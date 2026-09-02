/**
 * localClient.ts — el equivalente local de apps/web/src/api/client.ts.
 *
 * MISMA FORMA A PROPÓSITO: mismos nombres, mismos tipos, mismas firmas.
 * Cada vista solo cambia de dónde importa (`../api/client.ts` →
 * `../engine-browser/localClient.ts`) y sigue funcionando sin tocar ni una
 * línea de JSX — es el mismo patrón que ya demostró servir con
 * IndexedDbRepository cumpliendo Repository sin un método distinto.
 *
 * Reimplementa la LÓGICA de apps/api/server.ts (validaciones incluidas),
 * no solo su forma de datos: no hay servidor al que delegar, así que las
 * reglas de negocio que antes vivían en las rutas HTTP tienen que vivir acá.
 * Se repite el código a propósito (no se comparte con server.ts) porque uno
 * corre en Node y otro en el navegador — la LÓGICA es la misma a propósito,
 * mismo principio que ya se documentó en sheetImageBrowser.ts.
 */

import { useCallback, useEffect, useState } from "react";
import type { QuestionResult } from "../../../../packages/engine/scoring.ts";
import type { ClassificationState } from "../../../../packages/engine/classification.ts";
import type { Grade } from "../../../../packages/engine/grading.ts";
import { projectSheet, computeBatchMetrics } from "../../../../packages/domain/sheetProjection.ts";
import { buildOfficialTemplate } from "../../../../packages/pdf-generator/officialTemplate.ts";
import type { StoredSheet } from "../../../api/storage/types.ts";
import { IndexedDbRepository } from "./indexedDbRepository.ts";
import { uploadFileLocal } from "./localUpload.ts";
import { pngBlobToGrayImage, renderSheetImageUrl, buildReadingMarks } from "./sheetImageBrowser.ts";

const DPI = 200;
const template = buildOfficialTemplate(100);

// Un solo repositorio para toda la pestaña — abrir IndexedDB tiene su propio
// costo (primera apertura crea los almacenes) y no hay motivo para repetirlo
// por cada hook.
// Exportado (no solo interno) porque backup/restauración necesitan el
// MISMO repositorio — dos instancias de IndexedDbRepository apuntan a la
// misma base física, pero abrir la conexión dos veces sería trabajo de más
// sin ningún beneficio.
export const repo = new IndexedDbRepository();

export interface Batch {
  id: string;
  label: string;
  templateId: string;
  templateVersion: string;
  createdAt: string;
}

export interface ProjectedQuestion extends QuestionResult {
  corrected: boolean;
  automaticState: ClassificationState;
}

export interface ProjectedSheet {
  studentId: string;
  studentIdCorrected: boolean;
  questions: ProjectedQuestion[];
  score: { correct: number; incorrect: number; ungraded: number; total: number };
  grade: Grade | null;
  pendingOrdinals: number[];
  blankOrdinals: number[];
}

export type Measurements = Record<number, Record<string, number>>;

export type SheetOutcome =
  | {
      kind: "processed";
      studentId: string;
      reprojectionErrorPx: number;
      thresholdMethod: string;
      questions: QuestionResult[];
      measurements: Measurements;
    }
  | {
      kind: "rejected";
      reason: string;
      partial?: {
        questions: QuestionResult[];
        measurements: Measurements;
        reprojectionErrorPx: number;
        thresholdMethod: string;
        studentIdColumns: { ordinal: number; state: ClassificationState }[];
      };
    };

export interface SheetSummary {
  id: string;
  fileName: string;
  pageIndex: number;
  createdAt: string;
  outcome: SheetOutcome;
  projected: ProjectedSheet | null;
}

export interface AnswerKey {
  id: string;
  batchId: string;
  version: number;
  answers: Record<string, string>;
  voided: number[];
  source: "sheet" | "manual" | "import";
  sourceSheetId?: string;
  createdAt: string;
  createdBy: string;
}

export interface BatchMetrics {
  sheets: number;
  processed: number;
  rejected: number;
  anomalousRejections: number;
  rejectionsByReason: Record<string, number>;
  autoAcceptedCorrect: number;
  autoAcceptedIncorrect: number;
  sentToReview: number;
  averageGrade: number | null;
}

export interface BatchDetail {
  batch: Batch;
  answerKey: AnswerKey | null;
  sheets: SheetSummary[];
  metrics: BatchMetrics;
}

export interface Correction {
  id: string;
  sheetId: string;
  ordinal: number | null;
  resolvedAs: string | null;
  resolvedStudentId?: string;
  previousValue: string | null;
  reason: string;
  createdAt: string;
  createdBy: string;
}

/**
 * Reconstruye una hoja: lectura cruda + correcciones + clave vigente.
 * Puerto directo de project() en server.ts — misma regla exacta: una hoja
 * rechazada por código ilegible SÍ se proyecta, siempre que alguien haya
 * escrito el código a mano.
 */
async function project(sheet: StoredSheet): Promise<ProjectedSheet | null> {
  const [corrections, key] = await Promise.all([
    repo.listCorrections(sheet.id),
    repo.getCurrentAnswerKey(sheet.batchId),
  ]);

  let automatic: { studentId: string; questions: QuestionResult[] } | null = null;
  if (sheet.outcome.kind === "processed") {
    automatic = { studentId: sheet.outcome.studentId, questions: sheet.outcome.questions };
  } else if (sheet.outcome.partial) {
    const hasIdCorrection = corrections.some((c) => c.ordinal === null);
    if (hasIdCorrection) automatic = { studentId: "", questions: sheet.outcome.partial.questions };
  }
  if (!automatic) return null;

  return projectSheet(
    automatic,
    corrections,
    key ? key.answers : null,
    new Set(key?.voided ?? [])
  );
}

async function sheetSummary(sheet: StoredSheet): Promise<SheetSummary> {
  const projected = await project(sheet);
  return {
    id: sheet.id,
    fileName: sheet.fileName,
    pageIndex: sheet.pageIndex,
    createdAt: sheet.createdAt,
    outcome: sheet.outcome as SheetOutcome,
    projected,
  };
}

/** Estado estándar de una lectura: datos, si está cargando, y el fallo. */
export interface Async<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): Async<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fn()
      .then((d) => { if (!cancelled) setData(d); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, loading, error, reload: useCallback(() => setNonce((n) => n + 1), []) };
}

export function useBatches(): Async<Batch[]> {
  return useAsync(() => repo.listBatches(), []);
}

export function useBatch(id: string | null): Async<BatchDetail> {
  return useAsync(async () => {
    if (!id) return null as never;
    const batch = await repo.getBatch(id);
    if (!batch) throw new Error("Lote no encontrado");

    const [sheets, key] = await Promise.all([repo.listSheets(id), repo.getCurrentAnswerKey(id)]);
    const summaries = await Promise.all(sheets.map(sheetSummary));

    return {
      batch,
      answerKey: key,
      sheets: summaries,
      metrics: computeBatchMetrics(
        summaries.map((s) => ({
          outcome: { kind: s.outcome.kind, reason: s.outcome.kind === "rejected" ? s.outcome.reason : undefined },
          projected: s.projected,
        }))
      ),
    };
  }, [id]);
}

export function useSheet(id: string | null): Async<{ sheet: unknown; projected: ProjectedSheet | null; corrections: Correction[] }> {
  return useAsync(async () => {
    if (!id) return null as never;
    const sheet = await repo.getSheet(id);
    if (!sheet) throw new Error("Hoja no encontrada");
    return {
      sheet,
      projected: await project(sheet),
      corrections: await repo.listCorrections(id),
    };
  }, [id]);
}

// ── Acciones (no son hooks de lectura: se llaman y devuelven promesa) ──

export function createBatch(label: string): Promise<Batch> {
  return repo.createBatch({ label, templateId: template.id, templateVersion: template.version });
}

export interface UploadResult {
  fileName: string;
  pageIndex: number;
  status: "processed" | "rejected" | "duplicate";
  sheetId: string;
}

export interface UploadProgress {
  processed: number;
  total: number | null;
  currentFile: string | null;
  done: boolean;
}

/**
 * Sube hojas informando el avance. A diferencia de la versión HTTP (que
 * necesitaba un `uploadId` y sondear un endpoint aparte porque la subida
 * viajaba por red), acá el avance llega DIRECTO por callback — no hay
 * proceso remoto del que enterarse por otro camino.
 */
export async function uploadSheets(
  batchId: string,
  files: File[],
  onProgress?: (p: UploadProgress) => void
): Promise<{ results: UploadResult[] }> {
  const progress: UploadProgress = { processed: 0, total: null, currentFile: null, done: false };
  const tick = (patch: Partial<UploadProgress>): void => {
    Object.assign(progress, patch);
    onProgress?.({ ...progress });
  };

  const results: UploadResult[] = [];
  for (const file of files) {
    tick({ currentFile: file.name });
    const fileResults = await uploadFileLocal(repo, batchId, file, {}, {
      onPageCount: (count) => tick({ total: (progress.total ?? 0) + count }),
      onPageDone: () => tick({ processed: progress.processed + 1 }),
    });
    results.push(...fileResults);
  }
  tick({ done: true, currentFile: null });

  return { results };
}

/** Mismas reglas exactas que el bloque de validación de POST /sheets/:id/corrections en server.ts. */
export async function postCorrection(
  sheetId: string,
  body: { ordinal: number | null; resolvedAs: string | null; resolvedStudentId?: string; reason?: string; createdBy?: string }
): Promise<{ correction: Correction; projected: ProjectedSheet | null }> {
  const sheet = await repo.getSheet(sheetId);
  if (!sheet) throw new Error("Hoja no encontrada");

  if (sheet.outcome.kind === "rejected") {
    if (!sheet.outcome.partial) {
      throw new Error("Esta hoja no se pudo leer: no hay respuestas que corregir");
    }
    if (body.ordinal !== null && !sheet.outcome.partial) {
      throw new Error("No se pueden corregir respuestas de una hoja rechazada");
    }
  }
  if (body.ordinal === null && !body.resolvedStudentId) {
    throw new Error("Falta el código del alumno");
  }

  const before = await project(sheet);
  const previous =
    body.ordinal === null
      ? before?.studentId ?? null
      : (() => {
          const q = before?.questions.find((x) => x.ordinal === body.ordinal);
          return q && q.state.kind === "ANSWERED" ? q.state.option : q?.state.kind ?? null;
        })();

  const correction = await repo.appendCorrection({
    sheetId,
    ordinal: body.ordinal,
    resolvedAs: body.resolvedAs,
    resolvedStudentId: body.resolvedStudentId,
    previousValue: previous,
    reason: body.reason ?? "revisión manual",
    createdBy: body.createdBy ?? "operador",
  });

  return { correction, projected: await project(sheet) };
}

export async function postAnswerKey(
  batchId: string,
  body: { answers: Record<string, string>; voided?: number[]; source: "sheet" | "manual" | "import"; sourceSheetId?: string; createdBy?: string }
): Promise<AnswerKey> {
  const answers: Record<number, string> = {};
  for (const [k, v] of Object.entries(body.answers)) answers[Number(k)] = v;

  return repo.appendAnswerKey({
    batchId,
    answers,
    voided: body.voided ?? [],
    source: body.source,
    sourceSheetId: body.sourceSheetId,
    createdBy: body.createdBy ?? "operador",
  });
}

export async function readSheetAsAnswerKey(
  sheetId: string
): Promise<{ sheetId: string; answers: Record<string, string>; unresolved: number[]; total: number }> {
  const sheet = await repo.getSheet(sheetId);
  if (!sheet) throw new Error("Hoja no encontrada");
  if (sheet.outcome.kind !== "processed") {
    throw new Error("La hoja patrón no se pudo leer");
  }

  const answers: Record<number, string> = {};
  const unresolved: number[] = [];
  for (const q of sheet.outcome.questions) {
    if (q.state.kind === "ANSWERED") answers[q.ordinal] = q.state.option;
    else unresolved.push(q.ordinal);
  }
  const answersStr: Record<string, string> = {};
  for (const [k, v] of Object.entries(answers)) answersStr[k] = v;
  return { sheetId, answers: answersStr, unresolved, total: sheet.outcome.questions.length };
}

// ── Imagen de la hoja ("Ver hoja") ──────────────────────────────────────

/**
 * Equivalente local de GET /api/sheets/:id/image. A diferencia del servidor
 * (que cachea la imagen alineada en disco y la recalcula si falta), acá la
 * imagen SIEMPRE está guardada de antemano — se escribió en IndexedDB al
 * momento de analizar la hoja (ver localUpload.ts) porque no hay disco de
 * servidor que la recalcule bajo demanda.
 *
 * LIBERA LA URL ANTERIOR AL PEDIR UNA NUEVA — a diferencia de un <img src>
 * apuntando al servidor (donde el navegador simplemente deja de pedir la
 * URL vieja), acá cada render crea un Blob nuevo en memoria del lado del
 * cliente. Sin revocar la anterior, cambiar entre overlay on/off o hacer
 * zoom varias veces acumula un Blob de la hoja completa por cada cambio y
 * nunca los suelta hasta recargar la página.
 */
export function useSheetImageUrl(
  sheetId: string | null,
  overlay: boolean,
  width?: number
): Async<string> {
  const result = useAsync(async () => {
    if (!sheetId) return null as never;

    const png = await repo.getSheetImage(sheetId);
    if (!png) throw new Error("Esta hoja no se pudo enderezar para mostrarla");

    const aligned = await pngBlobToGrayImage(png);
    let marks = null;
    if (overlay) {
      const sheet = await repo.getSheet(sheetId);
      const projected = sheet ? await project(sheet) : null;
      marks = buildReadingMarks(projected?.questions ?? []);
    }

    return renderSheetImageUrl(aligned, template, DPI, marks, width);
  }, [sheetId, overlay, width]);

  // Se guarda la URL previa para revocarla en cuanto haya una nueva (o al
  // desmontar) — un useEffect aparte porque `result.data` cambia después de
  // que useAsync ya resolvió, no durante el render.
  useEffect(() => {
    return () => result.data?.revoke();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.data?.url]);

  return { ...result, data: result.data?.url ?? null };
}
