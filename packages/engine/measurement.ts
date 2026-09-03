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
 * de una burbuja conocida-marcada, el pico real de tinta aparece desplazado
 * del centro que el Template predice — no en una sola burbuja, en varias, y
 * con magnitud variable según la zona de la página. Es compatible con
 * distorsión de lente residual (una homografía pura corrige perspectiva, no
 * la curvatura de una lente de celular) más el error normal de una mano
 * llenando un círculo sin apuntar al milímetro.
 *
 * SEARCH_RADIUS_PX: hasta dónde se permite buscar el pico.
 *
 * ── 15 → 8 (2026-09-03), medido, no estimado ────────────────────────────
 *
 * La primera versión usaba 15 px, tomado del máximo desfase observado a ojo
 * en unas pocas burbujas. Al medir el desfase del máximo sobre TODAS las
 * marcas de alta confianza de las 12 hojas alineadas, la componente
 * sistemática resultó bastante menor:
 *
 *   mediana por hoja ......... dx entre -3 y 5 px, dy entre 1 y 7 px
 *   p10-p90 por hoja ......... dentro de ±9 px en 10 de las 12 hojas
 *   marcas en el borde ±13 ... entre 0% y 11% según la hoja
 *
 * (La excepción, marcada-03 con mediana dy=15, tiene 2 marcas confiables:
 * su mediana no significa nada.)
 *
 * Y el radio de más no sale gratis. La búsqueda se aplica IGUAL a toda
 * burbuja, marcada o no — tiene que ser así para que la comparación entre
 * opciones sea justa — pero en una burbuja SIN marcar no hay ningún pico
 * que encontrar: el máximo de 225 posiciones solo encuentra la cola alta
 * del ruido y del anillo impreso vecino. Eso infla las opciones vacías y se
 * come el margen de la marcada. Se nota justo donde más duele, en marcas
 * tenues: en foto-174156 el margen de las 8 marcas más flojas sube de 0.004
 * a 0.022 al pasar de ±15 a ±8.
 *
 * BRECHA de separación (peor marca verdadera − mejor no-marca verdadera),
 * sobre las TRES hojas con verdad dictada antes de procesar (§14):
 *
 *   radio    posiciones    escaneada   celular-172453   celular-174156
 *    ±15        225          0.144         0.107            -0.082
 *    ±11        121          0.206         0.109            -0.055
 *    ±8          81          0.215         0.110            -0.037   ← óptimo
 *    ±5          25          0.206         0.086            -0.057
 *    ±3           9          0.232         0.083            -0.068
 *    nominal      1          0.273         0.057            -0.053
 *
 * ±8 es el mejor o empata en las tres. Por debajo de ±8 la brecha se
 * degrada: ahí sí falta radio para el desfase real. Sobre las 12 hojas
 * (1200 preguntas) el cambio no movió NINGUNA respuesta de una letra a
 * otra; 83 pasaron de pendiente a resuelta y 3 al revés.
 *
 * De paso: medir las 500 burbujas pasa de 177 ms a 55 ms.
 *
 * CALIBRAR si aparecen fotos con desfases mayores — la forma de
 * comprobarlo es la de arriba: medir el desfase del máximo en marcas de
 * alta confianza y mirar qué fracción toca el borde de la ventana.
 */
export const SEARCH_RADIUS_PX = 8;
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
