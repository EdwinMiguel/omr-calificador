/**
 * grayscale.ts — decodificar imágenes a GrayImage, en navegador.
 *
 * Equivalente de `decodeRasterImage()` en apps/cli/io/loadPages.ts, pero sin
 * sharp: el navegador ya sabe decodificar JPEG/PNG de forma nativa
 * (createImageBitmap), así que no hace falta ninguna librería.
 *
 * LÍMITE CONOCIDO, DOCUMENTADO A PROPÓSITO: TIFF no está soportado. Ningún
 * navegador implementa createImageBitmap() ni <img> para TIFF — es un
 * límite de la plataforma, no de este código. La versión Node (loadPages.ts,
 * vía sharp) sí lo soporta. Si el escáner del colegio produce TIFF por
 * defecto, hay que cambiarlo a JPEG/PNG en su configuración, o agregar una
 * librería de decodificación TIFF en JS más adelante.
 *
 * No hay lista blanca de tipos MIME a propósito: el `type` que reporta el
 * navegador es poco fiable —hay sistemas que dicen `image/jpg` en vez del
 * estándar `image/jpeg`, y otros que lo dejan vacío— así que filtrar por ahí
 * solo produce rechazos falsos de archivos válidos. El árbitro real es
 * `createImageBitmap`: si no puede decodificarlo, falla.
 */

import type { GrayImage } from "../../../../packages/engine/types.ts";

/**
 * Crea un contexto 2D listo para que le lean todos los píxeles.
 *
 * `willReadFrequently`: sin esta pista el navegador respalda el lienzo en la
 * GPU, y cada getImageData obliga a traer los píxeles de vuelta — que es la
 * operación cara. Acá SIEMPRE se lee el lienzo entero una vez por página, así
 * que conviene el respaldo en memoria desde el principio.
 *
 * Fondo blanco ANTES de dibujar: un lienzo nuevo arranca en negro
 * transparente (0,0,0,0). Si la imagen trae canal alfa (un PNG recortado, o
 * un PDF sin fondo declarado), esas zonas quedarían en RGB(0,0,0) y el motor
 * las leería como TINTA NEGRA — justo lo contrario de lo que significan. En
 * un documento, "sin nada" es papel.
 */
export function makeReadableCanvas(width: number, height: number): OffscreenCanvasRenderingContext2D {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("No se pudo obtener contexto 2D de OffscreenCanvas");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  return ctx;
}

/**
 * Fórmula de luminancia ITU-R BT.601 (Y = 0.299R + 0.587G + 0.114B) — la
 * misma familia de conversión que usa sharp por defecto. No se persigue una
 * coincidencia exacta de coeficientes: para tinta oscura sobre papel claro
 * (el único contraste que el motor mide) cualquier fórmula de luminancia
 * estándar da resultados equivalentes en la práctica.
 */
export function grayscaleFromContext(
  ctx: OffscreenCanvasRenderingContext2D, width: number, height: number
): GrayImage {
  const { data: rgba } = ctx.getImageData(0, 0, width, height);
  const gray = new Uint8Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i++, p += 4) {
    gray[i] = Math.round(0.299 * rgba[p]! + 0.587 * rgba[p + 1]! + 0.114 * rgba[p + 2]!);
  }
  return { data: gray, width, height };
}

/** Decodifica un Blob (JPEG/PNG) a GrayImage. */
export async function decodeRasterBlob(blob: Blob, fileName = "la imagen"): Promise<GrayImage> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch (cause) {
    throw new Error(
      `El navegador no pudo decodificar ${fileName}. Puede estar dañada, o ser un ` +
      `formato que no soporta (TIFF, por ejemplo). Probá con JPEG o PNG.`,
      { cause }
    );
  }
  try {
    const ctx = makeReadableCanvas(bitmap.width, bitmap.height);
    ctx.drawImage(bitmap, 0, 0);
    return grayscaleFromContext(ctx, bitmap.width, bitmap.height);
  } finally {
    // ImageBitmap tiene memoria propia fuera del heap de JS (el buffer de
    // píxeles decodificado). Sin cerrarlo explícitamente, el GC de JS no sabe
    // que hay que liberarlo y queda retenido hasta un ciclo de recolección
    // que puede tardar. Con 30 hojas seguidas, eso acumula.
    bitmap.close();
  }
}
