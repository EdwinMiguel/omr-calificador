/**
 * indexedDbRepository.ts — implementación de `Repository` sobre IndexedDB.
 *
 * Es la MISMA interfaz que ya cumple `FileRepository` del lado servidor
 * (apps/api/storage/fileRepo.ts, JSONL en disco) — ver types.ts, Repository.
 * Ningún método nuevo, ninguna forma distinta: lo único que cambia es dónde
 * viven los datos. El resto del sistema (proyección, vistas) no tiene por
 * qué enterarse de cuál de las dos está usando.
 *
 * POR QUÉ NO ES "SOLO ARCHIVAR EL JSONL EN EL NAVEGADOR": localStorage podría
 * guardar texto, pero tiene un tope de ~5MB y no maneja binarios — las
 * imágenes alineadas (necesarias para "Ver hoja") no entrarían. IndexedDB
 * maneja cientos de MB y guarda objetos (incluidos Blobs) directamente, sin
 * pasar por JSON.
 *
 * Un almacén aparte, `images`, guarda el PNG de cada hoja — deliberadamente
 * FUERA de la interfaz `Repository`: el servidor tampoco lo mete ahí (cachea
 * PNGs en disco por su cuenta, ver alignedImageOf() en server.ts). Mismo
 * principio en los dos lados: datos estructurados por un camino, binarios
 * pesados por otro.
 */

import type {
  Repository, Batch, StoredSheet, StoredAnswerKey, StoredCorrection,
} from "../../../api/storage/types.ts";

const DB_NAME = "omr-calificador";
const DB_VERSION = 1;

const STORES = {
  batches: "batches",
  sheets: "sheets",
  answerKeys: "answerKeys",
  corrections: "corrections",
  images: "images",
} as const;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      const batches = db.createObjectStore(STORES.batches, { keyPath: "id" });
      batches.createIndex("createdAt", "createdAt");

      const sheets = db.createObjectStore(STORES.sheets, { keyPath: "id" });
      sheets.createIndex("batchId", "batchId");
      // findSheetByHash necesita ubicar por (lote, hash, página) — índice
      // compuesto en vez de recorrer todas las hojas del lote a mano.
      sheets.createIndex("byHashPage", ["batchId", "fileHash", "pageIndex"]);

      const keys = db.createObjectStore(STORES.answerKeys, { keyPath: "id" });
      keys.createIndex("batchId", "batchId");

      const corrections = db.createObjectStore(STORES.corrections, { keyPath: "id" });
      corrections.createIndex("sheetId", "sheetId");

      // Sin keyPath propio: la clave ES el sheetId, uno-a-uno.
      db.createObjectStore(STORES.images);
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Envuelve una transacción de un solo almacén en una Promise — IndexedDB es
 * callback-based por diseño (API de 2010), esto es lo único que hace falta
 * para poder usar await con normalidad en el resto del archivo. */
function tx<T>(
  db: IDBDatabase, store: string, mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function uuid(): string {
  return crypto.randomUUID();
}

export class IndexedDbRepository implements Repository {
  private dbPromise: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) this.dbPromise = openDb();
    return this.dbPromise;
  }

  // ── Lotes ────────────────────────────────────────────────────────────

  async createBatch(b: Omit<Batch, "id" | "createdAt">): Promise<Batch> {
    const batch: Batch = { ...b, id: uuid(), createdAt: new Date().toISOString() };
    const db = await this.db();
    await tx(db, STORES.batches, "readwrite", (s) => s.add(batch));
    return batch;
  }

  async listBatches(): Promise<Batch[]> {
    const db = await this.db();
    const all = await tx<Batch[]>(db, STORES.batches, "readonly", (s) => s.getAll());
    return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async getBatch(id: string): Promise<Batch | null> {
    const db = await this.db();
    const found = await tx<Batch | undefined>(db, STORES.batches, "readonly", (s) => s.get(id));
    return found ?? null;
  }

  // ── Hojas ────────────────────────────────────────────────────────────

  async findSheetByHash(batchId: string, fileHash: string, pageIndex: number): Promise<StoredSheet | null> {
    const db = await this.db();
    const found = await new Promise<StoredSheet | undefined>((resolve, reject) => {
      const t = db.transaction(STORES.sheets, "readonly");
      const idx = t.objectStore(STORES.sheets).index("byHashPage");
      const req = idx.get([batchId, fileHash, pageIndex]);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return found ?? null;
  }

  async appendSheet(s: Omit<StoredSheet, "id" | "createdAt">): Promise<StoredSheet> {
    const sheet: StoredSheet = { ...s, id: uuid(), createdAt: new Date().toISOString() };
    const db = await this.db();
    await tx(db, STORES.sheets, "readwrite", (st) => st.add(sheet));
    return sheet;
  }

  async listSheets(batchId: string): Promise<StoredSheet[]> {
    const db = await this.db();
    const all = await new Promise<StoredSheet[]>((resolve, reject) => {
      const t = db.transaction(STORES.sheets, "readonly");
      const idx = t.objectStore(STORES.sheets).index("batchId");
      const req = idx.getAll(batchId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async getSheet(id: string): Promise<StoredSheet | null> {
    const db = await this.db();
    const found = await tx<StoredSheet | undefined>(db, STORES.sheets, "readonly", (s) => s.get(id));
    return found ?? null;
  }

  // ── Clave de respuestas ──────────────────────────────────────────────

  async appendAnswerKey(
    k: Omit<StoredAnswerKey, "id" | "version" | "createdAt">
  ): Promise<StoredAnswerKey> {
    const previous = await this.listAnswerKeys(k.batchId);
    const key: StoredAnswerKey = {
      ...k, id: uuid(), version: previous.length + 1, createdAt: new Date().toISOString(),
    };
    const db = await this.db();
    await tx(db, STORES.answerKeys, "readwrite", (s) => s.add(key));
    return key;
  }

  async listAnswerKeys(batchId: string): Promise<StoredAnswerKey[]> {
    const db = await this.db();
    const all = await new Promise<StoredAnswerKey[]>((resolve, reject) => {
      const t = db.transaction(STORES.answerKeys, "readonly");
      const idx = t.objectStore(STORES.answerKeys).index("batchId");
      const req = idx.getAll(batchId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return all.sort((a, b) => a.version - b.version);
  }

  async getCurrentAnswerKey(batchId: string): Promise<StoredAnswerKey | null> {
    const keys = await this.listAnswerKeys(batchId);
    return keys.length > 0 ? keys[keys.length - 1]! : null;
  }

  // ── Correcciones ─────────────────────────────────────────────────────

  async appendCorrection(c: Omit<StoredCorrection, "id" | "createdAt">): Promise<StoredCorrection> {
    const correction: StoredCorrection = { ...c, id: uuid(), createdAt: new Date().toISOString() };
    const db = await this.db();
    await tx(db, STORES.corrections, "readwrite", (s) => s.add(correction));
    return correction;
  }

  async listCorrections(sheetId: string): Promise<StoredCorrection[]> {
    const db = await this.db();
    const all = await new Promise<StoredCorrection[]>((resolve, reject) => {
      const t = db.transaction(STORES.corrections, "readonly");
      const idx = t.objectStore(STORES.corrections).index("sheetId");
      const req = idx.getAll(sheetId);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async listCorrectionsForBatch(batchId: string): Promise<StoredCorrection[]> {
    const sheetIds = new Set((await this.listSheets(batchId)).map((s) => s.id));
    const db = await this.db();
    const all = await tx<StoredCorrection[]>(db, STORES.corrections, "readonly", (s) => s.getAll());
    return all
      .filter((c) => sheetIds.has(c.sheetId))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  // ── Imágenes (fuera de Repository, igual que en el servidor) ────────

  /** Guarda el PNG de la hoja alineada. Se llama una vez, cuando el motor
   * termina de analizarla — nunca se vuelve a calcular después. */
  async putSheetImage(sheetId: string, png: Blob): Promise<void> {
    const db = await this.db();
    await tx(db, STORES.images, "readwrite", (s) => s.put(png, sheetId));
  }

  async getSheetImage(sheetId: string): Promise<Blob | null> {
    const db = await this.db();
    const found = await tx<Blob | undefined>(db, STORES.images, "readonly", (s) => s.get(sheetId));
    return found ?? null;
  }
}
