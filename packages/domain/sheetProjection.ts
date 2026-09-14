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
  /**
   * Preguntas que siguen esperando decisión humana: el motor vio algo pero
   * NO SABE qué marcó el alumno (AMBIGUOUS/MULTIPLE), y nadie lo resolvió
   * todavía.
   *
   * "Pendiente" es "nadie la resolvió todavía", NO "el estado no es
   * ANSWERED" — son cosas distintas. BUG REAL encontrado probando el flujo
   * completo: una pregunta genuinamente en blanco, corregida a mano como
   * "dejar en blanco", queda en estado BLANK — y BLANK nunca es ANSWERED,
   * así que con el criterio viejo esa pregunta quedaba pendiente PARA
   * SIEMPRE, aunque una persona ya la hubiera decidido.
   *
   * BLANK TAMPOCO CUENTA COMO PENDIENTE, la haya confirmado una persona o
   * no. Una pregunta en blanco no es una duda: es una respuesta — "el
   * alumno no contestó" — y vale 0 puntos, como en cualquier examen. Antes
   * bloqueaba la nota: con 23 preguntas sin contestar (caso real, hoja de
   * prueba de la media hoja), la tabla mostraba "—" en vez de la nota hasta
   * que alguien hiciera 23 clics confirmando lo evidente.
   *
   * QUÉ HACE QUE ESTO SEA SEGURO y no un auto-aceptado a ciegas: la guarda
   * de blanco de classification.ts (BLANK_MARGIN_MAX). Para quedar BLANK no
   * alcanza con que todo mida poco — hace falta que NINGUNA opción se
   * despegue de las otras. Si una se despega, aunque sea 0.02, la pregunta
   * sale de BLANK y va a AMBIGUOUS, o sea a revisión. Ese umbral se calibró
   * contra 1.240 preguntas genuinamente vacías fabricadas por trasplante, y
   * sobre las 5 hojas con verdad conocida del proyecto (3 de la hoja
   * oficial + las 2 escaneadas de la media hoja) los 24 blancos reales se
   * leyeron los 24 bien, sin un solo error.
   */
  pendingOrdinals: number[];
  /**
   * Preguntas NO CONTESTADAS — da igual si lo dictaminó el motor (con la
   * evidencia de la guarda de blanco, ver arriba) o lo confirmó una persona
   * a mano. Las dos cosas significan lo mismo para la nota.
   *
   * Existe para que las cuentas cierren en pantalla: estas preguntas no son
   * correctas, ni incorrectas, ni pendientes — y sin una categoría propia
   * desaparecían de la tabla, y el profesor veía "23 + 76 + 0" sobre un
   * examen de 100 sin forma de saber dónde quedó la que falta.
   *
   * Para la NOTA valen 0 puntos y siguen en el denominador — que es
   * exactamente lo que significa dejar una pregunta sin contestar.
   */
  blankOrdinals: number[];
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
    pendingOrdinals: counted
      .filter((q) => q.state.kind !== "ANSWERED" && q.state.kind !== "BLANK" && !q.corrected)
      .map((q) => q.ordinal),
    blankOrdinals: counted
      .filter((q) => q.state.kind === "BLANK")
      .map((q) => q.ordinal),
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
  /**
   * Preguntas que el motor dio por NO CONTESTADAS sin preguntarle a nadie.
   *
   * Categoría propia y no parte de `sentToReview`: desde que una BLANK deja
   * de ir a la cola de revisión (ver sheetProjection::pendingOrdinals),
   * contarlas ahí haría que el contador del menú prometiera más preguntas
   * de las que la pantalla de revisión realmente tiene. Y tampoco puede ir
   * en autoAccepted correcta/incorrecta: para saber si una BLANK acertó
   * haría falta saber qué marcó el alumno, y la clave de respuestas dice
   * cuál era la correcta, no eso. Sin una casilla propia, estas preguntas
   * desaparecían del total y el % de revisión se calculaba sobre una base
   * recortada — se veía mejor de lo que es.
   */
  autoAcceptedBlank: number;
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
  let autoAcceptedCorrect = 0, autoAcceptedIncorrect = 0, autoAcceptedBlank = 0, sentToReview = 0;
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
      if (q.state.kind === "BLANK") autoAcceptedBlank++;
      else if (q.state.kind !== "ANSWERED") sentToReview++;
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
    autoAcceptedBlank,
    sentToReview,
    averageGrade: grades.length
      ? Math.round((grades.reduce((a, b) => a + b, 0) / grades.length) * 10) / 10
      : null,
  };
}
