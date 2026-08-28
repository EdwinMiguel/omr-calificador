/**
 * grading.ts — Día 12: de "cuántas acertó" a "qué nota sacó".
 *
 * PROMPT.md §13.7 exige que el puntaje se derive on-demand "según reglas
 * VERSIONADAS". Ese versionado es el motivo de este archivo: la regla de
 * nota no es una constante ni una fórmula suelta dentro de la API, es un
 * objeto con id y versión que queda guardado junto al resultado. Si el
 * colegio cambia de criterio a mitad del año, las notas viejas se pueden
 * recalcular con la regla vieja y las nuevas con la nueva, sin ambigüedad
 * sobre cuál se aplicó a quién.
 *
 * REGLA POR DEFECTO DECLARADA, NO ASUMIDA EN SILENCIO (PROMPT.md §17: "Si
 * encuentras una ambigüedad de dominio no resuelta, pregúntamela en vez de
 * asumir un valor por defecto"). Se le preguntó al cliente cómo calcula la
 * nota final; a falta de una regla distinta se aplica `proporcional-simple`:
 * nota = aciertos / preguntas vigentes × 20, sin penalizar errores. Es la
 * regla más común en colegios peruanos y la única que no castiga al alumno
 * por una decisión que nadie confirmó. CAMBIAR aquí si el colegio resta
 * puntos por respuesta incorrecta o pondera preguntas de forma distinta —
 * es un cambio de una línea, y sube GRADING_RULE_VERSION.
 */

import type { QuestionResult } from "./scoring.ts";

export interface GradingRule {
  id: string;
  version: string;
  /** Nota máxima alcanzable. En Perú la escala escolar es vigesimal. */
  maxGrade: number;
  /** Puntos que resta cada respuesta incorrecta (0 = no se penaliza). */
  penaltyPerIncorrect: number;
}

export const DEFAULT_GRADING_RULE: GradingRule = {
  id: "proporcional-simple",
  version: "1.0.0",
  maxGrade: 20,
  penaltyPerIncorrect: 0,
};

export interface Grade {
  /** Nota final ya redondeada a un decimal, en la escala de la regla. */
  value: number;
  /** Preguntas que efectivamente contaron (total menos las anuladas). */
  effectiveQuestions: number;
  /** Preguntas que aún no se pueden calificar solas (van a revisión). */
  pendingReview: number;
  rule: GradingRule;
}

/**
 * Una pregunta anulada desaparece del cálculo: no cuenta como acierto ni
 * como error, y baja el denominador. Es lo que permite anular una pregunta
 * mal formulada sin perjudicar a nadie — y por eso el puntaje NO puede
 * guardarse congelado: anular una pregunta cambia la nota de todo el aula.
 */
export function computeGrade(
  results: QuestionResult[],
  voidedOrdinals: ReadonlySet<number> = new Set(),
  rule: GradingRule = DEFAULT_GRADING_RULE
): Grade {
  const counted = results.filter((r) => !voidedOrdinals.has(r.ordinal));
  const correct = counted.filter((r) => r.correct === true).length;
  const incorrect = counted.filter((r) => r.correct === false).length;
  const pendingReview = counted.filter((r) => r.correct === null).length;

  const effectiveQuestions = counted.length;
  if (effectiveQuestions === 0) {
    return { value: 0, effectiveQuestions: 0, pendingReview, rule };
  }

  const rawPoints = correct - incorrect * rule.penaltyPerIncorrect;
  const scaled = (rawPoints / effectiveQuestions) * rule.maxGrade;
  // Nunca una nota negativa, por mucho que penalice la regla.
  const clamped = Math.max(0, Math.min(rule.maxGrade, scaled));

  return {
    value: Math.round(clamped * 10) / 10,
    effectiveQuestions,
    pendingReview,
    rule,
  };
}
