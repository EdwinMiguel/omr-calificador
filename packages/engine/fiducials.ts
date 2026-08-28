/**
 * fiducials.ts — Día 5: encontrar y ordenar los 4 marcadores de forma fiable.
 *
 * Estrategia base: de todos los blobs cuadrado-ish y suficientemente
 * grandes como para ser un marcador, el que está DE VERDAD en cada esquina
 * es el que queda más cerca de esa esquina física de la imagen — un
 * marcador se imprime a solo 12mm de cada borde de la hoja, mientras que
 * cualquier otro contenido (grid de código, tabla de preguntas) vive bien
 * adentro del margen.
 *
 * La asignación es GLOBAL, no esquina por esquina en orden fijo: se
 * ordenan todos los pares (esquina, candidato) posibles por distancia y se
 * confirman de menor a mayor. MEDIDO: con orden fijo (probar TL, después
 * TR, ...), una esquina podía "robarle" a otra su candidato real si por
 * casualidad quedaba un poco más cerca — pasó en una foto real donde TR
 * tomaba el blob que en realidad era el marcador de BR (291px de BR, pero
 * "disponible" cuando le tocó el turno a TR), dejando a BR con una opción
 * peor. Resolver por distancia global evita ese sesgo de orden.
 *
 * Si exactamente 3 esquinas encuentran un candidato de confianza, se
 * intenta RESCATAR la 4ta: la hoja es (aproximadamente) un paralelogramo
 * bajo perspectiva moderada, así que su posición se predice con las otras
 * 3 (diagonal_1 + diagonal_2 = diagonal_3 + faltante) y se busca ahí con
 * criterios más permisivos — una esquina con mal ángulo o reflejo puede
 * dar un blob más chico o menos sólido que el resto, pero rara vez lejos
 * de donde la geometría dice que tiene que estar.
 */

import type { Blob } from "./blobs.ts";
import { findBlobs } from "./blobs.ts";
import { thresholdAdaptive, thresholdOtsu } from "./threshold.ts";
import type { GrayImage } from "./types.ts";

export type CornerId = "TL" | "TR" | "BR" | "BL";
const CORNER_IDS: readonly CornerId[] = ["TL", "TR", "BR", "BL"];
const OPPOSITE: Record<CornerId, CornerId> = { TL: "BR", TR: "BL", BR: "TL", BL: "TR" };

export interface DetectedMarker {
  id: CornerId;
  centerPx: { x: number; y: number };
  blob: Blob;
}

const ASPECT_MIN = 0.7;
const ASPECT_MAX = 1.4;
const SOLIDITY_MIN = 0.85;

/**
 * MEDIDO (dataset real, 10 fotos): sin piso de área, "el candidato
 * cuadrado-ish más cercano a la esquina" puede ser una mota de ruido de
 * pocos píxeles en vez del marcador real. Derivado de la geometría
 * conocida del template (marcador 8mm, burbuja 3mm) contra el rango de
 * resolución observado (fotos de 899 a 1600px de ancho para una hoja A4
 * de 210mm, ~4.3 a ~7.6 px/mm):
 *   burbuja:   área de contorno ≈ 129 a 408 px²
 *   marcador:  área de contorno ≈ 1109 a 3600 px² en teoría, bastante
 *              menos en la práctica (el umbral adaptativo vacía el
 *              interior de rellenos grandes — ver nota de fillRatio).
 * 600 cae en el hueco entre ambos rangos.
 */
const MIN_MARKER_AREA_PX = 600;

/** Cuánto puede variar el área entre los 4 candidatos elegidos y seguir
 * considerándolos "el mismo marcador impreso 4 veces". CALIBRABLE: fotos
 * con mucha perspectiva agrandan el marcador más cercano a la cámara. */
const MAX_AREA_RATIO = 3;
/** Igual que arriba pero para el caso RESCATADO (ver más abajo): una
 * esquina con mala luz puede dar un área bastante más chica que las otras
 * 3 sin dejar de ser el marcador real — la posición ya hizo el trabajo
 * fuerte de confirmarlo, el área acá solo descarta un disparate. */
const MAX_AREA_RATIO_RESCUED = 6;

/**
 * MEDIDO: sin este piso, "el candidato más cercano a la esquina" se acepta
 * aunque esté lejísimos si es lo único disponible — pasó en una foto real
 * del dataset donde los 4 "marcadores" elegidos quedaron amontonados a
 * ~1200px de su esquina asignada (63% de la diagonal de la imagen) en vez
 * de en la esquina real. "El menos malo" no es lo mismo que "correcto".
 * El marcador se imprime a 12mm del borde de una hoja A4 (210x297mm); aun
 * con margen de sobra por cómo se encuadre la foto, no debería estar a más
 * de un tercio de la diagonal de la imagen de su esquina.
 */
const MAX_CORNER_DISTANCE_FRACTION = 0.3;

/**
 * Radio de búsqueda para el RESCATE del 4to marcador, alrededor del punto
 * predicho por la geometría de paralelogramo — más chico que
 * MAX_CORNER_DISTANCE_FRACTION porque acá no se busca "cerca de la esquina
 * de la imagen" (impreciso) sino "cerca de una posición calculada a partir
 * de 3 puntos reales" (mucho más preciso salvo perspectiva extrema).
 */
const RESCUE_SEARCH_RADIUS_FRACTION = 0.1;
/** Más permisivo que ASPECT_MIN/MAX/SOLIDITY_MIN: un marcador con reflejo
 * o sombra parcial puede perder parte de su forma sin dejar de ser él. */
const RESCUE_ASPECT_MIN = 0.5;
const RESCUE_ASPECT_MAX = 2.0;
const RESCUE_SOLIDITY_MIN = 0.7;

/**
 * DESCARTADO CON EVIDENCIA — se documenta para no repetir el intento.
 * Hipótesis: un marcador (cuadrado relleno) tendría fillRatio alto y una
 * burbuja sin marcar (solo el trazo) tendría fillRatio bajo, así que
 * fillRatio podría reemplazar la posición como filtro de forma.
 * Medido en el dataset real: marcadores dieron fillRatio 0.30-0.43;
 * burbujas del mismo umbral dieron 0.40-0.44 — rangos que SE SUPERPONEN.
 * Causa: el umbral ADAPTATIVO compara cada píxel contra su vecindario
 * local; dentro de un cuadrado grande y uniformemente negro (más grande
 * que el bloque de 25px), el interior no tiene contraste local contra el
 * que compararse, así que buena parte no se marca como tinta aunque lo
 * sea. No es un bug: es una limitación conocida del umbral adaptativo
 * frente a rellenos grandes, y la misma razón por la que abrir con
 * morfología (Día 4) dejó al marcador con forma de anillo en vez de
 * arreglarlo.
 */

/**
 * RELAXED_SOLIDITY_MIN: MEDIDO en una foto real donde faltaban DOS
 * esquinas (no una — el rescate de una sola no alcanzaba). El marcador
 * fragmentado por el umbral adaptativo daba solidity 0.21-0.28, muy por
 * debajo de 0.85. área (≈440-460px) y aspecto (≈1.02) seguían siendo
 * correctos — el fragmentado afecta la CONVEXIDAD del contorno, no su
 * tamaño ni proporción. Por eso el segundo intento solo afloja solidity,
 * no área ni aspecto: son las propiedades que de verdad distinguen un
 * marcador roto de una burbuja o una línea de tabla.
 */
const RELAXED_SOLIDITY_MIN = 0.2;

/**
 * MEDIDO en la misma foto: los marcadores fragmentados que pasan
 * RELAXED_SOLIDITY_MIN dieron área 441 y 458px — por ENCIMA del techo real
 * de una burbuja (408px, ver la nota de MIN_MARKER_AREA_PX) pero por
 * DEBAJO del piso estricto de 600. 420 cae en ese hueco: sigue sin admitir
 * burbujas, sí admite un marcador fragmentado que perdió algo de área.
 */
const RELAXED_MIN_MARKER_AREA_PX = 420;

function isSquareish(b: Blob, solidityMin: number, minArea: number): boolean {
  return (
    b.aspectRatio >= ASPECT_MIN &&
    b.aspectRatio <= ASPECT_MAX &&
    b.solidity >= solidityMin &&
    b.area >= minArea
  );
}

function areasConsistent(blobs: Blob[], maxRatio: number): boolean {
  const areas = blobs.map((b) => b.area);
  return Math.max(...areas) / Math.min(...areas) <= maxRatio;
}

/**
 * MEDIDO: usar el centroide ponderado por intensidad (cv.moments) como
 * posición del marcador introduce un sesgo sistemático de ~10-15px en la
 * homografía resultante — confirmado en una foto real barriendo el ROI de
 * medición y encontrando el pico real bien fuera de la posición esperada,
 * de forma consistente en dos zonas distintas de la hoja. Causa: el
 * marcador TL tiene una muesca (recorte de 3x3mm en su esquina interior,
 * para resolver rotación de 180°) — el centroide de una forma con una
 * esquina cortada se desplaza hacia el lado opuesto al corte, no queda en
 * el centro geométrico real del cuadrado de 8x8mm que el Template define.
 * El centro del BOUNDING BOX no tiene este problema: depende solo de los
 * píxeles más extremos (izquierda/derecha/arriba/abajo), no de cómo se
 * reparte la tinta adentro — la muesca no cambia dónde están los bordes
 * exteriores del cuadrado.
 */
function centerOf(b: Blob): { x: number; y: number } {
  return { x: b.boundingRect.x + b.boundingRect.width / 2, y: b.boundingRect.y + b.boundingRect.height / 2 };
}

function toMarkers(chosen: Record<CornerId, Blob>): DetectedMarker[] {
  return CORNER_IDS.map((id) => ({
    id,
    centerPx: centerOf(chosen[id]),
    blob: chosen[id],
  }));
}

/**
 * Predice dónde debería estar la esquina faltante usando las otras 3, por
 * la propiedad de un paralelogramo: la suma de una diagonal es igual a la
 * suma de la otra. Con perspectiva moderada (no extrema) esto sigue siendo
 * una buena aproximación, no una igualdad exacta — de ahí que la búsqueda
 * alrededor del punto predicho tenga un radio, no sea un punto exacto.
 */
function predictMissingCorner(missing: CornerId, chosen: Partial<Record<CornerId, Blob>>): { x: number; y: number } {
  const opposite = chosen[OPPOSITE[missing]]!.centroid;
  const others = CORNER_IDS.filter((id) => id !== missing && id !== OPPOSITE[missing]);
  const a = chosen[others[0]!]!.centroid;
  const b = chosen[others[1]!]!.centroid;
  return { x: a.x + b.x - opposite.x, y: a.y + b.y - opposite.y };
}

function rescueMissingCorner(
  missing: CornerId,
  chosen: Partial<Record<CornerId, Blob>>,
  allBlobs: Blob[],
  used: Set<Blob>,
  imageWidth: number,
  imageHeight: number
): Blob | null {
  const predicted = predictMissingCorner(missing, chosen);
  const radius = RESCUE_SEARCH_RADIUS_FRACTION * Math.hypot(imageWidth, imageHeight);

  let best: Blob | null = null;
  let bestDist = Infinity;
  for (const b of allBlobs) {
    if (used.has(b)) continue;
    if (b.aspectRatio < RESCUE_ASPECT_MIN || b.aspectRatio > RESCUE_ASPECT_MAX) continue;
    if (b.solidity < RESCUE_SOLIDITY_MIN) continue;
    const d = Math.hypot(b.centroid.x - predicted.x, b.centroid.y - predicted.y);
    if (d <= radius && d < bestDist) { bestDist = d; best = b; }
  }
  return best;
}

/**
 * @returns los 4 marcadores ordenados TL/TR/BR/BL, o null si no se pudo
 * armar un conjunto de 4 candidatos consistentes. Nunca "adivina" con 3.
 */
export function findFiducials(
  blobs: Blob[], imageWidth: number, imageHeight: number,
  solidityMin: number = SOLIDITY_MIN,
  /**
   * MEDIDO: con solidity relajado, los marcadores fragmentados que SÍ se
   * aceptan traen área más chica que uno intacto (441-458px vs 1645-1924px
   * en la misma foto — la fragmentación no solo afecta convexidad, también
   * resta área real). MAX_AREA_RATIO=3 rechazaba esa foto aun habiendo
   * encontrado los 4 marcadores correctos. Quien llama con solidity
   * relajado debe pasar también un maxAreaRatio más permisivo.
   */
  maxAreaRatio: number = MAX_AREA_RATIO,
  minArea: number = MIN_MARKER_AREA_PX
): DetectedMarker[] | null {
  const candidates = blobs.filter((b) => isSquareish(b, solidityMin, minArea));
  const corners: Record<CornerId, { x: number; y: number }> = {
    TL: { x: 0, y: 0 },
    TR: { x: imageWidth, y: 0 },
    BR: { x: imageWidth, y: imageHeight },
    BL: { x: 0, y: imageHeight },
  };
  const maxDistPx = MAX_CORNER_DISTANCE_FRACTION * Math.hypot(imageWidth, imageHeight);

  const pairs: { id: CornerId; blob: Blob; dist: number }[] = [];
  for (const id of CORNER_IDS) {
    for (const c of candidates) {
      const d = Math.hypot(c.centroid.x - corners[id].x, c.centroid.y - corners[id].y);
      if (d <= maxDistPx) pairs.push({ id, blob: c, dist: d });
    }
  }
  pairs.sort((a, b) => a.dist - b.dist);

  const chosen: Partial<Record<CornerId, Blob>> = {};
  const used = new Set<Blob>();
  for (const { id, blob } of pairs) {
    if (chosen[id] || used.has(blob)) continue;
    chosen[id] = blob;
    used.add(blob);
  }

  const missing = CORNER_IDS.filter((id) => !chosen[id]);

  if (missing.length === 0) {
    const full = chosen as Record<CornerId, Blob>;
    if (!areasConsistent(Object.values(full), maxAreaRatio)) return null;
    return toMarkers(full);
  }

  if (missing.length === 1) {
    const rescued = rescueMissingCorner(missing[0]!, chosen, blobs, used, imageWidth, imageHeight);
    if (rescued) {
      chosen[missing[0]!] = rescued;
      const full = chosen as Record<CornerId, Blob>;
      if (areasConsistent(Object.values(full), MAX_AREA_RATIO_RESCUED)) return toMarkers(full);
    }
  }

  return null;
}

/**
 * MEDIDO (dataset real): adaptativo y Otsu son BUENOS PARA COSAS DISTINTAS,
 * no uno "mejor" que el otro. Adaptativo vacía el interior de rellenos
 * grandes (nota de fillRatio, arriba) — a veces fragmenta un marcador
 * hasta dejarlo irreconocible en una esquina con mala luz. Otsu, al ser
 * un solo corte global, no tiene ese problema — pero es más sensible a
 * sombras/gradientes de luz en OTRAS zonas de la misma foto.
 * En la práctica, sobre las mismas 10 fotos: adaptativo resuelve una foto
 * que Otsu no puede, y Otsu resuelve varias que adaptativo no puede — la
 * intersección de ambos cubre más que cualquiera de los dos solo.
 * findFiducials() en sí queda agnóstico de qué umbral se usó (recibe
 * blobs, no una imagen); esta función es la que decide, para el propósito
 * específico de encontrar marcadores, probar los dos y quedarse con el
 * primero que dé un resultado geométricamente válido.
 */
export async function findFiducialsRobust(
  img: GrayImage
): Promise<{ markers: DetectedMarker[]; method: "adaptive" | "otsu" | "combined" } | null> {
  const [adaptiveBin, otsuBin] = await Promise.all([thresholdAdaptive(img), thresholdOtsu(img)]);
  const [adaptiveBlobs, otsuBlobs] = await Promise.all([findBlobs(adaptiveBin), findBlobs(otsuBin)]);

  const attempts: { name: "adaptive" | "otsu" | "combined"; blobs: Blob[] }[] = [
    { name: "adaptive", blobs: adaptiveBlobs },
    { name: "otsu", blobs: otsuBlobs },
    /**
     * MEDIDO: en dos fotos reales, cada método por separado encontraba 3
     * de 4 esquinas — pero eran esquinas DISTINTAS en cada caso (a
     * adaptativo le fallaba TR, a Otsu le fallaba una diferente en esa
     * misma foto). Ninguno de los dos solo alcanzaba, y `findFiducials()`
     * ya sabe descartar candidatos irrelevantes (los cientos de burbujas
     * que también entran al pool), así que juntar ambas listas de blobs
     * en una sola búsqueda no agrega riesgo — solo le da al algoritmo
     * más oportunidades reales de armar las 4 esquinas entre los dos.
     */
    { name: "combined", blobs: [...adaptiveBlobs, ...otsuBlobs] },
  ];

  for (const { name, blobs } of attempts) {
    const markers = findFiducials(blobs, img.width, img.height);
    if (markers) return { markers, method: name };
  }

  /**
   * MEDIDO: en una foto real, DOS marcadores (no uno) quedaron fragmentados
   * por el umbral adaptativo — el rescate de un solo faltante no alcanza
   * cuando faltan dos. Antes de rendirse, un segundo intento con solidity
   * mucho más permisivo (RELAXED_SOLIDITY_MIN): sigue exigiendo área y
   * aspecto correctos, así que no es "aceptar cualquier cosa" — es aceptar
   * que un marcador fragmentado por el umbral, con forma cuadrada e igual
   * tamaño, sigue siendo evidencia real de un marcador.
   */
  for (const { name, blobs } of attempts) {
    const markers = findFiducials(
      blobs, img.width, img.height, RELAXED_SOLIDITY_MIN, MAX_AREA_RATIO_RESCUED, RELAXED_MIN_MARKER_AREA_PX
    );
    if (markers) return { markers, method: name };
  }

  return null;
}
