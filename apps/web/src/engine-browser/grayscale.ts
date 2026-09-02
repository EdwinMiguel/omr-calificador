/**
 * grayscale.ts — decodificar un Blob de imagen a GrayImage, en navegador.
 *
 * Equivalente de `decodeRasterImage()` en apps/cli/io/loadPages.ts, pero sin
 * sharp: el navegador ya sabe decodificar JPEG/PNG de forma nativa
 * (createImageBitmap), así que no hace falta ninguna librería.
 *
 * LÍMITE CONOCIDO, DOCUMENTADO A PROPÓSITO: TIFF no está soportado. Ningún
 * navegador implementa createImageBitmap() ni <img> para TIFF — es un
 * límite de la plataforma, no de este código. La versión Node (loadPages.ts,
 * vía sharp) sí lo soporta. Si el escáner del colegio produce TIFF por
 * defecto, hay que cambiarlo a JPEG/PNG en la configuración del escáner, o
 * agregar una librería de decodificación TIFF en JS más adelante.
 */

import type { GrayImage } from "../../../../packages/engine/types.ts";

export const SUPPORTED_RASTER_TYPES = new Set(["image/jpeg", "image/png"]);

/**
 * Fórmula de luminancia ITU-R BT.601 (Y = 0.299R + 0.587G + 0.114B) — la
 * misma familia de conversión que usa sharp por defecto. No se persigue una
 * coincidencia exacta de coeficientes: para tinta oscura sobre papel claro
 * (el único contraste que el motor mide) cualquier fórmula de luminancia
 * estándar da resultados equivalentes en la práctica.
 */
function toGrayscale(rgba: Uint8ClampedArray, width: number, height: number): GrayImage {
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = Math.round(0.299 * rgba[p]! + 0.587 * rgba[p + 1]! + 0.114 * rgba[p + 2]!);
  }
  return { data: gray, width, height };
}

/** Decodifica un Blob (JPEG/PNG) directamente a GrayImage. */
export async function decodeRasterBlob(blob: Blob): Promise<GrayImage> {
  const bitmap = await createImageBitmap(blob);
  try {
    return grayscaleFromBitmap(bitmap);
  } finally {
    // ImageBitmap tiene memoria propia fuera del heap de JS (buffer de
    // píxeles decodificado) — sin cerrarlo explícitamente, el GC de JS no
    // sabe que hay que liberarlo y queda retenido hasta un ciclo de
    // recolección que puede tardar. Con 30 hojas seguidas eso acumula.
    bitmap.close();
  }
}

/** Extrae el GrayImage de un ImageBitmap ya decodificado (PDF y raster comparten esto). */
export function grayscaleFromBitmap(bitmap: ImageBitmap): GrayImage {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No se pudo obtener contexto 2D de OffscreenCanvas");
  ctx.drawImage(bitmap, 0, 0);
  const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  return toGrayscale(data, bitmap.width, bitmap.height);
}
