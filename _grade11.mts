import { loadPages } from "./apps/cli/io/loadPages.ts";
import { analyzeGeometry } from "./packages/engine/geometry.ts";
import { fillRatioNearby } from "./packages/engine/measurement.ts";
import { deriveThresholds, normalize } from "./packages/engine/calibration.ts";
import { classify } from "./packages/engine/classification.ts";
import { bubbleRoi } from "./template.ts";
import { buildOfficialTemplate } from "./packages/pdf-generator/officialTemplate.ts";

const DPI = 200;
const t = buildOfficialTemplate(100);

const file = "foto-11.jpeg";
const pages = await loadPages(`dataset/fotos-marcadas/${file}`);
console.log(`cargada: ${pages[0]!.width}x${pages[0]!.height}`);
const outcome = await analyzeGeometry(pages[0]!, t, DPI);
if (outcome.kind !== "aligned") { console.log(`✗ RECHAZADA: ${outcome.reason}`); process.exit(1); }
console.log(`✓ alineada vía ${outcome.thresholdMethod}, error=${outcome.reprojectionErrorPx.toFixed(3)}px`);

const cal = deriveThresholds(outcome.normalized, t, DPI);
console.log(`calibración: whiteRef=${cal.whiteRef.toFixed(3)} blackRef=${cal.blackRef.toFixed(3)} contraste=${(cal.blackRef-cal.whiteRef).toFixed(3)}`);

const classifyGroup = (g: typeof t.groups[number]) => {
  const labeled = g.bubbles.map((b) => ({
    label: b.label,
    normalized: normalize(fillRatioNearby(outcome.normalized, bubbleRoi(b, t, DPI)), cal),
  }));
  return classify(labeled);
};

let codigo = "";
for (const g of t.groups.filter((g) => g.kind === "digit").sort((a, b) => a.ordinal - b.ordinal)) {
  const r = classifyGroup(g);
  codigo += r.kind === "ANSWERED" ? r.option : "?";
}
console.log(`CÓDIGO LEÍDO: ${codigo}`);

const version = t.groups.find((g) => g.kind === "version");
if (version) console.log(`TIPO: ${JSON.stringify(classifyGroup(version))}`);

const counts: Record<string, number> = {};
const answers: string[] = [];
for (const g of t.groups.filter((g) => g.kind === "question").sort((a, b) => a.ordinal - b.ordinal)) {
  const r = classifyGroup(g);
  counts[r.kind] = (counts[r.kind] ?? 0) + 1;
  answers.push(r.kind === "ANSWERED" ? r.option : r.kind === "BLANK" ? "_" : r.kind === "MULTIPLE" ? "X" : "?");
}
console.log(`\nresumen 100 preguntas:`, counts);
console.log(`\nrespuestas (1-100):`);
for (let i = 0; i < 100; i += 25) console.log(`  ${i+1}-${i+25}: ${answers.slice(i, i+25).join(" ")}`);
