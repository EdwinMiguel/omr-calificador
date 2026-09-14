/**
 * halfSheetTemplate.ts — Template de la MEDIA hoja: 100 preguntas, código de
 * 7 dígitos y cabecera del profesor, todo en la mitad de una A4.
 *
 * Por qué existe: cada alumno recibe su propia hoja física privada, así que
 * imprimir a doble cara no sirve (una hoja de papel no se reparte entre dos
 * alumnos). La única forma de bajar el consumo de papel a la mitad es
 * imprimir DOS plantillas por A4 y cortar por la mitad — composeHalfSheetA4.ts
 * hace el corte de impresión; esta plantilla describe UNA mitad ya cortada,
 * que es lo único que el motor llega a ver.
 *
 * Dos intentos previos de este diseño NO sobrevivieron a la verificación
 * (quedan documentados en el plan, no se repiten los números acá):
 *   - 10 columnas × 10 filas: geométricamente imposible, las 5 opciones
 *     solas ya ocupan más ancho que el paso de columna disponible.
 *   - 6 columnas × 17 filas con letras A-E bajo cada burbuja: el renglón
 *     para el nombre completo quedaba 25mm corto y las letras ilegibles.
 *
 * Lo que hace entrar el diseño final, sin achicar el diámetro de burbuja:
 *   1. Las letras A-E van UNA VEZ como encabezado de columna, no repetidas
 *      bajo cada fila — libera el espacio entre filas por completo.
 *   2. El grid del código va al COSTADO de la tabla, no en una banda propia
 *      arriba — usa ancho que sobra en vez de alto que falta.
 *   3. Institución/curso/tipo de examen los imprime el generador (los
 *      define el profesor en la app), no van escritos a mano.
 */

import {
  validateTemplate,
  bubbleRoi,
  mmToPx,
  pxToMm,
  type Template,
  type Marker,
  type CalibrationPatch,
  type BubbleGroup,
} from "../../template.ts";
import { SEARCH_RADIUS_PX } from "../../packages/engine/measurement.ts";

/** DPI del lienzo canónico — el mismo que usa el motor en todo el pipeline. */
const DPI = 200;

/**
 * Hasta dónde alcanza el muestreo de UNA burbuja, medido desde su centro.
 * Es el piso real de separación, más estricto que el que exige
 * validateTemplate() (que solo pide bubbleDiameterMm + 0.8 = 3.8mm).
 *
 *   medio ROI de la burbuja (bubbleRoi, shrink 0.8) + SEARCH_RADIUS_PX
 *
 * SE CALCULA, no se declara como literal: la primera versión de este
 * archivo lo fijó a mano en 2.22mm y el número REAL es 2.258mm — bubbleRoi
 * redondea a píxeles enteros (`Math.round`), así que el ROI de 19px no
 * queda perfectamente centrado y un lado alcanza más que el otro. Un
 * literal a mano se desincroniza en silencio en cuanto alguien toque el
 * shrink, el DPI o SEARCH_RADIUS_PX; derivarlo del mismo `bubbleRoi` que
 * usa el motor hace imposible esa clase de error.
 */
export function measurementReachMm(t: Template): number {
  const b = t.groups.find((g) => g.kind === "question")?.bubbles[0];
  if (!b) throw new Error("El Template no tiene burbujas de pregunta de las que derivar el alcance");
  const roi = bubbleRoi(b, t, DPI);
  const centerPx = mmToPx(b.center.x, DPI);
  const halfRoiPx = Math.max(centerPx - roi.x, roi.x + roi.w - centerPx);
  return pxToMm(halfRoiPx + SEARCH_RADIUS_PX, DPI);
}

const LAYOUT_HALF = {
  // AÑADIDO — mitad de A4, corte horizontal. El ANCHO no cambia respecto a
  // una A4 completa (sigue siendo 210mm); lo que se pierde al cortar es
  // solo el alto (297 → 148.5). Por eso el diseño reorganiza cuántas filas
  // entran por columna, no aprieta el ancho.
  page: { widthMm: 210, heightMm: 148.5 },

  // Igual que la hoja oficial del colegio — la señal que mide el motor por
  // burbuja es idéntica a la de hoy, nada de esto cambia esa parte.
  bubbleDiameter: 3,

  marker: { size: 8, inset: 12 },

  // Cabecera: institución/curso/tipo de examen los imprime el generador
  // (composeHalfSheetA4.ts) a partir de lo que el profesor define en la
  // app — esta plantilla solo reserva el rectángulo para que
  // validateTemplate() rechace cualquier burbuja que caiga ahí. Bajo esa
  // línea van los renglones manuscritos (nombre, grado/sección, fecha),
  // que tampoco llevan burbuja — es texto que el operador lee a mano si
  // hace falta, el motor no los procesa.
  //
  // y=17,h=13 (no 18/14): en la primera pasada, el renglón de grado/fecha
  // quedaba a 0.5mm del encabezado "A B C D E" de la primera columna —
  // literalmente la misma línea, texto superpuesto en el PDF renderizado.
  // No lo detectó ninguna cuenta a mano; lo detectó mirar el PDF (por eso
  // el plan pide generar y mirar, no confiar en la aritmética). Con estos
  // valores el último renglón de la cabecera queda ~4mm por encima del
  // encabezado de columna — ver composeHalfSheetA4.ts::drawCabecera.
  cabecera: { x: 20, y: 17, w: 170, h: 13 },

  // 5 columnas × 20 filas = 100 exacto, sin columnas desparejas.
  // yStart 35 (no 33): dos motivos, los dos de tolerancia de impresión, no
  // de lectura del motor (el margen de medición de 0.78mm no depende de
  // yStart, solo del pitch). Con 33: la última fila quedaba a 20.2mm del
  // marcador BL, apenas sobre el mínimo de 20mm. Con 34: la cabecera
  // (termina en y=32) dejaba solo 0.5mm antes del borde superior de la
  // primera burbuja (32.5). Con 35 los dos quedan con margen cómodo:
  // última fila a 20.7mm del marcador, 1.5mm libres bajo la cabecera.
  questions: {
    yStart: 35,
    rowPitch: 4.8,
    perColumn: 20,
    colXStart: [30, 58, 86, 114, 142],
    optionPitch: 4.5,
    options: ["A", "B", "C", "D", "E"],
  },

  // Al costado de la tabla de preguntas, no en una banda propia arriba —
  // es lo que ahorra los ~27mm de alto que la cabecera necesita. Misma
  // orientación que la hoja oficial (columnas verticales, dígito 0-9 hacia
  // abajo): decodeDigitGrid() no asume nada sobre dónde cae el grid en la
  // página, así que moverlo no toca el motor.
  //
  // xStart 168, no 166: en la primera pasada, la etiqueta de fila "0"-"9"
  // (que se dibuja a la izquierda de la primera columna del código, ver
  // drawDigitRowLabels en composeHalfSheetA4.ts) quedaba a menos de 1mm del
  // borde de la última burbuja de preguntas (columna E, x=160) — se veían
  // pegadas en el PDF renderizado. El hueco entre las dos grillas de
  // burbujas en sí (160 a 166.5) siempre fue seguro; lo ajustado era el
  // TEXTO de la etiqueta, que necesita su propio espacio además del de las
  // burbujas. 2mm más de xStart + reducir el margen de esa etiqueta hacia
  // SU PROPIA columna (composeHalfSheetA4.ts) resuelven las dos puntas.
  idGrid: { xStart: 168, yStart: 40, digits: 7, pitch: 4.5, rows: 10 },

  // Debajo de la tabla de preguntas.
  //
  // y=131, no 128 — BUG REAL, encontrado midiendo y confirmado con una
  // hoja en blanco rasterizada del propio PDF. `validateTemplate()` NO
  // revisa los parches de calibración (solo mira `groups[].bubbles`), así
  // que nada avisaba de esto: con y=128 los parches quedaban a 0.30mm del
  // borde de la última fila de preguntas, y el muestreo de esas burbujas
  // alcanza 2.26mm desde su centro (y=126.2 → 128.46). O sea que la
  // ventana de medición de la fila 20 CAÍA DENTRO del parche.
  //
  // Medido sobre una hoja sin marcar (todas las preguntas deberían leer
  // ruido puro, ±0.002):
  //     Q19  ±0.002   ← fila sin parche debajo, referencia
  //     Q20   B=0.046  D=0.049   ← 20× el ruido
  //     Q40   B=0.082  D=0.086   ← 40× el ruido
  // (B y D son las peores porque caen sobre el CENTRO de un parche; A, C y
  // E caen sobre su borde.)
  //
  // No llegaba a romper la lectura —las 100 seguían dando BLANK— pero esos
  // valores entran en deriveSheetMarkContext como "perdedoras" e inflan el
  // `noiseHigh` de TODA la hoja, que es lo que fija el piso de la regla de
  // rescate: contaminaba la lectura de las otras 98 preguntas, no solo de
  // las dos afectadas. Con y=131 quedan 2.5mm de colchón sobre el alcance.
  calibration: { y: 131, size: 6, gap: 3, xStart: 30, count: 3 },

  // AÑADIDO — "INDICACIONES", la misma línea que traía el PDF original del
  // profesor (ver la nota sobre interlineado en officialTemplate.ts). No
  // reposiciona nada del diseño ya medido y verificado: va en el único
  // tramo de la página que queda completamente libre — debajo de los
  // parches de calibración (terminan en y=137) y por encima del margen de
  // 5mm del borde inferior de la página (148.5), fuera del rango x de los
  // marcadores BL/BR (que solo ocupan x=[8,16] y [194,202]).
  indicaciones: { x: 20, y: 139, w: 170, h: 6 },
} as const;

function makeMarkers(): Marker[] {
  const { size, inset } = LAYOUT_HALF.marker;
  const { widthMm: W, heightMm: H } = LAYOUT_HALF.page;
  const half = size / 2;

  return [
    {
      id: "TL",
      center: { x: inset, y: inset },
      sizeMm: size,
      // Muesca en la esquina interior: única asimetría de los 4
      // marcadores, resuelve la rotación de 180°.
      notch: { x: inset + half - 3, y: inset + half - 3, w: 3, h: 3 },
    },
    { id: "TR", center: { x: W - inset, y: inset }, sizeMm: size },
    { id: "BR", center: { x: W - inset, y: H - inset }, sizeMm: size },
    { id: "BL", center: { x: inset, y: H - inset }, sizeMm: size },
  ];
}

function makeCalibration(): CalibrationPatch[] {
  const { y, size, gap, xStart, count } = LAYOUT_HALF.calibration;
  const patches: CalibrationPatch[] = [];
  let x = xStart;

  for (let i = 0; i < count; i++) {
    patches.push({ kind: "black", rect: { x, y, w: size, h: size } });
    x += size + gap;
  }
  x += gap;
  for (let i = 0; i < count; i++) {
    patches.push({ kind: "white", rect: { x, y, w: size, h: size } });
    x += size + gap;
  }
  return patches;
}

/** Columna vertical 0-9 para una posición del código del alumno. */
function makeDigitColumn(ordinal: number, x: number): BubbleGroup {
  const { yStart, pitch, rows } = LAYOUT_HALF.idGrid;
  return {
    id: `codigo.${ordinal}`,
    kind: "digit",
    ordinal,
    printedLabel: `C${ordinal + 1}`,
    bubbles: Array.from({ length: rows }, (_, d) => ({
      index: d,
      label: String(d),
      center: { x, y: yStart + d * pitch },
    })),
  };
}

function makeAddedGroups(): BubbleGroup[] {
  const { xStart, digits, pitch } = LAYOUT_HALF.idGrid;
  return Array.from({ length: digits }, (_, i) =>
    makeDigitColumn(i, xStart + i * pitch)
  );
}

/** Numeración por columnas: 1-20 en la col 1, 21-40 en la col 2, etc. —
 * mismo orden de lectura que la hoja oficial del colegio. */
function makeQuestionGroups(count: number): BubbleGroup[] {
  const q = LAYOUT_HALF.questions;
  const groups: BubbleGroup[] = [];

  for (let n = 0; n < count; n++) {
    const col = Math.floor(n / q.perColumn);
    const row = n % q.perColumn;
    const baseX = q.colXStart[col];
    if (baseX === undefined) {
      throw new Error(`La pregunta ${n + 1} cae en la columna ${col}, que no existe en este layout`);
    }
    const y = q.yStart + row * q.rowPitch;

    groups.push({
      id: `q.${n + 1}`,
      kind: "question",
      ordinal: n + 1,
      printedLabel: String(n + 1),
      bubbles: q.options.map((label, i) => ({
        index: i,
        label,
        center: { x: baseX + i * q.optionPitch, y },
      })),
    });
  }
  return groups;
}

export function buildHalfSheetTemplate(questionCount = 100): Template {
  const maxQ = LAYOUT_HALF.questions.perColumn * LAYOUT_HALF.questions.colXStart.length;
  if (questionCount > maxQ) {
    throw new Error(`La media hoja solo tiene espacio para ${maxQ} preguntas`);
  }

  return {
    id: "hoja-media-a4",
    version: "1.0",
    page: { ...LAYOUT_HALF.page },
    bubbleDiameterMm: LAYOUT_HALF.bubbleDiameter,
    markers: makeMarkers(),
    calibration: makeCalibration(),
    groups: [...makeAddedGroups(), ...makeQuestionGroups(questionCount)],
    reserved: [
      { id: "cabecera", rect: { ...LAYOUT_HALF.cabecera } },
      { id: "indicaciones", rect: { ...LAYOUT_HALF.indicaciones } },
    ],
  };
}

/**
 * Separación mínima REAL entre cualquier par de burbujas del layout, en mm.
 * Expuesta para que el test la compare contra MEASUREMENT_REACH_MM + el
 * radio de burbuja — la verificación que validateTemplate() no hace (su
 * propio piso, bubbleDiameterMm + 0.8 = 3.8mm, es más laxo que el que
 * impone measurement.ts en la práctica).
 */
export function minBubbleSeparationMm(t: Template): number {
  const all = t.groups.flatMap((g) => g.bubbles);
  let min = Infinity;
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      const a = all[i]!.center, b = all[j]!.center;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < min) min = d;
    }
  }
  return min;
}

/**
 * Distancia mínima entre el borde de cualquier burbuja y el borde de
 * cualquier parche de calibración, en mm.
 *
 * Existe porque `validateTemplate()` NO mira los parches: solo recorre
 * `groups[].bubbles`. Los parches viven en `t.calibration`, y nada
 * comprobaba que estuvieran fuera del alcance de muestreo de una burbuja
 * — que es exactamente el bug que tuvo la primera versión de esta
 * plantilla (ver la nota de `calibration` arriba).
 */
export function minBubbleToCalibrationMm(t: Template): number {
  const r = t.bubbleDiameterMm / 2;
  let min = Infinity;
  for (const p of t.calibration) {
    for (const g of t.groups) {
      for (const b of g.bubbles) {
        const dx = Math.max(p.rect.x - (b.center.x + r), b.center.x - r - (p.rect.x + p.rect.w), 0);
        const dy = Math.max(p.rect.y - (b.center.y + r), b.center.y - r - (p.rect.y + p.rect.h), 0);
        min = Math.min(min, Math.hypot(dx, dy));
      }
    }
  }
  return min;
}

// `typeof process` primero, no directamente process.argv: este archivo
// también se empaqueta para el navegador (composeHalfSheetA4 correrá desde
// la app, no solo desde CLI) — mismo motivo que template.ts/officialTemplate.ts.
if (typeof process !== "undefined" && import.meta.url === `file://${process.argv[1]}`) {
  const t = buildHalfSheetTemplate(100);
  const errors = validateTemplate(t);
  const bubbles = t.groups.reduce((n, g) => n + g.bubbles.length, 0);
  const minSep = minBubbleSeparationMm(t);
  const reach = measurementReachMm(t);
  const r = t.bubbleDiameterMm / 2;
  // El ROI de una burbuja alcanza `reach` desde SU centro; la tinta de la
  // vecina empieza a (minSep - r) de ese mismo centro (el borde de SU
  // disco, no el de la propia). Por eso es "- r", no "- 2r": mezclar
  // diámetro y radio acá fue un bug real la primera vez que se escribió esto.
  const realMargin = minSep - r - reach;
  const calibClear = minBubbleToCalibrationMm(t);

  console.log(`Plantilla ${t.id} v${t.version}`);
  console.log(`  página: ${t.page.widthMm}×${t.page.heightMm}mm`);
  console.log(`  grupos: ${t.groups.length}  burbujas: ${bubbles}`);
  console.log(`  alcance del muestreo: ${reach.toFixed(3)}mm desde el centro de cada burbuja`);
  console.log(`  separación mínima entre burbujas: ${minSep.toFixed(2)}mm (piso validateTemplate: ${(r * 2 + 0.8).toFixed(2)}mm)`);
  console.log(`  margen real entre burbujas: ${realMargin.toFixed(3)}mm ${realMargin > 0 ? "✓" : "✗ NEGATIVO"}`);
  console.log(`  holgura burbuja↔parche de calibración: ${calibClear.toFixed(2)}mm ${calibClear > reach ? "✓" : "✗ EL MUESTREO ALCANZA EL PARCHE"}`);
  console.log(errors.length ? `\n✗ ${errors.length} errores:` : `\n✓ geometría válida`);
  errors.slice(0, 15).forEach((e) => console.log("  " + e));
}
