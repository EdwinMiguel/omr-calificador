import { describe, it, expect } from "vitest";
import { renderReadingOverlay, type ReadingMark } from "./readingOverlay.ts";
import { buildOfficialTemplate } from "../pdf-generator/officialTemplate.ts";
import { canvasSize } from "../../template.ts";
import type { GrayImage } from "./types.ts";

const DPI = 200;
const template = buildOfficialTemplate(100);
const { width, height } = canvasSize(template, DPI);

/** Papel blanco: cualquier píxel de color que aparezca lo puso el overlay. */
function blankSheet(): GrayImage {
  return { data: new Uint8Array(width * height).fill(255), width, height };
}

/** Cuenta píxeles que no son grises — es decir, pintados por el overlay. */
function countColored(rgb: Uint8Array): { read: number; review: number } {
  let read = 0, review = 0;
  for (let p = 0; p < rgb.length; p += 3) {
    const r = rgb[p]!, g = rgb[p + 1]!, b = rgb[p + 2]!;
    if (r === 22 && g === 140 && b === 80) read++;
    else if (r === 200 && g === 130 && b === 0) review++;
  }
  return { read, review };
}

describe("renderReadingOverlay", () => {
  it("sin marcas devuelve la imagen intacta en gris — no inventa señales", () => {
    const rgb = renderReadingOverlay(blankSheet(), template, DPI, []);
    expect(countColored(rgb)).toEqual({ read: 0, review: 0 });
  });

  it("dibuja un anillo verde sobre la opción leída", () => {
    const marks: ReadingMark[] = [{ groupId: "q.1", options: ["B"], tone: "read" }];
    const { read, review } = countColored(renderReadingOverlay(blankSheet(), template, DPI, marks));
    expect(read).toBeGreaterThan(0);
    expect(review).toBe(0);
  });

  it(
    "una pregunta sin ninguna opción leída igual se señala — si no, una duda " +
    "quedaría invisible justo en la vista que existe para detectarlas",
    () => {
      const marks: ReadingMark[] = [{ groupId: "q.5", options: [], tone: "review" }];
      const { review } = countColored(renderReadingOverlay(blankSheet(), template, DPI, marks));
      expect(review).toBeGreaterThan(0);
    }
  );

  it("una doble marca señala las DOS opciones, no solo la primera", () => {
    const one = countColored(
      renderReadingOverlay(blankSheet(), template, DPI, [{ groupId: "q.2", options: ["A"], tone: "review" }])
    ).review;
    const two = countColored(
      renderReadingOverlay(blankSheet(), template, DPI, [{ groupId: "q.2", options: ["A", "D"], tone: "review" }])
    ).review;
    expect(two).toBeGreaterThan(one * 1.8);
  });

  it("ignora grupos y opciones que no existen en la plantilla, sin reventar", () => {
    const marks: ReadingMark[] = [
      { groupId: "q.999", options: ["A"], tone: "read" },
      { groupId: "q.1", options: ["Z"], tone: "read" },
    ];
    expect(countColored(renderReadingOverlay(blankSheet(), template, DPI, marks))).toEqual({ read: 0, review: 0 });
  });

  it("también marca las columnas del código del alumno, no solo las preguntas", () => {
    const marks: ReadingMark[] = [{ groupId: "codigo.0", options: ["7"], tone: "read" }];
    expect(countColored(renderReadingOverlay(blankSheet(), template, DPI, marks)).read).toBeGreaterThan(0);
  });

  it("el anillo rodea la burbuja sin taparle el centro, para no ocultar la marca real", () => {
    const bubble = template.groups.find((g) => g.id === "q.1")!.bubbles.find((b) => b.label === "B")!;
    const rgb = renderReadingOverlay(blankSheet(), template, DPI, [
      { groupId: "q.1", options: ["B"], tone: "read" },
    ]);
    const cx = Math.round((bubble.center.x / 25.4) * DPI);
    const cy = Math.round((bubble.center.y / 25.4) * DPI);
    const idx = (cy * width + cx) * 3;
    // El centro exacto de la burbuja sigue siendo el papel original.
    expect([rgb[idx], rgb[idx + 1], rgb[idx + 2]]).toEqual([255, 255, 255]);
  });
});
