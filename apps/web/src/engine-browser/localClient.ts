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
import { buildHalfSheetTemplate } from "../../../../packages/pdf-generator/halfSheetTemplate.ts";
import { groupsBoundingBoxMm, sameColumnNeighbours } from "../../../../template.ts";
import type { StoredSheet } from "../../../api/storage/types.ts";
import { IndexedDbRepository } from "./indexedDbRepository.ts";
import { uploadFileLocal } from "./localUpload.ts";
import { pngBlobToGrayImage, renderSheetImageUrl, buildReadingMarks } from "./sheetImageBrowser.ts";

const DPI = 200;
// Ver la nota de omrWorker.ts: hoja-media-a4 es la plantilla de producción
// desde la Fase 2. Este `template` solo se usa acá para metadata del batch
// (templateId/templateVersion) y para renderizar el overlay de burbujas en
// la vista de revisión — no para clasificar nada, eso lo hace el worker.
const template = buildHalfSheetTemplate(100);

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
  /** Códigos del curso; ausente = sin nómina. Ver views/roster.ts. */
  roster?: string[];
}

export interface ProjectedQuestion extends QuestionResult {
  corrected: boolean;
  automaticState: ClassificationState;
}

export interface ProjectedSheet {
  studentId: string;
  studentIdCorrected: boolean;
  /** null = el lote no tiene nómina cargada. Ver domain/sheetProjection.ts. */
  studentIdInRoster: boolean | null;
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
  autoAcceptedBlank: number;
  sentToReview: number;
  /** Hojas cuyo código no figura en la nómina del curso. */
  unknownStudentIds: number;
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
/**
 * La nómina NUNCA se congela dentro de la hoja al procesarla: se lee del
 * lote en cada proyección. Cargar la lista después de haber subido las
 * hojas tiene que revisar también las que ya estaban — el mismo principio
 * de §13.7 que hace que activar la clave califique las hojas previas: no se
 * guarda una conclusión, se reconstruye cada vez desde los hechos.
 *
 * Una lista vacía vale `null` (comprobación apagada), no un conjunto vacío
 * que marcaría todas las hojas como desconocidas — ver setBatchRoster.
 */
async function rosterOf(batchId: string): Promise<ReadonlySet<string> | null> {
  const batch = await repo.getBatch(batchId);
  return batch?.roster?.length ? new Set(batch.roster) : null;
}

/**
 * @param roster se recibe ya resuelto en vez de leerlo acá adentro: esta
 * función corre UNA VEZ POR HOJA, y el lote es el mismo para todas — con 50
 * hojas serían 50 lecturas idénticas de IndexedDB para el mismo dato.
 */
async function project(
  sheet: StoredSheet,
  roster: ReadonlySet<string> | null
): Promise<ProjectedSheet | null> {
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
    new Set(key?.voided ?? []),
    undefined,
    roster
  );
}

async function sheetSummary(
  sheet: StoredSheet,
  roster: ReadonlySet<string> | null
): Promise<SheetSummary> {
  const projected = await project(sheet, roster);
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

/**
 * Cuántas hojas tiene cada lote — se agrega acá, no en `Batch` (la forma
 * cruda que se guarda), porque no es un dato que se guarde: se deriva de
 * `sheets` cada vez, igual que el resto de las proyecciones de este
 * archivo. Existe para que el selector de lotes en App.tsx pueda mostrar
 * "3.º B · Comunicación (0 hojas)" — sin esto, dos lotes con el mismo
 * nombre (el prompt de "Nuevo lote" siempre sugiere el mismo texto) son
 * indistinguibles en el desplegable, y elegir el vacío por error es fácil.
 */
export interface BatchWithCount extends Batch {
  sheetCount: number;
}

export function useBatches(): Async<BatchWithCount[]> {
  return useAsync(async () => {
    const list = await repo.listBatches();
    const counts = await Promise.all(list.map((b) => repo.listSheets(b.id)));
    return list.map((b, i) => ({ ...b, sheetCount: counts[i]!.length }));
  }, []);
}

export function useBatch(id: string | null): Async<BatchDetail> {
  return useAsync(async () => {
    if (!id) return null as never;
    const batch = await repo.getBatch(id);
    if (!batch) throw new Error("Lote no encontrado");

    const [sheets, key] = await Promise.all([repo.listSheets(id), repo.getCurrentAnswerKey(id)]);
    // El lote ya está cargado arriba: la nómina sale de ahí, sin releerla
    // una vez por hoja (ver la nota de project()).
    const roster = batch.roster?.length ? new Set(batch.roster) : null;
    const summaries = await Promise.all(sheets.map((s) => sheetSummary(s, roster)));

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
      projected: await project(sheet, await rosterOf(sheet.batchId)),
      corrections: await repo.listCorrections(id),
    };
  }, [id]);
}

// ── Acciones (no son hooks de lectura: se llaman y devuelven promesa) ──

export function createBatch(label: string): Promise<Batch> {
  return repo.createBatch({ label, templateId: template.id, templateVersion: template.version });
}

export function renameBatch(id: string, label: string): Promise<void> {
  return repo.renameBatch(id, label);
}

/** Nómina de códigos del curso — ver views/roster.ts para el porqué. */
export function setBatchRoster(id: string, roster: string[]): Promise<void> {
  return repo.setBatchRoster(id, roster);
}

/** Borra el lote y todo lo que cuelga de él (hojas, claves, correcciones,
 * imágenes) — ver la nota extensa en indexedDbRepository.ts::deleteBatch. */
export function deleteBatch(id: string): Promise<void> {
  return repo.deleteBatch(id);
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

export interface UploadFailure {
  fileName: string;
  message: string;
}

/**
 * Sube hojas informando el avance. A diferencia de la versión HTTP (que
 * necesitaba un `uploadId` y sondear un endpoint aparte porque la subida
 * viajaba por red), acá el avance llega DIRECTO por callback — no hay
 * proceso remoto del que enterarse por otro camino.
 *
 * UN ARCHIVO ILEGIBLE NO TUMBA LA TANDA. Los archivos son independientes
 * entre sí, así que el que falla se aparta y los demás siguen. MEDIDO antes
 * de este aislamiento: al soltar una hoja válida junto a un TIFF (formato
 * que el navegador no sabe decodificar), la excepción del TIFF cortaba el
 * bucle y la pantalla mostraba "0 hojas" — la hoja buena SÍ se había
 * guardado, pero el profesor no tenía forma de saberlo sin recargar. Un
 * escáner que entrega TIFF por defecto convierte eso en el caso normal, no
 * en un caso raro.
 */
export async function uploadSheets(
  batchId: string,
  files: File[],
  onProgress?: (p: UploadProgress) => void
): Promise<{ results: UploadResult[]; failures: UploadFailure[] }> {
  const progress: UploadProgress = { processed: 0, total: null, currentFile: null, done: false };
  const tick = (patch: Partial<UploadProgress>): void => {
    Object.assign(progress, patch);
    onProgress?.({ ...progress });
  };

  const results: UploadResult[] = [];
  const failures: UploadFailure[] = [];
  for (const file of files) {
    tick({ currentFile: file.name });
    try {
      const fileResults = await uploadFileLocal(repo, batchId, file, {}, {
        onPageCount: (count) => tick({ total: (progress.total ?? 0) + count }),
        onPageDone: () => tick({ processed: progress.processed + 1 }),
      });
      results.push(...fileResults);
    } catch (e) {
      failures.push({ fileName: file.name, message: e instanceof Error ? e.message : String(e) });
    }
  }
  tick({ done: true, currentFile: null });

  return { results, failures };
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

  const roster = await rosterOf(sheet.batchId);
  const before = await project(sheet, roster);
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

  return { correction, projected: await project(sheet, roster) };
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
      const projected = sheet ? await project(sheet, await rosterOf(sheet.batchId)) : null;
      marks = buildReadingMarks(projected?.questions ?? []);
    }

    return renderSheetImageUrl(aligned, template, DPI, marks, { targetWidth: width });
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

/**
 * Recorte fotográfico REAL alrededor de una pregunta, para la revisión
 * manual — no la representación sintética que dibujaba SheetCanvas (ver su
 * "PENDIENTE CONOCIDO", ahora resuelto). Mismo motivo que useSheetImageUrl
 * (PROMPT.md §8, "salida visual siempre"), pero acá SIEMPRE con overlay y
 * SIEMPRE recortado a la zona de la pregunta — no hay toggle: en revisión
 * uno quiere ver la marca real cuanto antes, no elegir primero.
 *
 * CROP_CONTEXT_MM (6mm, bastante más que el margen de foco de 1.4mm en
 * readingOverlay.ts): ese margen es "no tapar la burbuja", este es "que se
 * note que hay preguntas alrededor" — sin esto el recorte quedaría pegado
 * al borde de la primera/última fila vecina, sin aire.
 */
const CROP_CONTEXT_MM = 6;
/** Cuántas preguntas antes/después de la que está en revisión se incluyen
 * en el recorte — mismo criterio que ya usaba neighbourhood() en
 * Review.tsx para el canvas sintético: contexto sin volverse ilegible. */
const CROP_NEIGHBOURS = 2;

export function useReviewImageUrl(
  sheetId: string | null,
  ordinal: number | null,
  width?: number
): Async<string> {
  const result = useAsync(async () => {
    if (!sheetId || ordinal === null) return null as never;

    const png = await repo.getSheetImage(sheetId);
    if (!png) throw new Error("Esta hoja no se pudo enderezar para mostrarla");
    const aligned = await pngBlobToGrayImage(png);

    const sheet = await repo.getSheet(sheetId);
    const projected = sheet ? await project(sheet, await rosterOf(sheet.batchId)) : null;
    const marks = buildReadingMarks(projected?.questions ?? []);

    // Ver sameColumnNeighbours() en template.ts: ordinal±2 sin más cruzaría
    // de columna cerca de un borde (18-22 con 20 preguntas por columna).
    const neighbourGroups = sameColumnNeighbours(template.groups, ordinal, CROP_NEIGHBOURS);
    const cropRectMm = groupsBoundingBoxMm(neighbourGroups, template.bubbleDiameterMm, CROP_CONTEXT_MM);

    return renderSheetImageUrl(aligned, template, DPI, marks, {
      targetWidth: width,
      cropRectMm: cropRectMm ?? undefined,
      focusGroupId: `q.${ordinal}`,
    });
  }, [sheetId, ordinal, width]);

  useEffect(() => {
    return () => result.data?.revoke();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.data?.url]);

  return { ...result, data: result.data?.url ?? null };
}

/**
 * La FOTO del grid de 7 dígitos, para corregir el código mirando el papel.
 *
 * Mismo argumento que sostiene useReviewImageUrl para las respuestas,
 * aplicado al caso más caro de equivocarse: acá el profesor tiene que
 * TRANSCRIBIR 7 dígitos, no elegir entre 5 letras. Sin la imagen al lado,
 * el único camino era ir a buscar la hoja de papel en la pila —y con el
 * lote ya escaneado y guardado, puede que ni esté a mano— o escribir un
 * código de memoria. Un código tecleado mal tiene exactamente la misma
 * consecuencia que uno leído mal: la nota va a otra persona.
 *
 * Margen más generoso que en las preguntas (10mm contra 6mm): el grid del
 * código está pegado al borde derecho de la hoja, y ver ese borde ayuda a
 * confirmar que se está mirando la zona correcta.
 *
 * SIN overlay de lectura (marks = null): los anillos se dibujan sobre las
 * RESPUESTAS y acá no aportan; se muestra el papel tal cual, que es
 * exactamente contra lo que el profesor compara.
 */
const CODE_CROP_CONTEXT_MM = 10;

export function useStudentIdImageUrl(sheetId: string | null, width?: number): Async<string> {
  const result = useAsync(async () => {
    if (!sheetId) return null as never;

    const png = await repo.getSheetImage(sheetId);
    if (!png) throw new Error("Esta hoja no se pudo enderezar para mostrarla");
    const aligned = await pngBlobToGrayImage(png);

    const digitGroups = template.groups.filter((g) => g.kind === "digit");
    const cropRectMm = groupsBoundingBoxMm(
      digitGroups, template.bubbleDiameterMm, CODE_CROP_CONTEXT_MM
    );

    return renderSheetImageUrl(aligned, template, DPI, null, {
      targetWidth: width,
      cropRectMm: cropRectMm ?? undefined,
    });
  }, [sheetId, width]);

  useEffect(() => {
    return () => result.data?.revoke();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result.data?.url]);

  return { ...result, data: result.data?.url ?? null };
}
