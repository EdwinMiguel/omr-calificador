/**
 * threshold.ts — Separa tinta de papel. Tres métodos, comparados en el
 * Día 3 (apps/cli/compareThreshold.ts) para decidir cuál usa el pipeline.
 *
 * Convención: la salida es GrayImage binaria (0 o 255), con la TINTA en 255
 * y el papel en 0 — por eso las tres usan THRESH_*_INV. Es la misma
 * convención que ya usa verify-opencv.mjs para su propio test de contornos:
 * findContours() busca regiones no-cero, así que "tinta = 255" es lo que
 * hace que un blob de tinta sea "la figura" y no "el fondo".
 *
 * Memoria WASM: cada cv.Mat creado se libera explícitamente con try/finally
 * (PROMPT.md §6) — el GC de JS no toca el heap de WASM.
 */

import { loadCv } from "./cv.ts";
import type { GrayImage } from "./types.ts";
import type { CV, Mat } from "@techstark/opencv-js";

function toMat(cv: CV, img: GrayImage): Mat {
  const mat = new cv.Mat(img.height, img.width, cv.CV_8UC1);
  mat.data.set(img.data);
  return mat;
}

function fromMat(mat: Mat): GrayImage {
  return { data: new Uint8Array(mat.data), width: mat.cols, height: mat.rows };
}

/**
 * THRESH_VALUE controla el corte fijo del umbral global: por debajo es
 * tinta, por encima es papel. 128 es el punto medio del rango 0-255 — no
 * es un valor derivado de este dataset, es la opción "ingenua" a propósito,
 * para poder mostrar por qué falla frente a Otsu/adaptativo.
 */
const GLOBAL_THRESH_VALUE = 128;

export async function thresholdGlobal(img: GrayImage, thresh = GLOBAL_THRESH_VALUE): Promise<GrayImage> {
  const cv = await loadCv();
  const src = toMat(cv, img);
  const dst = new cv.Mat();
  try {
    cv.threshold(src, dst, thresh, 255, cv.THRESH_BINARY_INV);
    return fromMat(dst);
  } finally {
    dst.delete();
    src.delete();
  }
}

export async function thresholdOtsu(img: GrayImage): Promise<GrayImage> {
  const cv = await loadCv();
  const src = toMat(cv, img);
  const dst = new cv.Mat();
  try {
    // El primer "0" se ignora: con THRESH_OTSU, OpenCV calcula el corte
    // óptimo del histograma en vez de usar el valor pasado.
    cv.threshold(src, dst, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);
    return fromMat(dst);
  } finally {
    dst.delete();
    src.delete();
  }
}

/**
 * ADAPTIVE_BLOCK_SIZE: tamaño (en píxeles) del vecindario local que define
 * "el promedio contra el que se compara cada píxel". Debe ser IMPAR (lo
 * exige OpenCV: hay un píxel central y el resto se reparte simétrico a su
 * alrededor). 25 es un punto de partida razonable a la resolución de estas
 * fotos (~1600px de ancho) — CALIBRABLE: si el Día 3 muestra bordes
 * "carcomidos" alrededor de burbujas o marcadores, es la primera perilla
 * a mover, no una verdad fija.
 *
 * ADAPTIVE_C: constante que se resta al promedio local antes de comparar.
 * Sube el umbral efectivo → exige más contraste para contar como tinta.
 * 10 es el valor de referencia que usa la documentación de OpenCV como
 * punto de partida; CALIBRABLE contra el dataset real, igual que arriba.
 */
const ADAPTIVE_BLOCK_SIZE = 25;
const ADAPTIVE_C = 10;

export async function thresholdAdaptive(
  img: GrayImage, blockSize = ADAPTIVE_BLOCK_SIZE, c = ADAPTIVE_C
): Promise<GrayImage> {
  if (blockSize % 2 === 0) {
    throw new Error(`blockSize debe ser impar (OpenCV lo exige); recibido ${blockSize}`);
  }
  const cv = await loadCv();
  const src = toMat(cv, img);
  const dst = new cv.Mat();
  try {
    cv.adaptiveThreshold(
      src, dst, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY_INV, blockSize, c
    );
    return fromMat(dst);
  } finally {
    dst.delete();
    src.delete();
  }
}
