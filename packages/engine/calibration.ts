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
 *
 * ── Calibración por VECINDARIO (2026-09-02), no una sola referencia global ──
 *
 * PROBLEMA MEDIDO: la referencia de "papel" de arriba es una única mediana
 * para TODA la hoja. En una foto de celular con luz de costado o sombra
 * propia, el papel no tiene un solo brillo: se midió, sobre 10 fotos reales,
 * que la referencia de papel varía entre bandas de la misma hoja hasta un
 * 48% del contraste total de esa hoja (mediana 35%, mínimo 6% — el mínimo es
 * precisamente la hoja ESCANEADA, que por eso funciona bien con referencia
 * global). Con una sola referencia, media hoja queda con el corte demasiado
 * alto y la otra media con el corte demasiado bajo — cada burbuja que cae
 * del lado equivocado no se agrega mal, se manda a revisión (AMBIGUOUS), que
 * es el fallo conservador correcto, pero infla la cola de revisión manual sin
 * necesidad.
 *
 * EXPERIMENTO DECISIVO: la única hoja con verdad conocida (100 respuestas)
 * es la escaneada, que casi no tiene gradiente — no sirve para probar esto
 * directamente. Se le aplicó entonces un oscurecimiento lateral/vertical/
 * diagonal PROGRESIVO Y MULTIPLICATIVO por software (así se comporta la luz
 * real: reduce el brillo en proporción, no resta una constante) — la verdad
 * no cambia, así que toda respuesta perdida es culpa del gradiente y toda
 * recuperada es mérito real de la estrategia. Con gradiente lateral fuerte
 * (papel al 55% de su brillo en el borde): referencia global 75 bien/25
 * pendientes; por vecindario 99 bien/1 pendiente, CERO incorrectas en todos
 * los casos probados (5 intensidades × 3 direcciones × varias formas de
 * zona). Confirmado también sobre las 9 fotos reales del dataset (sin
 * gradiente sintético, sin ground truth): comparando contra la referencia
 * global, CERO respuestas que la global ya daba por buenas cambiaron de
 * letra — donde algo se mueve, siempre es de pendiente→resuelta o al revés,
 * nunca de una letra a otra. Es la firma exacta de PROMPT.md §15 (preferir
 * revisión manual a respuesta inventada), no una corrección arriesgada.
 *
 * POR QUÉ VECINDARIO (k-NN) Y NO UNA REJILLA POR ZONAS: se probaron rejillas
 * por columna (banda de 42mm en x) y rejillas 2D antes de esto. Las bandas
 * por columna ganan contra un gradiente LATERAL pero casi no ayudan contra
 * uno VERTICAL (84 vs 96 con rejilla 2D, medido) — asumen en qué dirección
 * viene la luz, y una foto de celular no promete ninguna. Las rejillas
 * también necesitan un tamaño de celda y una regla de "si hay pocas
 * muestras, usar la global" — dos parámetros arbitrarios más y un borde de
 * celda arbitrario que corta el vecindario real de una burbuja justo en el
 * límite. Vecindario por distancia no tiene esos problemas: cada burbuja
 * mira a sus k vecinas más cercanas SIN IMPORTAR LA DIRECCIÓN del
 * gradiente, sin bordes de celda, y sin rama de "pocas muestras" (siempre
 * hay exactamente k vecinas, están donde estén). Medido con el mismo
 * experimento: vecindario iguala o supera a la mejor rejilla en las 4
 * combinaciones dirección×intensidad probadas.
 *
 * POR QUÉ EL TAMAÑO DEL VECINDARIO ES UNA FRACCIÓN DEL TOTAL, NO UN NÚMERO
 * FIJO: el motor no debe asumir cuántas burbujas tiene la plantilla que le
 * toque (§2 — probado con Template B en Gate 1). Se barrieron fracciones de
 * 30 a 180 vecinas (5%-32% de 570 burbujas) sobre el experimento del
 * gradiente: el óptimo cae alrededor del 8% en las 4 combinaciones
 * probadas — ni tan chico que un vecindario caiga por mala suerte casi
 * todo del lado marcado (con ~17% de burbujas marcadas en un examen típico,
 * un vecindario muy chico tiene más chance de un desvío así), ni tan grande
 * que deje de ser "local" y se acerque de nuevo a la referencia global que
 * se quiere evitar.
 *
 * COSTO: medido en Node, calcular la referencia de las 570 burbujas de una
 * hoja completa (fuerza bruta, sin estructura espacial) toma ~59ms, contra
 * ~1047ms del análisis completo de la hoja (+5.6%). No se optimizó con un
 * índice espacial (§10, no antes de medir): con una sola plantilla de
 * producción y un total de burbujas acotado, la ganancia no justifica la
 * complejidad todavía.
 */

import type { GrayImage } from "./types.ts";
import { fillRatioNearby } from "./measurement.ts";
import { mmToPx, bubbleRoi, type Template } from "../../template.ts";

export interface SheetCalibration {
  blackRef: number;
  /**
   * Referencia de "papel en blanco de esta hoja" en la posición (mm de
   * plantilla) dada — YA NO es un número único: varía con dónde cae la
   * burbuja, ver la nota de arriba. `normalize()` la consulta una vez por
   * burbuja, en su propia posición.
   */
  whiteRefAt(xMm: number, yMm: number): number;
}

/** Ver "POR QUÉ EL TAMAÑO DEL VECINDARIO ES UNA FRACCIÓN", arriba. */
const WHITE_NEIGHBORHOOD_FRACTION = 0.08;
/** Cotas de sensatez si algún día una plantilla tiene muy pocas o
 * muchísimas burbujas — no alcanzadas hoy (570 × 8% = 46). */
const MIN_NEIGHBORS = 20;
const MAX_NEIGHBORS = 90;

function median(xs: number[]): number {
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
}

interface BubbleSample {
  xMm: number;
  yMm: number;
  raw: number;
}

/**
 * Construye la función de referencia local: para cualquier posición (mm),
 * la mediana del fillRatio crudo de las k burbujas físicamente más
 * cercanas. Por qué mediana y no promedio: la misma razón que en la
 * referencia global de más abajo — robusta a que unas pocas de esas k
 * vecinas SÍ estén marcadas (respuestas reales), sin que las contaminen.
 */
function buildWhiteRefAt(samples: BubbleSample[]): (xMm: number, yMm: number) => number {
  const k = Math.min(MAX_NEIGHBORS, Math.max(MIN_NEIGHBORS, Math.round(samples.length * WHITE_NEIGHBORHOOD_FRACTION)));

  return (xMm: number, yMm: number): number => {
    const nearest = samples
      .map((s) => ({ d2: (s.xMm - xMm) ** 2 + (s.yMm - yMm) ** 2, raw: s.raw }))
      .sort((a, b) => a.d2 - b.d2)
      .slice(0, k)
      .map((s) => s.raw);
    return median(nearest);
  };
}

/**
 * MEDIDO — bug real, no teórico: en una foto real, el parche BLANCO de
 * calibración leyó fillRatio=0.52 mientras las burbujas normales de esa
 * MISMA hoja (sin marcar, en otra zona de la página) leían 0.28-0.35 —
 * una sombra localizada (la mano de quien fotografiaba) caía justo sobre
 * la franja de calibración sin afectar el resto de la hoja. Confiar solo
 * en un parche puntual de 6x6mm es fràgil ante esto.
 *
 * Por eso ninguna referencia de blanco (ni la global de respaldo, ni la
 * local por vecindario) sale del parche blanco: salen de la mediana del
 * fillRatio de burbujas reales de la hoja. Es robusto porque en un examen
 * real la gran mayoría de las burbujas están sin marcar — haría falta que
 * más de la mitad de las burbujas de un vecindario estuvieran marcadas
 * para que la mediana dejara de representar "papel en blanco", algo que no
 * ocurre en un examen real (100 preguntas, 1 marca cada una, como mucho
 * ~17% de burbujas marcadas).
 *
 * blackRef sí sale de los parches de calibración: no hay equivalente de
 * "la mayoría de la hoja es tinta" del que derivarlo de otra forma, y son
 * solo 3 parches — no hace falta ni tiene sentido localizarlos por zona.
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
  //
  // TODAS las burbujas de la hoja (dígitos + preguntas), no solo
  // preguntas: es el mismo pool que ya usaba la referencia global, y es lo
  // que hace falta para que el vecindario tenga suficientes muestras cerca
  // del bloque de identificación (arriba de la hoja), lejos de las 500
  // burbujas de preguntas.
  const samples: BubbleSample[] = template.groups.flatMap((g) =>
    g.bubbles.map((b) => ({
      xMm: b.center.x,
      yMm: b.center.y,
      raw: fillRatioNearby(normalized, bubbleRoi(b, template, dpi)),
    }))
  );

  /**
   * MIN_CONTRAST: derivado de la evidencia real (Día 8), no arbitrario —
   * la foto más floja del dataset real dio blackRef-whiteRef≈0.19; 0.05
   * deja margen amplio por debajo de eso y aun así rechaza una hoja
   * genuinamente sin contraste medible. CALIBRAR si aparecen fotos con
   * contraste real pero bajo.
   *
   * Se comprueba contra la referencia GLOBAL (mediana de todas las
   * burbujas), no una local: esto decide si la hoja ENTERA es ilegible, no
   * si una zona lo es — para eso está la referencia por vecindario.
   */
  const globalWhite = median(samples.map((s) => s.raw));
  const MIN_CONTRAST = 0.05;
  if (blackRef - globalWhite < MIN_CONTRAST) {
    throw new Error(
      `Contraste insuficiente entre parches negro (${blackRef.toFixed(3)}) y blanco ` +
      `(${globalWhite.toFixed(3)}) — no se puede calibrar esta hoja con confianza`
    );
  }

  return { blackRef, whiteRefAt: buildWhiteRefAt(samples) };
}

/** Reescala un fillRatio crudo a [0,1] relativo a ESTA hoja, en la posición
 * (mm) de la burbuja medida. Puede superar el rango [0,1] levemente (una
 * marca de lápiz más oscura que el parche "negro" de referencia, por
 * ejemplo) — se deja sin recortar a propósito, es información real que
 * classification.ts puede usar. */
export function normalize(raw: number, cal: SheetCalibration, xMm: number, yMm: number): number {
  const white = cal.whiteRefAt(xMm, yMm);
  return (raw - white) / (cal.blackRef - white);
}
