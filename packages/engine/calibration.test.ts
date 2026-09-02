import { describe, it, expect } from "vitest";
import { deriveThresholds, normalize } from "./calibration.ts";
import { buildOfficialTemplate } from "../pdf-generator/officialTemplate.ts";
import type { GrayImage } from "./types.ts";
import { mmToPx } from "../../template.ts";

const DPI = 200;

function makeUniform(width: number, height: number, value: number): GrayImage {
  return { data: new Uint8Array(width * height).fill(value), width, height };
}

function paintPatch(img: GrayImage, xMm: number, yMm: number, wMm: number, hMm: number, value: number) {
  const x0 = Math.round(mmToPx(xMm, DPI)), y0 = Math.round(mmToPx(yMm, DPI));
  const w = Math.round(mmToPx(wMm, DPI)), h = Math.round(mmToPx(hMm, DPI));
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) img.data[y * img.width + x] = value;
}

describe("deriveThresholds", () => {
  it("deriva blackRef/whiteRef reales a partir de los parches y las burbujas del template", () => {
    const t = buildOfficialTemplate(100);
    const canvasW = Math.round(mmToPx(t.page.widthMm, DPI));
    const canvasH = Math.round(mmToPx(t.page.heightMm, DPI));
    const img = makeUniform(canvasW, canvasH, 200); // "papel" parejo, no puro blanco

    for (const patch of t.calibration) {
      paintPatch(img, patch.rect.x, patch.rect.y, patch.rect.w, patch.rect.h, patch.kind === "black" ? 20 : 200);
    }

    const cal = deriveThresholds(img, t, DPI);
    // Tolerancia amplia (no 2 decimales): deriveThresholds ahora usa
    // fillRatioNearby, cuyo barrido en pasos de 2px no siempre cae exacto
    // en el desplazamiento óptimo para un patch sintético — la propiedad
    // que importa es que se acerque al valor real, no una coincidencia exacta.
    // whiteRefAt(): la hoja entera es "papel parejo" (sin marcas ni
    // gradiente), así que la referencia local en cualquier punto tiene que
    // coincidir con la global — se prueba en dos puntos bien separados.
    const q = t.groups.find((g) => g.kind === "question")!;
    expect(cal.whiteRefAt(q.bubbles[0]!.center.x, q.bubbles[0]!.center.y)).toBeCloseTo((255 - 200) / 255, 1);
    expect(cal.whiteRefAt(t.page.widthMm - 20, t.page.heightMm - 20)).toBeCloseTo((255 - 200) / 255, 1);
    expect(cal.blackRef).toBeCloseTo((255 - 20) / 255, 1);
  });

  it("whiteRefAt() sigue el gradiente local en vez de una sola referencia para toda la hoja", () => {
    const t = buildOfficialTemplate(100);
    const canvasW = Math.round(mmToPx(t.page.widthMm, DPI));
    const canvasH = Math.round(mmToPx(t.page.heightMm, DPI));
    // Papel más oscuro (sombra) en la mitad izquierda, más claro a la derecha
    // — el mismo tipo de gradiente lateral medido en fotos reales de celular.
    const img = makeUniform(canvasW, canvasH, 255);
    for (let y = 0; y < canvasH; y++) {
      for (let x = 0; x < canvasW; x++) {
        img.data[y * canvasW + x] = x < canvasW / 2 ? 150 : 220;
      }
    }
    for (const patch of t.calibration) {
      paintPatch(img, patch.rect.x, patch.rect.y, patch.rect.w, patch.rect.h, patch.kind === "black" ? 20 : 220);
    }

    const cal = deriveThresholds(img, t, DPI);
    const q = t.groups.find((g) => g.kind === "question")!;
    const leftX = Math.min(...q.bubbles.map((b) => b.center.x));
    const rightX = Math.max(...t.groups.flatMap((g) => g.bubbles).map((b) => b.center.x));

    const refLeft = cal.whiteRefAt(leftX, q.bubbles[0]!.center.y);
    const refRight = cal.whiteRefAt(rightX, q.bubbles[0]!.center.y);
    // La referencia de la izquierda (papel más oscuro) tiene que ser más
    // alta que la de la derecha — si fuera una sola referencia global para
    // toda la hoja, refLeft === refRight.
    expect(refLeft).toBeGreaterThan(refRight);
  });

  it("rechaza una hoja sin contraste medible en vez de calibrar con ruido", () => {
    const t = buildOfficialTemplate(100);
    const canvasW = Math.round(mmToPx(t.page.widthMm, DPI));
    const canvasH = Math.round(mmToPx(t.page.heightMm, DPI));
    // Todo el mismo gris: como si los parches negro y blanco se hubieran
    // "lavado" a un valor casi idéntico (el caso real que motivó esto).
    const img = makeUniform(canvasW, canvasH, 180);
    expect(() => deriveThresholds(img, t, DPI)).toThrow(/Contraste insuficiente/);
  });
});

describe("normalize", () => {
  it("mapea el propio blackRef a 1 y el whiteRef a 0, en cualquier posición", () => {
    const cal = { blackRef: 0.8, whiteRefAt: () => 0.3 };
    expect(normalize(0.3, cal, 0, 0)).toBeCloseTo(0, 5);
    expect(normalize(0.8, cal, 100, 200)).toBeCloseTo(1, 5);
    expect(normalize(0.55, cal, 50, 50)).toBeCloseTo(0.5, 5);
  });

  it("usa la referencia de blanco de LA POSICIÓN consultada, no una fija", () => {
    const cal = { blackRef: 1, whiteRefAt: (x: number) => (x < 50 ? 0.4 : 0.2) };
    expect(normalize(0.4, cal, 10, 0)).toBeCloseTo(0, 5); // a la izquierda, blanco=0.4
    expect(normalize(0.2, cal, 90, 0)).toBeCloseTo(0, 5); // a la derecha, blanco=0.2
  });
});
