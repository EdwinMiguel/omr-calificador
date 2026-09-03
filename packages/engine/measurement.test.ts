import { describe, it, expect } from "vitest";
import { fillRatio, fillRatioNearby, SEARCH_RADIUS_PX } from "./measurement.ts";
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
  /** Marca cuadrada de 20x20 con su centro desplazado `d` px del centro
   * nominal, sobre papel blanco. */
  const conMarcaDesplazada = (d: number) => {
    const w = 200, h = 200;
    const data = new Uint8Array(w * h).fill(255);
    for (let y = 80 + d; y < 100 + d; y++) for (let x = 80 + d; x < 100 + d; x++) data[y * w + x] = 20;
    return { img: { data, width: w, height: h } as GrayImage, roi: { x: 80, y: 80, w: 20, h: 20 } };
  };

  it("encuentra una marca desplazada dentro del radio calibrado, que el ROI nominal pierde", () => {
    // En el borde mismo de la ventana: es el caso más exigente que el radio
    // calibrado sí tiene que cubrir. La mediana medida en fotos reales cae
    // bastante por debajo (1 a 7 px, ver la nota de SEARCH_RADIUS_PX).
    const { img, roi } = conMarcaDesplazada(SEARCH_RADIUS_PX);
    expect(fillRatio(img, roi)).toBeLessThan(0.35);        // el ROI exacto la pierde casi toda
    expect(fillRatioNearby(img, roi)).toBeGreaterThan(0.85); // la búsqueda la recupera entera
  });

  it(
    "una marca desplazada MÁS que el radio queda medida a medias — es el " +
    "lado que se paga del compromiso, y se paga a propósito",
    () => {
      // El radio no se elige por el desplazamiento máximo observado sino por
      // la BRECHA de separación: ver la tabla en measurement.ts. Una marca
      // así mide bajo y va a revisión (conservador), no se lee mal.
      const { img, roi } = conMarcaDesplazada(SEARCH_RADIUS_PX + 4);
      const medido = fillRatioNearby(img, roi);
      expect(medido).toBeGreaterThan(fillRatio(img, roi)); // algo recupera
      expect(medido).toBeLessThan(0.7);                    // pero no todo
    }
  );

  it(
    "REGRESIÓN: una ventana más grande infla una burbuja SIN marcar, que es " +
    "por lo que el radio bajó de 15 a 8",
    () => {
      // La búsqueda se aplica igual a toda burbuja. En una vacía no hay pico
      // que encontrar: el máximo solo alcanza la tinta impresa vecina y sube
      // la lectura de una burbuja que debería leer ~0, comiéndose el margen
      // de la marcada de su fila.
      const w = 200, h = 200;
      const data = new Uint8Array(w * h).fill(255);
      // Estructura impresa (borde de tabla) 10 px por debajo del ROI
      // nominal: fuera del alcance de ±8, dentro del de ±15.
      for (let y = 110; y < 130; y++) for (let x = 60; x < 140; x++) data[y * w + x] = 20;
      const img: GrayImage = { data, width: w, height: h };
      const roi = { x: 80, y: 80, w: 20, h: 20 };

      expect(fillRatio(img, roi)).toBeCloseTo(0, 3);            // vacía de verdad
      expect(fillRatioNearby(img, roi, 8)).toBeCloseTo(0, 3);   // ±8 no la alcanza
      expect(fillRatioNearby(img, roi, 15)).toBeGreaterThan(0.1); // ±15 sí: contaminada
    }
  );
});
