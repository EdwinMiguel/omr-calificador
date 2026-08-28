/**
 * calibration.ts — Día 10: que las mismas constantes funcionen bajo
 * iluminaciones distintas.
 *
 * Problema:  Día 8 midió fillRatio crudo sobre fotos reales y encontró que
 *            "papel en blanco" no da 0 — da ~0.27-0.35, según la
 *            exposición de cada foto (confirmado con los parches: negro
 *            ~0.53, blanco ~0.34 en una foto real, no 1.0 vs 0.0). Un
 *            umbral fijo tipo BLANK_MAX=0.10 no tiene sentido contra estos
 *            números — clasificaría TODO como marcado.
 * Concepto:  normalización por hoja. Los parches negro/blanco impresos en
 *            CADA hoja son la única referencia que no depende de la
 *            plantilla ni de la fecha: son tinta 100% conocida y papel
 *            100% conocido, fotografiados con la MISMA luz que las
 *            burbujas de esa misma hoja. Se reescala cada fillRatio crudo
 *            a [0,1] usando esos dos puntos como referencia — 0 = igual
 *            de claro que el papel de esta hoja, 1 = igual de oscuro que
 *            la tinta de esta hoja.
 * Por qué:   así el Día 9 (clasificación) usa umbrales que significan lo
 *            mismo en una foto con luz buena que en una con sombra.
 */

import type { GrayImage } from "./types.ts";
import { fillRatioNearby } from "./measurement.ts";
import { mmToPx, bubbleRoi, type Template } from "../../template.ts";

export interface SheetCalibration {
  whiteRef: number;
  blackRef: number;
}

/**
 * MEDIDO — bug real, no teórico: en una foto real, el parche BLANCO de
 * calibración leyó fillRatio=0.52 mientras las burbujas normales de esa
 * MISMA hoja (sin marcar, en otra zona de la página) leían 0.28-0.35 —
 * una sombra localizada (la mano de quien fotografiaba) caía justo sobre
 * la franja de calibración sin afectar el resto de la hoja. Confiar solo
 * en un parche puntual de 6x6mm es fràgil ante esto.
 *
 * Por eso whiteRef NO sale del parche blanco: sale de la MEDIANA de
 * fillRatio de TODAS las burbujas de la hoja. Es robusto porque en un
 * examen real la gran mayoría de las burbujas están sin marcar — haría
 * falta que más de la mitad de las 570 burbujas de la hoja estuvieran
 * marcadas para que la mediana dejara de representar "papel en blanco",
 * algo que no ocurre en un examen real (100 preguntas, 1 marca cada una,
 * como mucho ~17% de burbujas marcadas).
 *
 * blackRef sí sale de los parches de calibración: no hay equivalente de
 * "la mayoría de la hoja es tinta" del que derivarlo de otra forma.
 */
export function deriveThresholds(normalized: GrayImage, template: Template, dpi: number): SheetCalibration {
  let blackSum = 0, blackN = 0;
  for (const patch of template.calibration.filter((p) => p.kind === "black")) {
    const roi = {
      x: Math.round(mmToPx(patch.rect.x, dpi)), y: Math.round(mmToPx(patch.rect.y, dpi)),
      w: Math.round(mmToPx(patch.rect.w, dpi)), h: Math.round(mmToPx(patch.rect.h, dpi)),
    };
    blackSum += fillRatioNearby(normalized, roi);
    blackN++;
  }
  if (blackN === 0) {
    throw new Error("El Template no tiene parches de calibración negros");
  }
  const blackRef = blackSum / blackN;

  // fillRatioNearby (no fillRatio a secas): la MISMA búsqueda con
  // tolerancia a desfase que se usa para medir cada burbuja individual
  // (measurement.ts) — si la referencia "blanco" se calculara sin ese
  // margen, quedaría sistemáticamente más baja que las burbujas reales
  // que sí se miden con margen, inflando el normalizado de todo el resto.
  const allBubbleRatios = template.groups
    .flatMap((g) => g.bubbles)
    .map((b) => fillRatioNearby(normalized, bubbleRoi(b, template, dpi)))
    .sort((a, b) => a - b);
  const whiteRef = allBubbleRatios[Math.floor(allBubbleRatios.length / 2)]!;

  /**
   * MIN_CONTRAST: derivado de la evidencia real (Día 8), no arbitrario —
   * la foto más floja del dataset real dio blackRef-whiteRef≈0.19; 0.05
   * deja margen amplio por debajo de eso y aun así rechaza una hoja
   * genuinamente sin contraste medible. CALIBRAR si aparecen fotos con
   * contraste real pero bajo.
   */
  const MIN_CONTRAST = 0.05;
  if (blackRef - whiteRef < MIN_CONTRAST) {
    throw new Error(
      `Contraste insuficiente entre parches negro (${blackRef.toFixed(3)}) y blanco ` +
      `(${whiteRef.toFixed(3)}) — no se puede calibrar esta hoja con confianza`
    );
  }

  return { whiteRef, blackRef };
}

/** Reescala un fillRatio crudo a [0,1] relativo a ESTA hoja. Puede superar
 * el rango [0,1] levemente (una marca de lápiz más oscura que el parche
 * "negro" de referencia, por ejemplo) — se deja sin recortar a propósito,
 * es información real que classification.ts puede usar. */
export function normalize(raw: number, cal: SheetCalibration): number {
  return (raw - cal.whiteRef) / (cal.blackRef - cal.whiteRef);
}
