import { describe, it, expect } from "vitest";
import { gradeQuestions, computeScore, type AnswerKey } from "./scoring.ts";
import type { ClassificationState } from "./classification.ts";

const answered = (option: string): ClassificationState => ({ kind: "ANSWERED", option });
const blank: ClassificationState = { kind: "BLANK" };
const ambiguous: ClassificationState = { kind: "AMBIGUOUS" };
const multiple: ClassificationState = { kind: "MULTIPLE", options: ["A", "B"] };

describe("gradeQuestions", () => {
  it("marca correct=true cuando la respuesta coincide con la clave", () => {
    const key: AnswerKey = { 1: "B" };
    const r = gradeQuestions([{ ordinal: 1, state: answered("B") }], key);
    expect(r[0]!.correct).toBe(true);
  });

  it("marca correct=false cuando NO coincide — nunca se confunde con 'en blanco'", () => {
    const key: AnswerKey = { 1: "B" };
    const r = gradeQuestions([{ ordinal: 1, state: answered("C") }], key);
    expect(r[0]!.correct).toBe(false);
  });

  it("BLANK/AMBIGUOUS/MULTIPLE dan correct=null, nunca false — no son 'incorrectas', son no evaluables", () => {
    const key: AnswerKey = { 1: "B", 2: "B", 3: "B" };
    const r = gradeQuestions(
      [
        { ordinal: 1, state: blank },
        { ordinal: 2, state: ambiguous },
        { ordinal: 3, state: multiple },
      ],
      key
    );
    expect(r.map((x) => x.correct)).toEqual([null, null, null]);
  });
});

describe("computeScore", () => {
  it("cuenta correct/incorrect/ungraded por separado, nunca los mezcla", () => {
    const key: AnswerKey = { 1: "B", 2: "B", 3: "B", 4: "B", 5: "B" };
    const graded = gradeQuestions(
      [
        { ordinal: 1, state: answered("B") }, // correcta
        { ordinal: 2, state: answered("C") }, // incorrecta
        { ordinal: 3, state: blank },
        { ordinal: 4, state: ambiguous },
        { ordinal: 5, state: multiple },
      ],
      key
    );
    expect(computeScore(graded)).toEqual({ correct: 1, incorrect: 1, ungraded: 3, total: 5 });
  });

  it(
    "es una función pura sobre resultados ya calificados — recalificar con " +
    "otra clave (pregunta anulada) no requiere volver a leer la imagen",
    () => {
      const originalKey: AnswerKey = { 1: "B" };
      const revisedKey: AnswerKey = { 1: "C" }; // se anuló la B, ahora vale C
      const states = [{ ordinal: 1, state: answered("C") }];
      const before = computeScore(gradeQuestions(states, originalKey));
      const after = computeScore(gradeQuestions(states, revisedKey));
      expect(before).toEqual({ correct: 0, incorrect: 1, ungraded: 0, total: 1 });
      expect(after).toEqual({ correct: 1, incorrect: 0, ungraded: 0, total: 1 });
    }
  );
});
