#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, existsSync as ex2 } from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { createServer } from "node:http";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const OUT = path.join(ROOT, "out");
const DIST = path.join(ROOT, "dist");

async function ensurePuppeteer() {
  try {
    const m = await import("puppeteer");
    return m.default;
  } catch {
    console.log("Installing puppeteer (chrome) ...");
    execSync("npm install --save-dev puppeteer@^23 2>&1 | tail -n 5", { cwd: ROOT, stdio: "inherit" });
    const m = await import("puppeteer");
    return m.default;
  }
}

async function main() {
  const puppeteer = await ensurePuppeteer();
  mkdirSync(OUT, { recursive: true });
  const PORT = 18837;
  const mime = { ".html": "text/html", ".css": "text/css", ".js": "application/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2", ".json": "application/json", ".webmanifest": "application/manifest+json" };
  const server = createServer((req, res) => {
    let p = path.join(DIST, decodeURIComponent(req.url.split("?")[0].replace(/^\//, "") || "index.html"));
    if (!existsSync(p) || p.endsWith("/")) p = path.join(DIST, "index.html");
    if (!existsSync(p)) { res.writeHead(404); return res.end("not found"); }
    const ext = path.extname(p);
    res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream" });
    res.end(readFileSync(p));
  });
  await new Promise(r => server.listen(PORT, "127.0.0.1", r));
  console.log(`Serving dist at http://127.0.0.1:${PORT}`);
  const browser = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--font-render-hinting=none"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 920, height: 1320, deviceScaleFactor: 2 });
  const sample = {
    id: "q_sample",
    number: "SB-2026-0001",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    client: "جربة لاسم السرحة",
    items: [{ id: "it1", name: "تجربة بيان اسم الصنف والسعر والاجمالي والعدد", qty: 2, price: 160 }],
    notes: [
      { id: "n1", text: "السعر: غيرشامل الضريبة." },
      { id: "n2", text: "التسليم خلال 7 أيام." },
    ],
    approver: "تجربة",
    thankYou: "ولكم جزيل الشكر",
    options: { showNumberAndDate: false, showVat: false, vatRate: 14, showDiscount: false, discountPercent: 0, showWords: false, showValidity: false, validityDays: 30, showWatermark: true },
    schemaVersion: 1,
  };
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle0", timeout: 15000 });
  await page.evaluate((q) => { localStorage.setItem("sb.draft.v1", JSON.stringify(q)); }, sample);
  await page.reload({ waitUntil: "networkidle0" });
  try { await page.evaluate(() => document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()); } catch {}
  await page.waitForSelector(".sheet-page", { timeout: 8000 });
  await new Promise(r => setTimeout(r, 900));
  const sheetHandle = await page.$(".sheet");
  const pngPath = path.join(OUT, "sheet-arabic-sample.png");
  if (sheetHandle) { await sheetHandle.screenshot({ path: pngPath }); console.log("PNG:", pngPath); }
  else { await page.screenshot({ path: pngPath, fullPage: true }); }
  const pdfPath = path.join(OUT, "sample-print.pdf");
  try {
    await page.pdf({ path: pdfPath, format: "A4", printBackground: true, preferCSSPageSize: true });
    console.log("PDF:", pdfPath);
  } catch (e) { console.warn("page.pdf failed:", e.message); }
  try {
    const out = execSync(`pdffonts "${pdfPath}" 2>&1`, { encoding: "utf8" });
    console.log("\n--- pdffonts (sample-print.pdf) ---\n" + out.slice(0, 2000));
    const t = execSync(`pdftotext -layout "${pdfPath}" - 2>&1 | head -n 80`, { encoding: "utf8" });
    console.log("\n--- pdftotext excerpt ---\n" + t);
    const img = execSync(`pdfimages -list "${pdfPath}" 2>&1 | head -n 30`, { encoding: "utf8" });
    console.log("\n--- pdfimages -list ---\n" + img);
    const info = execSync(`pdfinfo "${pdfPath}" 2>&1 | head -n 20`, { encoding: "utf8" });
    console.log("\n--- pdfinfo ---\n" + info);
    const preview = path.join(OUT, "preview-1.png");
    try { execSync(`pdftoppm -png -r 150 -f 1 -l 1 "${pdfPath}" "${path.join(OUT, "preview-1")}" 2>&1`, { encoding: "utf8" }); console.log("preview:", preview + "-1.png"); } catch {}
  } catch (e) { console.warn("poppler checks failed:", e.message); }
  await browser.close();
  server.close();
  console.log("\nDone. Open:", path.join(OUT, "sheet-arabic-sample.png"));
}
main().catch(e => { console.error(e); process.exit(1); });
