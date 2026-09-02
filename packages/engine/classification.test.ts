import { describe, it, expect } from "vitest";
import { classify, BLANK_MAX, MARK_MIN, MARGIN_MIN } from "./classification.ts";

const opts = (values: number[]): { label: string; normalized: number }[] =>
  values.map((v, i) => ({ label: "ABCDE"[i]!, normalized: v }));

/**
 * Los casos se expresan RELATIVOS a los umbrales, no con números fijos.
 *
 * Antes estaban escritos con valores pegados a MARK_MIN=0.25 ("0.20 está en
 * la zona gris", "0.24 no llega a marcada"), así que al recalibrar el umbral
 * los tests fallaban aunque la regla siguiera siendo exactamente la misma.
 * Eso los volvía tests de la calibración, no del comportamiento. Escritos
 * así prueban lo que de verdad importa —qué decide la regla en cada zona— y
 * sobreviven a cualquier recalibración futura.
 */
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

  it("débil: una burbuja en la zona gris entre BLANK_MAX y MARK_MIN, ninguna llega a marcada", () => {
    const gris = (BLANK_MAX + MARK_MIN) / 2;
    const r = classify(opts([0.05, gris, 0.02, 0.03, 0.04]));
    expect(r.kind).toBe("AMBIGUOUS");
  });

  it("borrada: zona gris residual tras borrar, no vuelve a blanco puro", () => {
    // Apenas por encima de BLANK_MAX: hay rastro de grafito, pero no llega
    // a marca. No es blanco ni es respuesta — es duda.
    const rastro = BLANK_MAX + (MARK_MIN - BLANK_MAX) * 0.25;
    const r = classify(opts([rastro, 0.05, 0.04, 0.03, 0.02]));
    expect(r.kind).toBe("AMBIGUOUS");
  });

  it(
    "margen bajo: una cruza MARK_MIN y otra queda cerca pero POR DEBAJO del " +
    "umbral — es una marca dudosa, no dos marcas",
    () => {
      const top = MARK_MIN + MARGIN_MIN * 0.4;
      const second = MARK_MIN - MARGIN_MIN * 0.25; // cerca del top, pero no es marca
      expect(top - second).toBeLessThan(MARGIN_MIN);
      expect(second).toBeLessThan(MARK_MIN);
      const r = classify(opts([top, second, 0.02, 0.03, 0.04]));
      expect(r.kind).toBe("AMBIGUOUS");
    }
  );

  it(
    "si la segunda TAMBIÉN cruza MARK_MIN y está dentro del margen, es MULTIPLE " +
    "— por eso bajar MARK_MIN convierte en 'doble marca' lo que antes era " +
    "'marca con ruido al lado'. Ambos van a revisión igual, pero la etiqueta cambia",
    () => {
      const top = MARK_MIN + MARGIN_MIN * 0.6;
      const second = MARK_MIN + MARGIN_MIN * 0.1;
      expect(top - second).toBeLessThan(MARGIN_MIN);
      expect(second).toBeGreaterThanOrEqual(MARK_MIN);
      expect(classify(opts([top, second, 0.02, 0.03, 0.04])).kind).toBe("MULTIPLE");
    }
  );

  it("marca normal: oscura y con margen amplio sobre el resto", () => {
    expect(classify(opts([0.02, 0.03, 0.04, 0.95, 0.05]))).toEqual({ kind: "ANSWERED", option: "D" });
  });

  it("los umbrales mantienen un orden coherente entre sí", () => {
    // Si MARK_MIN cayera por debajo de BLANK_MAX, un mismo valor sería a la
    // vez "en blanco" y "marcado", y la primera guarda de classifyByMargin
    // ganaría siempre: nada podría clasificarse nunca como respuesta.
    expect(BLANK_MAX).toBeLessThan(MARK_MIN);
    expect(MARGIN_MIN).toBeGreaterThan(0);
  });
});
