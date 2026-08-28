/**
 * types.ts — el modelo de datos persistido (Día 12).
 *
 * PROMPT.md §13.9: "Resultados append-only. Ningún UPDATE/DELETE. Una
 * corrección es una fila nueva que referencia a la anterior." Todo lo que
 * hay aquí está diseñado alrededor de esa regla: no existe ninguna forma de
 * modificar un evento ya escrito, solo de agregar otro que lo corrige.
 *
 * PROMPT.md §13.7: NO se guarda ninguna nota ni puntaje. Se guardan las
 * respuestas crudas leídas de la hoja; la nota se deriva al leer. Por eso
 * `StoredSheet` tiene `questions` pero no tiene `grade`.
 */

import type { QuestionResult } from "../../../packages/engine/scoring.ts";
import type { RejectionReason, Measurements } from "../../../packages/engine/analyzeSheet.ts";
import type { ClassificationState } from "../../../packages/engine/classification.ts";

export interface Batch {
  id: string;
  /** Nombre visible: "3.º B · Comunicación". */
  label: string;
  templateId: string;
  templateVersion: string;
  createdAt: string;
}

/**
 * Una hoja procesada. `fileHash` es la clave de idempotencia (§13.10):
 * subir dos veces el mismo archivo no crea una segunda hoja.
 */
export interface StoredSheet {
  id: string;
  batchId: string;
  fileHash: string;
  fileName: string;
  /** Índice de página dentro del archivo — un PDF trae varias hojas. */
  pageIndex: number;
  engineVersion: string;
  createdAt: string;
  outcome: StoredOutcome;
}

export type StoredOutcome =
  | {
      kind: "processed";
      studentId: string;
      reprojectionErrorPx: number;
      thresholdMethod: string;
      /** Respuestas CRUDAS: qué marcó el alumno, sin comparar con clave. */
      questions: QuestionResult[];
      /** Oscuridad medida por opción — la evidencia para la revisión manual. */
      measurements: Measurements;
    }
  | {
      kind: "rejected";
      reason: RejectionReason;
      /**
       * Lo que sí se leyó pese al rechazo. Cuando el único problema es el
       * código del alumno, aquí viajan sus 100 respuestas: escribiendo el
       * código a mano la hoja queda calificada sin volver a escanearla.
       */
      partial?: {
        questions: QuestionResult[];
        measurements: Measurements;
        reprojectionErrorPx: number;
        thresholdMethod: string;
        studentIdColumns: { ordinal: number; state: ClassificationState }[];
      };
    };

/**
 * La clave de respuestas de un lote. Es un evento más, no una tabla que se
 * edita: cambiar la clave agrega una versión nueva, y la anterior queda
 * disponible para auditar con qué se calificó en su momento.
 */
export interface StoredAnswerKey {
  id: string;
  batchId: string;
  version: number;
  /** ordinal → opción correcta. */
  answers: Record<number, string>;
  /** Preguntas anuladas: siguen en la hoja pero no cuentan (§13.7). */
  voided: number[];
  /** De dónde salió: hoja patrón escaneada, tecleada o importada. */
  source: "sheet" | "manual" | "import";
  /** Si vino de una hoja patrón, cuál — para poder volver a mirarla. */
  sourceSheetId?: string;
  createdAt: string;
  createdBy: string;
}

/**
 * Una corrección manual. NO reemplaza la lectura original: la referencia.
 * Al leer una hoja se aplica la última corrección de cada pregunta sobre
 * la lectura automática, y el historial completo queda visible.
 */
export interface StoredCorrection {
  id: string;
  sheetId: string;
  /** Qué pregunta se corrigió. `null` = se corrigió el código del alumno. */
  ordinal: number | null;
  /** La opción elegida por la persona, o null si la dejó en blanco. */
  resolvedAs: string | null;
  /** Solo cuando ordinal es null: el código escrito a mano. */
  resolvedStudentId?: string;
  /** Qué había antes, para poder mostrar "de X a Y" en el historial. */
  previousValue: string | null;
  reason: string;
  createdAt: string;
  createdBy: string;
}

export interface Repository {
  createBatch(b: Omit<Batch, "id" | "createdAt">): Promise<Batch>;
  listBatches(): Promise<Batch[]>;
  getBatch(id: string): Promise<Batch | null>;

  /** Devuelve la hoja existente si el hash ya se procesó (§13.10). */
  findSheetByHash(batchId: string, fileHash: string, pageIndex: number): Promise<StoredSheet | null>;
  appendSheet(s: Omit<StoredSheet, "id" | "createdAt">): Promise<StoredSheet>;
  listSheets(batchId: string): Promise<StoredSheet[]>;
  getSheet(id: string): Promise<StoredSheet | null>;

  appendAnswerKey(k: Omit<StoredAnswerKey, "id" | "version" | "createdAt">): Promise<StoredAnswerKey>;
  getCurrentAnswerKey(batchId: string): Promise<StoredAnswerKey | null>;
  listAnswerKeys(batchId: string): Promise<StoredAnswerKey[]>;

  appendCorrection(c: Omit<StoredCorrection, "id" | "createdAt">): Promise<StoredCorrection>;
  listCorrections(sheetId: string): Promise<StoredCorrection[]>;
  listCorrectionsForBatch(batchId: string): Promise<StoredCorrection[]>;
}
