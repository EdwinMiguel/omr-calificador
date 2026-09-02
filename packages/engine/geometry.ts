/**
 * geometry.ts — Día 7: consolidar el pipeline geométrico en una función
 * pura, y probar que no quedó pegada a ninguna plantilla concreta.
 *
 * analyzeGeometry() no conoce "hoja-oficial-colegio" ni ninguna otra: solo
 * usa lo que el Template expone genéricamente (markers, page) a través de
 * canonicalMarkers()/canvasSize() de template.ts. La prueba de que esto es
 * cierto y no solo una intención es Template B — misma lógica, otra
 * geometría (ver geometry.test.ts).
 */

import { findFiducialsRobust } from "./fiducials.ts";
import { scaleForDetection, scalePoints, detectionWidthsFor } from "./detectionScale.ts";
import { computeHomography, warpToCanonical, type Point } from "./homography.ts";
import { fillRatio } from "./measurement.ts";
import { canonicalMarkers, canvasSize, mmToPx, type Template } from "../../template.ts";
import type { GrayImage } from "./types.ts";

export type GeometryOutcome =
  | {
      kind: "aligned";
      normalized: GrayImage;
      reprojectionErrorPx: number;
      /** Qué método de umbral encontró los marcadores — información de
       * auditoría (fiducials.ts §findFiducialsRobust), no algo de lo que
       * el resto del pipeline dependa. */
      thresholdMethod: "adaptive" | "otsu" | "combined";
    }
  | { kind: "rejected"; reason: "MARKERS_NOT_FOUND" | "BAD_HOMOGRAPHY" };

/**
 * MEDIDO: con 4 puntos, getPerspectiveTransform es una solución EXACTA
 * (error ~0.000 en todas las fotos reales que sí tenían los 4 marcadores
 * correctos). Un error alto no es "un poco de imprecisión" — es la señal
 * de que los 4 puntos de entrada eran casi colineales o inconsistentes
 * entre sí (pasó con el bug de asignación por orden fijo, antes de
 * corregirlo: errores de 150-992px). 5px deja margen para ruido de punto
 * flotante sin dejar pasar una homografía genuinamente mal condicionada.
 */
const MAX_REPROJECTION_ERROR_PX = 5;

/**
 * MEDIDO — bug real encontrado con evidencia, no en teoría: findFiducials
 * etiqueta TL/TR/BR/BL según qué marcador está más cerca de cada ESQUINA
 * DE LA FOTO (píxel (0,0), (w,0), etc.). Eso no tiene por qué coincidir
 * con cuál es la esquina TL REAL de la hoja impresa — una foto tomada con
 * el celular en orientación distinta a la hoja produce una asignación
 * rotada 90°/180°/270° respecto a la real.
 *
 * Esto NO lo detecta el error de reproyección: con exactamente 4 puntos,
 * getPerspectiveTransform siempre encuentra una solución EXACTA (error
 * ~0), sin importar si el emparejamiento es semánticamente correcto. Pasó
 * en una foto real: reprojectionErrorPx=0.000 con el contenido rotado 90°
 * dentro del lienzo canónico — burbujas y marcadores "cuadran" entre sí
 * porque toda la imagen rotó junto con ellos, pero el resultado no
 * corresponde a la hoja real.
 *
 * Los parches de calibración son la forma de detectarlo: se conoce de
 * antemano cuáles son negros y cuáles blancos. Probar las 4 rotaciones
 * posibles y quedarse con la que da mayor contraste negro/blanco no es
 * "ensayo y error" — es usar la única información de la hoja que no
 * depende de la orientación para resolver, precisamente, la orientación.
 */
async function resolveOrientationAndWarp(
  img: GrayImage, corners: Point[], template: Template, dpi: number
): Promise<{ normalized: GrayImage; reprojectionErrorPx: number } | null> {
  const dst = canonicalMarkers(template, dpi);
  const canvas = canvasSize(template, dpi);

  const cx = corners.reduce((s, p) => s + p.x, 0) / corners.length;
  const cy = corners.reduce((s, p) => s + p.y, 0) / corners.length;
  const sorted = [...corners].sort(
    (a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx)
  );

  if (template.calibration.length === 0) {
    // Sin parches para verificar, no hay forma de auto-corregir — se usa
    // el orden tal cual llegó (mejor que no producir nada).
    const h = await computeHomography(corners, dst);
    if (h.reprojectionErrorPx > MAX_REPROJECTION_ERROR_PX) return null;
    return { normalized: await warpToCanonical(img, h, canvas.width, canvas.height), reprojectionErrorPx: h.reprojectionErrorPx };
  }

  let best: { normalized: GrayImage; reprojectionErrorPx: number; contrast: number } | null = null;

  for (const direction of [1, -1] as const) {
    for (let offset = 0; offset < 4; offset++) {
      const ordered = [0, 1, 2, 3].map((i) => sorted[((offset + direction * i) % 4 + 4) % 4]!);
      const h = await computeHomography(ordered, dst);
      if (h.reprojectionErrorPx > MAX_REPROJECTION_ERROR_PX) continue;

      const normalized = await warpToCanonical(img, h, canvas.width, canvas.height);

      let blackSum = 0, blackN = 0, whiteSum = 0, whiteN = 0;
      for (const patch of template.calibration) {
        const roi = {
          x: Math.round(mmToPx(patch.rect.x, dpi)), y: Math.round(mmToPx(patch.rect.y, dpi)),
          w: Math.round(mmToPx(patch.rect.w, dpi)), h: Math.round(mmToPx(patch.rect.h, dpi)),
        };
        const r = fillRatio(normalized, roi);
        if (patch.kind === "black") { blackSum += r; blackN++; } else { whiteSum += r; whiteN++; }
      }
      const contrast = blackN && whiteN ? blackSum / blackN - whiteSum / whiteN : 0;

      if (!best || contrast > best.contrast) {
        best = { normalized, reprojectionErrorPx: h.reprojectionErrorPx, contrast };
      }
    }
  }

  // Sin contraste real entre negro y blanco, ninguna rotación probada
  // corresponde a la hoja real (o los marcadores encontrados no son
  // marcadores de verdad) — mejor no producir una imagen "alineada" falsa.
  if (!best || best.contrast < 0.15) return null;
  return { normalized: best.normalized, reprojectionErrorPx: best.reprojectionErrorPx };
}

export async function analyzeGeometry(
  img: GrayImage, template: Template, dpi: number
): Promise<GeometryOutcome> {
  // Los marcadores se buscan a escalas conocidas (ver detectionScale.ts):
  // los umbrales de forma y área de fiducials.ts son valores absolutos en
  // píxeles, así que sin esto una foto de más resolución confunde burbujas
  // rellenadas con marcadores. Se prueban varias escalas porque ninguna
  // funciona para todas las fotos — misma estrategia que findFiducialsRobust
  // con los métodos de umbral. El enderezado se hace después desde `img`
  // ORIGINAL, para no perder detalle de medición.
  let found: Awaited<ReturnType<typeof findFiducialsRobust>> = null;
  let corners: Point[] | null = null;

  for (const width of detectionWidthsFor(img)) {
    const scaled = await scaleForDetection(img, width);
    const attempt = await findFiducialsRobust(scaled.image);
    if (!attempt) continue;
    found = attempt;
    corners = scalePoints(attempt.markers.map((m) => m.centerPx), scaled.scaleToOriginal);
    break;
  }

  if (!found || !corners) return { kind: "rejected", reason: "MARKERS_NOT_FOUND" };

  const resolved = await resolveOrientationAndWarp(img, corners, template, dpi);
  if (!resolved) return { kind: "rejected", reason: "BAD_HOMOGRAPHY" };

  return {
    kind: "aligned",
    normalized: resolved.normalized,
    reprojectionErrorPx: resolved.reprojectionErrorPx,
    thresholdMethod: found.method,
  };
}

/**
 * Overlay de burbujas: un pequeño círculo en el centro de CADA burbuja que
 * el Template describe, dibujado sobre la imagen normalizada. Devuelve un
 * buffer RGB plano (no escribe archivos — quien persiste es el CLI/API,
 * PROMPT.md §8). Sirve para responder de un vistazo "¿la homografía cayó
 * donde tenía que caer?", exactamente lo que ya se verificó a mano en las
 * fotos reales durante el desarrollo de este día.
 */
export function renderOverlay(normalized: GrayImage, template: Template, dpi: number): Uint8Array {
  const { width, height, data } = normalized;
  const rgb = new Uint8Array(width * height * 3);
  for (let p = 0; p < data.length; p++) {
    const v = data[p]!;
    rgb[p * 3] = v; rgb[p * 3 + 1] = v; rgb[p * 3 + 2] = v;
  }

  const mmToPx = (mm: number) => (mm / 25.4) * dpi;
  const paint = (px: number, py: number, r: number, g: number, b: number) => {
    if (px < 0 || px >= width || py < 0 || py >= height) return;
    const idx = (py * width + px) * 3;
    rgb[idx] = r; rgb[idx + 1] = g; rgb[idx + 2] = b;
  };

  for (const group of template.groups) {
    for (const bubble of group.bubbles) {
      const cx = Math.round(mmToPx(bubble.center.x));
      const cy = Math.round(mmToPx(bubble.center.y));
      const r = Math.round(mmToPx(template.bubbleDiameterMm) / 2);
      for (let a = 0; a < 360; a += 3) {
        const rad = (a * Math.PI) / 180;
        paint(Math.round(cx + r * Math.cos(rad)), Math.round(cy + r * Math.sin(rad)), 255, 0, 0);
      }
    }
  }

  for (const marker of template.markers) {
    const cx = Math.round(mmToPx(marker.center.x));
    const cy = Math.round(mmToPx(marker.center.y));
    const half = Math.round(mmToPx(marker.sizeMm) / 2);
    for (let d = -half; d <= half; d++) {
      paint(cx + d, cy - half, 0, 255, 0);
      paint(cx + d, cy + half, 0, 255, 0);
      paint(cx - half, cy + d, 0, 255, 0);
      paint(cx + half, cy + d, 0, 255, 0);
    }
  }

  return rgb;
}
