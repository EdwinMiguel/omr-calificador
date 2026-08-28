/**
 * measurement.ts — Día 8: cuánta tinta hay en cada burbuja.
 *
 * Problema:  ya sabemos DÓNDE está cada burbuja (bubbleRoi(), Día 1) sobre
 *            la imagen normalizada (Día 7). Falta saber CUÁNTA tinta hay
 *            ahí — el número crudo que la clasificación (Día 9) va a
 *            convertir en ANSWERED/BLANK/MULTIPLE/AMBIGUOUS.
 * Concepto:  fillRatio — el promedio de oscuridad dentro del ROI, en
 *            [0,1]. 0 = papel blanco puro, 1 = negro puro. Es continuo a
 *            propósito: la CLASIFICACIÓN es la que decide con umbrales
 *            nombrados dónde cae el corte (Día 9) — measurement.ts nunca
 *            decide "marcada o no", solo mide.
 * Por qué:   PROMPT.md §6 exige guardar "los fillRatios crudos" en todo
 *            SheetResult, para poder reevaluar el histórico si cambian
 *            los umbrales sin tener que re-escanear nada.
 */

import type { GrayImage } from "./types.ts";

/**
 * @param roi en PÍXELES de la imagen normalizada (ya convertido desde mm
 * con bubbleRoi() + mmToPx del template.ts — measurement.ts no conoce mm).
 */
export function fillRatio(image: GrayImage, roi: { x: number; y: number; w: number; h: number }): number {
  const x0 = Math.max(0, roi.x);
  const y0 = Math.max(0, roi.y);
  const x1 = Math.min(image.width, roi.x + roi.w);
  const y1 = Math.min(image.height, roi.y + roi.h);

  let sum = 0;
  let count = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      sum += 255 - image.data[y * image.width + x]!;
      count++;
    }
  }

  if (count === 0) {
    throw new Error(`ROI fuera de la imagen: ${JSON.stringify(roi)} contra ${image.width}x${image.height}`);
  }
  return sum / (count * 255);
}

export type RoiPx = { x: number; y: number; w: number; h: number };

/**
 * MEDIDO — foto real, dataset de hojas marcadas: barriendo el ROI nominal
 * de una burbuja conocida-marcada en un radio de ±20px, el pico real de
 * tinta aparecía consistentemente desplazado 8-15px del centro que el
 * Template predice — no en una sola burbuja, en varias, y con magnitud
 * variable según la zona de la página (más en unas, casi nulo en otras).
 * Es compatible con distorsión de lente residual (una homografía pura
 * corrige perspectiva, no la curvatura de una lente de celular) más el
 * error normal de una mano llenando un círculo sin apuntar al milímetro.
 *
 * SEARCH_RADIUS_PX: hasta dónde se permite buscar el pico antes de
 * rendirse y usar el centro nominal. CALIBRAR si aparecen fotos con
 * desfases mayores — por ahora cubre lo observado (máximo visto: 15px).
 */
const SEARCH_RADIUS_PX = 15;
const SEARCH_STEP_PX = 2;

/**
 * Como fillRatio(), pero busca el máximo en una ventana alrededor del ROI
 * nominal en vez de confiar en que el centro cae exacto — ver la nota de
 * SEARCH_RADIUS_PX. Se aplica IGUAL a toda burbuja (marcada o no): así la
 * comparación entre opciones de una misma pregunta sigue siendo justa, no
 * se le da ventaja solo a la que se está buscando.
 */
export function fillRatioNearby(
  image: GrayImage, roi: { x: number; y: number; w: number; h: number }, radius = SEARCH_RADIUS_PX
): number {
  let best = -Infinity;
  for (let dy = -radius; dy <= radius; dy += SEARCH_STEP_PX) {
    for (let dx = -radius; dx <= radius; dx += SEARCH_STEP_PX) {
      const r = fillRatio(image, { x: roi.x + dx, y: roi.y + dy, w: roi.w, h: roi.h });
      if (r > best) best = r;
    }
  }
  return best;
}

/** Para el overlay de debug (08-rois.png): el rectángulo de muestreo, no
 * solo su fillRatio, para poder ver a ojo si el encogimiento (Día 1,
 * bubbleRoi shrink=0.8) cae adentro del círculo impreso o se le sale. */
export interface BubbleMeasurement {
  groupId: string;
  bubbleLabel: string;
  roi: RoiPx;
  fillRatio: number;
}
