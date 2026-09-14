import { describe, it, expect } from "vitest";
import { findFiducials, findFiducialsRobust } from "./fiducials.ts";
import { findBlobs } from "./blobs.ts";
import type { GrayImage } from "./types.ts";

function drawSquare(data: Uint8Array, w: number, x0: number, y0: number, size: number) {
  for (let y = y0; y < y0 + size; y++) for (let x = x0; x < x0 + size; x++) data[y * w + x] = 255;
}

/**
 * Anillo hueco, no disco relleno: así es una burbuja SIN MARCAR de verdad
 * (drawCircle en generateSheet.ts usa borderColor/borderWidth, no relleno).
 * Un disco relleno tendría fillRatio≈0.79 — pasaría el filtro igual que un
 * marcador, y no probaría nada.
 */
function drawRing(data: Uint8Array, w: number, cx: number, cy: number, r: number, thickness: number) {
  for (let y = cy - r; y <= cy + r; y++) {
    for (let x = cx - r; x <= cx + r; x++) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      if (d <= r && d >= r - thickness) data[y * w + x] = 255;
    }
  }
}

describe("findFiducials", () => {
  it("encuentra los 4 marcadores e ignora burbujas circulares chicas", async () => {
    const w = 400, h = 400;
    const data = new Uint8Array(w * h);
    // 30x30 → contourArea (29)² = 841, por encima de MIN_MARKER_AREA_PX (600).
    drawSquare(data, w, 10, 10, 30);    // TL
    drawSquare(data, w, 360, 10, 30);   // TR
    drawSquare(data, w, 360, 360, 30);  // BR
    drawSquare(data, w, 10, 360, 30);   // BL
    // "Burbujas" sin marcar: anillos huecos deliberadamente GRANDES (radio
    // 20, área de bounding box similar a la de un marcador) para que la
    // única razón por la que se descarten sea fillRatio bajo — no el área.
    drawRing(data, w, 70, 70, 20, 3);
    drawRing(data, w, 330, 330, 20, 3);

    const img: GrayImage = { data, width: w, height: h };
    const blobs = await findBlobs(img);
    const result = findFiducials(blobs, w, h);

    expect(result).not.toBeNull();
    expect(result!.map((m) => m.id)).toEqual(["TL", "TR", "BR", "BL"]);
    const tl = result!.find((m) => m.id === "TL")!;
    // Centro del bounding box (10..39 → centro 25), no centroide ponderado
    // por intensidad — ver el porqué en fiducials.ts::centerOf.
    expect(tl.centerPx.x).toBeCloseTo(25, 0);
    expect(tl.centerPx.y).toBeCloseTo(25, 0);
  });

  it("devuelve null en vez de adivinar cuando falta un marcador", async () => {
    const w = 400, h = 400;
    const data = new Uint8Array(w * h);
    drawSquare(data, w, 10, 10, 30);
    drawSquare(data, w, 360, 10, 30);
    drawSquare(data, w, 360, 360, 30);
    // Falta BL a propósito.

    const img: GrayImage = { data, width: w, height: h };
    const blobs = await findBlobs(img);
    expect(findFiducials(blobs, w, h)).toBeNull();
  });

  it("devuelve null si los 4 candidatos cuadrados no tienen tamaño consistente", async () => {
    const w = 400, h = 400;
    const data = new Uint8Array(w * h);
    drawSquare(data, w, 10, 10, 30);
    drawSquare(data, w, 360, 10, 30);
    drawSquare(data, w, 360, 360, 30);
    drawSquare(data, w, 10, 360, 90); // mucho más grande: no es "el mismo sello"

    const img: GrayImage = { data, width: w, height: h };
    const blobs = await findBlobs(img);
    expect(findFiducials(blobs, w, h)).toBeNull();
  });

  it("devuelve null cuando el candidato más cercano sigue estando lejísimos de la esquina", async () => {
    // Caso real que reveló la falta de este piso: sin marcadores
    // verdaderos disponibles, el algoritmo aceptaba "lo menos lejos" aunque
    // estuviera a más de la mitad de la diagonal de su esquina asignada.
    // 4 cuadrados grandes y consistentes entre sí, pero todos amontonados
    // cerca del centro — ninguno cerca de ninguna esquina real.
    const w = 400, h = 400;
    const data = new Uint8Array(w * h);
    drawSquare(data, w, 180, 180, 30);
    drawSquare(data, w, 220, 180, 30);
    drawSquare(data, w, 220, 220, 30);
    drawSquare(data, w, 180, 220, 30);

    const img: GrayImage = { data, width: w, height: h };
    const blobs = await findBlobs(img);
    expect(findFiducials(blobs, w, h)).toBeNull();
  });

  it("rescata un 4to marcador degradado (muy chico) usando la posición predicha por los otros 3", async () => {
    // Caso real: en la mayoría de las fotos del dataset, 3 esquinas se
    // encuentran con confianza y la 4ta queda deformada por mala luz o
    // ángulo, demasiado chica para pasar MIN_MARKER_AREA_PX (600) por sí
    // sola. Acá se simula con un cuadrado de 15x15 (área≈196) en la
    // posición donde la geometría de paralelogramo predice que debería
    // estar BL a partir de TL, TR y BR — no en cualquier lugar cercano,
    // sino exactamente en la posición que la predicción calcula.
    const w = 400, h = 400;
    const data = new Uint8Array(w * h);
    drawSquare(data, w, 10, 10, 30);    // TL, centro (24.5, 24.5)
    drawSquare(data, w, 360, 10, 30);   // TR, centro (374.5, 24.5)
    drawSquare(data, w, 360, 360, 30);  // BR, centro (374.5, 374.5)
    // BL predicho = TL + BR - TR = (24.5, 374.5) — degradado a 15x15.
    drawSquare(data, w, 17, 367, 15);

    const img: GrayImage = { data, width: w, height: h };
    const blobs = await findBlobs(img);
    const result = findFiducials(blobs, w, h);

    expect(result).not.toBeNull();
    const bl = result!.find((m) => m.id === "BL")!;
    // Centro del bounding box del cuadrado degradado (17..31, size 15).
    expect(bl.centerPx.x).toBeCloseTo(24.5, 0);
    expect(bl.centerPx.y).toBeCloseTo(374.5, 0);
  });

  it("no rescata nada si el 4to marcador realmente no está en ningún lado", async () => {
    const w = 400, h = 400;
    const data = new Uint8Array(w * h);
    drawSquare(data, w, 10, 10, 30);
    drawSquare(data, w, 360, 10, 30);
    drawSquare(data, w, 360, 360, 30);
    // BL ausente por completo, ni siquiera degradado.

    const img: GrayImage = { data, width: w, height: h };
    const blobs = await findBlobs(img);
    expect(findFiducials(blobs, w, h)).toBeNull();
  });

  it("devuelve null cuando ningún blob alcanza el tamaño real de un marcador", async () => {
    // El caso real que reveló la falta de este piso: una foto degradada
    // donde el marcador más "consistente entre sí" que existe son 4 motas
    // de ruido de ~10px — nada tiene el tamaño correcto, así que no hay
    // que devolver nada, no el mejor candidato disponible igual.
    const w = 400, h = 400;
    const data = new Uint8Array(w * h);
    drawSquare(data, w, 10, 10, 10);
    drawSquare(data, w, 380, 10, 10);
    drawSquare(data, w, 380, 380, 10);
    drawSquare(data, w, 10, 380, 10);

    const img: GrayImage = { data, width: w, height: h };
    const blobs = await findBlobs(img);
    expect(findFiducials(blobs, w, h)).toBeNull();
  });
});

describe("findFiducialsRobust — canvas más grande que el papel real", () => {
  /**
   * Reproduce el caso real medido en 2026-09-14: un escáner entrega un
   * canvas de tamaño fijo (A4 completo) más grande que el papel real
   * alimentado (media hoja), con el contenido pegado a un costado y el
   * resto del canvas en blanco. Acá: canvas 400x1200 (3x más alto que el
   * contenido), con las 4 marcadores dentro de los primeros ~400px —
   * misma proporción de sobra de canvas que la de los escaneos reales
   * (~1.9x) pero exagerada para que el test sea decisivo sin depender de
   * constantes finas.
   */
  it("encuentra los 4 marcadores cuando el contenido no llena el canvas", async () => {
    const w = 400, h = 1200;
    const data = new Uint8Array(w * h);
    drawSquare(data, w, 10, 10, 30);    // TL
    drawSquare(data, w, 360, 10, 30);   // TR
    drawSquare(data, w, 360, 360, 30);  // BR
    drawSquare(data, w, 10, 360, 30);   // BL
    // el resto del canvas (y > 400) queda en blanco, como el papel de
    // sobra que deja un escáner en modo "página A4 fija".

    const img: GrayImage = { data, width: w, height: h };
    // Primero se confirma que el camino de SIEMPRE (esquinas de la imagen
    // completa) efectivamente falla acá — si no, el test no prueba nada.
    const blobs = await findBlobs(img);
    expect(findFiducials(blobs, w, h)).toBeNull();

    const result = await findFiducialsRobust(img);
    expect(result).not.toBeNull();
    expect(result!.markers.map((m) => m.id)).toEqual(["TL", "TR", "BR", "BL"]);
    const tl = result!.markers.find((m) => m.id === "TL")!;
    expect(tl.centerPx.x).toBeCloseTo(25, 0);
    expect(tl.centerPx.y).toBeCloseTo(25, 0);
  });

  it("sigue sin inventar un 4to marcador aunque el canvas tenga espacio de sobra", async () => {
    // Mismo canvas con sobra, pero de verdad falta un marcador (no
    // degradado, ausente) — el fallback nuevo tiene que seguir respetando
    // "nunca adivinar con 3", igual que findFiducials() en el camino de
    // siempre.
    const w = 400, h = 1200;
    const data = new Uint8Array(w * h);
    drawSquare(data, w, 10, 10, 30);
    drawSquare(data, w, 360, 10, 30);
    drawSquare(data, w, 360, 360, 30);
    // BL ausente.

    const img: GrayImage = { data, width: w, height: h };
    const result = await findFiducialsRobust(img);
    expect(result).toBeNull();
  });

  /**
   * El primer test solo prueba relleno ABAJO (contenido pegado arriba-
   * izquierda). contentBoundingBox() calcula min/max de x e y por
   * separado, así que en teoría no le importa de qué lado sobra canvas —
   * este test verifica esa generalización con sobra en 3 de los 4 lados a
   * la vez (arriba, derecha y abajo), no solo la asumida por el bug real.
   */
  it("encuentra los 4 marcadores con el contenido centrado, sobrando canvas en varios lados", async () => {
    const w = 1000, h = 1000;
    const data = new Uint8Array(w * h);
    // Contenido corrido hacia la esquina inferior-izquierda: sobra canvas
    // arriba (y<300), a la derecha (x>700) y abajo un poco menos.
    drawSquare(data, w, 300, 300, 30);  // TL
    drawSquare(data, w, 650, 300, 30);  // TR
    drawSquare(data, w, 650, 650, 30);  // BR
    drawSquare(data, w, 300, 650, 30);  // BL

    const img: GrayImage = { data, width: w, height: h };
    const blobs = await findBlobs(img);
    expect(findFiducials(blobs, w, h)).toBeNull(); // confirma que hace falta el fallback

    const result = await findFiducialsRobust(img);
    expect(result).not.toBeNull();
    expect(result!.markers.map((m) => m.id)).toEqual(["TL", "TR", "BR", "BL"]);
    const bl = result!.markers.find((m) => m.id === "BL")!;
    expect(bl.centerPx.x).toBeCloseTo(315, 0);
    expect(bl.centerPx.y).toBeCloseTo(665, 0);
  });

  it("sigue resolviendo el caso normal (contenido llena el canvas) sin pasar por el fallback", async () => {
    // No es un test nuevo de comportamiento — es la confirmación de que
    // agregar los intentos nuevos en findFiducialsRobust() no le cambió el
    // resultado al caso de siempre, llamando por la función pública que de
    // verdad usa el resto del motor (geometry.ts), no solo findFiducials().
    const w = 400, h = 400;
    const data = new Uint8Array(w * h);
    drawSquare(data, w, 10, 10, 30);
    drawSquare(data, w, 360, 10, 30);
    drawSquare(data, w, 360, 360, 30);
    drawSquare(data, w, 10, 360, 30);

    const img: GrayImage = { data, width: w, height: h };
    const result = await findFiducialsRobust(img);
    expect(result).not.toBeNull();
    expect(result!.markers.map((m) => m.id)).toEqual(["TL", "TR", "BR", "BL"]);
  });
});
