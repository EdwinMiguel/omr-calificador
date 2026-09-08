/**
 * evaluateHalfSheet.ts — la Fase 2 del plan de la media hoja: mide contra
 * hojas físicas REALES lo que la geometría de halfSheetTemplate.ts solo
 * probó en el papel (validateTemplate() + inspección visual del PDF).
 *
 * Corre el pipeline COMPLETO (analyzeSheet, no una reimplementación) contra
 * cada imagen de una carpeta, y si existe un ground-truth/*.json para esa
 * imagen (mismo formato que ya usan hoja-resuelta-escaneada.json,
 * IMG_20260830_172453.json e IMG_20260830_174156.json — sha256 + marks +
 * opcionalmente studentCode.columns), calcula:
 *
 *   - AUTO_ACCEPTED_INCORRECT — la barrera de PROMPT.md §15. Si esto no da
 *     0, la respuesta a "¿esto sigue?" es no, sin importar nada más.
 *   - brecha de separación (peor positivo − mejor negativo) por hoja, para
 *     comparar contra los 0.107 mm que ya tiene la hoja oficial actual
 *     (ver classification.ts / la nota de measurement-margin en
 *     halfSheetTemplate.ts, que predijo 0.78mm de margen ANTES de tener
 *     una sola hoja física — este script es lo que confirma si acertó).
 *   - contaminación entre burbujas vecinas: si el ROI de una opción
 *     "sin marcar" mide sospechosamente alto, es la señal de que el paso
 *     de 4.5mm (más chico que los 5.0mm de la hoja oficial) se está
 *     comiendo el margen — el riesgo #1 que el plan declaró.
 *
 * Uso:
 *   npx tsx apps/cli/evaluateHalfSheet.ts [carpeta=dataset/media-hoja] [groundTruthDir=ground-truth]
 *
 * Sin ground-truth para una imagen, igual reporta si la geometría resolvió
 * (marcadores, homografía, calibración) — eso solo ya es información real:
 * una hoja que ni siquiera alinea no necesita esperar a tener la verdad
 * dictada para saber que algo anda mal.
 */

import { readdirSync, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { extname, join, basename } from "node:path";
import { loadPages } from "./io/loadPages.ts";
import { analyzeSheet } from "../../packages/engine/analyzeSheet.ts";
import { buildHalfSheetTemplate } from "../../packages/pdf-generator/halfSheetTemplate.ts";
import type { QuestionResult } from "../../packages/engine/scoring.ts";

const DPI = 200;
const RASTER_EXT = new Set([".jpg", ".jpeg", ".png", ".tif", ".tiff", ".pdf"]);

const [, , inputDir = "dataset/media-hoja", gtDir = "ground-truth"] = process.argv;

interface GroundTruth {
  sheet: string;
  sha256: string;
  marks: Record<string, string | null>;
  studentCode?: { columns: (string | null)[] };
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function findGroundTruth(sha256: string, fileName: string): GroundTruth | null {
  if (!existsSync(gtDir)) return null;
  for (const name of readdirSync(gtDir)) {
    if (!name.endsWith(".json")) continue;
    const gt = JSON.parse(readFileSync(join(gtDir, name), "utf8")) as GroundTruth;
    if (gt.sha256 === sha256 || gt.sheet === fileName) return gt;
  }
  return null;
}

/** Todas las opciones NO marcadas de las preguntas donde la verdad SÍ
 * conoce cuál se marcó — la misma definición de "negativo conocido" que
 * usó el experimento del estimador (dataset original con 3 hojas). */
function separationGap(
  questions: QuestionResult[], measurements: Record<number, Record<string, number>>, marks: Record<string, string | null>
): { gap: number | null; worstPositive: number; bestNegative: number } | null {
  const pos: number[] = [];
  const neg: number[] = [];
  for (const q of questions) {
    const truth = marks[String(q.ordinal)];
    if (truth == null) continue; // pregunta en blanco a propósito: no aporta positivo ni negativo de opción
    const fills = measurements[q.ordinal];
    if (!fills) continue;
    for (const [label, v] of Object.entries(fills)) {
      if (label === truth) pos.push(v);
      else neg.push(v);
    }
  }
  if (pos.length === 0 || neg.length === 0) return null;
  const worstPositive = Math.min(...pos);
  const bestNegative = Math.max(...neg);
  return { gap: worstPositive - bestNegative, worstPositive, bestNegative };
}

function uniqueFiles(dir: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    if (!RASTER_EXT.has(extname(name).toLowerCase())) continue;
    const bytes = readFileSync(join(dir, name));
    const hash = sha256Hex(bytes);
    if (seen.has(hash)) continue;
    seen.add(hash);
    out.push(name);
  }
  return out;
}

async function main() {
  if (!existsSync(inputDir)) {
    console.log(`No existe ${inputDir} todavía.`);
    console.log(`\nEsta es la Fase 2 del plan de la media hoja — necesita hojas FÍSICAS reales,`);
    console.log(`no se puede simular: imprimir hoja-media-a4.pdf al 100%, cortar por la mitad,`);
    console.log(`llenar varias mitades a mano (presión variada, incluida floja), dictar la`);
    console.log(`verdad MIRANDO EL PAPEL antes de procesar (§14) en ${gtDir}/, y escanear cada`);
    console.log(`mitad por separado hacia ${inputDir}/.`);
    process.exit(1);
  }

  const files = uniqueFiles(inputDir);
  if (files.length === 0) {
    console.log(`${inputDir}/ existe pero no tiene imágenes todavía.`);
    process.exit(1);
  }

  const t = buildHalfSheetTemplate(100);
  console.log(`Plantilla ${t.id} v${t.version} — ${files.length} archivo(s) en ${inputDir}/\n`);

  let totalOk = 0, totalErr = 0, totalRev = 0;
  const errList: string[] = [];
  const gaps: { file: string; gap: number }[] = [];
  let geometryFails = 0;

  for (const fileName of files) {
    const bytes = readFileSync(join(inputDir, fileName));
    const sha256 = sha256Hex(bytes);
    const pages = await loadPages(join(inputDir, fileName));
    const img = pages[0]!;

    const outcome = await analyzeSheet(img, t, DPI, {});

    if (outcome.kind === "rejected" && !outcome.partial) {
      geometryFails++;
      console.log(`✗ ${fileName}: RECHAZADA sin lectura parcial — ${outcome.reason}`);
      continue;
    }

    const questions = outcome.kind === "processed" ? outcome.result.questions : outcome.partial!.questions;
    const measurements = outcome.kind === "processed" ? outcome.result.measurements : outcome.partial!.measurements;
    const reproj = outcome.kind === "processed" ? outcome.result.reprojectionErrorPx : outcome.partial!.reprojectionErrorPx;
    const method = outcome.kind === "processed" ? outcome.result.thresholdMethod : outcome.partial!.thresholdMethod;

    const gt = findGroundTruth(sha256, basename(fileName));
    const tag = outcome.kind === "processed" ? "procesada" : `rechazada (${outcome.reason}, con lectura parcial)`;
    console.log(`${gt ? "✓" : "○"} ${fileName}: ${tag} — reproj=${reproj.toFixed(3)}px vía ${method}${gt ? "" : "  [sin ground-truth]"}`);

    if (!gt) continue;

    let ok = 0, err = 0, rev = 0;
    const badList: string[] = [];
    for (const q of questions) {
      const truth = gt.marks[String(q.ordinal)] ?? null;
      const st = q.state;
      if (st.kind === "ANSWERED") {
        if (st.option === truth) ok++;
        else { err++; badList.push(`  ✗ Q${q.ordinal} leyó ${st.option}, verdad ${truth ?? "BLANCO"}`); }
      } else if (st.kind === "BLANK") {
        if (truth === null) ok++;
        else { err++; badList.push(`  ✗ Q${q.ordinal} leyó BLANCO, verdad ${truth}`); }
      } else {
        rev++;
      }
    }
    totalOk += ok; totalErr += err; totalRev += rev;
    console.log(`    verdad: ${ok} ok / ${err} INCORRECTAS / ${rev} revisión`);
    for (const b of badList) { console.log(b); errList.push(`${fileName} ${b.trim()}`); }

    const sep = separationGap(questions, measurements, gt.marks);
    if (sep) {
      gaps.push({ file: fileName, gap: sep.gap! });
      console.log(`    brecha de separación: ${sep.gap!.toFixed(3)} (peor positivo ${sep.worstPositive.toFixed(3)}, mejor negativo ${sep.bestNegative.toFixed(3)})`);
    }
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`RESUMEN`);
  console.log(`  hojas cuya geometría no resolvió: ${geometryFails} de ${files.length}`);
  console.log(`  con verdad conocida — correctas: ${totalOk}  AUTO_ACCEPTED_INCORRECT: ${totalErr}  revisión: ${totalRev}`);
  if (gaps.length > 0) {
    const worst = gaps.reduce((a, b) => (b.gap < a.gap ? b : a));
    console.log(`  brecha de separación, peor caso: ${worst.gap.toFixed(3)} (${worst.file})`);
    console.log(`  brecha de separación, todas: ${gaps.map((g) => `${g.file}=${g.gap.toFixed(3)}`).join("  ")}`);
  }
  if (totalErr > 0) {
    console.log(`\n✗ NO CUMPLE LA BARRERA §15 (AUTO_ACCEPTED_INCORRECT debe ser 0). No avanzar a la Fase 3.`);
    process.exit(1);
  } else if (totalOk + totalRev + totalErr === 0) {
    console.log(`\n○ Ninguna imagen tuvo ground-truth — faltan los archivos en ${gtDir}/ para poder concluir algo.`);
  } else {
    console.log(`\n✓ 0 auto-aceptadas incorrectas sobre ${totalOk + totalErr} preguntas con verdad conocida.`);
  }
}

await main();
