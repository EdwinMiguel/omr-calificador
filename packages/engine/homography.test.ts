import { describe, it, expect } from "vitest";
import { computeHomography, warpToCanonical, type Point } from "./homography.ts";
import { loadCv } from "./cv.ts";
import type { GrayImage } from "./types.ts";

function drawSquare(data: Uint8Array, w: number, cx: number, cy: number, half: number) {
  for (let y = cy - half; y < cy + half; y++) {
    for (let x = cx - half; x < cx + half; x++) {
      if (x >= 0 && x < w && y >= 0 && y < data.length / w) data[y * w + x] = 255;
    }
  }
}

describe("computeHomography + warpToCanonical", () => {
  it("con 4 puntos, el error de reproyección es ~0 (solución exacta)", async () => {
    const src: Point[] = [{ x: 10, y: 10 }, { x: 300, y: 40 }, { x: 280, y: 350 }, { x: 5, y: 320 }];
    const dst: Point[] = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 0, y: 300 }];
    const h = await computeHomography(src, dst);
    expect(h.reprojectionErrorPx).toBeLessThan(0.01);
  });

  it("rechaza si no son exactamente 4 puntos, en vez de comportarse raro", async () => {
    await expect(computeHomography([{ x: 0, y: 0 }], [{ x: 0, y: 0 }])).rejects.toThrow(/4 puntos/);
  });

  it(
    "DEMUESTRA el round-trip real: distorsiona una imagen con marcadores " +
    "conocidos, calcula la homografía inversa a partir de esos marcadores, " +
    "y recupera una imagen frontal donde los marcadores vuelven a estar " +
    "donde el Template dice que deberían estar",
    async () => {
      const cv = await loadCv();

      // Lienzo "canónico": 4 cuadrados marcando las esquinas de un
      // rectángulo de 300x300 dentro de una imagen de 320x320.
      const canonW = 320, canonH = 320;
      const canonical = new Uint8Array(canonW * canonH);
      const canonCorners: Point[] = [
        { x: 10, y: 10 }, { x: 310, y: 10 }, { x: 310, y: 310 }, { x: 10, y: 310 },
      ];
      for (const c of canonCorners) drawSquare(canonical, canonW, c.x, c.y, 8);

      // "Foto": la misma imagen, deformada con una perspectiva conocida —
      // simula una hoja fotografiada en ángulo. cv.warpPerspective hacia
      // ADELANTE (canónico → foto) para construir el caso de prueba.
      const distortedCorners: Point[] = [
        { x: 40, y: 60 }, { x: 380, y: 20 }, { x: 400, y: 380 }, { x: 20, y: 340 },
      ];
      const srcMat = cv.matFromArray(4, 1, cv.CV_32FC2, canonCorners.flatMap((p) => [p.x, p.y]));
      const dstMat = cv.matFromArray(4, 1, cv.CV_32FC2, distortedCorners.flatMap((p) => [p.x, p.y]));
      const forwardH = cv.getPerspectiveTransform(srcMat, dstMat);
      const canonMat = new cv.Mat(canonH, canonW, cv.CV_8UC1);
      canonMat.data.set(canonical);
      const photoMat = new cv.Mat();
      cv.warpPerspective(canonMat, photoMat, forwardH, new cv.Size(420, 420));
      const photo: GrayImage = { data: new Uint8Array(photoMat.data), width: photoMat.cols, height: photoMat.rows };
      srcMat.delete(); dstMat.delete(); forwardH.delete(); canonMat.delete(); photoMat.delete();

      // Ahora, como haría el pipeline real: SOLO con los 4 puntos
      // (equivalentes a lo que devolvería findFiducials sobre la "foto"),
      // se calcula la homografía inversa y se endereza.
      const inverseH = await computeHomography(distortedCorners, canonCorners);
      expect(inverseH.reprojectionErrorPx).toBeLessThan(0.5);

      const recovered = await warpToCanonical(photo, inverseH, canonW, canonH);

      // Verificación real: en la imagen recuperada, ¿hay tinta donde el
      // Template (canonCorners) dice que debería haber un marcador?
      for (const c of canonCorners) {
        let ink = 0, total = 0;
        for (let y = c.y - 6; y < c.y + 6; y++) {
          for (let x = c.x - 6; x < c.x + 6; x++) {
            total++;
            if (recovered.data[y * canonW + x] === 255) ink++;
          }
        }
        expect(ink / total).toBeGreaterThan(0.7);
      }
    }
  );
});
