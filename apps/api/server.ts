/**
 * server.ts — Día 12: la API. Capa de transporte, sin lógica de dominio
 * propia (PROMPT.md §9). Todo lo que decide algo vive en packages/:
 * el análisis en packages/engine, la proyección en packages/domain.
 * Aquí solo hay HTTP, validación de entrada y llamadas a esos módulos.
 */

import Fastify from "fastify";
import multipart from "@fastify/multipart";
import cors from "@fastify/cors";
import staticFiles from "@fastify/static";
import { z } from "zod";
import { createHash } from "node:crypto";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { loadPagesFromBuffer } from "../cli/io/loadPages.ts";
import { analyzeSheet, ENGINE_VERSION } from "../../packages/engine/analyzeSheet.ts";
import { analyzeGeometry } from "../../packages/engine/geometry.ts";
import { renderReadingOverlay, type ReadingMark } from "../../packages/engine/readingOverlay.ts";
import type { GrayImage } from "../../packages/engine/types.ts";
import sharp from "sharp";
import { buildOfficialTemplate } from "../../packages/pdf-generator/officialTemplate.ts";
import { projectSheet, computeBatchMetrics, type ProjectedSheet } from "../../packages/domain/sheetProjection.ts";
import type { QuestionResult } from "../../packages/engine/scoring.ts";
import { FileRepository } from "./storage/fileRepo.ts";
import type { StoredSheet } from "./storage/types.ts";

const DPI = 200;
const DATA_DIR = process.env.OMR_DATA_DIR ?? join(process.cwd(), ".data");
const template = buildOfficialTemplate(100);

const repo = new FileRepository(join(DATA_DIR, "events.jsonl"));

const app = Fastify({
  logger: { level: process.env.LOG_LEVEL ?? "info" },
  bodyLimit: 60 * 1024 * 1024,
});

await app.register(cors, { origin: true });
await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 40 } });

/**
 * Reconstruye una hoja: lectura cruda + correcciones + clave vigente.
 *
 * Una hoja rechazada por código ilegible SÍ se proyecta, siempre que
 * alguien haya escrito el código a mano: sus respuestas estaban leídas
 * (ver PartialRead en analyzeSheet.ts) y la corrección le pone dueño. Sin
 * esa corrección devuelve null — la hoja sigue sin pertenecer a nadie.
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

async function sheetSummary(sheet: StoredSheet) {
  const projected = await project(sheet);
  return {
    id: sheet.id,
    fileName: sheet.fileName,
    pageIndex: sheet.pageIndex,
    createdAt: sheet.createdAt,
    outcome: sheet.outcome,
    projected,
  };
}

// ── Lotes ───────────────────────────────────────────────────────────────
app.post("/api/batches", async (req, reply) => {
  const body = z.object({ label: z.string().min(1).max(120) }).parse(req.body);
  const batch = await repo.createBatch({
    label: body.label,
    templateId: template.id,
    templateVersion: template.version,
  });
  return reply.code(201).send(batch);
});

app.get("/api/batches", async () => repo.listBatches());

app.get("/api/batches/:id", async (req, reply) => {
  const { id } = z.object({ id: z.string() }).parse(req.params);
  const batch = await repo.getBatch(id);
  if (!batch) return reply.code(404).send({ error: "Lote no encontrado" });

  const sheets = await repo.listSheets(id);
  const key = await repo.getCurrentAnswerKey(id);
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
});

/**
 * Progreso de subidas en curso, para que la interfaz pueda mostrar
 * "18 de 30 procesadas" en vez de un cartel mudo durante ~36 segundos.
 *
 * POR QUÉ UN MAPA EN MEMORIA Y NO ALGO PERSISTIDO: el progreso solo tiene
 * sentido mientras la petición está viva. Si el proceso se reinicia, la
 * subida se perdió igual — no hay nada que recuperar. Guardarlo en el log
 * de eventos ensuciaría un registro que existe para auditar notas, no
 * para estados efímeros de la interfaz.
 *
 * El cliente manda su propio `uploadId` y consulta un endpoint aparte
 * mientras la subida sigue abierta. Funciona incluso con UN archivo PDF de
 * 30 páginas, que es el caso más probable del escáner del colegio y el
 * único que no se puede resolver troceando del lado del cliente.
 */
interface UploadProgress {
  processed: number;
  /** null hasta que se termina de decodificar el primer archivo. */
  total: number | null;
  currentFile: string | null;
  done: boolean;
  updatedAt: number;
}
const uploadProgress = new Map<string, UploadProgress>();

/** Sin esto el mapa crecería para siempre: cada subida deja una entrada. */
const PROGRESS_TTL_MS = 5 * 60 * 1000;
function pruneProgress(): void {
  const cutoff = Date.now() - PROGRESS_TTL_MS;
  for (const [key, value] of uploadProgress) {
    if (value.updatedAt < cutoff) uploadProgress.delete(key);
  }
}

app.get("/api/uploads/:uploadId/progress", async (req, reply) => {
  const { uploadId } = z.object({ uploadId: z.string() }).parse(req.params);
  const progress = uploadProgress.get(uploadId);
  if (!progress) return reply.code(404).send({ error: "Subida no encontrada" });
  return progress;
});

// ── Subida y análisis ───────────────────────────────────────────────────
app.post("/api/batches/:id/sheets", async (req, reply) => {
  const { id } = z.object({ id: z.string() }).parse(req.params);
  const batch = await repo.getBatch(id);
  if (!batch) return reply.code(404).send({ error: "Lote no encontrado" });

  const uploadId = z.object({ uploadId: z.string().max(80).optional() })
    .parse(req.query).uploadId;
  pruneProgress();
  const progress: UploadProgress = {
    processed: 0, total: null, currentFile: null, done: false, updatedAt: Date.now(),
  };
  if (uploadId) uploadProgress.set(uploadId, progress);
  const tick = (patch: Partial<UploadProgress>): void => {
    Object.assign(progress, patch, { updatedAt: Date.now() });
  };

  const results: unknown[] = [];
  await mkdir(join(DATA_DIR, "uploads"), { recursive: true });

  for await (const part of req.parts()) {
    if (part.type !== "file") continue;
    const buffer = await part.toBuffer();
    // PROMPT.md §13.10: idempotencia por hash del archivo.
    const fileHash = createHash("sha256").update(buffer).digest("hex");
    const fileName = part.filename;
    tick({ currentFile: fileName });

    await writeFile(join(DATA_DIR, "uploads", `${fileHash}-${fileName}`), buffer);

    // §13.6: un archivo puede traer varias hojas (PDF multipágina).
    // El total se informa apenas se abre el archivo, sin esperar a que se
    // rasterice: para un PDF de 30 hojas eso es medio minuto de diferencia
    // entre ver "0 de 30" y ver un signo de pregunta.
    const pages = await loadPagesFromBuffer(buffer, fileName, (count) => {
      tick({ total: (progress.total ?? 0) + count });
    });

    for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
      const existing = await repo.findSheetByHash(id, fileHash, pageIndex);
      if (existing) {
        results.push({ fileName, pageIndex, status: "duplicate", sheetId: existing.id });
        req.log.info({ batchId: id, sheetId: existing.id, fileHash }, "hoja duplicada, se omite");
        // Una duplicada también avanza el contador: si no, la barra se
        // quedaría corta y parecería trabada al re-subir un archivo.
        tick({ processed: progress.processed + 1 });
        continue;
      }

      const outcome = await analyzeSheet(pages[pageIndex]!, template, DPI, {});
      const stored = await repo.appendSheet({
        batchId: id,
        fileHash,
        fileName,
        pageIndex,
        engineVersion: ENGINE_VERSION,
        outcome:
          outcome.kind === "processed"
            ? {
                kind: "processed",
                studentId: outcome.result.studentId,
                reprojectionErrorPx: outcome.result.reprojectionErrorPx,
                thresholdMethod: outcome.result.thresholdMethod,
                questions: outcome.result.questions,
                measurements: outcome.result.measurements,
              }
            : { kind: "rejected", reason: outcome.reason, partial: outcome.partial },
      });

      // §13.11: los logs llevan batchId y sheetId para poder depurar una
      // hoja entre mil.
      req.log.info(
        { batchId: id, sheetId: stored.id, outcome: outcome.kind, reason: outcome.kind === "rejected" ? outcome.reason : undefined },
        "hoja procesada"
      );
      results.push({ fileName, pageIndex, status: outcome.kind, sheetId: stored.id });
      tick({ processed: progress.processed + 1 });
    }
  }

  tick({ done: true, currentFile: null });
  return reply.code(201).send({ results });
});

// ── Detalle de hoja ─────────────────────────────────────────────────────
app.get("/api/sheets/:id", async (req, reply) => {
  const { id } = z.object({ id: z.string() }).parse(req.params);
  const sheet = await repo.getSheet(id);
  if (!sheet) return reply.code(404).send({ error: "Hoja no encontrada" });
  return {
    sheet,
    projected: await project(sheet),
    corrections: await repo.listCorrections(id),
  };
});

/**
 * La hoja escaneada, enderezada, con lo que el motor leyó dibujado encima
 * — PROMPT.md §8 ("salida visual siempre"). Es lo que permite al profesor
 * verificar de un vistazo que la lectura coincide con el papel, en vez de
 * confiar en una tabla de letras.
 *
 * CACHÉ EN DISCO, y no por optimización prematura: rehacer la geometría
 * (fiduciales + homografía + warp) cuesta ~1.2 s MEDIDOS. Sin caché, mirar
 * 30 hojas de un aula serían 36 segundos de espera pura. Se guarda la
 * imagen ALINEADA (lo caro) y el overlay se dibuja fresco en cada pedido
 * (lo barato), porque el overlay cambia cada vez que alguien corrige una
 * respuesta y una imagen cacheada con el overlay quedaría desactualizada.
 */
const ALIGNED_DIR = join(DATA_DIR, "aligned");

async function alignedImageOf(sheet: StoredSheet): Promise<GrayImage | null> {
  await mkdir(ALIGNED_DIR, { recursive: true });
  const cachePath = join(ALIGNED_DIR, `${sheet.id}.png`);

  if (existsSync(cachePath)) {
    const { data, info } = await sharp(cachePath)
      .grayscale().raw().toBuffer({ resolveWithObject: true });
    return { data: new Uint8Array(data), width: info.width, height: info.height };
  }

  const uploadPath = join(DATA_DIR, "uploads", `${sheet.fileHash}-${sheet.fileName}`);
  if (!existsSync(uploadPath)) return null;

  const pages = await loadPagesFromBuffer(await readFile(uploadPath), sheet.fileName);
  const page = pages[sheet.pageIndex];
  if (!page) return null;

  const geo = await analyzeGeometry(page, template, DPI);
  if (geo.kind === "rejected") return null;

  await sharp(Buffer.from(geo.normalized.data), {
    raw: { width: geo.normalized.width, height: geo.normalized.height, channels: 1 },
  }).png().toFile(cachePath);

  return geo.normalized;
}

app.get("/api/sheets/:id/image", async (req, reply) => {
  const { id } = z.object({ id: z.string() }).parse(req.params);
  const query = z.object({
    overlay: z.enum(["0", "1"]).default("1"),
    width: z.coerce.number().int().min(200).max(4000).optional(),
  }).parse(req.query);

  const sheet = await repo.getSheet(id);
  if (!sheet) return reply.code(404).send({ error: "Hoja no encontrada" });

  const aligned = await alignedImageOf(sheet);
  if (!aligned) {
    return reply.code(422).send({ error: "Esta hoja no se pudo enderezar para mostrarla" });
  }

  let pipeline;
  if (query.overlay === "1") {
    const projected = await project(sheet);
    const marks: ReadingMark[] = (projected?.questions ?? []).map((q) => ({
      groupId: `q.${q.ordinal}`,
      options: q.state.kind === "ANSWERED" ? [q.state.option]
        : q.state.kind === "MULTIPLE" ? q.state.options
        : [],
      // Una corrección manual ya no está "en duda": se muestra como leída,
      // que es lo que el profesor quiere confirmar al mirar la hoja.
      tone: q.state.kind === "ANSWERED" ? "read" : "review",
    }));
    const rgb = renderReadingOverlay(aligned, template, DPI, marks);
    pipeline = sharp(Buffer.from(rgb), {
      raw: { width: aligned.width, height: aligned.height, channels: 3 },
    });
  } else {
    pipeline = sharp(Buffer.from(aligned.data), {
      raw: { width: aligned.width, height: aligned.height, channels: 1 },
    });
  }

  if (query.width) pipeline = pipeline.resize({ width: query.width });
  const png = await pipeline.png({ compressionLevel: 6 }).toBuffer();

  // Sin caché HTTP: el overlay cambia con cada corrección y una imagen
  // vieja mostraría al profesor una lectura que ya no es la vigente.
  return reply.header("content-type", "image/png").header("cache-control", "no-store").send(png);
});

// ── Correcciones (append-only, §13.9) ───────────────────────────────────
const correctionBody = z.object({
  ordinal: z.number().int().positive().nullable(),
  resolvedAs: z.string().min(1).max(4).nullable(),
  resolvedStudentId: z.string().regex(/^\d{7}$/).optional(),
  reason: z.string().max(300).default("revisión manual"),
  createdBy: z.string().min(1).max(80).default("operador"),
});

app.post("/api/sheets/:id/corrections", async (req, reply) => {
  const { id } = z.object({ id: z.string() }).parse(req.params);
  const body = correctionBody.parse(req.body);
  const sheet = await repo.getSheet(id);
  if (!sheet) return reply.code(404).send({ error: "Hoja no encontrada" });
  // Una hoja rechazada admite que se le escriba el código a mano (ordinal
  // null) siempre que sus respuestas se hayan leído; lo que no admite es
  // corregir respuestas que nunca se llegaron a medir.
  if (sheet.outcome.kind === "rejected") {
    if (!sheet.outcome.partial) {
      return reply.code(400).send({ error: "Esta hoja no se pudo leer: no hay respuestas que corregir" });
    }
    if (body.ordinal !== null && !sheet.outcome.partial) {
      return reply.code(400).send({ error: "No se pueden corregir respuestas de una hoja rechazada" });
    }
  }
  if (body.ordinal === null && !body.resolvedStudentId) {
    return reply.code(400).send({ error: "Falta el código del alumno" });
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
    sheetId: id,
    ordinal: body.ordinal,
    resolvedAs: body.resolvedAs,
    resolvedStudentId: body.resolvedStudentId,
    previousValue: previous,
    reason: body.reason,
    createdBy: body.createdBy,
  });

  req.log.info({ batchId: sheet.batchId, sheetId: id, ordinal: body.ordinal }, "corrección registrada");
  return reply.code(201).send({ correction, projected: await project(sheet) });
});

// ── Clave de respuestas ─────────────────────────────────────────────────
const answerKeyBody = z.object({
  answers: z.record(z.string(), z.string().min(1).max(4)),
  voided: z.array(z.number().int().positive()).default([]),
  source: z.enum(["sheet", "manual", "import"]),
  sourceSheetId: z.string().optional(),
  createdBy: z.string().min(1).max(80).default("operador"),
});

app.post("/api/batches/:id/answer-key", async (req, reply) => {
  const { id } = z.object({ id: z.string() }).parse(req.params);
  const body = answerKeyBody.parse(req.body);
  const batch = await repo.getBatch(id);
  if (!batch) return reply.code(404).send({ error: "Lote no encontrado" });

  const answers: Record<number, string> = {};
  for (const [k, v] of Object.entries(body.answers)) answers[Number(k)] = v;

  const key = await repo.appendAnswerKey({
    batchId: id,
    answers,
    voided: body.voided,
    source: body.source,
    sourceSheetId: body.sourceSheetId,
    createdBy: body.createdBy,
  });
  req.log.info({ batchId: id, keyVersion: key.version, source: key.source }, "clave registrada");
  return reply.code(201).send(key);
});

app.get("/api/batches/:id/answer-keys", async (req) => {
  const { id } = z.object({ id: z.string() }).parse(req.params);
  return repo.listAnswerKeys(id);
});

/**
 * Lee una hoja patrón ya subida y devuelve sus respuestas como candidata a
 * clave — SIN activarla. Las preguntas que no se leyeron limpias vienen
 * marcadas para que una persona las confirme: una clave a medias calificaría
 * mal a todo el lote sin que nada parezca roto (mismo principio que §13.8).
 */
app.get("/api/sheets/:id/as-answer-key", async (req, reply) => {
  const { id } = z.object({ id: z.string() }).parse(req.params);
  const sheet = await repo.getSheet(id);
  if (!sheet) return reply.code(404).send({ error: "Hoja no encontrada" });
  if (sheet.outcome.kind !== "processed") {
    return reply.code(400).send({ error: "La hoja patrón no se pudo leer", reason: sheet.outcome.reason });
  }

  const answers: Record<number, string> = {};
  const unresolved: number[] = [];
  for (const q of sheet.outcome.questions) {
    if (q.state.kind === "ANSWERED") answers[q.ordinal] = q.state.option;
    else unresolved.push(q.ordinal);
  }
  return { sheetId: id, answers, unresolved, total: sheet.outcome.questions.length };
});

/**
 * Sirve la web ya construida (apps/web/dist) desde el mismo proceso.
 *
 * PROD_ONLY, deliberado: en desarrollo la web corre con `vite` (HMR) y su
 * propio proxy a /api — no tiene sentido servirla aquí también. Esto solo
 * se activa cuando existe un build, es decir, en el despliegue real.
 *
 * Un solo servicio en vez de dos (API + estático separado) es la elección
 * más simple para desplegar con costo 0: nada de CORS entre orígenes,
 * nada de una segunda cuenta/panel de hosting, una sola URL.
 */
const webDist = join(dirname(fileURLToPath(import.meta.url)), "..", "web", "dist");
if (existsSync(webDist)) {
  await app.register(staticFiles, { root: webDist });
  // SPA: cualquier ruta que no sea /api/* ni un archivo estático real cae
  // en index.html — esta app no navega por URL todavía, pero un refresh o
  // un enlace copiado no debe romperse con un 404 en blanco.
  app.setNotFoundHandler((req, reply) => {
    if (req.raw.url?.startsWith("/api/")) {
      return reply.code(404).send({ error: "No encontrado" });
    }
    return reply.sendFile("index.html");
  });
  app.log.info(`sirviendo web estática desde ${webDist}`);
}

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: "0.0.0.0" });
app.log.info(`API lista en http://localhost:${port} · datos en ${DATA_DIR}`);
