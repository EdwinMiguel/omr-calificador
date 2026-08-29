/**
 * readingOverlay.ts — la hoja escaneada con lo que el motor leyó encima.
 *
 * Distinto de `renderOverlay` (geometry.ts), que dibuja las 500 burbujas
 * del Template en rojo: eso responde "¿la homografía cayó donde debía?" y
 * sirve para depurar geometría. Esto responde otra pregunta, la del
 * profesor: **"¿lo que el programa leyó coincide con lo que el alumno
 * marcó?"** — y para eso 500 círculos rojos son ruido, no información.
 *
 * Por eso aquí se marca SOLO lo leído, con color según el estado:
 *   verde  → el motor resolvió esta opción con confianza
 *   ámbar  → quedó en duda y fue a revisión manual
 *
 * Así la verificación es visual y rápida: el profesor recorre la hoja
 * buscando que cada anillo verde caiga sobre una burbuja efectivamente
 * pintada, y que los ámbar sean justamente los casos difíciles.
 *
 * Función pura (PROMPT.md §6): devuelve un buffer RGB, no escribe archivos.
 */

import type { GrayImage } from "./types.ts";
import type { Template } from "../../template.ts";

export type MarkTone = "read" | "review";

export interface ReadingMark {
  /** Id del grupo en el Template: "q.97", "codigo.2". */
  groupId: string;
  /** Opciones a señalar. Vacío = no se leyó nada (BLANK/AMBIGUOUS). */
  options: string[];
  tone: MarkTone;
}

const COLORS: Record<MarkTone, [number, number, number]> = {
  // Verde y ámbar elegidos oscuros a propósito: sobre papel blanco
  // escaneado, un verde claro casi no se distingue.
  read: [22, 140, 80],
  review: [200, 130, 0],
};

/** Grosor del anillo en mm — visible al ver la hoja completa sin tapar la marca. */
const RING_THICKNESS_MM = 0.45;
/** Cuánto más grande que la burbuja se dibuja el anillo, para no cubrir el grafito. */
const RING_MARGIN_MM = 0.7;

export function renderReadingOverlay(
  normalized: GrayImage,
  template: Template,
  dpi: number,
  marks: readonly ReadingMark[]
): Uint8Array {
  const { width, height, data } = normalized;

  const rgb = new Uint8Array(width * height * 3);
  for (let p = 0; p < data.length; p++) {
    const v = data[p]!;
    rgb[p * 3] = v;
    rgb[p * 3 + 1] = v;
    rgb[p * 3 + 2] = v;
  }

  const mmToPx = (mm: number): number => (mm / 25.4) * dpi;
  const paint = (px: number, py: number, color: [number, number, number]): void => {
    if (px < 0 || px >= width || py < 0 || py >= height) return;
    const idx = (py * width + px) * 3;
    rgb[idx] = color[0];
    rgb[idx + 1] = color[1];
    rgb[idx + 2] = color[2];
  };

  /** Anillo grueso: se recorre el cuadrado que lo contiene y se pinta la corona. */
  const ring = (cxMm: number, cyMm: number, radiusMm: number, color: [number, number, number]): void => {
    const cx = mmToPx(cxMm);
    const cy = mmToPx(cyMm);
    const rOuter = mmToPx(radiusMm + RING_THICKNESS_MM);
    const rInner = mmToPx(radiusMm);
    const box = Math.ceil(rOuter);
    for (let dy = -box; dy <= box; dy++) {
      for (let dx = -box; dx <= box; dx++) {
        const dist = Math.hypot(dx, dy);
        if (dist >= rInner && dist <= rOuter) {
          paint(Math.round(cx + dx), Math.round(cy + dy), color);
        }
      }
    }
  };

  /** Cuadrado macizo, para señalar una pregunta sin ninguna opción leída. */
  const square = (cxMm: number, cyMm: number, sizeMm: number, color: [number, number, number]): void => {
    const cx = Math.round(mmToPx(cxMm));
    const cy = Math.round(mmToPx(cyMm));
    const half = Math.round(mmToPx(sizeMm) / 2);
    for (let dy = -half; dy <= half; dy++) {
      for (let dx = -half; dx <= half; dx++) paint(cx + dx, cy + dy, color);
    }
  };

  const groups = new Map(template.groups.map((g) => [g.id, g]));
  const bubbleRadiusMm = template.bubbleDiameterMm / 2 + RING_MARGIN_MM;

  for (const mark of marks) {
    const group = groups.get(mark.groupId);
    if (!group) continue;
    const color = COLORS[mark.tone];

    if (mark.options.length === 0) {
      // Nada leído: se marca el renglón a la izquierda de la primera burbuja,
      // porque no hay ninguna opción concreta que rodear y dejar la pregunta
      // sin señal alguna la volvería invisible en la revisión.
      const first = group.bubbles[0];
      if (!first) continue;
      square(first.center.x - template.bubbleDiameterMm * 1.6, first.center.y, 1.6, color);
      continue;
    }

    for (const option of mark.options) {
      const bubble = group.bubbles.find((b) => b.label === option);
      if (!bubble) continue;
      ring(bubble.center.x, bubble.center.y, bubbleRadiusMm, color);
    }
  }

  return rgb;
}
