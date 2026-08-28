/**
 * sheetProjection.ts — de eventos guardados a "qué muestro en pantalla".
 *
 * Vive en packages/ y no en apps/api porque es lógica de dominio: aplicar
 * correcciones sobre una lectura y derivar la nota son reglas del negocio,
 * no transporte HTTP (PROMPT.md §9: "apps/api sin lógica de dominio propia").
 * Todo aquí es función pura sobre datos ya cargados — no toca disco ni red,
 * igual que el engine.
 *
 * La idea central (PROMPT.md §13.7 y §13.9): lo persistido es inmutable y
 * mínimo — las respuestas crudas que la hoja mostró. Todo lo demás (si está
 * bien, qué nota da, si sigue pendiente) se RECONSTRUYE cada vez que se lee.
 * Por eso anular una pregunta o corregir una respuesta cambia el resultado
 * al instante y sin reescanear: nunca se guardó una conclusión, solo hechos.
 */

import type { QuestionResult } from "../engine/scoring.ts";
import { gradeQuestions, computeScore, type AnswerKey, type Score } from "../engine/scoring.ts";
import { computeGrade, DEFAULT_GRADING_RULE, type Grade, type GradingRule } from "../engine/grading.ts";
import type { ClassificationState } from "../engine/classification.ts";

export interface CorrectionInput {
  ordinal: number | null;
  resolvedAs: string | null;
  resolvedStudentId?: string;
  createdAt: string;
}

export interface ProjectedQuestion extends QuestionResult {
  /** true si una persona resolvió esta pregunta a mano. */
  corrected: boolean;
  /** Qué había leído el motor antes de la corrección. */
  automaticState: ClassificationState;
}

export interface ProjectedSheet {
  studentId: string;
  /** true si el código lo escribió una persona, no el motor. */
  studentIdCorrected: boolean;
  questions: ProjectedQuestion[];
  score: Score;
  grade: Grade | null;
  /** Preguntas que siguen esperando decisión humana. */
  pendingOrdinals: number[];
}

/**
 * Aplica las correcciones sobre la lectura automática. Si hay varias
 * correcciones para la misma pregunta gana la última — pero ninguna se
 * borra: el historial completo se muestra aparte, en la vista de detalle.
 */
export function projectSheet(
  automatic: { studentId: string; questions: QuestionResult[] },
  corrections: readonly CorrectionInput[],
  key: AnswerKey | null,
  voided: ReadonlySet<number> = new Set(),
  rule: GradingRule = DEFAULT_GRADING_RULE
): ProjectedSheet {
  const byOrdinal = new Map<number, CorrectionInput>();
  let idCorrection: CorrectionInput | null = null;

  // Orden cronológico: la última corrección de cada pregunta es la vigente.
  for (const c of [...corrections].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (c.ordinal === null) idCorrection = c;
    else byOrdinal.set(c.ordinal, c);
  }

  const corrected = automatic.questions.map((q): ProjectedQuestion => {
    const fix = byOrdinal.get(q.ordinal);
    if (!fix) return { ...q, corrected: false, automaticState: q.state };
    const state: ClassificationState =
      fix.resolvedAs === null ? { kind: "BLANK" } : { kind: "ANSWERED", option: fix.resolvedAs };
    return { ordinal: q.ordinal, state, correct: null, corrected: true, automaticState: q.state };
  });

  // La clave se aplica DESPUÉS de las correcciones, nunca antes: corregir
  // una respuesta y luego calificarla es lo mismo que si la hoja hubiera
  // venido así de origen.
  const graded = key
    ? gradeQuestions(corrected.map((q) => ({ ordinal: q.ordinal, state: q.state })), key)
    : corrected.map((q) => ({ ordinal: q.ordinal, state: q.state, correct: null }));

  const questions: ProjectedQuestion[] = graded.map((g, i) => ({
    ...g,
    corrected: corrected[i]!.corrected,
    automaticState: corrected[i]!.automaticState,
  }));

  const counted = questions.filter((q) => !voided.has(q.ordinal));

  return {
    studentId: idCorrection?.resolvedStudentId ?? automatic.studentId,
    studentIdCorrected: idCorrection !== null,
    questions,
    score: computeScore(counted),
    grade: key ? computeGrade(questions, voided, rule) : null,
    pendingOrdinals: counted.filter((q) => q.state.kind !== "ANSWERED").map((q) => q.ordinal),
  };
}

export interface BatchMetrics {
  sheets: number;
  processed: number;
  rejected: number;
  /** Rechazos que SÍ señalan un problema — excluye páginas en blanco (§13.5). */
  anomalousRejections: number;
  rejectionsByReason: Record<string, number>;
  autoAcceptedCorrect: number;
  /** LA métrica del proyecto (§15). Debe ser 0. */
  autoAcceptedIncorrect: number;
  sentToReview: number;
  averageGrade: number | null;
}

/**
 * PROMPT.md §15: las métricas distinguen SIEMPRE auto-aceptadas correctas /
 * auto-aceptadas incorrectas / enviadas a revisión / rechazadas. Mezclarlas
 * en un único "porcentaje de acierto" escondería justo lo que importa.
 *
 * Ojo con qué cuenta como "auto-aceptada": solo lo que el MOTOR resolvió.
 * Una respuesta que una persona corrigió a mano no es mérito ni error del
 * algoritmo, así que queda fuera de esas dos cifras — si no, la métrica
 * mejoraría sola a medida que alguien corrige, que es exactamente la clase
 * de auto-engaño que §14 prohíbe.
 */
export function computeBatchMetrics(
  sheets: readonly {
    outcome: { kind: "processed" | "rejected"; reason?: string };
    projected: ProjectedSheet | null;
  }[]
): BatchMetrics {
  const rejectionsByReason: Record<string, number> = {};
  let processed = 0, rejected = 0, anomalousRejections = 0;
  let autoAcceptedCorrect = 0, autoAcceptedIncorrect = 0, sentToReview = 0;
  const grades: number[] = [];

  for (const s of sheets) {
    if (s.outcome.kind === "rejected") {
      rejected++;
      const reason = s.outcome.reason ?? "DESCONOCIDO";
      rejectionsByReason[reason] = (rejectionsByReason[reason] ?? 0) + 1;
      // El reverso en blanco de un dúplex es ruido normal, no una alarma.
      if (reason !== "BLANK_PAGE") anomalousRejections++;
    } else {
      processed++;
    }

    // Las respuestas se cuentan según lo que se LEYÓ, no según si la hoja
    // se aceptó. Una hoja rechazada por código ilegible cuyas respuestas
    // sí se midieron (y que una persona rescató escribiendo el código) sí
    // aporta a las métricas de lectura: el motor acertó esas respuestas, y
    // no contarlas subestimaría su desempeño real.
    const p = s.projected;
    if (!p) continue;
    for (const q of p.questions) {
      if (q.corrected) continue;
      if (q.state.kind !== "ANSWERED") sentToReview++;
      else if (q.correct === true) autoAcceptedCorrect++;
      else if (q.correct === false) autoAcceptedIncorrect++;
    }
    if (p.grade && p.pendingOrdinals.length === 0) grades.push(p.grade.value);
  }

  return {
    sheets: sheets.length,
    processed,
    rejected,
    anomalousRejections,
    rejectionsByReason,
    autoAcceptedCorrect,
    autoAcceptedIncorrect,
    sentToReview,
    averageGrade: grades.length
      ? Math.round((grades.reduce((a, b) => a + b, 0) / grades.length) * 10) / 10
      : null,
  };
}
