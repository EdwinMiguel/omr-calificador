/**
 * types.ts — Contratos puros del motor OMR. Cero I/O en este archivo ni en
 * nada que lo importe (packages/engine/): ver PROMPT.md §6.
 */

/**
 * Una página en escala de grises, 8 bits, 1 byte por píxel, sin canales,
 * sin alfa, sin compresión. `data` tiene exactamente `width * height` bytes,
 * en orden fila por fila (fila 0 completa, luego fila 1, ...).
 *
 * Es la ÚNICA forma de imagen que el motor conoce. La conversión desde
 * cualquier formato de archivo ocurre una sola vez, en el borde del sistema
 * (apps/cli/io, más adelante apps/api) — nunca dentro de packages/engine.
 */
export interface GrayImage {
  data: Uint8Array;
  width: number;
  height: number;
}
