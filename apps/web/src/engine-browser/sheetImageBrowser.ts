/**
 * sheetImageBrowser.ts — "Ver hoja" del lado del navegador: guardar la
 * imagen alineada de forma compacta, y reconstruir el overlay de lectura
 * sobre ella cuando el profesor quiere verla.
 *
 * Server (apps/api/server.ts) hace esto mismo con sharp + caché en disco.
 * Acá no hay disco de servidor: la imagen tiene que guardarse donde sea que
 * viva el resto del lote (IndexedDB) o se pierde. La pieza que SÍ se
 * reutiliza tal cual es `renderReadingOverlay()` — es puro, sin ningún
 * import de Node, así que corre igual de un lado que del otro.
 */

import type { GrayImage } from "../../../../packages/engine/types.ts";
import { renderReadingOverlay, type ReadingMark } from "../../../../packages/engine/readingOverlay.ts";
import type { Template } from "../../../../template.ts";
import { decodeRasterBlob, makeReadableCanvas } from "./grayscale.ts";

/**
 * GrayImage → PNG comprimido, para guardar. Sin esto, 30 hojas sin
 * comprimir (~4 MB cada una a 200dpi) serían ~120MB en IndexedDB; como PNG
 * de escala de grises comprime muy bien (mucho blanco liso), baja bastante.
 */
export async function grayImageToPngBlob(img: GrayImage): Promise<Blob> {
  const ctx = makeReadableCanvas(img.width, img.height);
  const imageData = ctx.createImageData(img.width, img.height);
  for (let i = 0, p = 0; i < img.data.length; i++, p += 4) {
    const v = img.data[i]!;
    imageData.data[p] = v;
    imageData.data[p + 1] = v;
    imageData.data[p + 2] = v;
    imageData.data[p + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);
  return ctx.canvas.convertToBlob({ type: "image/png" });
}

/** El camino de vuelta: reutiliza el mismo decodificador que ya lee JPEG/PNG
 * al cargar hojas — un PNG en escala de grises es un caso más de lo mismo. */
export function pngBlobToGrayImage(blob: Blob): Promise<GrayImage> {
  return decodeRasterBlob(blob, "la imagen guardada");
}

/**
 * Traduce las preguntas de una hoja proyectada al formato que pide
 * renderReadingOverlay(). Puerto directo de la misma lógica que
 * apps/api/server.ts usa para el endpoint /sheets/:id/image — se repite acá
 * (no se comparte código con el servidor) porque una vive en Node y otra en
 * el navegador; la LÓGICA es la misma a propósito, no una reinvención.
 */
export function buildReadingMarks(
  questions: { ordinal: number; state: { kind: string; option?: string; options?: string[] } }[]
): ReadingMark[] {
  return questions.map((q) => ({
    groupId: `q.${q.ordinal}`,
    options:
      q.state.kind === "ANSWERED" ? [q.state.option!]
      : q.state.kind === "MULTIPLE" ? q.state.options!
      : [],
    // Una corrección manual ya no está "en duda": se muestra como leída,
    // que es lo que el profesor quiere confirmar al mirar la hoja.
    tone: q.state.kind === "ANSWERED" ? "read" : "review",
  }));
}

/**
 * Dibuja el overlay sobre la imagen alineada y devuelve una URL de objeto
 * lista para un <img src>. Se usa URL de objeto y no data: URL a propósito
 * — un data: URL codifica en base64 (¬33% más pesado) y vive como string
 * gigante en el heap de JS; una URL de objeto solo referencia el Blob.
 *
 * @returns la URL y una función para liberarla — quien la use debe llamarla
 * al desmontar, o la URL (y su Blob) quedan retenidos hasta recargar la
 * página.
 */
export async function renderSheetOverlayUrl(
  aligned: GrayImage,
  template: Template,
  dpi: number,
  marks: ReadingMark[]
): Promise<{ url: string; revoke: () => void }> {
  const rgb = renderReadingOverlay(aligned, template, dpi, marks);

  const ctx = makeReadableCanvas(aligned.width, aligned.height);
  const imageData = ctx.createImageData(aligned.width, aligned.height);
  for (let i = 0, p = 0; p < imageData.data.length; i++, p += 4) {
    imageData.data[p] = rgb[i * 3]!;
    imageData.data[p + 1] = rgb[i * 3 + 1]!;
    imageData.data[p + 2] = rgb[i * 3 + 2]!;
    imageData.data[p + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);

  const blob = await ctx.canvas.convertToBlob({ type: "image/png" });
  const url = URL.createObjectURL(blob);
  return { url, revoke: () => URL.revokeObjectURL(url) };
}
