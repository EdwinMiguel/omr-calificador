/**
 * client.ts — el único lugar del front que sabe que existe una red.
 *
 * PROMPT.md §9: "apps/web → toda llamada a la API vive en hooks". Los
 * componentes no hacen fetch: piden datos a un hook y reciben
 * {data, loading, error}. Así una vista se puede leer sin saber nada de
 * HTTP, y cambiar la forma de traer datos no toca ni un componente.
 */

import { useCallback, useEffect, useState } from "react";
import type { QuestionResult } from "../../../../packages/engine/scoring.ts";
import type { ClassificationState } from "../../../../packages/engine/classification.ts";
import type { Grade } from "../../../../packages/engine/grading.ts";

const BASE = "/api";

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
}

/** Oscuridad normalizada por opción: ordinal → { "A": 0.02, "E": 0.241, … } */
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(BASE + path, {
    ...init,
    headers: init?.body instanceof FormData ? init.headers : { "content-type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `La API respondió ${res.status}`);
  }
  return res.json() as Promise<T>;
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
  return useAsync(() => request<Batch[]>("/batches"), []);
}

export function useBatch(id: string | null): Async<BatchDetail> {
  return useAsync(
    () => (id ? request<BatchDetail>(`/batches/${id}`) : Promise.resolve(null as never)),
    [id]
  );
}

export function useSheet(id: string | null): Async<{ sheet: unknown; projected: ProjectedSheet | null; corrections: Correction[] }> {
  return useAsync(
    () => (id ? request(`/sheets/${id}`) : Promise.resolve(null as never)),
    [id]
  );
}

// ── Acciones (no son hooks de lectura: se llaman y devuelven promesa) ──

export function createBatch(label: string): Promise<Batch> {
  return request<Batch>("/batches", { method: "POST", body: JSON.stringify({ label }) });
}

export interface UploadResult {
  fileName: string;
  pageIndex: number;
  status: "processed" | "rejected" | "duplicate";
  sheetId: string;
}

export interface UploadProgress {
  processed: number;
  /** null mientras no se sepa: un PDF no revela su cantidad de páginas hasta abrirlo. */
  total: number | null;
  currentFile: string | null;
  done: boolean;
}

/**
 * Sube hojas informando el avance.
 *
 * El progreso NO puede deducirse del lado del cliente: un solo PDF puede
 * traer 30 hojas, y la barra tiene que moverse hoja a hoja, no archivo a
 * archivo. Por eso el cliente inventa un `uploadId`, lo manda con la
 * subida, y consulta un endpoint aparte mientras la petición sigue abierta.
 */
export async function uploadSheets(
  batchId: string,
  files: File[],
  onProgress?: (p: UploadProgress) => void
): Promise<{ results: UploadResult[] }> {
  const form = new FormData();
  for (const f of files) form.append("file", f);

  const uploadId = crypto.randomUUID();
  const upload = request<{ results: UploadResult[] }>(
    `/batches/${batchId}/sheets?uploadId=${uploadId}`,
    { method: "POST", body: form }
  );

  if (onProgress) {
    let polling = true;
    void upload.finally(() => { polling = false; });
    void (async () => {
      while (polling) {
        await new Promise((r) => setTimeout(r, 700));
        if (!polling) break;
        try {
          const p = await request<UploadProgress>(`/uploads/${uploadId}/progress`);
          onProgress(p);
          if (p.done) break;
        } catch {
          // 404 al principio (la subida aún no registró su progreso) o al
          // final (ya expiró). Ninguno es un fallo de la subida en sí, así
          // que se ignora y se sigue consultando.
        }
      }
    })();
  }

  return upload;
}

export function postCorrection(
  sheetId: string,
  body: { ordinal: number | null; resolvedAs: string | null; resolvedStudentId?: string; reason?: string; createdBy?: string }
): Promise<{ correction: Correction; projected: ProjectedSheet | null }> {
  return request(`/sheets/${sheetId}/corrections`, { method: "POST", body: JSON.stringify(body) });
}

export function postAnswerKey(
  batchId: string,
  body: { answers: Record<string, string>; voided?: number[]; source: "sheet" | "manual" | "import"; sourceSheetId?: string; createdBy?: string }
): Promise<AnswerKey> {
  return request(`/batches/${batchId}/answer-key`, { method: "POST", body: JSON.stringify(body) });
}

export function readSheetAsAnswerKey(
  sheetId: string
): Promise<{ sheetId: string; answers: Record<string, string>; unresolved: number[]; total: number }> {
  return request(`/sheets/${sheetId}/as-answer-key`);
}
