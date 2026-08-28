/**
 * classification.ts — Día 9: convertir números en decisiones conservadoras.
 *
 * Recibe fillRatios ya NORMALIZADOS por hoja (calibration.ts) — nunca
 * crudos, porque "0.45" no significa nada sin saber contra qué hoja se
 * midió. Clasificación conservadora (PROMPT.md §13.1): ninguna guarda
 * `else` que adivine — lo no resuelto limpiamente cae en AMBIGUOUS.
 */

export type ClassificationState =
  | { kind: "ANSWERED"; option: string }
  | { kind: "BLANK" }
  | { kind: "MULTIPLE"; options: string[] }
  | { kind: "AMBIGUOUS" };

/**
 * Los tres umbrales nombrados que exige PROMPT.md §7 — con su origen y su
 * estado explícitos, no números mágicos.
 *
 * RECALIBRADOS CON EVIDENCIA REAL (foto-11.jpeg, hoja marcada casi
 * completa, 100 preguntas): para cada pregunta se tomó el valor más alto
 * de sus 5 opciones (≈marca real, dado que casi todo estaba marcado) y
 * también los otros 4 valores de cada pregunta (≈papel en blanco real,
 * 400 muestras). Los dos grupos SE SUPERPONEN — hay marcas reales tan
 * débiles como 0.016 y "blancos" tan ruidosos como 0.228 — así que ningún
 * corte separa el 100% de los casos; eso es justamente evidencia real,
 * no una falla de calibración.
 *
 *   MARK_MIN=0.25  → 0 de 400 valores "blanco" lo cruzan (máximo real
 *                    observado: 0.228) — cero falsos positivos, prioridad
 *                    del proyecto (§15, AUTO_ACCEPTED_INCORRECT=0).
 *   BLANK_MAX=0.15 → por debajo, el percentil 90 de los "blancos" reales
 *                    (0.139) — la franja 0.15-0.25 queda deliberadamente
 *                    como zona de incertidumbre real (AMBIGUOUS), no un
 *                    error: en esta calidad de foto, una parte de las
 *                    marcas genuinamente débiles no se puede distinguir
 *                    con confianza de una mancha, y eso tiene que ir a
 *                    revisión manual, no a un lado o al otro por default.
 *
 * El valor original (MARK_MIN=0.5) asumía que una marca de lápiz se
 * acerca a la densidad óptica de la tinta de impresora de los parches de
 * calibración — medido: NO es así, ni de cerca (ver la nota extensa sobre
 * esto en fiducials.ts, mismo hallazgo). CALIBRAR de nuevo si cambia la
 * calidad de foto esperada (luz, enfoque, resolución) o el grosor de
 * burbuja del template.
 */
export const BLANK_MAX = 0.15;
export const MARK_MIN = 0.25;
export const MARGIN_MIN = 0.08;

export interface LabeledFill {
  label: string;
  normalized: number;
}

/**
 * MEDIDO — bug real, no teórico: la primera versión llamaba MULTIPLE en
 * cuanto DOS burbujas cruzaban MARK_MIN, sin mirar qué tan lejos estaban
 * entre sí. En columnas de dígito (10 opciones, más candidatos que en una
 * pregunta de 5) esto disparaba falsos MULTIPLE: la marca real a 0.71 y un
 * segundo candidato con ruido a 0.41 — ambos por encima de 0.25, pero con
 * una brecha de 0.30 entre sí, nada parecido a una doble marca real (que
 * debería verse pareja, no con un ganador claro). Una doble marca genuina
 * y "una marca clara + ruido secundario que también cruzó el umbral" son
 * distinguibles por lo mismo: qué tan CERCA está el 2º lugar del 1º — no
 * si el 2º cruzó independientemente la misma línea fija que el 1º.
 */
function classifyByMargin(sorted: LabeledFill[]): ClassificationState {
  const top = sorted[0]!;
  const second = sorted[1];

  if (top.normalized < BLANK_MAX) return { kind: "BLANK" };
  if (top.normalized < MARK_MIN) return { kind: "AMBIGUOUS" };

  if (second && top.normalized - second.normalized < MARGIN_MIN) {
    // El 2º está pisándole los talones al 1º: o los dos son marca real
    // (pareja, ambos oscuros) o el 1º gana por muy poco para confiar.
    if (second.normalized >= MARK_MIN) {
      return { kind: "MULTIPLE", options: [top.label, second.label] };
    }
    return { kind: "AMBIGUOUS" };
  }

  return { kind: "ANSWERED", option: top.label };
}

/**
 * @param bubbles fillRatios ya normalizados (calibration.ts::normalize),
 * uno por burbuja del grupo (las 5 opciones de una pregunta, o los 10
 * dígitos de una columna de código).
 */
export function classify(bubbles: LabeledFill[]): ClassificationState {
  const sorted = [...bubbles].sort((a, b) => b.normalized - a.normalized);
  return classifyByMargin(sorted);
}
