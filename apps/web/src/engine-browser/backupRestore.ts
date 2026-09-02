/**
 * backupRestore.ts — la red de seguridad de guardar todo en el navegador.
 *
 * PROBLEMA QUE RESUELVE: con IndexedDB, los datos viven en ESE navegador,
 * en ESA computadora. Si el profesor limpia la caché, cambia de máquina, o
 * el disco se llena y el navegador decide liberar espacio, las notas
 * desaparecen sin aviso. Esto no es hipotético — es el costo explícito de
 * elegir "guardar local ahora, Supabase más adelante" en vez de un
 * servidor con base de datos real.
 *
 * La mitigación: un archivo que el profesor puede descargar y guardar
 * donde quiera (USB, correo, Drive), y volver a cargar si el navegador
 * pierde los datos.
 *
 * ALCANCE DECLARADO, NO UN DESCUIDO: el respaldo NO incluye las imágenes
 * de "Ver hoja" (el PNG alineado de cada hoja). Son el dato más pesado
 * (~1-2MB por hoja) y el menos crítico — perder la posibilidad de ver el
 * papel de nuevo es mucho menos grave que perder las respuestas y notas.
 * Incluirlas multiplicaría el tamaño del archivo por muy poco beneficio
 * real. Si hace falta recuperar "Ver hoja" después de restaurar, hoy no
 * hay forma automática — queda como límite conocido, no oculto.
 */

import type { Batch, StoredSheet, StoredAnswerKey, StoredCorrection } from "../../../api/storage/types.ts";
import type { IndexedDbRepository } from "./indexedDbRepository.ts";

const FORMAT_VERSION = 1;

interface BackupFile {
  formatVersion: number;
  exportedAt: string;
  batch: Batch;
  sheets: StoredSheet[];
  answerKeys: StoredAnswerKey[];
  corrections: StoredCorrection[];
}

/** Nombre de archivo sugerido: incluye el nombre del lote y la fecha, para
 * que varios respaldos del mismo colegio no se confundan entre sí en la
 * carpeta de Descargas. */
export function backupFileName(batch: Batch): string {
  const safeLabel = batch.label.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
  const date = new Date().toISOString().slice(0, 10);
  return `respaldo-${safeLabel}-${date}.json`;
}

export async function exportBatchBackup(
  batchId: string, repo: IndexedDbRepository
): Promise<Blob> {
  const batch = await repo.getBatch(batchId);
  if (!batch) throw new Error("Lote no encontrado");

  const [sheets, answerKeys, corrections] = await Promise.all([
    repo.listSheets(batchId),
    repo.listAnswerKeys(batchId),
    repo.listCorrectionsForBatch(batchId),
  ]);

  const backup: BackupFile = {
    formatVersion: FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    batch, sheets, answerKeys, corrections,
  };

  return new Blob([JSON.stringify(backup, null, 1)], { type: "application/json" });
}

/**
 * Restaura un respaldo completo, preservando cada `id` y `createdAt`
 * original — no se genera nada nuevo, se reinserta tal cual estaba.
 *
 * RECHAZA si el lote ya existe en este navegador, a propósito: sin esta
 * guarda, volver a cargar un respaldo viejo por error sobrescribiría en
 * silencio correcciones o una clave más reciente que las del archivo. Es
 * la misma cautela que ya se aplicó en otras partes del sistema — nunca
 * una operación que pueda destruir trabajo más nuevo sin que nadie lo pida
 * a propósito.
 */
export async function importBatchBackup(
  file: File, repo: IndexedDbRepository
): Promise<Batch> {
  let backup: BackupFile;
  try {
    backup = JSON.parse(await file.text());
  } catch {
    throw new Error(`'${file.name}' no es un respaldo válido (no se pudo leer como JSON)`);
  }

  if (backup.formatVersion !== FORMAT_VERSION || !backup.batch || !Array.isArray(backup.sheets)) {
    throw new Error(`'${file.name}' no tiene el formato de un respaldo de esta aplicación`);
  }

  const existing = await repo.getBatch(backup.batch.id);
  if (existing) {
    throw new Error(
      `El lote "${existing.label}" ya existe en este navegador — restaurar lo sobrescribiría. ` +
      `Si de verdad querés reemplazarlo, hay que borrarlo primero.`
    );
  }

  // Orden deliberado: el lote primero (las hojas lo referencian por
  // batchId), después hojas y claves, correcciones al final — así una
  // falla a mitad de camino nunca deja una corrección apuntando a una hoja
  // que no llegó a restaurarse.
  await repo.restoreBatch(backup.batch);
  for (const sheet of backup.sheets) await repo.restoreSheet(sheet);
  for (const key of backup.answerKeys) await repo.restoreAnswerKey(key);
  for (const correction of backup.corrections) await repo.restoreCorrection(correction);

  return backup.batch;
}
