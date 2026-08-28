/**
 * fileRepo.ts — persistencia append-only sobre un archivo JSONL.
 *
 * POR QUÉ ASÍ, y no Postgres todavía: el stack declarado (PROMPT.md §4) es
 * PostgreSQL/Supabase, y esta implementación NO lo reemplaza — se sienta
 * detrás de la interfaz `Repository` justamente para que el adaptador SQL
 * entre como reemplazo directo sin tocar rutas ni UI. Se eligió esto para
 * el MVP porque provisionar una base es una decisión del cliente (cuenta,
 * costo, dónde vive el dato de los alumnos) y Gate 4 no depende de ella.
 *
 * Lo que sí aporta de verdad: §13.9 pide append-only "ningún UPDATE/DELETE".
 * Un log JSONL cumple eso POR CONSTRUCCIÓN — la única operación de escritura
 * que existe es `appendFile`. En SQL el append-only es una convención que
 * alguien puede romper con un UPDATE distraído; aquí es imposible.
 *
 * Límite conocido y aceptado: todo el log se lee a memoria al arrancar.
 * Con miles de hojas es correcto; con cientos de miles habría que migrar al
 * adaptador SQL — que es exactamente el punto de tener la interfaz.
 */

import { appendFile, readFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Repository, Batch, StoredSheet, StoredAnswerKey, StoredCorrection,
} from "./types.ts";

type Event =
  | { type: "batch"; data: Batch }
  | { type: "sheet"; data: StoredSheet }
  | { type: "answerKey"; data: StoredAnswerKey }
  | { type: "correction"; data: StoredCorrection };

export class FileRepository implements Repository {
  private events: Event[] = [];
  private loaded = false;

  constructor(private readonly path: string) {}

  private async load(): Promise<void> {
    if (this.loaded) return;
    await mkdir(dirname(this.path), { recursive: true });
    if (existsSync(this.path)) {
      const raw = await readFile(this.path, "utf8");
      this.events = raw
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l) as Event);
    }
    this.loaded = true;
  }

  /** La ÚNICA operación de escritura de toda la clase. */
  private async append(event: Event): Promise<void> {
    await this.load();
    this.events.push(event);
    await appendFile(this.path, JSON.stringify(event) + "\n", "utf8");
  }

  private async all(type: "batch"): Promise<Batch[]>;
  private async all(type: "sheet"): Promise<StoredSheet[]>;
  private async all(type: "answerKey"): Promise<StoredAnswerKey[]>;
  private async all(type: "correction"): Promise<StoredCorrection[]>;
  private async all(type: Event["type"]): Promise<unknown[]> {
    await this.load();
    return this.events.filter((e) => e.type === type).map((e) => e.data);
  }

  async createBatch(b: Omit<Batch, "id" | "createdAt">): Promise<Batch> {
    const batch: Batch = { ...b, id: randomUUID(), createdAt: new Date().toISOString() };
    await this.append({ type: "batch", data: batch });
    return batch;
  }

  async listBatches(): Promise<Batch[]> {
    return (await this.all("batch")).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getBatch(id: string): Promise<Batch | null> {
    return (await this.all("batch")).find((b) => b.id === id) ?? null;
  }

  async findSheetByHash(batchId: string, fileHash: string, pageIndex: number): Promise<StoredSheet | null> {
    return (await this.all("sheet")).find(
      (s) => s.batchId === batchId && s.fileHash === fileHash && s.pageIndex === pageIndex
    ) ?? null;
  }

  async appendSheet(s: Omit<StoredSheet, "id" | "createdAt">): Promise<StoredSheet> {
    const sheet: StoredSheet = { ...s, id: randomUUID(), createdAt: new Date().toISOString() };
    await this.append({ type: "sheet", data: sheet });
    return sheet;
  }

  async listSheets(batchId: string): Promise<StoredSheet[]> {
    return (await this.all("sheet"))
      .filter((s) => s.batchId === batchId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getSheet(id: string): Promise<StoredSheet | null> {
    return (await this.all("sheet")).find((s) => s.id === id) ?? null;
  }

  async appendAnswerKey(k: Omit<StoredAnswerKey, "id" | "version" | "createdAt">): Promise<StoredAnswerKey> {
    const previous = await this.listAnswerKeys(k.batchId);
    const key: StoredAnswerKey = {
      ...k,
      id: randomUUID(),
      version: previous.length + 1,
      createdAt: new Date().toISOString(),
    };
    await this.append({ type: "answerKey", data: key });
    return key;
  }

  async listAnswerKeys(batchId: string): Promise<StoredAnswerKey[]> {
    return (await this.all("answerKey"))
      .filter((k) => k.batchId === batchId)
      .sort((a, b) => a.version - b.version);
  }

  /** La vigente es la de mayor versión — las anteriores no se borran. */
  async getCurrentAnswerKey(batchId: string): Promise<StoredAnswerKey | null> {
    const keys = await this.listAnswerKeys(batchId);
    return keys.length > 0 ? keys[keys.length - 1]! : null;
  }

  async appendCorrection(c: Omit<StoredCorrection, "id" | "createdAt">): Promise<StoredCorrection> {
    const correction: StoredCorrection = {
      ...c, id: randomUUID(), createdAt: new Date().toISOString(),
    };
    await this.append({ type: "correction", data: correction });
    return correction;
  }

  async listCorrections(sheetId: string): Promise<StoredCorrection[]> {
    return (await this.all("correction"))
      .filter((c) => c.sheetId === sheetId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async listCorrectionsForBatch(batchId: string): Promise<StoredCorrection[]> {
    const sheetIds = new Set((await this.listSheets(batchId)).map((s) => s.id));
    return (await this.all("correction"))
      .filter((c) => sheetIds.has(c.sheetId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
}
