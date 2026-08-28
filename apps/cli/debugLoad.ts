/**
 * debugLoad.ts — CLI del Día 2: carga un archivo y vuelca cada página como
 * PNG inspeccionable. Es la herramienta con la que se corre la PUERTA del
 * día (10 fotos propias procesadas sin error) y se producen 01-original.png.
 *
 *   npx tsx apps/cli/debugLoad.ts <archivo> [outDir=debug]
 */
import { loadPages } from "./io/loadPages.ts";
import { dumpDebug } from "./io/dumpDebug.ts";

const [, , filePath, outDir = "debug"] = process.argv;
if (!filePath) {
  console.error("Uso: tsx apps/cli/debugLoad.ts <archivo> [outDir]");
  process.exit(1);
}

const pages = await loadPages(filePath);
console.log(`✓ ${filePath} → ${pages.length} página(s)`);

for (const [i, page] of pages.entries()) {
  const stage = pages.length > 1 ? `01-original-p${i + 1}` : "01-original";
  const path = await dumpDebug(stage, page, outDir);
  console.log(`  página ${i + 1}: ${page.width}x${page.height} → ${path}`);
}
