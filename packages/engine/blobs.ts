/**
 * blobs.ts — Día 4: de imagen binaria a lista de objetos con propiedades.
 *
 * Opening (erosión + dilatación) quita el ruido moteado de <4px que el
 * Día 3 ya midió con findContours (cientos por foto). Erosión encoge todo:
 * el ruido de 1-2px desaparece del todo, los blobs reales (burbujas,
 * marcadores) sobreviven encogidos. Dilatación los devuelve a su tamaño,
 * pero el ruido ya no está para "crecer de vuelta".
 */

import { loadCv } from "./cv.ts";
import type { GrayImage } from "./types.ts";

export interface Blob {
  area: number;
  boundingRect: { x: number; y: number; width: number; height: number };
  centroid: { x: number; y: number };
  /** ancho / alto del bounding box. Un cuadrado ronda 1.0. */
  aspectRatio: number;
  /** área / área del casco convexo. 1.0 = forma perfectamente convexa
   * (cuadrado, círculo). Baja si el contorno tiene muescas o es irregular. */
  solidity: number;
  /**
   * MEDIDO (dataset real): `solidity` NO distingue un marcador sólido de
   * una burbuja vacía — ambos son convexos, ambos dan ~1.0. Una burbuja sin
   * marcar es solo el TRAZO del círculo (borderWidth 0.75pt), no un
   * relleno; `contourArea` mide el polígono del contorno EXTERNO, que es
   * el mismo tanto si el círculo está hueco como relleno. `fillRatio` sí
   * los distingue: fracción de píxeles realmente encendidos dentro del
   * bounding box. Un marcador (relleno) da ~1.0; el trazo de una burbuja
   * vacía da bastante menos.
   */
  fillRatio: number;
}

/**
 * OPEN_KERNEL_SIZE: lado del elemento estructurante para la erosión+dilatación.
 *
 * MEDIDO en el dataset real (10 fotos): con 3x3, la cantidad de blobs
 * SUBE (no baja) después de abrir — de ~1300-1600 a ~2000-2700. La causa,
 * confirmada mirando 04-morphology.png: el trazo de las burbujas (3mm de
 * diámetro) es de apenas 1-2px de ancho a esta resolución, más angosto que
 * el propio kernel de 3x3 — la apertura erosiona el trazo en vez de solo
 * quitar ruido, fragmentando círculos completos en varios arcos sueltos.
 *
 * Por eso `findBlobs()` NO aplica esta función por defecto. Se deja
 * disponible y probada (blobs.test.ts la valida con ruido de 5x5 y un
 * kernel de 7x7, mayor que el ruido) para cuando haga falta limpieza
 * agresiva sobre blobs GRANDES, no como paso obligatorio del pipeline.
 */
const OPEN_KERNEL_SIZE = 3;

export async function morphologyOpen(img: GrayImage, kernelSize = OPEN_KERNEL_SIZE): Promise<GrayImage> {
  const cv = await loadCv();
  const src = new cv.Mat(img.height, img.width, cv.CV_8UC1);
  src.data.set(img.data);
  const dst = new cv.Mat();
  const kernel = cv.Mat.ones(kernelSize, kernelSize, cv.CV_8U);
  try {
    cv.morphologyEx(src, dst, cv.MORPH_OPEN, kernel);
    return { data: new Uint8Array(dst.data), width: dst.cols, height: dst.rows };
  } finally {
    kernel.delete();
    dst.delete();
    src.delete();
  }
}

/**
 * MIN_BLOB_AREA: por debajo de esto ni vale la pena calcular sus propiedades
 * (evita casco convexo sobre un contorno de 1-2 píxeles, que puede fallar
 * o no significar nada). CALIBRARLO junto al tamaño real de burbuja/marcador
 * en píxeles a la resolución de trabajo — hoy es un piso conservador, no
 * un valor derivado del template todavía (eso llega en el Día 7).
 */
const MIN_BLOB_AREA = 4;

export async function findBlobs(img: GrayImage): Promise<Blob[]> {
  const cv = await loadCv();
  const src = new cv.Mat(img.height, img.width, cv.CV_8UC1);
  src.data.set(img.data);
  const contours = new cv.MatVector();
  const hierarchy = new cv.Mat();

  try {
    cv.findContours(src, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    const blobs: Blob[] = [];
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const area = cv.contourArea(c);
      if (area < MIN_BLOB_AREA) { c.delete(); continue; }

      const rect = cv.boundingRect(c);
      const m = cv.moments(c);
      const centroid = m.m00 !== 0
        ? { x: m.m10 / m.m00, y: m.m01 / m.m00 }
        : { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };

      const hull = new cv.Mat();
      cv.convexHull(c, hull);
      const hullArea = cv.contourArea(hull);
      hull.delete();

      const roi = src.roi(rect);
      const fillRatio = cv.countNonZero(roi) / (rect.width * rect.height);
      roi.delete(); // roi() no copia memoria, pero el objeto Mat en sí sí se libera

      blobs.push({
        area,
        boundingRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        centroid,
        aspectRatio: rect.height !== 0 ? rect.width / rect.height : 0,
        solidity: hullArea !== 0 ? area / hullArea : 0,
        fillRatio,
      });
      c.delete();
    }
    return blobs;
  } finally {
    hierarchy.delete();
    contours.delete();
    src.delete();
  }
}
