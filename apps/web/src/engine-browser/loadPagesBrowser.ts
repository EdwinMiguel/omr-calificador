/**
 * loadPagesBrowser.ts — equivalente de apps/cli/io/loadPages.ts, pero para
 * correr DENTRO del navegador en vez de un servidor Node.
 *
 * DIFERENCIA DE DISEÑO A PROPÓSITO, no un simple "puerto": la versión Node
 * devuelve `Promise<GrayImage[]>` — decodifica TODAS las páginas de un PDF
 * antes de devolver ninguna. MEDIDO en el servidor: un PDF de 10 hojas hace
 * subir el proceso a ~950 MB de RSS, muy por encima de los 512 MB de un
 * plan gratuito — esa acumulación fue la causa directa de que Render se
 * cayera al subir un lote real. Mover el motor al navegador no arregla
 * esto solo: si se copiara la misma forma de cargar, un PDF de 30 hojas
 * podría tumbar la pestaña igual que tumbó al servidor.
 *
 * Por eso acá la función es un GENERADOR ASÍNCRONO: entrega una página,
 * espera a que quien la llama la consuma (típicamente analyzeSheet(), que
 * no retiene la imagen una vez calificada), y recién ahí decodifica la
 * siguiente. En cualquier momento hay como mucho una página de más
 * retenida en memoria, sin importar cuántas traiga el archivo.
 */

import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
// Vite: el sufijo ?url pide el archivo empaquetado como asset servible y
// devuelve su URL final, en vez de intentar ejecutarlo como módulo — es la
// forma correcta de apuntar pdf.js a su propio worker bajo un bundler.
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.mjs?url";
import type { GrayImage } from "../../../../packages/engine/types.ts";
import { decodeRasterBlob, grayscaleFromBitmap, SUPPORTED_RASTER_TYPES } from "./grayscale.ts";

GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/** Mismo DPI que la versión Node — es el punto de acuerdo con canvasSize()
 * de template.ts sobre cuántos píxeles ocupa cada burbuja. */
const PDF_RASTER_DPI = 200;

export type PageCountListener = (pageCount: number) => void;

function extOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  return dot === -1 ? "" : fileName.slice(dot).toLowerCase();
}

const RASTER_EXTENSIONS = new Set([".jpg", ".jpeg", ".png"]);

async function* decodePdfPagesStreaming(
  file: File,
  onPageCount?: PageCountListener
): AsyncGenerator<GrayImage, void, void> {
  // Se conserva `loadingTask`, no solo `doc`: destroy() vive ahí, y además
  // de liberar el documento cierra el worker de pdf.js que getDocument()
  // levanta — sin esto quedaría un worker por cada PDF procesado.
  const loadingTask = getDocument({ data: await file.arrayBuffer() });
  const doc = await loadingTask.promise;
  onPageCount?.(doc.numPages);
  const scale = PDF_RASTER_DPI / 72; // el viewport de pdf.js está en puntos (1/72")

  try {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      try {
        const viewport = page.getViewport({ scale });
        const canvas = new OffscreenCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("No se pudo obtener contexto 2D de OffscreenCanvas");

        // pdf.js tipa canvas/context para el DOM (HTMLCanvasElement); acá se
        // usa OffscreenCanvas a propósito (funciona en la página y en un
        // futuro Web Worker sin cambios) — mismo puente `unknown` que ya
        // usa la versión Node con @napi-rs/canvas, y por la misma razón:
        // son dos implementaciones de la misma API sin relación estructural
        // entre sus tipos.
        await page.render({
          canvas: canvas as unknown as HTMLCanvasElement,
          canvasContext: ctx as unknown as CanvasRenderingContext2D,
          viewport,
        }).promise;

        const bitmap = await createImageBitmap(canvas);
        try {
          yield grayscaleFromBitmap(bitmap);
        } finally {
          bitmap.close();
        }
      } finally {
        // PDFPageProxy retiene sus propios recursos (fuentes, operator
        // list) hasta que se libera explícitamente — sin esto se acumulan
        // igual que las imágenes, solo que en la capa de pdf.js en vez de
        // en la nuestra.
        page.cleanup();
      }
    }
  } finally {
    await loadingTask.destroy();
  }
}

/**
 * @param file Un archivo elegido por el usuario (<input type="file">) o
 * soltado en la zona de carga — nunca una ruta: en el navegador no existe
 * acceso directo al sistema de archivos.
 */
export async function* loadPagesBrowser(
  file: File,
  onPageCount?: PageCountListener
): AsyncGenerator<GrayImage, void, void> {
  const ext = extOf(file.name);

  if (RASTER_EXTENSIONS.has(ext)) {
    if (!SUPPORTED_RASTER_TYPES.has(file.type) && file.type !== "") {
      throw new Error(`Tipo de archivo no reconocido por el navegador: '${file.type}' (${file.name})`);
    }
    onPageCount?.(1);
    yield await decodeRasterBlob(file);
    return;
  }

  if (ext === ".tif" || ext === ".tiff") {
    throw new Error(
      `TIFF no se puede leer desde el navegador (limitación de la plataforma, ` +
      `no de este sistema) — reexportá '${file.name}' como JPEG o PNG.`
    );
  }

  if (ext === ".pdf") {
    yield* decodePdfPagesStreaming(file, onPageCount);
    return;
  }

  throw new Error(`Formato no soportado: '${ext}' (archivo: ${file.name})`);
}
