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
 * Dibuja (opcionalmente) el overlay sobre la imagen alineada y devuelve una
 * URL de objeto lista para un <img src>. Equivalente local de
 * GET /api/sheets/:id/image del servidor — mismas dos opciones:
 *
 *   marks=null    → la hoja tal cual, sin intervención del programa. Es
 *                   cómo se comprueba que un anillo no esté tapando una duda.
 *   targetWidth   → redimensiona antes de codificar. MEDIDO del lado
 *                   servidor: la hoja completa pesa ~1.8MB en PNG; a 1000px
 *                   de ancho, ~680KB y se ve igual mientras está ajustada a
 *                   la pantalla — la resolución completa solo hace falta al
 *                   hacer zoom.
 *
 * Se usa URL de objeto y no data: URL a propósito — un data: URL codifica en
 * base64 (~33% más pesado) y vive como string gigante en el heap de JS; una
 * URL de objeto solo referencia el Blob.
 *
 * @returns la URL y una función para liberarla — quien la use debe llamarla
 * al desmontar o al pedir una nueva, o la URL (y su Blob) quedan retenidos
 * hasta recargar la página.
 */
export async function renderSheetImageUrl(
  aligned: GrayImage,
  template: Template,
  dpi: number,
  marks: ReadingMark[] | null,
  targetWidth?: number
): Promise<{ url: string; revoke: () => void }> {
  const rgb = marks ? renderReadingOverlay(aligned, template, dpi, marks) : null;

  const ctx = makeReadableCanvas(aligned.width, aligned.height);
  const imageData = ctx.createImageData(aligned.width, aligned.height);
  for (let i = 0, p = 0; p < imageData.data.length; i++, p += 4) {
    const gray = aligned.data[i]!;
    imageData.data[p] = rgb ? rgb[i * 3]! : gray;
    imageData.data[p + 1] = rgb ? rgb[i * 3 + 1]! : gray;
    imageData.data[p + 2] = rgb ? rgb[i * 3 + 2]! : gray;
    imageData.data[p + 3] = 255;
  }
  ctx.putImageData(imageData, 0, 0);

  let sourceCanvas: OffscreenCanvas = ctx.canvas;
  if (targetWidth && targetWidth < aligned.width) {
    const scale = targetWidth / aligned.width;
    const outHeight = Math.round(aligned.height * scale);
    const resized = new OffscreenCanvas(targetWidth, outHeight);
    const rctx = resized.getContext("2d");
    if (!rctx) throw new Error("No se pudo obtener contexto 2D para redimensionar");
    rctx.drawImage(ctx.canvas, 0, 0, targetWidth, outHeight);
    sourceCanvas = resized;
  }

  const blob = await sourceCanvas.convertToBlob({ type: "image/png" });
  const url = URL.createObjectURL(blob);
  return { url, revoke: () => URL.revokeObjectURL(url) };
}
