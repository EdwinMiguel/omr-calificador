/**
 * scoring.ts — Día 11: aplicar la clave y calcular el puntaje.
 *
 * PROMPT.md §13.7: "Puntaje derivado, nunca congelado. Se guardan
 * respuestas crudas; el puntaje se calcula on-demand según reglas
 * versionadas, para poder anular una pregunta y recalcular sin
 * reescanear." Por eso computeScore() es una función pura sobre
 * QuestionResult[] — se puede volver a llamar con otra AnswerKey en
 * cualquier momento, sin tocar la hoja original.
 */

import type { ClassificationState } from "./classification.ts";

/** Opción correcta por número de pregunta (`ordinal` de la BubbleGroup). */
export type AnswerKey = Record<number, string>;

export interface QuestionResult {
  ordinal: number;
  state: ClassificationState;
  /**
   * true/false solo cuando state.kind === "ANSWERED" — de lo contrario
   * null: una pregunta BLANK/AMBIGUOUS/MULTIPLE no es "incorrecta", es
   * NO EVALUABLE automáticamente. Confundir "en blanco" con "mal" sería
   * inventar información que la hoja no dio.
   */
  correct: boolean | null;
}

export function gradeQuestions(
  states: { ordinal: number; state: ClassificationState }[],
  key: AnswerKey
): QuestionResult[] {
  return states.map(({ ordinal, state }) => ({
    ordinal,
    state,
    correct: state.kind === "ANSWERED" ? state.option === key[ordinal] : null,
  }));
}

export interface Score {
  correct: number;
  incorrect: number;
  /** BLANK, AMBIGUOUS o MULTIPLE — no se auto-califican, van a revisión. */
  ungraded: number;
  total: number;
}

export function computeScore(results: QuestionResult[]): Score {
  let correct = 0, incorrect = 0, ungraded = 0;
  for (const r of results) {
    if (r.correct === true) correct++;
    else if (r.correct === false) incorrect++;
    else ungraded++;
  }
  return { correct, incorrect, ungraded, total: results.length };
}
