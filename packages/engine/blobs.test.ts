import { describe, it, expect } from "vitest";
import { morphologyOpen, findBlobs } from "./blobs.ts";
import type { GrayImage } from "./types.ts";

function synthSquares(): GrayImage {
  const w = 200, h = 200;
  const data = new Uint8Array(w * h); // todo 0 (papel)
  const put = (x0: number, y0: number, size: number) => {
    for (let y = y0; y < y0 + size; y++) for (let x = x0; x < x0 + size; x++) data[y * w + x] = 255;
  };
  put(20, 20, 40);
  put(120, 20, 40);
  put(20, 120, 40);
  return { data, width: w, height: h };
}

describe("findBlobs — caso del plan: 3 cuadrados sintéticos", () => {
  it("encuentra exactamente 3 blobs con las dimensiones esperadas", async () => {
    const img = synthSquares();
    const blobs = await findBlobs(img);

    expect(blobs).toHaveLength(3);
    for (const b of blobs) {
      expect(b.boundingRect.width).toBe(40);
      expect(b.boundingRect.height).toBe(40);
      expect(b.aspectRatio).toBeCloseTo(1, 1);
      expect(b.solidity).toBeCloseTo(1, 1); // cuadrado = totalmente convexo
    }

    // Un cuadrado que ocupa los índices de píxel 20..59 (40px) tiene su
    // centro geométrico en 39.5, no en 40 — (20+59)/2, no 20+40/2. Fue mi
    // primer error al escribir este test: asumí aritmética continua sobre
    // algo que son posiciones discretas de píxel.
    const centroids = blobs.map((b) => b.centroid).sort((a, b) => a.x - b.x || a.y - b.y);
    expect(centroids[0]).toEqual({ x: 39.5, y: 39.5 });
    expect(centroids[1]).toEqual({ x: 39.5, y: 139.5 });
    expect(centroids[2]).toEqual({ x: 139.5, y: 39.5 });
  });
});

describe("morphologyOpen — quita ruido sin destruir blobs reales", () => {
  it("elimina motas de 5x5 (área 16, pasan el filtro por área) con un kernel de apertura de 7x7", async () => {
    const img = synthSquares();
    // OpenCV calcula el área de un contorno trazado como (lado-1)², no
    // lado² (un cuadrado de 40px ya dio área 1521 = 39² arriba, no 1600).
    // Una mota de 2x2 tendría área 1 — ya la filtraría MIN_BLOB_AREA=4 por
    // sí solo, sin que la morfología tuviera que hacer nada (así falló el
    // primer intento de este test). Con motas de 5x5 (área 16) sí pasan
    // ese filtro y hace falta abrir con un kernel más grande que ellas
    // (7x7) para demostrar que la apertura, no el filtro de área, es lo
    // que las elimina.
    const noiseSpots: [number, number][] = [[70, 70], [95, 95], [70, 165], [165, 70]];
    for (const [nx, ny] of noiseSpots) {
      for (let y = ny; y < ny + 5; y++) for (let x = nx; x < nx + 5; x++) img.data[y * img.width + x] = 255;
    }

    const before = await findBlobs(img);
    const opened = await morphologyOpen(img, 7);
    const after = await findBlobs(opened);

    // Antes: 3 cuadrados + 4 motas de ruido = 7. Después de abrir: solo los 3 reales.
    expect(before).toHaveLength(3 + noiseSpots.length);
    expect(after).toHaveLength(3);
    for (const b of after) {
      expect(b.boundingRect.width).toBe(40);
      expect(b.boundingRect.height).toBe(40);
    }
  });
});
