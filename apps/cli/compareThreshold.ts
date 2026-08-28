/**
 * compareThreshold.ts — Día 3: compara umbral global vs Otsu vs adaptativo
 * sobre el dataset real de fotos, y deja un PNG lado a lado por foto para
 * inspección visual (PROMPT.md §8: en CV se depura mirando, no leyendo).
 *
 *   npx tsx apps/cli/compareThreshold.ts [carpeta=dataset/fotos] [outDir=dataset/debug]
 */
import { readdirSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import sharp from "sharp";
import { loadPages } from "./io/loadPages.ts";
import { dumpDebug } from "./io/dumpDebug.ts";
import { thresholdGlobal, thresholdOtsu, thresholdAdaptive } from "../../packages/engine/threshold.ts";
import type { GrayImage } from "../../packages/engine/types.ts";

const [, , inputDir = "dataset/fotos", outDir = "dataset/debug"] = process.argv;

/** Descarta duplicados exactos por contenido — no por nombre de archivo. */
function uniqueFiles(dir: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const hash = createHash("md5").update(readFileSync(join(dir, name))).digest("hex");
    if (seen.has(hash)) continue;
    seen.add(hash);
    out.push(name);
  }
  return out;
}

const LABEL_H = 24;

async function panelWithLabel(img: GrayImage, label: string): Promise<Buffer> {
  const png = await sharp(Buffer.from(img.data), {
    raw: { width: img.width, height: img.height, channels: 1 },
  }).png().toBuffer();

  const svg = Buffer.from(
    `<svg width="${img.width}" height="${LABEL_H}">
       <rect width="100%" height="100%" fill="black"/>
       <text x="8" y="${LABEL_H - 7}" font-size="16" fill="white" font-family="sans-serif">${label}</text>
     </svg>`
  );

  // sharp({create}) exige 3-4 canales (pensado para lienzos RGB/RGBA); para
  // un canvas de 1 solo canal se arma el buffer crudo directamente.
  const blank = Buffer.alloc(img.width * (img.height + LABEL_H), 0);
  return sharp(blank, { raw: { width: img.width, height: img.height + LABEL_H, channels: 1 } })
    .composite([{ input: svg, top: 0, left: 0 }, { input: png, top: LABEL_H, left: 0 }])
    .png()
    .toBuffer();
}

async function sideBySide(panels: Buffer[]): Promise<Buffer> {
  const metas = await Promise.all(panels.map((p) => sharp(p).metadata()));
  const gap = 6;
  const totalW = metas.reduce((s, m) => s + (m.width ?? 0), 0) + gap * (panels.length - 1);
  const h = Math.max(...metas.map((m) => m.height ?? 0));

  let x = 0;
  const composites = panels.map((input, i) => {
    const left = x;
    x += (metas[i]!.width ?? 0) + gap;
    return { input, left, top: 0 };
  });

  const blank = Buffer.alloc(totalW * h, 200);
  return sharp(blank, { raw: { width: totalW, height: h, channels: 1 } })
    .composite(composites)
    .png()
    .toBuffer();
}

const files = uniqueFiles(inputDir);
console.log(`${files.length} fotos únicas en ${inputDir}\n`);

for (const [i, file] of files.entries()) {
  const n = String(i + 1).padStart(2, "0");
  const pages = await loadPages(join(inputDir, file));
  const original = pages[0]!;

  const [global, otsu, adaptive] = await Promise.all([
    thresholdGlobal(original),
    thresholdOtsu(original),
    thresholdAdaptive(original),
  ]);

  const combined = await sideBySide([
    await panelWithLabel(original, "original"),
    await panelWithLabel(global, "global (128)"),
    await panelWithLabel(otsu, "otsu"),
    await panelWithLabel(adaptive, "adaptativo"),
  ]);

  const combinedImg: GrayImage = await sharp(combined)
    .raw()
    .toBuffer({ resolveWithObject: true })
    .then(({ data, info }) => ({ data: new Uint8Array(data), width: info.width, height: info.height }));

  const path = await dumpDebug("03-threshold", combinedImg, join(outDir, n));

  // % de píxeles "tinta" (255) en cada método — referencia numérica rápida,
  // no reemplaza mirar el PNG, pero avisa cuando algo se disparó
  // (ej. un método marcando >40% de la hoja como tinta es sospechoso: una
  // hoja real tiene mucho más papel que tinta).
  const inkPct = (img: GrayImage) => {
    let n2 = 0;
    for (const v of img.data) if (v === 255) n2++;
    return (n2 / img.data.length) * 100;
  };
  console.log(
    `${n} ${file.padEnd(45)} tinta% global=${inkPct(global).toFixed(1)} ` +
    `otsu=${inkPct(otsu).toFixed(1)} adaptativo=${inkPct(adaptive).toFixed(1)} → ${path}`
  );
}

console.log(
  `\nRevisa cada 03-threshold.png: la PUERTA del Día 3 es ≥8/10 fotos donde ` +
  `el panel "adaptativo" separa las burbujas del papel con claridad visual.`
);
