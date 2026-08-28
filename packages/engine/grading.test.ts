import { describe, it, expect } from "vitest";
import { computeGrade, DEFAULT_GRADING_RULE } from "./grading.ts";
import type { QuestionResult } from "./scoring.ts";

const q = (ordinal: number, correct: boolean | null): QuestionResult => ({
  ordinal,
  state: correct === null ? { kind: "AMBIGUOUS" } : { kind: "ANSWERED", option: "A" },
  correct,
});

describe("computeGrade", () => {
  it("escala los aciertos a la nota vigesimal", () => {
    const results = Array.from({ length: 100 }, (_, i) => q(i + 1, i < 80));
    expect(computeGrade(results).value).toBe(16);
  });

  it("una pregunta anulada sale del denominador — no cuenta ni a favor ni en contra", () => {
    // 9 de 10 correctas = 18. Si se anula la única incorrecta, quedan 9 de 9 = 20.
    const results = Array.from({ length: 10 }, (_, i) => q(i + 1, i < 9));
    expect(computeGrade(results).value).toBe(18);
    const withVoid = computeGrade(results, new Set([10]));
    expect(withVoid.value).toBe(20);
    expect(withVoid.effectiveQuestions).toBe(9);
  });

  it(
    "las preguntas a revisión no se cuentan como incorrectas, pero sí bajan la nota " +
    "provisional — por eso se informa pendingReview junto al valor",
    () => {
      const results = [q(1, true), q(2, true), q(3, null), q(4, null)];
      const g = computeGrade(results);
      expect(g.value).toBe(10); // 2 de 4 confirmadas
      expect(g.pendingReview).toBe(2);
    }
  );

  it("con penalización configurada, resta por error pero nunca baja de 0", () => {
    const severa = { ...DEFAULT_GRADING_RULE, id: "con-penalidad", penaltyPerIncorrect: 1 };
    const results = Array.from({ length: 10 }, (_, i) => q(i + 1, i < 2));
    // 2 aciertos - 8 errores = -6 → se recorta a 0, no a una nota negativa.
    expect(computeGrade(results, new Set(), severa).value).toBe(0);
  });

  it("anular TODAS las preguntas no revienta con división por cero", () => {
    const results = [q(1, true), q(2, false)];
    expect(computeGrade(results, new Set([1, 2])).value).toBe(0);
  });

  it("guarda qué regla se aplicó, para poder auditar una nota vieja", () => {
    expect(computeGrade([q(1, true)]).rule.id).toBe("proporcional-simple");
    expect(computeGrade([q(1, true)]).rule.version).toBe("1.0.0");
  });
});
