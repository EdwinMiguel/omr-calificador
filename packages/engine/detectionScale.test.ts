import { describe, it, expect } from "vitest";
import {
  scaleForDetection, scalePoints, detectionWidthsFor,
  DETECTION_TARGET_WIDTH_PX, DETECTION_SCALE_LADDER_PX,
} from "./detectionScale.ts";
import type { GrayImage } from "./types.ts";

function gray(width: number, height: number): GrayImage {
  return { data: new Uint8Array(width * height).fill(200), width, height };
}

describe("scaleForDetection", () => {
  it("no toca una imagen que ya está por debajo del objetivo — agrandar no agrega información", async () => {
    const img = gray(1200, 1600);
    const r = await scaleForDetection(img);
    expect(r.image).toBe(img);
    expect(r.scaleToOriginal).toBe(1);
  });

  it("reduce una foto de celular al ancho objetivo, conservando la proporción", async () => {
    const r = await scaleForDetection(gray(3072, 4080));
    expect(r.image.width).toBe(DETECTION_TARGET_WIDTH_PX);
    // 4080 * (1500/3072) ≈ 1992
    expect(r.image.height).toBeGreaterThan(1980);
    expect(r.image.height).toBeLessThan(2005);
  });

  it("el factor devuelto permite recuperar las coordenadas originales", async () => {
    const r = await scaleForDetection(gray(3000, 4000));
    expect(r.scaleToOriginal).toBeCloseTo(3000 / r.image.width, 5);
    const [p] = scalePoints([{ x: 100, y: 200 }], r.scaleToOriginal);
    expect(p!.x).toBeCloseTo(100 * r.scaleToOriginal, 5);
    expect(p!.y).toBeCloseTo(200 * r.scaleToOriginal, 5);
  });

  it("respeta un ancho objetivo explícito, que es lo que usa la escalera", async () => {
    const r = await scaleForDetection(gray(3072, 4080), 1200);
    expect(r.image.width).toBe(1200);
  });
});

describe("scalePoints", () => {
  it("con factor 1 devuelve una copia, no la misma referencia — evita alias accidentales", () => {
    const pts = [{ x: 1, y: 2 }];
    const out = scalePoints(pts, 1);
    expect(out).toEqual(pts);
    expect(out).not.toBe(pts);
  });
});

describe("detectionWidthsFor", () => {
  it("una foto grande recorre toda la escalera", () => {
    expect(detectionWidthsFor(gray(4000, 3000))).toEqual([...DETECTION_SCALE_LADDER_PX]);
  });

  it(
    "una imagen pequeña no repite intentos: los peldaños que la superan " +
    "colapsan en su propio ancho, y el duplicado se descarta",
    () => {
      // 1204px: el peldaño 1500 y el 1800 dan ambos 1204 (nunca se agranda),
      // así que solo quedan 1204 y 1200.
      expect(detectionWidthsFor(gray(1204, 1600))).toEqual([1204, 1200]);
    }
  );

  it("nunca propone un ancho mayor que el de la imagen", () => {
    for (const w of [500, 900, 1300, 1600, 2500, 4000]) {
      for (const proposed of detectionWidthsFor(gray(w, 1000))) {
        expect(proposed).toBeLessThanOrEqual(w);
      }
    }
  });

  it("la escalera se mantiene dentro del rango seguro derivado (~900-1934 px)", () => {
    for (const rung of DETECTION_SCALE_LADDER_PX) {
      expect(rung).toBeGreaterThanOrEqual(900);
      expect(rung).toBeLessThanOrEqual(1934);
    }
  });
});
