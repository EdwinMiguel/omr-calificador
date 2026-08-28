import { describe, it, expect } from "vitest";
import { thresholdGlobal, thresholdOtsu, thresholdAdaptive } from "./threshold.ts";
import type { GrayImage } from "./types.ts";

function countInk(img: GrayImage): number {
  let n = 0;
  for (const v of img.data) if (v === 255) n++;
  return n;
}

describe("thresholdGlobal / thresholdOtsu — un solo corte para toda la imagen", () => {
  it("separa tinta de papel cuando la iluminación es pareja", async () => {
    // 10x10, papel=200 parejo, un bloque de tinta=20 de 3x3 = 9 píxeles.
    const w = 10, h = 10;
    const data = new Uint8Array(w * h).fill(200);
    for (let y = 3; y < 6; y++) for (let x = 3; x < 6; x++) data[y * w + x] = 20;
    const img: GrayImage = { data, width: w, height: h };

    const result = await thresholdGlobal(img, 128);
    expect(countInk(result)).toBe(9); // exactamente el bloque de tinta, ni más ni menos
  });

  it(
    "DEMUESTRA el fallo: con una sombra parcial, el global confunde papel " +
    "oscuro con tinta — Otsu, al ser también UN SOLO corte global, hereda " +
    "el mismo problema",
    async () => {
      // Imagen 20x10 con una sombra: mitad izquierda papel=200 (iluminada),
      // mitad derecha papel=90 (en sombra) — SIN ninguna tinta ahí todavía.
      // Un bloque real de tinta (valor 20) va en la mitad iluminada.
      const w = 20, h = 10;
      const data = new Uint8Array(w * h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          data[y * w + x] = x < w / 2 ? 200 : 90;
        }
      }
      for (let y = 3; y < 6; y++) for (let x = 3; x < 6; x++) data[y * w + x] = 20; // tinta real, 9px
      const img: GrayImage = { data, width: w, height: h };

      const global = await thresholdGlobal(img, 128);
      const otsu = await thresholdOtsu(img);
      const adaptive = await thresholdAdaptive(img, 7, 5);

      // La verdad: solo 9 píxeles son tinta real. TODA la mitad derecha
      // (10x10=100 píxeles) es papel en sombra, no tinta.
      const globalInk = countInk(global);
      const otsuInk = countInk(otsu);
      const adaptiveInk = countInk(adaptive);

      // Global con corte fijo en 128: 90 < 128, así que clasifica TODA la
      // mitad en sombra (100px) como tinta, además de la tinta real (9px).
      expect(globalInk).toBeGreaterThanOrEqual(100);

      // Otsu es automático, pero sigue siendo UN SOLO corte para toda la
      // imagen: con una imagen bimodal 200/90 (más 9px de 20), el corte que
      // más separa los dos grupos grandes queda en algún punto entre 90 y
      // 200 — por encima de 90, así que también arrastra la mitad en sombra.
      expect(otsuInk).toBeGreaterThanOrEqual(100);

      // Adaptativo compara cada píxel contra SU vecindario local: en la
      // mitad en sombra el vecindario también es ~90, así que esa zona no
      // se marca como tinta. Debe acercarse mucho a la verdad (9), muy por
      // debajo de lo que dan global/Otsu.
      expect(adaptiveInk).toBeLessThan(30);
    }
  );
});

describe("thresholdAdaptive — validación de parámetros", () => {
  it("rechaza blockSize par en vez de dejar que OpenCV falle silenciosamente", async () => {
    const img: GrayImage = { data: new Uint8Array(9).fill(100), width: 3, height: 3 };
    await expect(thresholdAdaptive(img, 10)).rejects.toThrow(/impar/);
  });
});
