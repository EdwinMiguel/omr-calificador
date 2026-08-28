import { describe, it, expect } from "vitest";
import { classify } from "./classification.ts";

const opts = (values: number[]): { label: string; normalized: number }[] =>
  values.map((v, i) => ({ label: "ABCDE"[i]!, normalized: v }));

describe("classify — los 7 casos límite del plan (Día 9)", () => {
  it("marca limpia: una sola burbuja bien oscura", () => {
    expect(classify(opts([0.05, 0.9, 0.03, 0.02, 0.04]))).toEqual({ kind: "ANSWERED", option: "B" });
  });

  it("blanco: todas cerca de 0", () => {
    expect(classify(opts([0.02, 0.05, 0.01, 0.03, 0.0]))).toEqual({ kind: "BLANK" });
  });

  it("doble: dos burbujas claramente marcadas", () => {
    expect(classify(opts([0.85, 0.05, 0.8, 0.03, 0.02]))).toEqual({ kind: "MULTIPLE", options: ["A", "C"] });
  });

  it("débil: una burbuja en zona gris (entre BLANK_MAX=0.15 y MARK_MIN=0.25), ninguna llega a marcada", () => {
    const r = classify(opts([0.05, 0.20, 0.02, 0.03, 0.04]));
    expect(r.kind).toBe("AMBIGUOUS");
  });

  it("borrada: zona gris residual tras borrar, no vuelve a blanco puro", () => {
    const r = classify(opts([0.18, 0.05, 0.04, 0.03, 0.02]));
    expect(r.kind).toBe("AMBIGUOUS");
  });

  it("margen bajo: una burbuja cruza MARK_MIN pero otra queda pisándole los talones por debajo — no dos marcas, una marca dudosa", () => {
    // 0.30 sí es "marcada" (≥0.25); 0.24 NO llega a marcada, pero está a
    // solo 0.06 de la ganadora — menos que MARGIN_MIN (0.08). Si ambas
    // hubieran cruzado MARK_MIN sería MULTIPLE (dos marcas reales); acá es
    // una marca real con un vecino sospechosamente cerca — el caso real
    // que motivó bajar MARGIN_MIN: con MARK_MIN=0.25 la franja "blanco
    // ruidoso" (hasta 0.228 medido) queda pegada al umbral de marca.
    const r = classify(opts([0.30, 0.24, 0.02, 0.03, 0.04]));
    expect(r.kind).toBe("AMBIGUOUS");
  });

  it("marca normal: oscura y con margen amplio sobre el resto", () => {
    expect(classify(opts([0.02, 0.03, 0.04, 0.95, 0.05]))).toEqual({ kind: "ANSWERED", option: "D" });
  });
});
