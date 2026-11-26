"""Private, single-user localhost gateway around the official `agy` CLI."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import secrets
import shutil
import signal
import sys
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import AsyncIterator

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

MIN_SHARED_SECRET_LEN = 32
MAX_WAITING_REQUESTS = 5
RETRY_BACKOFFS = (2.0, 5.0)
TRANSIENT_EXEC_ERROR = "Agent execution terminated due to error"

# Patterns indicating the `agy` CLI is not signed in.
NOT_SIGNED_IN_MARKERS = (
    "not signed in",
    "not logged in",
    "please sign in",
    "sign in required",
    "login required",
    "authentication required",
    "unauthenticated",
    "run `agy` to sign in",
)

ANSI_ESCAPE_RE = re.compile(r"\x1b\[[0-9;?]*[ -/]*[@-~]")
MODEL_ID_RE = re.compile(r"^[a-zA-Z0-9][a-zA-Z0-9._:-]{1,127}$")

logging.basicConfig(
    level=logging.INFO,
    format="%(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger("agy-gateway")


@dataclass(frozen=True)
class GatewayConfig:
    gateway_secret: str
    agy_bin: str
    workspace: Path
    default_model: str
    min_gap: float
    timeout: float
    port: int
    kill_switch_file: Path


def load_config() -> GatewayConfig:
    secret = os.environ.get("GATEWAY_TOKEN", "").strip()
    if len(secret) < MIN_SHARED_SECRET_LEN:
        raise RuntimeError(
            f"GATEWAY_TOKEN must be set and at least {MIN_SHARED_SECRET_LEN} characters long."
        )

    agy_bin = os.environ.get("AGY_BIN", "agy").strip() or "agy"
    workspace_raw = os.environ.get("AGY_WORKSPACE", "/srv/agy-workspace").strip()
    if not workspace_raw:
        raise RuntimeError("AGY_WORKSPACE must be set to a valid directory path.")
    workspace = Path(workspace_raw).resolve()
    if not workspace.is_dir():
        raise RuntimeError(f"AGY_WORKSPACE does not exist or is not a directory: {workspace}")

    default_model = os.environ.get("AGY_MODEL", "gemini-3.8-flash-medium").strip()
    min_gap = max(0.0, float(os.environ.get("AGY_MIN_GAP", "2")))
    timeout = max(0.1, float(os.environ.get("AGY_TIMEOUT", "120")))
    port = int(os.environ.get("PORT", "8787"))
    kill_switch_file = Path(
        os.environ.get("AGY_KILL_SWITCH_FILE", "/srv/agy-gateway/DISABLED")
    )

    return GatewayConfig(
        gateway_secret=secret,
        agy_bin=agy_bin,
        workspace=workspace,
        default_model=default_model,
        min_gap=min_gap,
        timeout=timeout,
        port=port,
        kill_switch_file=kill_switch_file,
    )


def parse_models_output(raw_output: str) -> set[str]:
    """Parse model IDs from `agy models` output, stripping spinner and ANSI sequences."""
    cleaned = ANSI_ESCAPE_RE.sub("", raw_output)
    models: set[str] = set()
    for raw_line in cleaned.splitlines():
        # Spinner frames use carriage return; keep text after the final '\r'.
        line = raw_line.split("\r")[-1].strip()
        if not line:
            continue
        if line.lower().startswith("fetching available models"):
            continue
        first_col = line.split()[0]
        if MODEL_ID_RE.match(first_col):
            models.add(first_col)
    return models


def is_not_signed_in(combined_output: str) -> bool:
    lowered = combined_output.lower()
    return any(marker in lowered for marker in NOT_SIGNED_IN_MARKERS)


async def kill_process_group(proc: asyncio.subprocess.Process) -> None:
    """Terminate the entire process group of a subprocess cleanly, leaving no strays."""
    try:
        pgid = os.getpgid(proc.pid)
    except ProcessLookupError:
        pgid = proc.pid

    try:
        os.killpg(pgid, signal.SIGTERM)
    except ProcessLookupError:
        pass

    if proc.returncode is None:
        try:
            await asyncio.wait_for(proc.wait(), timeout=1.5)
        except asyncio.TimeoutError:
            pass

    # Always follow up with SIGKILL on the process group so no background child survives.
    try:
        os.killpg(pgid, signal.SIGKILL)
    except ProcessLookupError:
        pass

    if proc.returncode is None:
        try:
            await asyncio.wait_for(proc.wait(), timeout=2.0)
        except asyncio.TimeoutError:
            pass


class GatewayState:
    def __init__(self, config: GatewayConfig) -> None:
        self.config = config
        self.lock = asyncio.Lock()
        self.waiting = 0
        self.last_call = 0.0
        self.allowed_models: set[str] = set()
        self.models_loaded_at = 0.0

    def check_kill_switch(self) -> None:
        if self.config.kill_switch_file.exists():
            raise HTTPException(status_code=503, detail="Gateway is temporarily disabled.")

    def verify_auth(self, authorization: str | None) -> None:
        expected = f"Bearer {self.config.gateway_secret}"
        if not authorization or not secrets.compare_digest(authorization, expected):
            raise HTTPException(status_code=401, detail="Unauthorized")

    def resolve_agy_binary(self) -> str:
        resolved = shutil.which(self.config.agy_bin)
        if resolved:
            return resolved
        candidate = Path(self.config.agy_bin)
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
        raise HTTPException(
            status_code=503,
            detail=(
                f"`{self.config.agy_bin}` CLI is not installed or not in PATH. "
                "Install `agy` from antigravity.google and sign in manually on the server."
            ),
        )

    async def refresh_allowed_models(self, force: bool = False) -> set[str]:
        now = time.monotonic()
        if not force and self.allowed_models and (now - self.models_loaded_at) < 300.0:
            return self.allowed_models

        agy_bin = self.resolve_agy_binary()
        try:
            proc = await asyncio.create_subprocess_exec(
                agy_bin,
                "models",
                cwd=str(self.config.workspace),
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                start_new_session=True,
            )
        except FileNotFoundError as exc:
            raise HTTPException(
                status_code=503,
                detail="Install `agy` on the server and sign in manually before calling the gateway.",
            ) from exc

        try:
            stdout_b, stderr_b = await asyncio.wait_for(proc.communicate(), timeout=30.0)
        except asyncio.TimeoutError as exc:
            await kill_process_group(proc)
            raise HTTPException(
                status_code=503,
                detail="Timed out checking `agy models`. Ensure `agy` is installed and signed in on the server.",
            ) from exc

        stdout_s = stdout_b.decode("utf-8", errors="replace")
        stderr_s = stderr_b.decode("utf-8", errors="replace")
        combined = f"{stdout_s}\n{stderr_s}"

        if is_not_signed_in(combined):
            raise HTTPException(
                status_code=503,
                detail="`agy` is not signed in. Sign in manually as the service user on the server by running `agy`.",
            )

        models = parse_models_output(stdout_s)
        if not models and proc.returncode != 0:
            raise HTTPException(
                status_code=503,
                detail="Unable to list models from `agy models`. Verify `agy` is installed and signed in on the server.",
            )

        if models:
            self.allowed_models = models
            self.models_loaded_at = now
        return self.allowed_models

    async def validate_model(self, requested_model: str | None) -> str | None:
        model = (requested_model or "").strip() or self.config.default_model
        if not model:
            return None

        if not MODEL_ID_RE.match(model):
            raise HTTPException(status_code=400, detail="Invalid model name format.")

        allowed = await self.refresh_allowed_models(force=False)
        if model not in allowed:
            # Refresh once in case new models became available.
            allowed = await self.refresh_allowed_models(force=True)
        if model not in allowed:
            raise HTTPException(
                status_code=400,
                detail="Requested model is not in the allowlist returned by `agy models`.",
            )
        return model

    def build_command(
        self,
        agy_bin: str,
        prompt: str,
        model: str | None,
        output_format: str,
    ) -> list[str]:
        cmd = [
            agy_bin,
            "-p",
            prompt,
            "--sandbox",
            "--disable-slash-commands",
            "--output-format",
            output_format,
        ]
        if model:
            cmd.extend(["--model", model])
        return cmd

    async def enforce_min_gap(self) -> None:
        if self.config.min_gap <= 0:
            return
        elapsed = time.monotonic() - self.last_call
        gap = self.config.min_gap - elapsed
        if gap > 0:
            await asyncio.sleep(gap)

    async def run_agy_once(self, cmd: list[str]) -> tuple[int, str, str]:
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                cwd=str(self.config.workspace),
                stdin=asyncio.subprocess.DEVNULL,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                start_new_session=True,
            )
        except FileNotFoundError as exc:
            raise HTTPException(
                status_code=503,
                detail="Install `agy` on the server and sign in manually before calling the gateway.",
            ) from exc

        try:
            stdout_b, stderr_b = await asyncio.wait_for(
                proc.communicate(), timeout=self.config.timeout
            )
        except asyncio.TimeoutError as exc:
            await kill_process_group(proc)
            raise HTTPException(
                status_code=504,
                detail=f"`agy` timed out after {self.config.timeout:g}s and was terminated.",
            ) from exc
        except asyncio.CancelledError:
            await kill_process_group(proc)
            raise

        stdout_s = stdout_b.decode("utf-8", errors="replace")
        stderr_s = stderr_b.decode("utf-8", errors="replace")
        return proc.returncode or 0, stdout_s, stderr_s

    async def execute_prompt(self, prompt: str, model: str | None) -> str:
        agy_bin = self.resolve_agy_binary()
        cmd = self.build_command(agy_bin, prompt, model, output_format="text")

        max_attempts = 1 + len(RETRY_BACKOFFS)
        for attempt in range(max_attempts):
            if attempt > 0:
                await asyncio.sleep(RETRY_BACKOFFS[attempt - 1])

            await self.enforce_min_gap()
            self.last_call = time.monotonic()
            rc, stdout_s, stderr_s = await self.run_agy_once(cmd)
            self.last_call = time.monotonic()

            combined = f"{stdout_s}\n{stderr_s}"
            if is_not_signed_in(combined):
                raise HTTPException(
                    status_code=503,
                    detail="`agy` is not signed in. Sign in manually as the service user on the server by running `agy`.",
                )

            if TRANSIENT_EXEC_ERROR in combined:
                if attempt < len(RETRY_BACKOFFS):
                    continue
                raise HTTPException(
                    status_code=502,
                    detail="Upstream `agy` execution failed after retries.",
                )

            if rc != 0:
                raise HTTPException(
                    status_code=502,
                    detail=f"`agy` exited with non-zero status ({rc}).",
                )

            return stdout_s.strip()

        raise HTTPException(status_code=502, detail="Upstream `agy` execution failed.")


class AskRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=200_000)
    model: str | None = Field(default=None)


def log_request_event(
    path: str, status_code: int, duration_ms: float, prompt_len: int | None
) -> None:
    """Log metadata ONLY — never log prompt text, answers, or secrets."""
    ts = datetime.now(timezone.utc).isoformat(timespec="seconds")
    prompt_info = f" prompt_len={prompt_len}" if prompt_len is not None else ""
    logger.info(
        f"ts={ts} path={path} status={status_code} duration_ms={duration_ms:.1f}{prompt_info}"
    )


def create_app() -> FastAPI:
    config = load_config()
    state = GatewayState(config)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        async def _warmup() -> None:
            try:
                await state.refresh_allowed_models(force=True)
                logger.info(
                    f"ts={datetime.now(timezone.utc).isoformat(timespec='seconds')} "
                    f"event=startup models_loaded={len(state.allowed_models)}"
                )
            except HTTPException as exc:
                logger.warning(
                    f"ts={datetime.now(timezone.utc).isoformat(timespec='seconds')} "
                    f"event=startup_warning status={exc.status_code}"
                )

        warmup_task = asyncio.create_task(_warmup())
        try:
            yield
        finally:
            if not warmup_task.done():
                warmup_task.cancel()

    app = FastAPI(title="Private AGY Local Gateway", docs_url=None, redoc_url=None, lifespan=lifespan)
    app.state.gateway = state

    @app.get("/healthz")
    async def healthz() -> dict[str, bool]:
        started = time.monotonic()
        status_code = 200
        try:
            state.check_kill_switch()
            return {"ok": True}
        except HTTPException as exc:
            status_code = exc.status_code
            raise
        finally:
            log_request_event("/healthz", status_code, (time.monotonic() - started) * 1000, None)

    @app.post("/v1/ask")
    async def ask(
        body: AskRequest,
        authorization: str | None = Header(default=None),
    ) -> dict[str, str]:
        started = time.monotonic()
        prompt_len = len(body.prompt)
        status_code = 200
        queued = False

        try:
            state.check_kill_switch()
            state.verify_auth(authorization)

            if state.lock.locked() and state.waiting >= MAX_WAITING_REQUESTS:
                raise HTTPException(status_code=429, detail="Too many waiting requests.")

            if state.lock.locked():
                state.waiting += 1
                queued = True

            try:
                async with state.lock:
                    if queued:
                        state.waiting -= 1
                        queued = False
                    state.check_kill_switch()
                    model = await state.validate_model(body.model)
                    reply_text = await state.execute_prompt(body.prompt, model)
                    return {"text": reply_text}
            finally:
                if queued:
                    state.waiting -= 1
        except HTTPException as exc:
            status_code = exc.status_code
            raise
        except Exception:
            status_code = 500
            raise
        finally:
            log_request_event(
                "/v1/ask", status_code, (time.monotonic() - started) * 1000, prompt_len
            )

    @app.post("/v1/ask/stream")
    async def ask_stream(
        body: AskRequest,
        request: Request,
        authorization: str | None = Header(default=None),
    ) -> StreamingResponse:
        started = time.monotonic()
        prompt_len = len(body.prompt)

        try:
            state.check_kill_switch()
            state.verify_auth(authorization)

            if state.lock.locked() and state.waiting >= MAX_WAITING_REQUESTS:
                raise HTTPException(status_code=429, detail="Too many waiting requests.")
        except HTTPException as exc:
            log_request_event(
                "/v1/ask/stream", exc.status_code, (time.monotonic() - started) * 1000, prompt_len
            )
            raise

        async def event_generator() -> AsyncIterator[str]:
            queued = False
            status_code = 200
            proc: asyncio.subprocess.Process | None = None
            try:
                if state.lock.locked():
                    state.waiting += 1
                    queued = True

                async with state.lock:
                    if queued:
                        state.waiting -= 1
                        queued = False

                    state.check_kill_switch()
                    agy_bin = state.resolve_agy_binary()
                    model = await state.validate_model(body.model)
                    await state.enforce_min_gap()
                    state.last_call = time.monotonic()

                    cmd = state.build_command(
                        agy_bin, body.prompt, model, output_format="stream-json"
                    )
                    try:
                        proc = await asyncio.create_subprocess_exec(
                            *cmd,
                            cwd=str(state.config.workspace),
                            stdin=asyncio.subprocess.DEVNULL,
                            stdout=asyncio.subprocess.PIPE,
                            stderr=asyncio.subprocess.PIPE,
                            start_new_session=True,
                        )
                    except FileNotFoundError:
                        status_code = 503
                        yield f"event: error\ndata: {json.dumps({'status': 503, 'detail': 'agy CLI not installed on server'})}\n\n"
                        return

                    deadline = time.monotonic() + state.config.timeout
                    assert proc.stdout is not None
                    while True:
                        if await request.is_disconnected():
                            await kill_process_group(proc)
                            return

                        remaining = deadline - time.monotonic()
                        if remaining <= 0:
                            status_code = 504
                            await kill_process_group(proc)
                            yield f"event: error\ndata: {json.dumps({'status': 504, 'detail': 'agy timed out'})}\n\n"
                            return

                        try:
                            raw_line = await asyncio.wait_for(
                                proc.stdout.readline(), timeout=min(remaining, 1.0)
                            )
                        except asyncio.TimeoutError:
                            continue

                        if not raw_line:
                            break

                        line = raw_line.decode("utf-8", errors="replace").strip()
                        if not line:
                            continue

                        try:
                            evt = json.loads(line)
                        except json.JSONDecodeError:
                            continue

                        if evt.get("event") == "step_update":
                            delta = (evt.get("step_update") or {}).get("text_delta")
                            if isinstance(delta, str) and delta:
                                yield f"data: {json.dumps({'delta': delta}, ensure_ascii=False)}\n\n"
                        elif evt.get("event") == "result":
                            res_obj = evt.get("result") or {}
                            if res_obj.get("status") != "SUCCESS":
                                status_code = 502
                                yield f"event: error\ndata: {json.dumps({'status': 502, 'detail': 'agy execution error'})}\n\n"
                                return

                    await proc.wait()
                    state.last_call = time.monotonic()
                    if proc.returncode != 0:
                        stderr_s = ""
                        if proc.stderr is not None:
                            stderr_s = (await proc.stderr.read()).decode("utf-8", errors="replace")
                        if is_not_signed_in(stderr_s):
                            status_code = 503
                            yield f"event: error\ndata: {json.dumps({'status': 503, 'detail': 'agy is not signed in on server'})}\n\n"
                        else:
                            status_code = 502
                            yield f"event: error\ndata: {json.dumps({'status': 502, 'detail': 'agy exited with error'})}\n\n"
                        return

                    yield "event: done\ndata: {}\n\n"
            except HTTPException as exc:
                status_code = exc.status_code
                yield f"event: error\ndata: {json.dumps({'status': exc.status_code, 'detail': exc.detail})}\n\n"
            finally:
                if proc is not None and proc.returncode is None:
                    await kill_process_group(proc)
                if queued:
                    state.waiting -= 1
                log_request_event(
                    "/v1/ask/stream",
                    status_code,
                    (time.monotonic() - started) * 1000,
                    prompt_len,
                )

        return StreamingResponse(event_generator(), media_type="text/event-stream")

    @app.exception_handler(HTTPException)
    async def http_exc_handler(_req: Request, exc: HTTPException) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

    return app


def main() -> None:
    import uvicorn

    config = load_config()
    app = create_app()
    # Hardcoded loopback bind only — never bind 0.0.0.0.
    uvicorn.run(app, host="127.0.0.1", port=config.port, access_log=False)


if __name__ == "__main__":
    main()
