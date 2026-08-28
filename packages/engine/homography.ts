/**
 * homography.ts — Día 6: convertir cualquier foto en una hoja frontal y
 * alineada.
 *
 * Problema:  la foto de la hoja está inclinada/rotada — la posición de
 *            cada burbuja en píxeles de la FOTO no coincide con la
 *            posición fija que describe el Template (esa solo es válida
 *            sobre una hoja perfectamente de frente).
 * Concepto:  homografía — una transformación proyectiva 3x3 que mapea 4
 *            puntos conocidos de origen a 4 puntos de destino conocidos.
 *            Con los 4 marcadores como referencia (posición real en la
 *            foto → posición fija del Template), se resuelve la matriz
 *            que endereza TODA la hoja, no solo esos 4 puntos.
 * Por qué:   una vez normalizada, se puede usar bubbleRoi() del Template
 *            directamente sobre la imagen resultante — exactamente lo que
 *            hace viable leer burbujas por coordenadas fijas (PROMPT.md §2).
 */

import { loadCv } from "./cv.ts";
import type { GrayImage } from "./types.ts";

export interface Point { x: number; y: number }

export interface Homography {
  /** Matriz 3x3 fila por fila (9 elementos), de src → dst. */
  matrix: number[];
  /**
   * Error de reproyección: al aplicar la matriz a los 4 puntos de origen,
   * cuánto se alejan del destino esperado. Debería ser ~0 matemáticamente
   * (4 puntos → solución exacta), así que un valor alto avisa de un dato
   * de entrada malo (puntos casi colineales, coordenadas repetidas) antes
   * de warpear nada.
   */
  reprojectionErrorPx: number;
}

/**
 * @param srcPoints 4 puntos en la foto original, orden TL/TR/BR/BL.
 * @param dstPoints 4 puntos en el lienzo canónico, mismo orden.
 */
export async function computeHomography(srcPoints: Point[], dstPoints: Point[]): Promise<Homography> {
  if (srcPoints.length !== 4 || dstPoints.length !== 4) {
    throw new Error(`computeHomography necesita exactamente 4 puntos de cada lado, recibió ${srcPoints.length}/${dstPoints.length}`);
  }
  const cv = await loadCv();

  const srcMat = cv.matFromArray(4, 1, cv.CV_32FC2, srcPoints.flatMap((p) => [p.x, p.y]));
  const dstMat = cv.matFromArray(4, 1, cv.CV_32FC2, dstPoints.flatMap((p) => [p.x, p.y]));
  const H = cv.getPerspectiveTransform(srcMat, dstMat);

  try {
    const matrix = Array.from(H.data64F as Float64Array);

    let maxErr = 0;
    for (let i = 0; i < 4; i++) {
      const sp = srcPoints[i]!;
      const wx = matrix[0]! * sp.x + matrix[1]! * sp.y + matrix[2]!;
      const wy = matrix[3]! * sp.x + matrix[4]! * sp.y + matrix[5]!;
      const wz = matrix[6]! * sp.x + matrix[7]! * sp.y + matrix[8]!;
      const projected = { x: wx / wz, y: wy / wz };
      const dp = dstPoints[i]!;
      maxErr = Math.max(maxErr, Math.hypot(projected.x - dp.x, projected.y - dp.y));
    }

    return { matrix, reprojectionErrorPx: maxErr };
  } finally {
    H.delete();
    dstMat.delete();
    srcMat.delete();
  }
}

export async function warpToCanonical(
  img: GrayImage, homography: Homography, outWidth: number, outHeight: number
): Promise<GrayImage> {
  const cv = await loadCv();
  const src = new cv.Mat(img.height, img.width, cv.CV_8UC1);
  src.data.set(img.data);
  const H = cv.matFromArray(3, 3, cv.CV_64F, homography.matrix);
  const dst = new cv.Mat();
  try {
    cv.warpPerspective(src, dst, H, new cv.Size(outWidth, outHeight));
    return { data: new Uint8Array(dst.data), width: dst.cols, height: dst.rows };
  } finally {
    dst.delete();
    H.delete();
    src.delete();
  }
}
