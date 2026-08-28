import { describe, it, expect } from "vitest";
import { decodeDigitGrid } from "./identification.ts";
import type { BubbleGroup } from "../../template.ts";
import type { LabeledFill } from "./classification.ts";

function digitGroup(ordinal: number): BubbleGroup {
  return {
    id: `codigo.${ordinal}`,
    kind: "digit",
    ordinal,
    printedLabel: `C${ordinal + 1}`,
    bubbles: Array.from({ length: 10 }, (_, d) => ({ index: d, label: String(d), center: { x: 0, y: 0 } })),
  };
}

describe("decodeDigitGrid", () => {
  it("decodifica un código completo cuando las 7 columnas leen limpio", () => {
    const groups = Array.from({ length: 7 }, (_, i) => digitGroup(i));
    // Código 7072391: cada columna marca su dígito correspondiente y nada más.
    const target = "7072391";
    const fillFn = (g: BubbleGroup): LabeledFill[] => {
      const correct = target[g.ordinal]!;
      return g.bubbles.map((b) => ({ label: b.label, normalized: b.label === correct ? 0.9 : 0.02 }));
    };
    const result = decodeDigitGrid(groups, fillFn);
    expect(result.value).toBe("7072391");
  });

  it("devuelve null si UNA sola columna no decodifica con confianza — no adivina un ID parcial", () => {
    const groups = Array.from({ length: 7 }, (_, i) => digitGroup(i));
    const target = "7072391";
    const fillFn = (g: BubbleGroup): LabeledFill[] => {
      if (g.ordinal === 5) {
        // Columna 6 (dígito "9"): ambigua, dos candidatos parecidos.
        return g.bubbles.map((b) => ({ label: b.label, normalized: b.label === "9" || b.label === "8" ? 0.4 : 0.02 }));
      }
      const correct = target[g.ordinal]!;
      return g.bubbles.map((b) => ({ label: b.label, normalized: b.label === correct ? 0.9 : 0.02 }));
    };
    const result = decodeDigitGrid(groups, fillFn);
    expect(result.value).toBeNull();
    expect(result.columns.find((c) => c.ordinal === 5)!.state.kind).not.toBe("ANSWERED");
  });

  it("ordena las columnas por ordinal, sin importar el orden de entrada", () => {
    const target = "7072391";
    const fillFn = (g: BubbleGroup): LabeledFill[] => {
      const correct = target[g.ordinal]!;
      return g.bubbles.map((b) => ({ label: b.label, normalized: b.label === correct ? 0.9 : 0.02 }));
    };
    const shuffled = [digitGroup(3), digitGroup(0), digitGroup(6), digitGroup(1), digitGroup(5), digitGroup(2), digitGroup(4)];
    expect(decodeDigitGrid(shuffled, fillFn).value).toBe("7072391");
  });
});
