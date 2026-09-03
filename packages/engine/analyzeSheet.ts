/**
 * analyzeSheet.ts — Día 11: "Fin de la fase CLI-only" (PLAN-15-DIAS.md).
 *
 * El punto de entrada único del motor: GrayImage + Template + Config →
 * SheetOutcome (PROMPT.md §6). Une lo de los Días 7-11 en una función pura
 * — nada de esto toca disco ni conoce el formato del archivo original.
 */

import type { GrayImage } from "./types.ts";
import type { Template, BubbleGroup } from "../../template.ts";
import { bubbleRoi } from "../../template.ts";
import { analyzeGeometry } from "./geometry.ts";
import { deriveThresholds, normalize, normalizeWithinGroup } from "./calibration.ts";
import { fillRatioNearby } from "./measurement.ts";
import { classify, deriveSheetMarkContext, type LabeledFill, type ClassificationState } from "./classification.ts";
import { decodeDigitGrid } from "./identification.ts";
import { gradeQuestions, computeScore, type AnswerKey, type QuestionResult, type Score } from "./scoring.ts";

export type RejectionReason =
  | "MARKERS_NOT_FOUND"
  | "BAD_HOMOGRAPHY"
  | "BLANK_PAGE"
  | "STUDENT_ID_UNREADABLE"
  /** Ampliación general (no específica de esta plantilla): deriveThresholds
   * puede fallar por falta de contraste medible entre los parches negro y
   * blanco — no estaba en la lista original de PROMPT.md §6, pero es el
   * mismo tipo de "no confío lo suficiente en esta hoja para calificarla". */
  | "CALIBRATION_FAILED";

export type SheetOutcome =
  | { kind: "processed"; result: SheetResult; alignedImage: GrayImage }
  | { kind: "rejected"; reason: RejectionReason; partial?: PartialRead; alignedImage?: GrayImage };

/**
 * `alignedImage` — la hoja ya enderezada, PARA MOSTRAR (overlay de qué se
 * leyó, comparación visual, PROMPT.md §8). El servidor la recalcula bajo
 * demanda (analyzeGeometry corre de nuevo cuando alguien pide ver la hoja,
 * y la cachea en disco desde ahí) porque un archivo con miles de hojas no
 * tiene sentido guardarlas todas de entrada. En el navegador no hay ese
 * "disco del servidor": si no viaja acá, se pierde — recalcularla implicaría
 * repetir el análisis completo solo para poder mostrar una imagen. Por eso
 * ahora se entrega siempre que exista, y es la propia capa de
 * almacenamiento (servidor o IndexedDB) la que decide si la guarda o no.
 *
 * Presente en CUALQUIER resultado donde la geometría llegó a resolverse:
 * "processed", pero también "rejected" por STUDENT_ID_UNREADABLE o
 * CALIBRATION_FAILED — en ambos casos la hoja ya se enderezó antes de que
 * fallara el paso siguiente, y poder verla ayuda a entender por qué falló
 * (ej. mirar si los parches de calibración salieron manchados). Ausente
 * en BLANK_PAGE, MARKERS_NOT_FOUND y BAD_HOMOGRAPHY: ahí no hay ninguna
 * imagen enderezada que mostrar, la hoja nunca llegó a alinearse.
 */

/**
 * Lo que SÍ se alcanzó a leer en una hoja que igual se rechaza.
 *
 * MEDIDO sobre un caso real: una hoja con dos dígitos marcados a la vez en
 * una columna del código se rechaza por STUDENT_ID_UNREADABLE — correcto,
 * no se debe adivinar a quién pertenece. Pero sus 100 respuestas se habían
 * leído perfectamente, y descartarlas obliga a volver a escanear la hoja
 * solo para recuperar lo que ya se tenía. Con esto, una persona escribe el
 * código a mano y la hoja queda calificada sin pasar de nuevo por el
 * escáner — que es justo el espíritu de §13.7 (no re-escanear para algo
 * que se puede derivar).
 *
 * NO convierte el rechazo en aceptación: la hoja sigue siendo `rejected` y
 * no se califica sola. Solo deja de tirar evidencia ya obtenida.
 */
export interface PartialRead {
  questions: QuestionResult[];
  measurements: Measurements;
  reprojectionErrorPx: number;
  thresholdMethod: "adaptive" | "otsu" | "combined";
  /** Lectura por columna del código, para mostrar cuál falló y por qué. */
  studentIdColumns: { ordinal: number; state: ClassificationState }[];
}

/**
 * Oscuridad normalizada de CADA opción de cada pregunta — los números
 * exactos sobre los que `classify()` tomó su decisión.
 *
 * Se guardan porque la revisión manual los necesita: quien resuelve una
 * pregunta dudosa decide mucho mejor viendo "la E midió 0.241 y el umbral
 * es 0.25" que viendo solo "no se pudo leer". Sin esto, la persona tendría
 * que confiar a ciegas o volver a la hoja de papel.
 *
 * Costo real medido: 100 preguntas × 5 opciones = 500 números por hoja,
 * ~6 KB en JSON. Barato frente a lo que habilita.
 */
export type Measurements = Record<number, Record<string, number>>;

export interface SheetResult {
  templateId: string;
  templateVersion: string;
  engineVersion: string;
  studentId: string;
  reprojectionErrorPx: number;
  thresholdMethod: "adaptive" | "otsu" | "combined";
  questions: QuestionResult[];
  measurements: Measurements;
  score: Score;
}

/** PROMPT.md §6: "guarda siempre engineVersion... para poder reevaluar el
 * histórico si el algoritmo cambia". Subir esto es un cambio deliberado,
 * no un detalle — significa "algo en el pipeline de análisis cambió".
 *
 * 0.1.0 → 0.2.0: las preguntas se normalizan contra la referencia de papel
 * de su propia fila (calibration.ts::normalizeWithinGroup) en vez de contra
 * la de vecindario. Los `measurements` guardados por versiones 0.1.x están
 * en la escala anterior: comparables entre sí, NO comparables uno a uno con
 * los de 0.2.x. */
export const ENGINE_VERSION = "0.2.0";

/**
 * MEDIDO de forma indirecta, no contra una foto de papel genuinamente en
 * blanco (no hay una en el dataset todavía — todas las "vacías" son la
 * hoja IMPRESA sin marcar, que igual tiene título, marcadores y cientos de
 * contornos de burbuja). Una hoja realmente en blanco (el reverso de un
 * dúplex, por ejemplo) no tiene NADA de eso. 0.5% de píxeles oscuros deja
 * margen amplio bajo lo que cualquier hoja impresa mide, incluso borrosa.
 * CALIBRAR contra una foto real de papel en blanco en cuanto exista una.
 */
const BLANK_PAGE_MAX_INK_FRACTION = 0.005;
const DARK_PIXEL_THRESHOLD = 200;

function isBlankPage(img: GrayImage): boolean {
  let dark = 0;
  for (const v of img.data) if (v < DARK_PIXEL_THRESHOLD) dark++;
  return dark / img.data.length < BLANK_PAGE_MAX_INK_FRACTION;
}

export async function analyzeSheet(
  img: GrayImage, template: Template, dpi: number, answerKey: AnswerKey
): Promise<SheetOutcome> {
  // PROMPT.md §13.5: "Verifica cobertura de tinta ANTES de buscar
  // marcadores" — más barato que correr todo el pipeline geométrico sobre
  // una hoja que no tiene nada que encontrar.
  if (isBlankPage(img)) {
    return { kind: "rejected", reason: "BLANK_PAGE" };
  }

  const geo = await analyzeGeometry(img, template, dpi);
  if (geo.kind === "rejected") {
    return { kind: "rejected", reason: geo.reason };
  }

  let calibration;
  try {
    calibration = deriveThresholds(geo.normalized, template, dpi);
  } catch {
    return { kind: "rejected", reason: "CALIBRATION_FAILED", alignedImage: geo.normalized };
  }

  const measureGroup = (group: BubbleGroup) =>
    group.bubbles.map((b) => ({
      label: b.label,
      raw: fillRatioNearby(geo.normalized, bubbleRoi(b, template, dpi)),
      xMm: b.center.x,
      yMm: b.center.y,
    }));

  /** Referencia de papel por VECINDARIO: la de toda la vida. */
  const fillFn = (group: BubbleGroup): LabeledFill[] =>
    measureGroup(group).map((b) => ({
      label: b.label,
      normalized: normalize(b.raw, calibration, b.xMm, b.yMm),
    }));

  /**
   * Referencia de papel por GRUPO: las otras opciones de la misma pregunta
   * (calibration.ts::normalizeWithinGroup). Se aplica SOLO a las preguntas,
   * igual que el contexto de rescate más abajo y por la misma razón: se
   * midió contra las 199 respuestas de las dos hojas con verdad conocida, y
   * ninguna de esas verdades incluye el código del alumno. Cambiar cómo se
   * lee el código sin poder comprobarlo contra una verdad sería justo el
   * tipo de asunción que PROMPT.md §14 prohíbe — y un dígito mal leído le
   * cambia el dueño a la hoja entera.
   */
  const fillQuestion = (group: BubbleGroup): LabeledFill[] => {
    const measured = measureGroup(group);
    const normalized = normalizeWithinGroup(measured, calibration);
    return measured.map((b, i) => ({ label: b.label, normalized: normalized[i]! }));
  };

  const digitGroups = template.groups.filter((g) => g.kind === "digit");
  const id = decodeDigitGrid(digitGroups, fillFn);

  // Se mide TODO primero y se clasifica después, en dos pasadas: la segunda
  // necesita saber cuánto mide una marca —y cuánto mide el ruido— en ESTA
  // hoja, y eso solo se sabe una vez medidas todas las preguntas. Ver
  // deriveSheetMarkContext() en classification.ts.
  const questionGroups = template.groups.filter((g) => g.kind === "question");
  const measurements: Measurements = {};
  const measuredQuestions = questionGroups.map((g) => {
    const fills = fillQuestion(g);
    measurements[g.ordinal] = Object.fromEntries(
      fills.map((f) => [f.label, Math.round(f.normalized * 1000) / 1000])
    );
    return { ordinal: g.ordinal, fills };
  });

  // El contexto se pasa SOLO a las preguntas. `decodeDigitGrid` de más
  // arriba clasifica el código sin él a propósito: una respuesta mal leída
  // afecta una nota, un dígito mal leído le cambia el dueño a la hoja.
  const sheetContext = deriveSheetMarkContext(measuredQuestions.map((q) => q.fills));
  const states = measuredQuestions.map(({ ordinal, fills }) => ({
    ordinal,
    state: classify(fills, sheetContext),
  }));
  const questions = gradeQuestions(states, answerKey);

  // PROMPT.md §13.8 (mismo principio, aplicado al ID): una hoja cuyo
  // código no se lee con confianza no se asigna a un alumno adivinado.
  // Las respuestas ya leídas viajan igual en `partial` — ver PartialRead.
  if (id.value === null) {
    return {
      kind: "rejected",
      reason: "STUDENT_ID_UNREADABLE",
      partial: {
        questions,
        measurements,
        reprojectionErrorPx: geo.reprojectionErrorPx,
        thresholdMethod: geo.thresholdMethod,
        studentIdColumns: id.columns.map((c) => ({ ordinal: c.ordinal, state: c.state })),
      },
      alignedImage: geo.normalized,
    };
  }

  const score = computeScore(questions);

  return {
    kind: "processed",
    result: {
      templateId: template.id,
      templateVersion: template.version,
      engineVersion: ENGINE_VERSION,
      studentId: id.value,
      reprojectionErrorPx: geo.reprojectionErrorPx,
      thresholdMethod: geo.thresholdMethod,
      questions,
      measurements,
      score,
    },
    alignedImage: geo.normalized,
  };
}
