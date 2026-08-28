/**
 * identification.ts — Día 11: decodificar el código del alumno a partir
 * del grid de dígitos.
 *
 * No inventa un dígito dudoso: si CUALQUIER columna no decodifica con
 * confianza (BLANK/AMBIGUOUS/MULTIPLE), el código completo se considera
 * no legible — un ID parcialmente adivinado es peor que ninguno, porque
 * asigna la hoja a un alumno equivocado en vez de mandarla a revisión.
 */

import type { BubbleGroup } from "../../template.ts";
import { classify, type ClassificationState } from "./classification.ts";
import type { LabeledFill } from "./classification.ts";

export interface DigitColumnRead {
  ordinal: number;
  printedLabel: string;
  state: ClassificationState;
}

export interface IdentificationResult {
  /** El código completo, o null si alguna columna no se pudo leer con confianza. */
  value: string | null;
  columns: DigitColumnRead[];
}

/**
 * @param digitGroups los grupos `kind: "digit"` del código de alumno (NO
 * incluye examGrid/version si el Template los tuviera — el llamador filtra).
 * @param fillFn calcula los fillRatios normalizados de un grupo — inyectado
 * para no acoplar este módulo a measurement.ts/calibration.ts directamente
 * (identification.ts no hace I/O ni sabe de imágenes, solo de Bubble/Template).
 */
export function decodeDigitGrid(
  digitGroups: BubbleGroup[],
  fillFn: (group: BubbleGroup) => LabeledFill[]
): IdentificationResult {
  const sorted = [...digitGroups].sort((a, b) => a.ordinal - b.ordinal);
  const columns: DigitColumnRead[] = sorted.map((g) => ({
    ordinal: g.ordinal,
    printedLabel: g.printedLabel,
    state: classify(fillFn(g)),
  }));

  const allClean = columns.every((c) => c.state.kind === "ANSWERED");
  const value = allClean
    ? columns.map((c) => (c.state as { kind: "ANSWERED"; option: string }).option).join("")
    : null;

  return { value, columns };
}
