/**
 * exportGrades.ts — sacar las notas de la aplicación hacia los registros
 * del colegio. Sin esto, calificar acá no serviría de mucho: las notas
 * quedarían atrapadas adentro, sin forma de llevarlas a Excel ni al
 * sistema administrativo del colegio.
 *
 * Dos detalles del formato, ninguno arbitrario:
 *
 *   Separador ";" en vez de ",": Excel en español (configuración regional
 *   de Perú incluida) usa la coma como separador DECIMAL, así que interpreta
 *   un CSV separado por comas como una sola columna gigante. Punto y coma
 *   es el separador que Excel en español espera de un archivo CSV.
 *
 *   BOM UTF-8 al principio: sin él, Excel en Windows asume ANSI/Latin-1 y
 *   rompe cualquier tilde o "ñ" (vocales de "Comunicación", por ejemplo).
 *   Firefox y Chrome ya escriben UTF-8 sin pensarlo; Excel es el que
 *   necesita la pista explícita.
 */

import type { BatchDetail, SheetSummary } from "./localClient.ts";

function csvEscape(value: string): string {
  // Comillas si el valor trae el separador, comillas, o salto de línea —
  // regla estándar de CSV (RFC 4180), no específica de este archivo.
  if (/[";\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function row(fields: (string | number)[]): string {
  return fields.map((f) => csvEscape(String(f))).join(";");
}

/**
 * Una fila por hoja, INCLUSO las que no tienen dueño todavía o siguen con
 * preguntas pendientes — quedan visibles con su estado en vez de
 * desaparecer del archivo. Un profesor que solo mira el CSV tiene que poder
 * notar "faltan 3 alumnos" sin volver a abrir la aplicación.
 */
export function gradesToCsv(detail: BatchDetail): Blob {
  const header = row(["Código de alumno", "Estado", "Correctas", "Incorrectas", "En blanco", "A revisión", "Nota", "Archivo"]);
  const lines = [header];

  for (const sheet of detail.sheets) {
    lines.push(row(gradeRowFields(sheet)));
  }

  // \uFEFF: el BOM UTF-8, escapado explícito y no como carácter literal
  // invisible en el archivo — así ningún editor o herramienta futura puede
  // corromperlo sin que se note en el diff.
  const csv = "\uFEFF" + lines.join("\r\n") + "\r\n";
  return new Blob([csv], { type: "text/csv;charset=utf-8" });
}

function gradeRowFields(sheet: SheetSummary): (string | number)[] {
  const p = sheet.projected;
  if (!p) {
    const reason = sheet.outcome.kind === "rejected" ? sheet.outcome.reason : "desconocido";
    return ["—", `Rechazada (${reason})`, "", "", "", "", "", sheet.fileName];
  }

  const pending = p.pendingOrdinals.length;
  const estado = pending > 0 ? `${pending} pendiente(s)` : "Calificada";
  const nota = p.grade && pending === 0 ? p.grade.value : "";

  return [
    p.studentId || "—",
    estado,
    p.score.correct,
    p.score.incorrect,
    p.blankOrdinals.length,
    pending,
    nota,
    sheet.fileName,
  ];
}

/** Dispara la descarga del navegador — no hay otra forma de "guardar
 * archivo" desde JS sin un backend: se simula el clic en un enlace. */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  // Se revoca en el siguiente tick, no de inmediato: algunos navegadores
  // (Firefox en particular) inician la descarga de forma asíncrona y
  // revocar la URL demasiado pronto la corta a mitad de camino.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
