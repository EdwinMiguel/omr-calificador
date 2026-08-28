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
  it("deriva blackRef/whiteRef reales a partir de los parches del template", () => {
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
    expect(cal.whiteRef).toBeCloseTo((255 - 200) / 255, 1);
    expect(cal.blackRef).toBeCloseTo((255 - 20) / 255, 1);
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
  it("mapea el propio blackRef a 1 y el whiteRef a 0", () => {
    const cal = { whiteRef: 0.3, blackRef: 0.8 };
    expect(normalize(0.3, cal)).toBeCloseTo(0, 5);
    expect(normalize(0.8, cal)).toBeCloseTo(1, 5);
    expect(normalize(0.55, cal)).toBeCloseTo(0.5, 5);
  });
});
