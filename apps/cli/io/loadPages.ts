/**
 * loadPages.ts — Punto único donde un archivo de entrada deja de ser un
 * formato específico y pasa a ser GrayImage[]. Hace I/O (fs, decodificación)
 * a propósito: por eso vive en apps/cli, no en packages/engine (PROMPT.md §6).
 */

import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import sharp from "sharp";
import { createCanvas } from "@napi-rs/canvas";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist/legacy/build/pdf.mjs";
import type { GrayImage } from "../../../packages/engine/types.ts";

// En Node no hay Worker de verdad para pdf.js: sin esto, getDocument() falla
// con "No GlobalWorkerOptions.workerSrc specified". pdf.js detecta que está
// en Node y ejecuta el worker en el mismo proceso, pero igual exige la ruta.
GlobalWorkerOptions.workerSrc = new URL(
  "../../../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
  import.meta.url
).href;

const RASTER_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".tif", ".tiff"]);

/** DPI al que se rasteriza un PDF de entrada. 200 DPI: mismo valor que usa
 * el resto del sistema (canvasSize() en template.ts) para razonar sobre
 * tamaños de burbuja en píxeles — no es arbitrario, es el punto de acuerdo
 * entre "cuántos píxeles por burbuja" y "cuánto pesa la imagen en memoria". */
const PDF_RASTER_DPI = 200;

/**
 * Decodifica un formato raster (JPG/PNG/TIFF) a un único GrayImage.
 *
 * `.grayscale()` colapsa los canales de color a 1 solo canal ANTES de pedir
 * los bytes crudos — si se pidiera `.raw()` sin `.grayscale()`, `data`
 * tendría 3 (RGB) u 4 (RGBA) bytes por píxel en vez de 1, y el resto del
 * motor recibiría un buffer con la forma equivocada sin ningún error visible.
 */
async function decodeRasterImage(bytes: Buffer): Promise<GrayImage> {
  const { data, info } = await sharp(bytes)
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });

  return { data: new Uint8Array(data), width: info.width, height: info.height };
}

/**
 * Un PDF no es una imagen: es un documento vectorial. Cada página se
 * RENDERIZA a un canvas a PDF_RASTER_DPI y ESO es lo que se decodifica —
 * reutilizando decodeRasterImage() para no duplicar la conversión a gris.
 *
 * Siempre devuelve un elemento por página, incluso si el PDF tiene una sola:
 * el contrato de loadPages() es GrayImage[], nunca una imagen suelta
 * (PROMPT.md §13.6) — un examen a dos caras escaneado en dúplex es un PDF
 * de 2 páginas por hoja física, y el llamador no debe tener que distinguir
 * "PDF de 1 página" de "imagen".
 */
/**
 * Se avisa la cantidad de páginas apenas se abre el PDF, ANTES de
 * rasterizarlas: pdf.js conoce `numPages` de inmediato, mientras que
 * renderizar cada página cuesta ~1s. Sin esto, quien sube un PDF de 30
 * hojas ve medio minuto de "Preparando…" sin ninguna cifra; con esto ve
 * "0 de 30" desde el principio y entiende cuánto falta.
 */
export type PageCountListener = (pageCount: number) => void;

async function decodePdfPages(bytes: Buffer, onPageCount?: PageCountListener): Promise<GrayImage[]> {
  // pdf.js avisa por consola "Ensure standardFontDataUrl..." cuando un PDF
  // referencia una fuente estándar (Helvetica, como hoja-v1.pdf) sin
  // proveerle dónde reconstruir sus glyphs. Se investigó apuntarlo a
  // node_modules/pdfjs-dist/standard_fonts/, pero su lector de archivos
  // Node falla al resolver esa carpeta (limitación de pdf.js, no de este
  // código) y cambia el warning por un error. Se deja sin resolver a
  // propósito: este sistema nunca lee texto impreso (§2, "sin OCR"), lee
  // cobertura de tinta en ROIs geométricos fijos. Una fuente de respaldo
  // con métricas ligeramente distintas no mueve un solo píxel de las zonas
  // de fiduciales o burbujas, que ya tienen su propio margen de seguridad.
  const doc = await getDocument({ data: new Uint8Array(bytes) }).promise;
  onPageCount?.(doc.numPages);
  const scale = PDF_RASTER_DPI / 72; // el viewport de pdf.js está en puntos (1/72")

  const pages: GrayImage[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");

    // pdf.js tipa canvas/canvasContext para el DOM del navegador
    // (HTMLCanvasElement, CanvasRenderingContext2D). @napi-rs/canvas
    // implementa la misma API en Node pero con sus propios tipos — no hay
    // forma de que coincidan estructuralmente sin pasar por `unknown`. El
    // puente es seguro porque ya se verificó en tests (loadPages.test.ts)
    // que el resultado renderizado es correcto: 8/8 tests, incluido un PDF
    // de 3 páginas con tonos de gris exactos.
    await page.render({
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    pages.push(await decodeRasterImage(canvas.toBuffer("image/png")));
  }
  return pages;
}

/**
 * La misma decodificación pero desde bytes ya en memoria, sin pasar por
 * disco: es lo que necesita la API, que recibe el archivo por multipart y
 * no tiene (ni debe tener) una ruta de archivo. `fileName` se usa solo para
 * deducir el formato por su extensión, igual que en loadPages().
 */
export async function loadPagesFromBuffer(
  bytes: Buffer,
  fileName: string,
  onPageCount?: PageCountListener
): Promise<GrayImage[]> {
  const ext = extname(fileName).toLowerCase();

  if (RASTER_EXTENSIONS.has(ext)) {
    onPageCount?.(1);
    return [await decodeRasterImage(bytes)];
  }
  if (ext === ".pdf") {
    return decodePdfPages(bytes, onPageCount);
  }

  throw new Error(`Formato no soportado: '${ext}' (archivo: ${fileName})`);
}

export async function loadPages(filePath: string): Promise<GrayImage[]> {
  return loadPagesFromBuffer(await readFile(filePath), filePath);
}
