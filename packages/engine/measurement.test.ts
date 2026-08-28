import { describe, it, expect } from "vitest";
import { fillRatio, fillRatioNearby } from "./measurement.ts";
import type { GrayImage } from "./types.ts";

describe("fillRatio", () => {
  it("da ~0 sobre papel blanco puro", () => {
    const img: GrayImage = { data: new Uint8Array(100 * 100).fill(255), width: 100, height: 100 };
    expect(fillRatio(img, { x: 10, y: 10, w: 20, h: 20 })).toBeCloseTo(0, 5);
  });

  it("da ~1 sobre tinta negra pura", () => {
    const img: GrayImage = { data: new Uint8Array(100 * 100).fill(0), width: 100, height: 100 };
    expect(fillRatio(img, { x: 10, y: 10, w: 20, h: 20 })).toBeCloseTo(1, 5);
  });

  it("da ~0.5 cuando la mitad del ROI es tinta y la mitad papel", () => {
    const w = 100, h = 100;
    const data = new Uint8Array(w * h).fill(255);
    for (let y = 10; y < 30; y++) for (let x = 10; x < 20; x++) data[y * w + x] = 0; // mitad izq. del ROI
    const img: GrayImage = { data, width: w, height: h };
    expect(fillRatio(img, { x: 10, y: 10, w: 20, h: 20 })).toBeCloseTo(0.5, 2);
  });

  it("distingue una burbuja marcada de una vacía con el mismo tamaño de ROI", () => {
    const w = 100, h = 100;
    const data = new Uint8Array(w * h).fill(255);
    // Burbuja "marcada": círculo relleno de lápiz dentro del ROI.
    for (let y = 10; y < 30; y++) {
      for (let x = 60; x < 80; x++) {
        if ((x - 70) ** 2 + (y - 20) ** 2 <= 100) data[y * w + x] = 30;
      }
    }
    const img: GrayImage = { data, width: w, height: h };
    const blank = fillRatio(img, { x: 10, y: 10, w: 20, h: 20 });
    const marked = fillRatio(img, { x: 60, y: 10, w: 20, h: 20 });
    expect(blank).toBeLessThan(0.05);
    expect(marked).toBeGreaterThan(0.5);
  });

  it("recorta el ROI a los límites de la imagen en vez de leer basura", () => {
    const img: GrayImage = { data: new Uint8Array(10 * 10).fill(0), width: 10, height: 10 };
    // ROI que se sale por los 4 lados — no debe explotar ni devolver NaN.
    expect(fillRatio(img, { x: -5, y: -5, w: 20, h: 20 })).toBeCloseTo(1, 5);
  });

  it("lanza si el ROI cae completamente fuera de la imagen", () => {
    const img: GrayImage = { data: new Uint8Array(10 * 10).fill(0), width: 10, height: 10 };
    expect(() => fillRatio(img, { x: 100, y: 100, w: 5, h: 5 })).toThrow(/fuera de la imagen/);
  });
});

describe("fillRatioNearby", () => {
  it("encuentra una marca real desplazada del ROI nominal — caso real medido (Día 9)", () => {
    const w = 200, h = 200;
    const data = new Uint8Array(w * h).fill(255);
    // Marca real a 12px de donde el Template "espera" la burbuja — dentro
    // del rango observado en fotos reales (8-15px).
    for (let y = 92; y < 112; y++) for (let x = 92; x < 112; x++) data[y * w + x] = 20;

    const img: GrayImage = { data, width: w, height: h };
    const nominalRoi = { x: 80, y: 80, w: 20, h: 20 }; // centro nominal (90,90), la tinta está en (92-112)

    expect(fillRatio(img, nominalRoi)).toBeLessThan(0.3); // el ROI exacto la pierde casi toda
    // >0.7, no >0.9: el barrido en pasos de 2px no siempre cae en el
    // desplazamiento óptimo exacto (12,12 es par, la grilla parte de -15
    // impar) — lo que importa es que la encuentre, muy por encima del
    // ROI sin corregir, no que la aciarte al píxel.
    expect(fillRatioNearby(img, nominalRoi)).toBeGreaterThan(0.7);
  });

  it("no inventa una marca donde solo hay papel en blanco", () => {
    const img: GrayImage = { data: new Uint8Array(200 * 200).fill(255), width: 200, height: 200 };
    expect(fillRatioNearby(img, { x: 80, y: 80, w: 20, h: 20 })).toBeCloseTo(0, 5);
  });
});
