import { loadPages } from "./apps/cli/io/loadPages.ts";
import { analyzeGeometry } from "./packages/engine/geometry.ts";
import { fillRatio } from "./packages/engine/measurement.ts";
import { deriveThresholds, normalize } from "./packages/engine/calibration.ts";
import { classify } from "./packages/engine/classification.ts";
import { bubbleRoi } from "./template.ts";
import { buildOfficialTemplate } from "./packages/pdf-generator/officialTemplate.ts";
import type { BubbleGroup } from "./template.ts";

const DPI = 200;
const t = buildOfficialTemplate(100);

async function processSheet(file: string) {
  console.log(`\n========== ${file} ==========`);
  const pages = await loadPages(`dataset/fotos-marcadas/${file}`);
  const outcome = await analyzeGeometry(pages[0]!, t, DPI);
  if (outcome.kind !== "aligned") {
    console.log(`✗ RECHAZADA: ${outcome.reason}`);
    return;
  }
  console.log(`✓ alineada vía ${outcome.thresholdMethod}, error=${outcome.reprojectionErrorPx.toFixed(3)}px`);

  const cal = deriveThresholds(outcome.normalized, t, DPI);
  console.log(`  calibración: whiteRef=${cal.whiteRef.toFixed(3)} blackRef=${cal.blackRef.toFixed(3)}`);

  const classifyGroup = (g: BubbleGroup) => {
    const labeled = g.bubbles.map((b) => ({
      label: b.label,
      normalized: normalize(fillRatio(outcome.normalized, bubbleRoi(b, t, DPI)), cal),
    }));
    return { group: g, labeled, result: classify(labeled) };
  };

  // Código del alumno: 7 columnas de dígitos.
  const digitGroups = t.groups.filter((g) => g.kind === "digit").sort((a, b) => a.ordinal - b.ordinal);
  let codigo = "";
  for (const g of digitGroups) {
    const { result, labeled } = classifyGroup(g);
    if (result.kind === "ANSWERED") {
      codigo += result.option;
    } else {
      codigo += "?";
      console.log(`  dígito ${g.printedLabel}: ${result.kind} — valores=[${labeled.map((l) => l.normalized.toFixed(2)).join(",")}]`);
    }
  }
  console.log(`  CÓDIGO LEÍDO: ${codigo}`);

  // Preguntas 1,2,3,15,88 + un vistazo a cuántas dan BLANK en total.
  const sample = [1, 2, 3, 15, 88];
  for (const n of sample) {
    const g = t.groups.find((gr) => gr.id === `q.${n}`)!;
    const { result } = classifyGroup(g);
    console.log(`  Q${n}: ${JSON.stringify(result)}`);
  }

  const allQuestions = t.groups.filter((g) => g.kind === "question");
  const counts: Record<string, number> = {};
  for (const g of allQuestions) {
    const { result } = classifyGroup(g);
    counts[result.kind] = (counts[result.kind] ?? 0) + 1;
  }
  console.log(`  resumen 100 preguntas:`, counts);
}

await processSheet("limpia-05.jpeg");
await processSheet("marcada-01.jpeg");
