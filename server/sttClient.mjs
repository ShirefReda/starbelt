/* global FormData, Blob */
/**
 * Bilingual Egyptian Arabic + English Speech-to-Text Engine for Fathy AI.
 *
 * Indexed from ElevenLabs official docs (`https://elevenlabs.io/docs/llms.txt` ->
 * `https://elevenlabs.io/docs/api-reference/speech-to-text/convert.md` & `overview/models.md`):
 *
 * Priority #1: ElevenLabs Speech-to-Text (`POST /v1/speech-to-text`)
 *   - Primary model: `scribe_v3` with:
 *       - `language_code="ar"` + `secondary_language_codes=["en"]` (native mixed Arabic/English code-switching)
 *       - `numbers_format="digits"` (converts spoken Arabic/English measurements & prices to digits)
 *       - `keyterms` (curated Star Belt industrial belt vocabulary <= 100 terms)
 *       - `tag_audio_events="false"`
 *   - Automatic fallback to `scribe_v2` (multilingual auto-detect + keyterms) if `scribe_v3` is unavailable.
 *
 * Priority #2 (Built-In Fallback): Groq Whisper (`POST /openai/v1/audio/transcriptions`)
 *   - Uses the existing `GROQ_API_KEY` (`whisper-large-v3` -> `whisper-large-v3-turbo`)
 *   - Bilingual Egyptian Arabic + English Star Belt domain prompt with auto-language detection
 *     so code-switched English belt specs stay in crisp Latin characters.
 */

/**
 * Curated bilingual Star Belt domain glossary (strictly <= 100 terms, each <= 50 chars,
 * <= 5 words, and free of ElevenLabs disallowed chars `< > { } [ ] \`).
 */
export const STARBELT_STT_KEYTERMS = [
  // Triggers, company & quotation phrases
  "فتحي",
  "يا فتحي",
  "Fathy",
  "ستار بيلت",
  "Star Belt",
  "عرض سعر",
  "بيان سعر",
  "شامل الضريبة",
  "غير شامل الضريبة",
  "تسنيم",
  "شريف رضا",
  // Belt materials
  "PVC",
  "PU",
  "Polyurethane",
  "PTFE",
  "Teflon",
  "Silicone",
  "Rubber",
  "Neoprene",
  "EPDM",
  "Nitrile",
  "NBR",
  "Cotton",
  "Felt",
  "Canvas",
  "Kevlar",
  "Steel Cord",
  "Modular Belt",
  "Intralox",
  "Acetal",
  "POM",
  "Polypropylene",
  "PE",
  "HDPE",
  // Belt types & surface profiles
  "Conveyor Belt",
  "Timing Belt",
  "Flat Belt",
  "V-Belt",
  "Poly-V",
  "Ribbed Belt",
  "Round Belt",
  "Synchronous Belt",
  "Transmission Belt",
  "Elevator Belt",
  "Treadmill Belt",
  "Mesh Belt",
  "Wire Mesh",
  "Chevron",
  "Rough Top",
  "Supergrip",
  "Diamond Top",
  "Matt Finish",
  "Glossy",
  "Smooth Top",
  // Timing & V-belt profiles / pitches
  "HTD",
  "3M",
  "5M",
  "8M",
  "14M",
  "STD",
  "S5M",
  "S8M",
  "T2.5",
  "T5",
  "T10",
  "T20",
  "AT5",
  "AT10",
  "AT20",
  "MXL",
  "XL",
  "SPA",
  "SPB",
  "SPC",
  "SPZ",
  "3V",
  "5V",
  "8V",
  // Fabrication, joints & specs
  "Ply",
  "1 Ply",
  "2 Ply",
  "3 Ply",
  "4 Ply",
  "Food Grade",
  "FDA",
  "Antistatic",
  "Oil Resistant",
  "Heat Resistant",
  "Endless",
  "Open End",
  "Cleats",
  "Sidewall",
  "V-Guide",
  "Tracking Guide",
  "Alligator Lacing",
  "Clipper",
  "Vulcanized",
  "Finger Joint",
  "VAT",
];

const GROQ_BILINGUAL_PROMPT =
  "يا فتحي، شركة ستار بيلت لتصنيع السيور Star Belt. " +
  "سير ناقل PVC أخضر 2 ply أو 3 ply، PU Food Grade، PTFE Teflon، Silicone، Rubber، Modular Belt. " +
  "Timing Belt HTD 3M 5M 8M 14M AT5 AT10 T5 T10 XL، V-Belt SPA SPB SPC، Chevron، Rough Top، Cleats، Sidewall، V-Guide، Endless، Open End. " +
  "مقاس 50 سم × 12 متر، سمك 3 mm، السعر 4200 جنيه، خصم 5%، شامل ضريبة 14% VAT، اعمل عرض سعر PDF.";

/**
 * Map audio MIME types (including WhatsApp `audio/ogg; codecs=opus`) to a clean file extension.
 */
export function extensionForAudioMime(mimetype = "audio/ogg") {
  const mime = String(mimetype || "audio/ogg").toLowerCase().split(";")[0].trim();
  if (mime.includes("ogg") || mime.includes("opus")) return "ogg";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4") || mime.includes("m4a") || mime.includes("aac")) return "m4a";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("flac")) return "flac";
  return "ogg";
}

/**
 * Normalize common Arabic phonetic transliterations of English industrial belt terms
 * back into clean industry-standard English specs while keeping Egyptian Arabic natural.
 */
export function normalizeBilingualBeltTranscript(rawText) {
  if (!rawText || typeof rawText !== "string") return "";
  const replacements = [
    [/(?:بي\s*في\s*سي|بى\s*فى\s*سى|بيفيسي)/gi, "PVC"],
    [/(?:بي\s*تي\s*إ?أ?ا?ف\s*إ?ا?ي|بى\s*تى\s*اف\s*اى)/gi, "PTFE"],
    [/(?:تفلون|تيفلون)/gi, "Teflon"],
    [/(?:فود\s*جريد|فود\s*قريد)/gi, "Food Grade"],
    [/(?:تايمنج\s*بيلت|تايمنغ\s*بيلت)/gi, "Timing Belt"],
    [/(?:كونفيور\s*بيلت|كونفاير\s*بيلت)/gi, "Conveyor Belt"],
    [/(?:موديولار\s*بيلت|موديلار\s*بيلت)/gi, "Modular Belt"],
    [/(?:في\s*بيلت|فى\s*بيلت)/gi, "V-Belt"],
    [/(?:في\s*جايد|فى\s*جايد|في\s*قايد)/gi, "V-Guide"],
    [/(?:سايد\s*وول|سايد\s*ول)/gi, "Sidewall"],
    [/(?:راف\s*توب)/gi, "Rough Top"],
    [/(?:سوبر\s*جريب)/gi, "Supergrip"],
    [/(?:شفرون|شيفرون)/gi, "Chevron"],
    [/(?:أوبن\s*إند|اوبن\s*اند)/gi, "Open End"],
    [/(?:إندلس|اندلس|إندليس|اندليس)/gi, "Endless"],
    [/(?:اتش\s*تي\s*دي|إتش\s*تي\s*دي)/gi, "HTD"],
    [/(?:ون\s*بلاي|وان\s*بلاي)/gi, "1 ply"],
    [/(?:تو\s*بلاي)/gi, "2 ply"],
    [/(?:ثري\s*بلاي|تري\s*بلاي)/gi, "3 ply"],
    [/(?:فور\s*بلاي)/gi, "4 ply"],
    [/(?:أنتي\s*ستاتيك|انتي\s*ستاتيك)/gi, "Antistatic"],
    [/(?:بولي\s*يوريثان|بوليوريثان)/gi, "PU"],
    [/(?:بي\s*يو|بى\s*يو)(?=\s|$|[.,،])/gi, "PU"],
  ];

  let out = rawText.trim();
  for (const [pattern, replacement] of replacements) {
    out = out.replace(pattern, replacement);
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

export class FathySttClient {
  constructor({
    elevenLabsApiKey = "",
    elevenLabsBaseUrl = "https://api.elevenlabs.io",
    elevenLabsModel = "scribe_v3",
    useKeyterms = true,
    groqApiKey = "",
    groqBaseUrl = "https://api.groq.com/openai/v1",
  } = {}) {
    this.elevenLabsApiKey = elevenLabsApiKey.trim();
    this.elevenLabsBaseUrl = elevenLabsBaseUrl.trim().replace(/\/+$/, "");
    this.elevenLabsModel = elevenLabsModel.trim() || "scribe_v3";
    this.useKeyterms = Boolean(useKeyterms);
    this.groqApiKey = groqApiKey.trim();
    this.groqBaseUrl = groqBaseUrl.trim().replace(/\/+$/, "");
    this.lastSuccess = null;
  }

  isConfigured() {
    return Boolean(this.elevenLabsApiKey || this.groqApiKey);
  }

  getConfiguredProviders() {
    const providers = [];
    if (this.elevenLabsApiKey) providers.push(`elevenlabs/${this.elevenLabsModel}`);
    if (this.groqApiKey) providers.push("groq/whisper-large-v3", "groq/whisper-large-v3-turbo");
    return providers;
  }

  /**
   * Transcribe audio with ElevenLabs Speech-to-Text (`POST /v1/speech-to-text`).
   * Uses `scribe_v3` bilingual `language_code=ar` + `secondary_language_codes=en` +
   * `numbers_format=digits` + Star Belt `keyterms`, or `scribe_v2` auto-detect + `keyterms`.
   */
  async transcribeWithElevenLabs(audioBuffer, { mimetype = "audio/ogg", modelId = this.elevenLabsModel } = {}) {
    const ext = extensionForAudioMime(mimetype);
    const cleanMime = String(mimetype || "audio/ogg").split(";")[0].trim() || "audio/ogg";
    const form = new FormData();
    form.append("file", new Blob([audioBuffer], { type: cleanMime }), `voice.${ext}`);
    form.append("model_id", modelId);
    form.append("tag_audio_events", "false");

    const isV3 = /^scribe_v3/i.test(modelId);
    if (isV3) {
      // Scribe v3 native multilingual code-switching: Arabic primary + English secondary + digit numbers
      form.append("language_code", "ar");
      form.append("secondary_language_codes", "en");
      form.append("numbers_format", "digits");
    }
    // For scribe_v2, omit `language_code` so it auto-detects and keeps mixed Arabic+English specs intact

    if (this.useKeyterms) {
      for (const term of STARBELT_STT_KEYTERMS.slice(0, 100)) {
        form.append("keyterms", term);
      }
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 45_000);
    const startedAt = Date.now();
    try {
      const res = await fetch(`${this.elevenLabsBaseUrl}/v1/speech-to-text`, {
        method: "POST",
        headers: {
          "xi-api-key": this.elevenLabsApiKey,
          Accept: "application/json",
        },
        body: form,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const errText = (await res.text()).slice(0, 260);
        throw new Error(`elevenlabs/${modelId}: HTTP ${res.status} (${errText})`);
      }

      const data = await res.json();
      const rawTranscript =
        typeof data?.edited_transcript?.edited_text === "string" && data.edited_transcript.edited_text.trim()
          ? data.edited_transcript.edited_text
          : typeof data?.text === "string"
            ? data.text
            : Array.isArray(data?.transcripts)
              ? data.transcripts.map((t) => t?.text || "").join(" ").trim()
              : "";

      const text = normalizeBilingualBeltTranscript(rawTranscript);
      if (!text) {
        throw new Error(`elevenlabs/${modelId}: empty transcript`);
      }

      const latencyMs = Date.now() - startedAt;
      this.lastSuccess = {
        provider: "elevenlabs",
        model: modelId,
        latencyMs,
        at: new Date().toISOString(),
      };
      return {
        text,
        rawText: rawTranscript.trim(),
        provider: "elevenlabs",
        model: modelId,
        languageCode: data?.language_code || "ar",
        latencyMs,
      };
    } catch (err) {
      clearTimeout(timer);
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  /**
   * Transcribe audio with Groq Whisper (`POST /openai/v1/audio/transcriptions`).
   * Keeps language auto-detected + supplies a bilingual Egyptian Arabic & English Star Belt prompt
   * so English specs (PVC, PU, HTD 8M, 2 ply) stay in clean Latin script inside Arabic sentences.
   */
  async transcribeWithGroq(audioBuffer, { mimetype = "audio/ogg", model = "whisper-large-v3" } = {}) {
    const ext = extensionForAudioMime(mimetype);
    const cleanMime = String(mimetype || "audio/ogg").split(";")[0].trim() || "audio/ogg";
    const form = new FormData();
    form.append("file", new Blob([audioBuffer], { type: cleanMime }), `voice.${ext}`);
    form.append("model", model);
    form.append("prompt", GROQ_BILINGUAL_PROMPT);
    form.append("response_format", "verbose_json");
    form.append("temperature", "0");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 40_000);
    const startedAt = Date.now();
    try {
      const res = await fetch(`${this.groqBaseUrl}/audio/transcriptions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.groqApiKey}`,
          Accept: "application/json",
        },
        body: form,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!res.ok) {
        const errText = (await res.text()).slice(0, 260);
        throw new Error(`groq/${model}: HTTP ${res.status} (${errText})`);
      }

      const data = await res.json();
      const rawTranscript = typeof data?.text === "string" ? data.text.trim() : "";
      const text = normalizeBilingualBeltTranscript(rawTranscript);
      if (!text) {
        throw new Error(`groq/${model}: empty transcript`);
      }

      const latencyMs = Date.now() - startedAt;
      this.lastSuccess = {
        provider: "groq",
        model,
        latencyMs,
        at: new Date().toISOString(),
      };
      return {
        text,
        rawText: rawTranscript,
        provider: "groq",
        model,
        languageCode: data?.language || "ar",
        latencyMs,
      };
    } catch (err) {
      clearTimeout(timer);
      throw err instanceof Error ? err : new Error(String(err));
    }
  }

  /**
   * Transcribe an audio buffer (WhatsApp voice note or web microphone recording) using:
   * 1. ElevenLabs Scribe (`scribe_v3`, then `scribe_v2` fallback)
   * 2. Groq Whisper (`whisper-large-v3`, then `whisper-large-v3-turbo` fallback)
   */
  async transcribeAudio(audioBuffer, { mimetype = "audio/ogg" } = {}) {
    if (!audioBuffer || audioBuffer.length < 100) {
      throw new Error("Audio buffer is empty or too short to transcribe");
    }
    if (!this.isConfigured()) {
      throw new Error(
        "No Speech-to-Text provider configured. Set ELEVENLABS_API_KEY (recommended, Scribe v3) or GROQ_API_KEY.",
      );
    }

    const errors = [];

    // Priority #1: ElevenLabs Scribe (scribe_v3 -> scribe_v2)
    if (this.elevenLabsApiKey) {
      const modelsToTry =
        this.elevenLabsModel === "scribe_v2"
          ? ["scribe_v2"]
          : [this.elevenLabsModel, "scribe_v2"];
      for (const modelId of modelsToTry) {
        try {
          return await this.transcribeWithElevenLabs(audioBuffer, { mimetype, modelId });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[Fathy STT] Fallback from elevenlabs/${modelId}: ${msg}`);
          errors.push(msg);
        }
      }
    }

    // Priority #2: Groq Whisper fallback (whisper-large-v3 -> whisper-large-v3-turbo)
    if (this.groqApiKey) {
      for (const model of ["whisper-large-v3", "whisper-large-v3-turbo"]) {
        try {
          return await this.transcribeWithGroq(audioBuffer, { mimetype, model });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn(`[Fathy STT] Fallback from groq/${model}: ${msg}`);
          errors.push(msg);
        }
      }
    }

    throw new Error(`Speech-to-Text failed: ${errors.slice(0, 4).join(" | ")}`);
  }
}
