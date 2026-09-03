import { describe, it, expect } from "vitest";
import { deriveThresholds, normalize, normalizeWithinGroup } from "./calibration.ts";
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

  it("rechaza una hoja con una ZONA sin contraste en vez de invertir la escala ahí", () => {
    // REGRESIÓN de un bug real: normalize() divide por (blackRef - whiteRef).
    // Con referencia local hay un denominador por burbuja, y si una zona está
    // tan oscura que su papel mide como la tinta, el denominador se acerca a
    // 0 (valores disparados) o se vuelve NEGATIVO, invirtiendo la escala: una
    // burbuja vacía pasa a medir "más marcada" que la pintada. Medido sobre
    // la hoja escaneada con sombra sintética: 7 respuestas auto-aceptadas
    // INCORRECTAS, justo lo que §15 prohíbe.
    const t = buildOfficialTemplate(100);
    const canvasW = Math.round(mmToPx(t.page.widthMm, DPI));
    const canvasH = Math.round(mmToPx(t.page.heightMm, DPI));
    const img = makeUniform(canvasW, canvasH, 210); // papel normal

    for (const patch of t.calibration) {
      paintPatch(img, patch.rect.x, patch.rect.y, patch.rect.w, patch.rect.h, patch.kind === "black" ? 20 : 210);
    }
    // Sombra brutal sobre una FRANJA: el papel de esa zona queda tan oscuro
    // como la tinta. El resto de la hoja sigue perfectamente legible, así
    // que la guarda de contraste GLOBAL no se dispara — es exactamente el
    // caso que la guarda global no cubría.
    paintPatch(img, 20, 120, 55, 170, 22);

    expect(() => deriveThresholds(img, t, DPI)).toThrow(/Zona de la hoja sin contraste/);
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

describe("normalizeWithinGroup", () => {
  /** Referencia de vecindario deliberadamente EQUIVOCADA (0.5), para que se
   * note cuál de las dos se está usando en cada caso. */
  const cal = { blackRef: 1, whiteRefAt: () => 0.5 };
  const at = (raw: number) => ({ raw, xMm: 100, yMm: 100 });

  it("usa la mediana de las OTRAS opciones del grupo, no la referencia de vecindario", () => {
    // Una marca (0.70) entre cuatro papeles (0.30). La referencia correcta
    // para esta fila es 0.30, no el 0.5 que dice el vecindario.
    const r = normalizeWithinGroup([0.30, 0.30, 0.70, 0.30, 0.30].map(at), cal);
    expect(r[2]).toBeCloseTo((0.70 - 0.30) / (1 - 0.30), 4);
    expect(r[2]).not.toBeCloseTo((0.70 - 0.5) / (1 - 0.5), 2);
    // Y las cuatro no marcadas quedan en 0: son exactamente su propia
    // referencia de papel.
    for (const i of [0, 1, 3, 4]) expect(r[i]).toBeCloseTo(0, 5);
  });

  it("excluye la propia burbuja: una marca no se auto-atenúa subiendo su referencia", () => {
    // Dos marcadas y dos no, en un grupo de 4. Si la referencia de una
    // marca se calculara INCLUYÉNDOLA, la mediana caería sobre 0.9 y la
    // marca mediría 0 — se borraría a sí misma.
    const r = normalizeWithinGroup([0.9, 0.9, 0.3, 0.3].map(at), cal);
    expect(r[0]).toBeCloseTo((0.9 - 0.3) / (1 - 0.3), 4);
    expect(r[0]).toBeGreaterThan(0.5);
  });

  it("vuelve a la referencia de vecindario si el papel del grupo mide casi como la tinta", () => {
    // Denominador de fila = 0.5 - 0.48 = 0.02, por debajo del contraste
    // mínimo exigible: dividir por eso dispara cualquier diferencia de ruido
    // a valores enormes. Se usa la de vecindario, que la guarda de zona de
    // deriveThresholds ya validó.
    const sombra = { blackRef: 0.5, whiteRefAt: () => 0.2 };
    const r = normalizeWithinGroup([0.48, 0.48, 0.49, 0.48, 0.48].map(at), sombra);
    expect(r[2]).toBeCloseTo((0.49 - 0.2) / (0.5 - 0.2), 4);
  });

  it("grupos de menos de 4 opciones usan la referencia de vecindario", () => {
    // Con dos o tres opciones, "la mediana de las otras" es una muestra
    // suelta, no una referencia. Ninguna plantilla del proyecto llega acá.
    const r = normalizeWithinGroup([0.30, 0.70].map(at), cal);
    expect(r[1]).toBeCloseTo((0.70 - 0.5) / (1 - 0.5), 4);
  });

  it("REGRESIÓN: resuelve un sombreado que varía DENTRO de la fila, invisible para el vecindario", () => {
    // Medido en Q100 de la foto anotada: las cuatro opciones NO marcadas
    // subían en rampa de izquierda a derecha mientras la referencia de
    // vecindario les daba a las cinco el mismo valor de papel. Con la rampa,
    // la última opción sin marcar se acercaba peligrosamente a la marcada.
    const rampa = [0.42, 0.43, 0.44, 0.45, 0.46];
    const marcada = 0.52;
    const conVecindario = rampa.map((v) => (v - 0.42) / (1 - 0.42));
    const brechaVecindario = (marcada - 0.42) / (1 - 0.42) - Math.max(...conVecindario);

    const r = normalizeWithinGroup([...rampa.slice(0, 4), marcada].map(at), cal);
    const brechaFila = r[4]! - Math.max(...r.slice(0, 4));
    expect(brechaFila).toBeGreaterThan(brechaVecindario);
  });
});
