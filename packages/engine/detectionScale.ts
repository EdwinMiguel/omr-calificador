/**
 * detectionScale.ts — llevar la imagen a una escala conocida ANTES de
 * buscar los marcadores.
 *
 * BUG REAL que motiva este archivo. Una foto tomada con un celular moderno
 * (3072 px de ancho) se rechazaba con BAD_HOMOGRAPHY, mientras que fotos
 * peores en luz y enfoque sí funcionaban. La causa no era la calidad:
 *
 *   - `fiducials.ts` exige MIN_MARKER_AREA_PX = 600 px² para considerar
 *     que un blob puede ser un marcador. Ese piso es ABSOLUTO, pero el
 *     tamaño en píxeles de todo depende de la resolución. A 1200 px de
 *     ancho una burbuja de 3 mm ocupa ~230 px² y queda descartada; a
 *     3072 px ocupa ~1500 px² y PASA el filtro.
 *   - A la vez, a esa resolución el umbral adaptativo vacía el interior de
 *     los marcadores reales (problema ya documentado en fiducials.ts), que
 *     entonces fallan el filtro de solidez.
 *
 * Resultado: el detector tomaba cuatro burbujas rellenadas del medio de la
 * hoja como si fueran los marcadores de las esquinas, y la homografía
 * salía disparatada. Verificado dibujando los puntos detectados sobre la
 * foto: caían sobre burbujas, no sobre marcadores.
 *
 * POR QUÉ NORMALIZAR Y NO AJUSTAR LOS UMBRALES: escalar cada constante con
 * el tamaño de la imagen obliga a re-derivar varias a la vez, y la más
 * difícil de acertar es el tamaño de ventana del umbral adaptativo, que es
 * justamente la que causa el vaciado. Normalizar arregla todas de una sola
 * vez porque hace que la etapa de detección vea SIEMPRE la misma escala.
 *
 * POR QUÉ SOLO PARA DETECTAR: el enderezado se hace desde la imagen
 * ORIGINAL, no desde la copia reducida. El lienzo canónico mide 1654 px de
 * ancho a 200 dpi; enderezar desde una copia de 1500 px sería agrandar, o
 * sea inventar detalle ya descartado, y las burbujas se medirían peor. La
 * copia reducida sirve para ENCONTRAR los marcadores; sus coordenadas se
 * reescalan a la imagen original y desde ahí se warpea a resolución plena.
 */

import { loadCv } from "./cv.ts";
import type { GrayImage } from "./types.ts";
import type { Point } from "./homography.ts";

/**
 * Ancho al que se lleva la imagen para buscar marcadores.
 *
 * DERIVADO, no elegido por prueba y error. Dos restricciones acotan el
 * rango, y 1500 queda centrado con margen a ambos lados:
 *
 *   Techo   ~1934 px — por encima, una burbuja de 3 mm supera los 600 px²
 *                      del piso de área y se confunde con un marcador.
 *   Piso     ~900 px — por debajo, el marcador de 8 mm baja de ~34 px de
 *                      lado y la detección de forma se vuelve inestable.
 *
 * Coincide con la evidencia: en el dataset real todo lo que alinea mide
 * entre 899 y 1742 px. (Las fotos de WhatsApp funcionaban porque WhatsApp
 * las redimensiona a ~1600 px — el detector nunca se había probado a
 * resolución nativa de celular hasta encontrar este bug.)
 *
 * El ancho es el de la IMAGEN, no el de la hoja dentro de ella. Si la hoja
 * ocupa el 70% del encuadre, a 1500 px de imagen la hoja mide ~1050 px:
 * sigue dentro del rango seguro. Ese margen es la razón de centrar en 1500
 * en vez de pegarse al techo.
 */
export const DETECTION_TARGET_WIDTH_PX = 1500;

/**
 * Escalas a probar, en orden, hasta que aparezcan los 4 marcadores.
 *
 * NO es "por si acaso": MEDIDO sobre el dataset real. `marcada-02.jpeg`
 * encuentra sus marcadores a 1204, 1300, 1400, 1450 y 1600 px — pero NO a
 * 1500 ni 1550. El fallo no es gradual sino una ventana estrecha, producto
 * de cómo interactúa el tamaño de ventana del umbral adaptativo con el
 * tamaño en píxeles del marcador a esa escala puntual.
 *
 * Conclusión: no existe un único ancho que funcione para todas las fotos, y
 * buscarlo sería perseguir un número mágico. Se prueban varios puntos del
 * rango seguro (~900-1934 px), que es exactamente la misma estrategia que
 * `findFiducialsRobust` ya aplica con los métodos de umbral: ninguno gana
 * siempre, y la unión cubre mucho más que cualquiera por separado.
 *
 * El coste solo lo paga la foto que falla: la primera escala resuelve el
 * caso normal y ahí termina.
 */
export const DETECTION_SCALE_LADDER_PX = [1500, 1200, 1800] as const;

export interface ScaledForDetection {
  /** La imagen a usar para buscar marcadores (reducida, o la misma). */
  image: GrayImage;
  /** Factor para llevar coordenadas de la copia a la imagen original. */
  scaleToOriginal: number;
}

/**
 * Anchos concretos a intentar para una imagen dada, sin repetir.
 *
 * Nunca agranda: una imagen ya pequeña se usa tal cual, porque agrandar no
 * agrega información y solo cuesta memoria. Por eso varios peldaños de la
 * escalera pueden colapsar en el mismo ancho efectivo (una foto de 1204 px
 * no cambia con objetivo 1500 ni 1800), y se descartan los duplicados para
 * no repetir exactamente el mismo intento fallido.
 */
export function detectionWidthsFor(img: GrayImage): number[] {
  const seen = new Set<number>();
  const widths: number[] = [];
  for (const rung of DETECTION_SCALE_LADDER_PX) {
    const w = Math.min(img.width, rung);
    if (!seen.has(w)) { seen.add(w); widths.push(w); }
  }
  return widths;
}

/**
 * Devuelve una copia reducida solo si hace falta. Una imagen que ya está
 * en el rango bueno se usa tal cual: agrandarla no aportaría nada y
 * costaría memoria y tiempo.
 */
export async function scaleForDetection(
  img: GrayImage,
  targetWidth: number = DETECTION_TARGET_WIDTH_PX
): Promise<ScaledForDetection> {
  if (img.width <= targetWidth) {
    return { image: img, scaleToOriginal: 1 };
  }

  const ratio = targetWidth / img.width;
  const outWidth = targetWidth;
  const outHeight = Math.max(1, Math.round(img.height * ratio));

  const cv = await loadCv();
  const src = new cv.Mat(img.height, img.width, cv.CV_8UC1);
  src.data.set(img.data);
  const dst = new cv.Mat();
  try {
    // INTER_AREA es el remuestreo correcto para reducir: promedia los
    // píxeles del área de origen en vez de tomar muestras sueltas. Con
    // interpolación bilineal, un marcador negro sólido puede perder densidad
    // en los bordes y volverse más difícil de detectar — justo lo contrario
    // de lo que este módulo busca.
    cv.resize(src, dst, new cv.Size(outWidth, outHeight), 0, 0, cv.INTER_AREA);
    return {
      image: { data: new Uint8Array(dst.data), width: dst.cols, height: dst.rows },
      scaleToOriginal: img.width / dst.cols,
    };
  } finally {
    dst.delete();
    src.delete();
  }
}

/** Lleva puntos hallados en la copia reducida a coordenadas de la original. */
export function scalePoints(points: readonly Point[], scaleToOriginal: number): Point[] {
  if (scaleToOriginal === 1) return [...points];
  return points.map((p) => ({ x: p.x * scaleToOriginal, y: p.y * scaleToOriginal }));
}
