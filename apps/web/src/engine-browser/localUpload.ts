/**
 * localUpload.ts — equivalente en el navegador de POST /api/batches/:id/sheets.
 *
 * Mismos tres pasos que hace apps/api/server.ts, en el mismo orden: hashear
 * el archivo (idempotencia, PROMPT.md §13.10), analizarlo, guardar solo los
 * campos que corresponden — nunca `...outcome` completo, por lo mismo que
 * el servidor tampoco lo hace: `alignedImage` es pesada y no pertenece al
 * registro estructurado de la hoja, tiene su propio almacén.
 */

import { analyzeFile, type PageResult } from "./omrClient.ts";
import { grayImageToPngBlob } from "./sheetImageBrowser.ts";
import { IndexedDbRepository } from "./indexedDbRepository.ts";
import type { StoredSheet } from "../../../api/storage/types.ts";
import type { AnswerKey } from "../../../../packages/engine/scoring.ts";

async function sha256Hex(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface UploadResult {
  fileName: string;
  pageIndex: number;
  status: "processed" | "rejected" | "duplicate";
  sheetId: string;
}

export interface UploadCallbacks {
  onPageCount?: (total: number) => void;
  onPageDone?: (result: UploadResult) => void;
}

export async function uploadFileLocal(
  repo: IndexedDbRepository,
  batchId: string,
  file: File,
  answerKey: AnswerKey,
  callbacks: UploadCallbacks = {}
): Promise<UploadResult[]> {
  const fileHash = await sha256Hex(file);

  // El worker entrega las páginas en orden a medida que las termina, pero
  // acá solo se JUNTAN (síncrono) — nada de trabajo async dentro del
  // callback. Recién cuando analyzeFile() resolvió (todas ya llegaron) se
  // procesan una por una, en orden, sin condiciones de carrera.
  const pages: PageResult[] = [];
  await analyzeFile(file, answerKey, {
    onPageCount: callbacks.onPageCount,
    onPage: (page) => pages.push(page),
  });

  const results: UploadResult[] = [];
  for (const { pageIndex, outcome } of pages) {
    const existing = await repo.findSheetByHash(batchId, fileHash, pageIndex);
    if (existing) {
      results.push({ fileName: file.name, pageIndex, status: "duplicate", sheetId: existing.id });
      callbacks.onPageDone?.(results[results.length - 1]!);
      continue;
    }

    const stored: Omit<StoredSheet, "id" | "createdAt"> = {
      batchId,
      fileHash,
      fileName: file.name,
      pageIndex,
      engineVersion: "0.1.0",
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
    };

    const sheet = await repo.appendSheet(stored);

    if (outcome.alignedImage) {
      const png = await grayImageToPngBlob(outcome.alignedImage);
      await repo.putSheetImage(sheet.id, png);
    }

    const result: UploadResult = { fileName: file.name, pageIndex, status: outcome.kind, sheetId: sheet.id };
    results.push(result);
    callbacks.onPageDone?.(result);
  }

  return results;
}
