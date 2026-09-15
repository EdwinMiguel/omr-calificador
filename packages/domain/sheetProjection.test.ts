import { describe, it, expect } from "vitest";
import { projectSheet, computeBatchMetrics, type CorrectionInput } from "./sheetProjection.ts";
import type { QuestionResult } from "../engine/scoring.ts";

const answered = (ordinal: number, option: string): QuestionResult => ({
  ordinal, state: { kind: "ANSWERED", option }, correct: null,
});
const ambiguous = (ordinal: number): QuestionResult => ({
  ordinal, state: { kind: "AMBIGUOUS" }, correct: null,
});
const blank = (ordinal: number): QuestionResult => ({
  ordinal, state: { kind: "BLANK" }, correct: null,
});
const multiple = (ordinal: number, options: string[]): QuestionResult => ({
  ordinal, state: { kind: "MULTIPLE", options }, correct: null,
});

describe("projectSheet", () => {
  it("sin clave no inventa aciertos: todo queda sin calificar", () => {
    const p = projectSheet({ studentId: "7072391", questions: [answered(1, "B")] }, [], null);
    expect(p.questions[0]!.correct).toBeNull();
    expect(p.grade).toBeNull();
  });

  it("aplica la clave sobre la lectura cruda", () => {
    const p = projectSheet(
      { studentId: "7072391", questions: [answered(1, "B"), answered(2, "C")] },
      [], { 1: "B", 2: "D" }
    );
    expect(p.questions.map((q) => q.correct)).toEqual([true, false]);
    expect(p.score).toEqual({ correct: 1, incorrect: 1, ungraded: 0, total: 2 });
  });

  it("una corrección manual reemplaza la lectura, pero conserva qué había leído el motor", () => {
    const corrections: CorrectionInput[] = [
      { ordinal: 1, resolvedAs: "E", createdAt: "2026-08-27T10:00:00Z" },
    ];
    const p = projectSheet(
      { studentId: "7072391", questions: [ambiguous(1)] }, corrections, { 1: "E" }
    );
    expect(p.questions[0]!.state).toEqual({ kind: "ANSWERED", option: "E" });
    expect(p.questions[0]!.correct).toBe(true);
    expect(p.questions[0]!.corrected).toBe(true);
    expect(p.questions[0]!.automaticState.kind).toBe("AMBIGUOUS");
  });

  it("con varias correcciones sobre la misma pregunta gana la última", () => {
    const corrections: CorrectionInput[] = [
      { ordinal: 1, resolvedAs: "A", createdAt: "2026-08-27T10:00:00Z" },
      { ordinal: 1, resolvedAs: "C", createdAt: "2026-08-27T11:00:00Z" },
    ];
    const p = projectSheet({ studentId: "7", questions: [ambiguous(1)] }, corrections, { 1: "C" });
    expect(p.questions[0]!.state).toEqual({ kind: "ANSWERED", option: "C" });
  });

  it("una corrección del código del alumno (ordinal null) cambia a quién pertenece la hoja", () => {
    const corrections: CorrectionInput[] = [
      { ordinal: null, resolvedAs: null, resolvedStudentId: "7018835", createdAt: "2026-08-27T10:00:00Z" },
    ];
    const p = projectSheet({ studentId: "", questions: [] }, corrections, null);
    expect(p.studentId).toBe("7018835");
    expect(p.studentIdCorrected).toBe(true);
  });

  it(
    "una pregunta corregida a mano como BLANK sale de pendientes — 'resuelta' no es " +
    "lo mismo que 'ANSWERED': una hoja con una pregunta genuinamente vacía, ya " +
    "confirmada como tal, tiene que poder llegar a cero pendientes",
    () => {
      const corrections: CorrectionInput[] = [
        { ordinal: 73, resolvedAs: null, createdAt: "2026-08-27T10:00:00Z" },
      ];
      const p = projectSheet(
        { studentId: "7", questions: [answered(1, "B"), ambiguous(73)] },
        corrections, { 1: "B", 73: "A" }
      );
      expect(p.questions.find((q) => q.ordinal === 73)!.state).toEqual({ kind: "BLANK" });
      expect(p.pendingOrdinals).toEqual([]);
    }
  );

  it(
    "las cuatro categorías que ve el profesor SIEMPRE suman el total — correctas + " +
    "incorrectas + en blanco + a revisión. Sin `blankOrdinals` una pregunta " +
    "confirmada como vacía no caía en ninguna y la tabla mostraba 99 de 100",
    () => {
      const corrections: CorrectionInput[] = [
        { ordinal: 2, resolvedAs: null, createdAt: "2026-08-27T10:00:00Z" },
      ];
      const p = projectSheet(
        {
          studentId: "7",
          questions: [answered(1, "B"), ambiguous(2), answered(3, "X"), ambiguous(4)],
        },
        corrections,
        { 1: "B", 2: "A", 3: "C", 4: "D" }
      );
      expect(p.blankOrdinals).toEqual([2]);
      expect(p.pendingOrdinals).toEqual([4]);
      const suma =
        p.score.correct + p.score.incorrect + p.blankOrdinals.length + p.pendingOrdinals.length;
      expect(suma).toBe(p.score.total);
    }
  );

  it("una pregunta anulada sale del puntaje y de los pendientes", () => {
    const p = projectSheet(
      { studentId: "7", questions: [answered(1, "B"), ambiguous(2)] },
      [], { 1: "B", 2: "C" }, new Set([2])
    );
    expect(p.score.total).toBe(1);
    expect(p.pendingOrdinals).toEqual([]);
    expect(p.grade!.value).toBe(20);
  });

  it(
    "una pregunta que el MOTOR dio por vacía tampoco es pendiente — sin contestar " +
    "no es una duda, es una respuesta que vale 0. Antes bloqueaba la nota hasta " +
    "que alguien confirmara a mano lo evidente, una por una",
    () => {
      const p = projectSheet(
        { studentId: "7", questions: [answered(1, "B"), blank(2)] },
        [], { 1: "B", 2: "A" }
      );
      expect(p.pendingOrdinals).toEqual([]);
      expect(p.blankOrdinals).toEqual([2]);
    }
  );

  it(
    "LA LÍNEA QUE NO SE CRUZA: ambiguas y dobles marcas SIGUEN siendo pendientes. " +
    "Ahí el motor vio algo y no supo qué era — darlas por no contestadas le " +
    "quitaría al alumno un punto que quizás ganó",
    () => {
      const p = projectSheet(
        { studentId: "7", questions: [blank(1), ambiguous(2), multiple(3, ["A", "C"])] },
        [], { 1: "A", 2: "B", 3: "C" }
      );
      expect(p.pendingOrdinals).toEqual([2, 3]);
      expect(p.blankOrdinals).toEqual([1]);
    }
  );

  it(
    "la nota sale con preguntas en blanco sin esperar a nadie, y las cuenta como 0: " +
    "2 de 4 correctas con 2 vacías es 10, no 20 sobre las contestadas",
    () => {
      const p = projectSheet(
        { studentId: "7", questions: [answered(1, "A"), answered(2, "B"), blank(3), blank(4)] },
        [], { 1: "A", 2: "B", 3: "C", 4: "D" }
      );
      expect(p.pendingOrdinals).toEqual([]);
      expect(p.grade!.value).toBe(10);
      expect(p.grade!.effectiveQuestions).toBe(4); // las vacías siguen en el denominador
      expect(p.grade!.pendingReview).toBe(0);
    }
  );

  it("las cuatro categorías siguen sumando el total con blancos automáticos mezclados", () => {
    const p = projectSheet(
      {
        studentId: "7",
        questions: [answered(1, "B"), answered(2, "X"), blank(3), ambiguous(4)],
      },
      [], { 1: "B", 2: "C", 3: "A", 4: "D" }
    );
    const suma =
      p.score.correct + p.score.incorrect + p.blankOrdinals.length + p.pendingOrdinals.length;
    expect(suma).toBe(p.score.total);
  });
});

describe("computeBatchMetrics", () => {
  it("no cuenta las páginas en blanco como rechazos anómalos (§13.5)", () => {
    const m = computeBatchMetrics([
      { outcome: { kind: "rejected", reason: "BLANK_PAGE" }, projected: null },
      { outcome: { kind: "rejected", reason: "MARKERS_NOT_FOUND" }, projected: null },
    ]);
    expect(m.rejected).toBe(2);
    expect(m.anomalousRejections).toBe(1);
  });

  it(
    "no cuenta como auto-aceptada una respuesta que corrigió una persona — " +
    "si no, la métrica del algoritmo mejoraría sola con el trabajo manual",
    () => {
      const projected = projectSheet(
        { studentId: "7", questions: [answered(1, "B"), ambiguous(2)] },
        [{ ordinal: 2, resolvedAs: "C", createdAt: "2026-08-27T10:00:00Z" }],
        { 1: "B", 2: "C" }
      );
      const m = computeBatchMetrics([{ outcome: { kind: "processed" }, projected }]);
      expect(m.autoAcceptedCorrect).toBe(1); // solo la pregunta 1
      expect(m.autoAcceptedIncorrect).toBe(0);
      expect(m.sentToReview).toBe(0); // la 2 ya no está pendiente, pero no es mérito del motor
    }
  );

  it("separa auto-aceptadas incorrectas — la métrica que debe ser 0 (§15)", () => {
    const projected = projectSheet(
      { studentId: "7", questions: [answered(1, "B")] }, [], { 1: "D" }
    );
    const m = computeBatchMetrics([{ outcome: { kind: "processed" }, projected }]);
    expect(m.autoAcceptedIncorrect).toBe(1);
  });

  it(
    "una hoja rechazada por código ilegible pero rescatada a mano SÍ aporta sus " +
    "respuestas a las métricas — el motor las leyó bien, no contarlas lo subestima",
    () => {
      const projected = projectSheet(
        { studentId: "", questions: [answered(1, "B"), answered(2, "C")] },
        [{ ordinal: null, resolvedAs: null, resolvedStudentId: "7072391", createdAt: "2026-08-27T10:00:00Z" }],
        { 1: "B", 2: "C" }
      );
      const m = computeBatchMetrics([
        { outcome: { kind: "rejected", reason: "STUDENT_ID_UNREADABLE" }, projected },
      ]);
      expect(m.rejected).toBe(1);          // sigue contando como rechazo del motor
      expect(m.autoAcceptedCorrect).toBe(2); // pero sus respuestas sí cuentan
    }
  );

  it("el promedio solo incluye hojas sin pendientes — una nota provisional no promedia", () => {
    const completa = projectSheet({ studentId: "1", questions: [answered(1, "B")] }, [], { 1: "B" });
    const pendiente = projectSheet({ studentId: "2", questions: [ambiguous(1)] }, [], { 1: "B" });
    const m = computeBatchMetrics([
      { outcome: { kind: "processed" }, projected: completa },
      { outcome: { kind: "processed" }, projected: pendiente },
    ]);
    expect(m.averageGrade).toBe(20);
  });
});

/**
 * La nómina es la única defensa del sistema contra "el código se leyó con
 * confianza y está mal" — el fallo que acredita la nota completa a otra
 * persona sin ningún aviso. Ver roster.ts y ProjectedSheet::studentIdInRoster.
 */
describe("projectSheet — nómina del curso", () => {
  const hoja = { studentId: "7072391", questions: [answered(1, "B")] };

  it("sin nómina no afirma nada: null, no false", () => {
    // Importa que sea null y no false: false significa "no está en la
    // lista" y manda la hoja a revisión. Un lote sin nómina mandaría
    // TODAS las hojas a revisión si esto devolviera false.
    expect(projectSheet(hoja, [], null).studentIdInRoster).toBeNull();
  });

  it("código que figura en la lista", () => {
    const p = projectSheet(hoja, [], null, undefined, undefined, new Set(["7072391", "1234567"]));
    expect(p.studentIdInRoster).toBe(true);
  });

  it("código que NO figura: es el caso que se quiere atrapar", () => {
    const p = projectSheet(hoja, [], null, undefined, undefined, new Set(["1234567"]));
    expect(p.studentIdInRoster).toBe(false);
  });

  it("la nota se calcula igual — el problema es de quién es, no cuánto sacó", () => {
    const p = projectSheet(
      { studentId: "9999999", questions: [answered(1, "B")] },
      [], { 1: "B" }, undefined, undefined, new Set(["1234567"])
    );
    expect(p.studentIdInRoster).toBe(false);
    expect(p.grade?.value).toBe(20);
  });

  describe("se evalúa sobre el código VIGENTE, no sobre el que leyó el motor", () => {
    const corregido = (id: string): CorrectionInput[] => [
      { ordinal: null, resolvedAs: null, resolvedStudentId: id, createdAt: "2026-09-15T10:00:00Z" },
    ];

    it("un código corregido a mano que SÍ está en la lista deja de avisar", () => {
      const p = projectSheet(hoja, corregido("1234567"), null, undefined, undefined, new Set(["1234567"]));
      expect(p.studentId).toBe("1234567");
      expect(p.studentIdInRoster).toBe(true);
    });

    it("un dedazo al escribirlo a mano se atrapa igual que un error de lectura", () => {
      // El motor había leído bien; la persona tecleó mal. Misma consecuencia,
      // misma red — por eso la comprobación va después de la corrección.
      const p = projectSheet(hoja, corregido("1234568"), null, undefined, undefined, new Set(["1234567"]));
      expect(p.studentIdInRoster).toBe(false);
    });
  });

  it("computeBatchMetrics cuenta las hojas sin dueño, aparte de los rechazos", () => {
    const roster = new Set(["1111111"]);
    const conocida = projectSheet({ studentId: "1111111", questions: [answered(1, "B")] }, [], { 1: "B" }, undefined, undefined, roster);
    const ajena = projectSheet({ studentId: "2222222", questions: [answered(1, "B")] }, [], { 1: "B" }, undefined, undefined, roster);
    const m = computeBatchMetrics([
      { outcome: { kind: "processed" }, projected: conocida },
      { outcome: { kind: "processed" }, projected: ajena },
    ]);
    expect(m.unknownStudentIds).toBe(1);
    // No son rechazos: se leyeron enteras y cuentan como procesadas.
    expect(m.rejected).toBe(0);
    expect(m.processed).toBe(2);
  });

  it("sin nómina, unknownStudentIds es 0 — no avisa de lo que no puede saber", () => {
    const sinLista = projectSheet(hoja, [], { 1: "B" });
    const m = computeBatchMetrics([{ outcome: { kind: "processed" }, projected: sinLista }]);
    expect(m.unknownStudentIds).toBe(0);
  });
});
