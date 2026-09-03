/**
 * officialTemplate.ts — Template de la hoja OFICIAL del profesor.
 *
 * Describe `Hoja_Respuestas_OMR_100_Preguntas_Compacta_Una_Cara.pdf`, que es
 * la hoja que el colegio va a usar, MÁS los elementos que ese PDF no tenía y
 * que el pipeline necesita para poder procesarla.
 *
 * ┌─ ORIGEN DE CADA NÚMERO ────────────────────────────────────────────────┐
 * │ MEDIDO   → extraído del content stream del PDF oficial parseando los    │
 * │            operadores de dibujo (q/Q/cm + curvas Bézier) y convertido   │
 * │            a mm con origen arriba-izquierda. No son valores elegidos.   │
 * │ AÑADIDO  → geometría nueva que el PDF oficial no tenía. Elegida para    │
 * │            caer en zonas libres, verificada con validateTemplate().     │
 * └────────────────────────────────────────────────────────────────────────┘
 *
 * Lo que el PDF oficial NO tenía y aquí se añade:
 *   - 4 marcadores fiduciales      → sin ellos findFiducials() falla siempre
 *   - parches de calibración       → Día 10 / Gate 3
 *   - grid de 7 dígitos del CÓDIGO → el PDF solo tiene "CÓDIGO: ______"
 *
 * El campo "TIPO DE EXAMEN" del profesor se deja como estaba, en texto libre.
 * Ver la nota al pie: no se sabe todavía qué significa.
 *
 * El texto del profesor (institución, curso, nombres, fecha, indicaciones)
 * NO se redibuja: viene del PDF original, que se usa como fondo intacto.
 * Aquí solo se declara su zona en `reserved` para que validateTemplate()
 * verifique que ninguna burbuja nueva lo invada.
 */

import {
  validateTemplate,
  type Template,
  type Marker,
  type CalibrationPatch,
  type BubbleGroup,
} from "../../template.ts";

/**
 * Regiones del PDF oficial y cuánto se desplaza cada una al recomponer.
 *
 * El PDF original no deja hueco entre la cabecera y la tabla, y su esquina
 * superior izquierda está ocupada por "INSTITUCIÓN:", justo donde tiene que
 * ir el marcador fiducial. Por eso la página se recompone en tres bloques:
 * el título se queda donde está, la cabecera baja lo justo para liberar la
 * esquina, y la tabla baja lo suficiente para abrir arriba el hueco del
 * código del alumno.
 *
 * El código va ARRIBA, antes de la tabla, a propósito: al final de la hoja
 * es lo primero que un alumno se salta, y una hoja sin código es una hoja
 * que no se puede asignar a nadie.
 *
 * Los límites de cada región son MEDIDOS (líneas de la tabla en y[28.2,179.0];
 * cabecera en y[14.7,26.1] — 5 líneas de 6 pt con interlineado 6.5 pt).
 */
export const REGIONS = {
  titulo: { topMm: 4, bottomMm: 14, shiftMm: 0 },
  header: { topMm: 14, bottomMm: 27.9, shiftMm: 8 },
  tabla: { topMm: 27.9, bottomMm: 180, shiftMm: 70.5 },
} as const;

/**
 * "CÓDIGO: ___________" comparte línea con "GRADO/SECCIÓN: __________" en la
 * cabecera original. Se tapa en blanco tras desplazar la cabecera, porque el
 * código pasa a marcarse con burbujas: pedirlo también a mano invita a que
 * ambos valores discrepen, y entonces no se sabe cuál vale.
 *
 * Las cinco líneas de la cabecera van a 6 pt con interlineado de 6.5 pt
 * (2.29 mm), así que la ventana libre entre la línea de NOMBRES y la de
 * INDICACIONES es de apenas ~2.8 mm: la tapa tiene que ser ajustada o se
 * come las líneas vecinas.
 *
 * Medido con las métricas reales de la fuente, no estimado:
 *   x → "CÓDIGO:" arranca en 41.64 y sus blancos terminan en 64.47
 *       ("GRADO/SECCIÓN: __________" acaba antes, en 40.47)
 *   y → baseline de la línea 4 en 23.76 (+8 de desplazamiento = 31.76);
 *       ocupa [30.17, 32.02] contando el acento de la Ó y los guiones bajos
 * Coordenadas ya con el desplazamiento de la cabecera aplicado.
 */
export const CODIGO_TEXTO_TAPA = { x: 41.4, y: 29.9, w: 23.4, h: 2.4 } as const;

const LAYOUT_OFICIAL = {
  // MEDIDO — A4 exacto.
  page: { widthMm: 210, heightMm: 297 },

  // MEDIDO — las 500 burbujas del PDF tienen todas 3 mm de diámetro.
  // Es notablemente menor que los 4.5 mm de la hoja propia (template.ts);
  // ver la nota de RIESGO al pie de este archivo.
  bubbleDiameter: 3,

  // MEDIDO + DESPLAZADO — bloque de preguntas: 25 filas × 4 columnas de 5
  // opciones. En el PDF original la fila 1 está en y=36.93; aquí se le suma
  // REGIONS.tabla.shiftMm porque la tabla se reubica al recomponer. Las x no
  // cambian: el desplazamiento es solo vertical.
  questions: {
    yStart: 36.93 + REGIONS.tabla.shiftMm,
    rowPitch: 5.8,      // 36.93 + 24 × 5.8 = 176.13 = centro de la fila 25
    perColumn: 25,
    colXStart: [41, 79, 117, 155], // centro de la opción A de cada columna
    optionPitch: 5,
    options: ["A", "B", "C", "D", "E"],
  },

  // Zona de la tabla ya recolocada, para que validateTemplate() detecte
  // cualquier elemento añadido que se le encime.
  contentZone: {
    x: 26,
    y: REGIONS.tabla.topMm + REGIONS.tabla.shiftMm,
    w: 159,
    h: REGIONS.tabla.bottomMm - REGIONS.tabla.topMm,
  },

  // AÑADIDO — marcadores en las 4 esquinas. Inset 12 mm: lo bastante dentro
  // para sobrevivir al margen no imprimible de una impresora doméstica, y lo
  // bastante fuera para no tocar el contenido una vez recompuesto.
  marker: { size: 8, inset: 12 },

  // AÑADIDO — hueco abierto arriba al bajar la tabla: y[40, 93].
  // Mismo pitch de 5 mm que el resto de la hoja oficial.
  idGrid: { xStart: 40, yStart: 48, digits: 7, pitch: 5, rows: 10 },

  // SIN grupo `version` a propósito — ver la nota al pie sobre TIPO DE EXAMEN.

  // AÑADIDO — franja libre bajo la tabla recolocada (termina en y≈250.5).
  calibration: { y: 261, size: 6, gap: 3, xStart: 40, count: 3 },
} as const;

function makeMarkers(): Marker[] {
  const { size, inset } = LAYOUT_OFICIAL.marker;
  const { widthMm: W, heightMm: H } = LAYOUT_OFICIAL.page;
  const half = size / 2;

  return [
    {
      id: "TL",
      center: { x: inset, y: inset },
      sizeMm: size,
      // Muesca en la esquina interior: única asimetría de los 4 marcadores,
      // es lo que permite detectar y corregir una hoja rotada 180°.
      notch: { x: inset + half - 3, y: inset + half - 3, w: 3, h: 3 },
    },
    { id: "TR", center: { x: W - inset, y: inset }, sizeMm: size },
    { id: "BR", center: { x: W - inset, y: H - inset }, sizeMm: size },
    { id: "BL", center: { x: inset, y: H - inset }, sizeMm: size },
  ];
}

function makeCalibration(): CalibrationPatch[] {
  const { y, size, gap, xStart, count } = LAYOUT_OFICIAL.calibration;
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
  const { yStart, pitch, rows } = LAYOUT_OFICIAL.idGrid;
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

/**
 * Grupos añadidos al PDF oficial. Por ahora solo el código del alumno: esta
 * plantilla NO lleva grupo `version` (ver la nota sobre TIPO DE EXAMEN al pie).
 */
function makeAddedGroups(): BubbleGroup[] {
  const { xStart, digits, pitch } = LAYOUT_OFICIAL.idGrid;
  return Array.from({ length: digits }, (_, i) =>
    makeDigitColumn(i, xStart + i * pitch)
  );
}

/**
 * Reconstruye los 100 grupos de preguntas en las coordenadas MEDIDAS del PDF.
 * La numeración sigue al PDF oficial: 1-25 en la columna 1, 26-50 en la 2, etc.
 */
function makeQuestionGroups(count: number): BubbleGroup[] {
  const q = LAYOUT_OFICIAL.questions;
  const groups: BubbleGroup[] = [];

  for (let n = 0; n < count; n++) {
    const col = Math.floor(n / q.perColumn);
    const row = n % q.perColumn;
    const baseX = q.colXStart[col];
    if (baseX === undefined) {
      throw new Error(`La pregunta ${n + 1} cae en la columna ${col}, que no existe en el PDF oficial`);
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

export function buildOfficialTemplate(questionCount = 100): Template {
  const maxQ = LAYOUT_OFICIAL.questions.perColumn * LAYOUT_OFICIAL.questions.colXStart.length;
  if (questionCount > maxQ) {
    throw new Error(`El PDF oficial solo tiene ${maxQ} preguntas impresas`);
  }

  return {
    id: "hoja-oficial-colegio",
    version: "1.0",
    page: { ...LAYOUT_OFICIAL.page },
    bubbleDiameterMm: LAYOUT_OFICIAL.bubbleDiameter,
    markers: makeMarkers(),
    calibration: makeCalibration(),
    groups: [...makeAddedGroups(), ...makeQuestionGroups(questionCount)],
    reserved: [{ id: "contenido-profesor", rect: { ...LAYOUT_OFICIAL.contentZone } }],
  };
}

/**
 * Las burbujas de preguntas están DENTRO de contentZone (son parte del
 * contenido del profesor), así que la validación genérica de zonas
 * reservadas las marcaría a todas. Aquí solo se valida lo AÑADIDO, que es
 * lo único cuya posición elegimos nosotros y por tanto puede colisionar.
 */
export function validateAddedGeometry(t: Template): string[] {
  const added = t.groups.filter((g) => g.kind !== "question");
  return validateTemplate({ ...t, groups: added });
}

// `typeof process` primero, y no directamente process.argv: este archivo
// también se empaqueta para el navegador (el motor corre client-side en un
// Web Worker), donde `process` no existe y evaluarlo aquí lanzaba
// "ReferenceError: process is not defined" al cargar el worker. El bloque
// sigue funcionando igual al correr el archivo con tsx en Node.
if (typeof process !== "undefined" && import.meta.url === `file://${process.argv[1]}`) {
  const t = buildOfficialTemplate(100);
  const errors = validateAddedGeometry(t);
  const qs = t.groups.filter((g) => g.kind === "question");
  const bubbles = t.groups.reduce((n, g) => n + g.bubbles.length, 0);

  console.log(`Plantilla ${t.id} v${t.version}`);
  console.log(`  preguntas: ${qs.length} × ${qs[0]?.bubbles.length} opciones`);
  console.log(`  grupos totales: ${t.groups.length}  burbujas: ${bubbles}`);
  console.log(`  diámetro de burbuja: ${t.bubbleDiameterMm} mm`);
  console.log(errors.length ? `\n✗ ${errors.length} errores en geometría añadida:` : `\n✓ geometría añadida válida`);
  errors.slice(0, 10).forEach((e) => console.log("  " + e));
}

/**
 * ─── PENDIENTE: qué es "TIPO DE EXAMEN" ────────────────────────────────
 * El PDF del profesor trae "TIPO DE EXAMEN: ______" como texto libre, con
 * una línea larga. Esa longitud sugiere texto descriptivo ("Bimestral",
 * "Recuperación"), no una letra de versión A-D. Se llegó a añadir un grupo
 * `version` con burbujas A-D y se retiró: el significado del campo no está
 * confirmado con el profesor, y suponerlo tenía dos costes — duplicaba un
 * campo que ya existía en la cabecera, y fijaba en 4 un número de variantes
 * que nadie confirmó.
 *
 * Mientras tanto la hoja se corrige con UNA clave única. Si el profesor
 * confirma que sí usa versiones barajadas, hay que volver a añadir el grupo
 * `version` ANTES de imprimir en cantidad: leer la versión con la clave
 * equivocada produce notas catastróficas de apariencia normal (§13.8), y es
 * el fallo más difícil de detectar de todo el sistema.
 *
 * El engine no necesita cambios por esto: `GroupKind` ya contempla
 * "version", y una plantilla sin ese grupo simplemente usa clave única.
 */

/**
 * ─── RIESGO CONOCIDO, pendiente de medir (§7 "nada de magia") ───────────
 * Las burbujas del PDF oficial son de 3 mm, frente a los 4.5 mm de la hoja
 * propia. A 200 DPI eso son ~24 px de diámetro, y el ROI encogido al 80%
 * deja ~19 px de lado para calcular el fillRatio. Es viable, pero da menos
 * margen que la hoja propia ante desenfoque, sombra o baja resolución —
 * justo las condiciones de una foto de celular (§1 del prompt).
 *
 * Esto NO se resuelve suponiendo: se decide con la evidencia del Gate 2
 * (tabla de fillRatios) y del Gate 3 (tres condiciones de luz). Si el
 * margen resulta insuficiente, la conversación con el colegio es agrandar
 * la burbuja a ~4 mm — cambio barato mientras no se haya impreso en
 * cantidad, caro después (§5).
 */
