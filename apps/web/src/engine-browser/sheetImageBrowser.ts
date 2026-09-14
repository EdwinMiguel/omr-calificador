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
import type { RectMm, Template } from "../../../../template.ts";
import { mmToPx } from "../../../../template.ts";
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

export interface RenderSheetImageOptions {
  /** Redimensiona antes de codificar. MEDIDO del lado servidor: la hoja
   * completa pesa ~1.8MB en PNG; a 1000px de ancho, ~680KB y se ve igual
   * mientras está ajustada a la pantalla — la resolución completa solo
   * hace falta al hacer zoom. */
  targetWidth?: number;
  /**
   * Recorta a esta región (mm, coordenadas de la hoja) ANTES de
   * redimensionar — para la revisión manual, que necesita la zona de UNA
   * pregunta con sus vecinas, no la hoja de 297mm completa. El overlay se
   * dibuja SIEMPRE sobre la imagen entera primero (renderReadingOverlay
   * necesita las coordenadas completas para ubicar cada marca) y el
   * recorte es el último paso, sobre el resultado ya pintado.
   */
  cropRectMm?: RectMm;
  /** Id del grupo a resaltar con el marco de foco (ver la nota de
   * FOCUS_COLOR en readingOverlay.ts) — "esto es lo que se está mirando
   * ahora", no un estado de lectura. */
  focusGroupId?: string;
}

/**
 * Dibuja (opcionalmente) el overlay sobre la imagen alineada y devuelve una
 * URL de objeto lista para un <img src>. Equivalente local de
 * GET /api/sheets/:id/image del servidor.
 *
 *   marks=null → la hoja tal cual, sin intervención del programa. Es cómo
 *                se comprueba que un anillo no esté tapando una duda.
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
  opts: RenderSheetImageOptions = {}
): Promise<{ url: string; revoke: () => void }> {
  const { targetWidth, cropRectMm, focusGroupId } = opts;
  const rgb = (marks || focusGroupId)
    ? renderReadingOverlay(aligned, template, dpi, marks ?? [], focusGroupId)
    : null;

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

  // Región de origen: toda la imagen, o el recorte pedido — recortado
  // contra los bordes reales para no pedirle a drawImage un rectángulo que
  // se sale del canvas (pasaría si cropRectMm queda parcialmente fuera de
  // la hoja, ej. la primera/última pregunta con vecinas hacia afuera).
  let srcX = 0, srcY = 0, srcW = aligned.width, srcH = aligned.height;
  if (cropRectMm) {
    const x0 = Math.max(0, Math.round(mmToPx(cropRectMm.x, dpi)));
    const y0 = Math.max(0, Math.round(mmToPx(cropRectMm.y, dpi)));
    const x1 = Math.min(aligned.width, Math.round(mmToPx(cropRectMm.x + cropRectMm.w, dpi)));
    const y1 = Math.min(aligned.height, Math.round(mmToPx(cropRectMm.y + cropRectMm.h, dpi)));
    srcX = x0; srcY = y0; srcW = Math.max(1, x1 - x0); srcH = Math.max(1, y1 - y0);
  }

  const scale = targetWidth && targetWidth < srcW ? targetWidth / srcW : 1;
  const outW = Math.round(srcW * scale);
  const outH = Math.round(srcH * scale);

  let sourceCanvas: OffscreenCanvas = ctx.canvas;
  if (cropRectMm || scale !== 1) {
    const out = new OffscreenCanvas(outW, outH);
    const octx = out.getContext("2d");
    if (!octx) throw new Error("No se pudo obtener contexto 2D para recortar/redimensionar");
    octx.drawImage(ctx.canvas, srcX, srcY, srcW, srcH, 0, 0, outW, outH);
    sourceCanvas = out;
  }

  const blob = await sourceCanvas.convertToBlob({ type: "image/png" });
  const url = URL.createObjectURL(blob);
  return { url, revoke: () => URL.revokeObjectURL(url) };
}
