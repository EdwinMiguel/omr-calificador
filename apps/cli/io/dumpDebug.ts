/**
 * dumpDebug.ts — Escribe un GrayImage como PNG inspeccionable a simple vista.
 *
 * PROMPT.md §8: "en visión por computadora no se depura leyendo código, se
 * depura mirando imágenes". El motor (packages/engine) nunca escribe
 * archivos; quien persiste a disco es siempre el CLI o la API. Por eso esta
 * función vive aquí, junto a loadPages.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";
import type { GrayImage } from "../../../packages/engine/types.ts";

export async function dumpDebug(stage: string, image: GrayImage, outDir: string): Promise<string> {
  await mkdir(outDir, { recursive: true });
  const path = join(outDir, `${stage}.png`);

  const png = await sharp(Buffer.from(image.data), {
    raw: { width: image.width, height: image.height, channels: 1 },
  })
    .png()
    .toBuffer();

  await writeFile(path, png);
  return path;
}
