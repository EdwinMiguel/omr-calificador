/**
 * template.ts — Fuente única de verdad de la geometría de la hoja.
 *
 * TODAS las coordenadas están en MILÍMETROS sobre una página A4.
 * La conversión a píxeles ocurre en un solo lugar (mmToPx), en el momento
 * de procesar, según el DPI del lienzo canónico.
 *
 * De este archivo consumen:
 *   - el generador de PDF (dibuja la hoja física)
 *   - el motor OMR       (sabe dónde muestrear cada burbuja)
 *   - el overlay de debug(dibuja los ROIs sobre la imagen normalizada)
 *   - el generador sintético (rellena burbujas con respuestas conocidas)
 *
 * Regla: NADA en el sistema puede tener una coordenada hardcodeada.
 * Si necesitas mover una burbuja, se mueve aquí y todo lo demás sigue.
 */

// ─────────────────────────────────────────────────────────────
// Tipos
// ─────────────────────────────────────────────────────────────

export interface PointMm { x: number; y: number }
export interface RectMm { x: number; y: number; w: number; h: number }

export interface Marker {
  id: "TL" | "TR" | "BR" | "BL";
  center: PointMm;
  sizeMm: number;
  /** Muesca blanca interior — solo el TL la tiene. Resuelve rotación de 180°. */
  notch?: RectMm;
}

export interface Bubble {
  /** Índice dentro del grupo: 0=A, 1=B... o 0..9 para dígitos. */
  index: number;
  label: string;
  center: PointMm;
}

export type GroupKind = "question" | "digit" | "version";

export interface BubbleGroup {
  id: string;
  kind: GroupKind;
  /** Para preguntas: número de pregunta. Para dígitos: posición del dígito. */
  ordinal: number;
  /** Etiqueta impresa a la izquierda del grupo (ej. "12", "D1"). */
  printedLabel: string;
  bubbles: Bubble[];
}

export interface CalibrationPatch {
  kind: "black" | "white";
  rect: RectMm;
}

export interface Template {
  id: string;
  version: string;
  page: { widthMm: number; heightMm: number };
  bubbleDiameterMm: number;
  markers: Marker[];
  calibration: CalibrationPatch[];
  groups: BubbleGroup[];
  /**
   * Zonas ocupadas por contenido que el engine NO muestrea: texto impreso,
   * cabeceras, futuro QR. validateTemplate() verifica que ninguna burbuja
   * caiga dentro de ellas.
   */
  reserved: { id: string; rect: RectMm }[];
}

// ─────────────────────────────────────────────────────────────
// Conversión mm ↔ px — el único lugar donde ocurre
// ─────────────────────────────────────────────────────────────

export const mmToPx = (mm: number, dpi: number): number => (mm / 25.4) * dpi;
export const pxToMm = (px: number, dpi: number): number => (px / dpi) * 25.4;

/** Tamaño del lienzo canónico al que warpPerspective lleva toda hoja. */
export function canvasSize(t: Template, dpi: number) {
  return {
    width: Math.round(mmToPx(t.page.widthMm, dpi)),
    height: Math.round(mmToPx(t.page.heightMm, dpi)),
  };
}

/** ROI de muestreo de una burbuja, encogido para no tocar el contorno impreso. */
export function bubbleRoi(
  b: Bubble, t: Template, dpi: number, shrink = 0.8
): { x: number; y: number; w: number; h: number } {
  const d = mmToPx(t.bubbleDiameterMm, dpi) * shrink;
  return {
    x: Math.round(mmToPx(b.center.x, dpi) - d / 2),
    y: Math.round(mmToPx(b.center.y, dpi) - d / 2),
    w: Math.round(d),
    h: Math.round(d),
  };
}

/** Esquinas canónicas de los marcadores, destino de la homografía. */
export function canonicalMarkers(t: Template, dpi: number): PointMm[] {
  const order: Marker["id"][] = ["TL", "TR", "BR", "BL"];
  return order.map((id) => {
    const m = t.markers.find((k) => k.id === id)!;
    return { x: mmToPx(m.center.x, dpi), y: mmToPx(m.center.y, dpi) };
  });
}

// ─────────────────────────────────────────────────────────────
// Construcción de la plantilla v1
// ─────────────────────────────────────────────────────────────

const LAYOUT = {
  page: { widthMm: 210, heightMm: 297 },   // A4

  bubbleDiameter: 4.5,
  pitch: 6,            // separación centro a centro, horizontal y vertical

  marker: { size: 8, inset: 12 },          // centro a 12 mm de cada borde

  calibration: { y: 22, size: 6, gap: 3, xStart: 20, count: 3 },

  // Bloque de identificación
  idGrid:   { xStart: 20,  yStart: 44, digits: 8, rows: 10 },
  examGrid: { xStart: 95,  yStart: 44, digits: 3, rows: 10 },
  version:  { xStart: 125, yStart: 44, options: ["A", "B", "C", "D"] },
  qrReserve:{ x: 168, y: 34, w: 25, h: 25 },

  // Bloque de preguntas: 4 columnas × 25 preguntas = 100
  questions: {
    yStart: 128,
    perColumn: 25,
    columns: 4,
    columnXStart: 28,     // x del centro de la burbuja A
    columnWidth: 42,      // separación entre inicios de columna
    options: ["A", "B", "C", "D", "E"],
  },
} as const;

function makeMarkers(): Marker[] {
  const { size, inset } = LAYOUT.marker;
  const { widthMm: W, heightMm: H } = LAYOUT.page;
  const half = size / 2;

  return [
    {
      id: "TL",
      center: { x: inset, y: inset },
      sizeMm: size,
      // Muesca en la esquina INTERIOR (hacia el centro de la hoja).
      notch: { x: inset + half - 3, y: inset + half - 3, w: 3, h: 3 },
    },
    { id: "TR", center: { x: W - inset, y: inset },     sizeMm: size },
    { id: "BR", center: { x: W - inset, y: H - inset }, sizeMm: size },
    { id: "BL", center: { x: inset,     y: H - inset }, sizeMm: size },
  ];
}

function makeCalibration(): CalibrationPatch[] {
  const { y, size, gap, xStart, count } = LAYOUT.calibration;
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

/** Columna vertical de dígitos 0-9 (una por posición del número). */
function makeDigitColumn(
  id: string, ordinal: number, label: string, x: number, yStart: number
): BubbleGroup {
  return {
    id, kind: "digit", ordinal, printedLabel: label,
    bubbles: Array.from({ length: LAYOUT.idGrid.rows }, (_, d) => ({
      index: d,
      label: String(d),
      center: { x, y: yStart + d * LAYOUT.pitch },
    })),
  };
}

function makeIdGroups(): BubbleGroup[] {
  const groups: BubbleGroup[] = [];

  const { xStart, yStart, digits } = LAYOUT.idGrid;
  for (let i = 0; i < digits; i++) {
    groups.push(makeDigitColumn(
      `dni.${i}`, i, `D${i + 1}`, xStart + i * LAYOUT.pitch, yStart
    ));
  }

  const ex = LAYOUT.examGrid;
  for (let i = 0; i < ex.digits; i++) {
    groups.push(makeDigitColumn(
      `exam.${i}`, i, `E${i + 1}`, ex.xStart + i * LAYOUT.pitch, ex.yStart
    ));
  }

  // Versión / forma del examen — fila horizontal A B C D
  groups.push({
    id: "version",
    kind: "version",
    ordinal: 0,
    printedLabel: "FORMA",
    bubbles: LAYOUT.version.options.map((label, i) => ({
      index: i,
      label,
      center: {
        x: LAYOUT.version.xStart + i * LAYOUT.pitch,
        y: LAYOUT.version.yStart,
      },
    })),
  });

  return groups;
}

function makeQuestionGroups(count: number): BubbleGroup[] {
  const q = LAYOUT.questions;
  const groups: BubbleGroup[] = [];

  for (let n = 0; n < count; n++) {
    const col = Math.floor(n / q.perColumn);
    const row = n % q.perColumn;
    const baseX = q.columnXStart + col * q.columnWidth;
    const y = q.yStart + row * LAYOUT.pitch;

    groups.push({
      id: `q.${n + 1}`,
      kind: "question",
      ordinal: n + 1,
      printedLabel: String(n + 1),
      bubbles: q.options.map((label, i) => ({
        index: i,
        label,
        center: { x: baseX + i * LAYOUT.pitch, y },
      })),
    });
  }
  return groups;
}

/**
 * Construye la plantilla.
 * @param questionCount 50 para validar el MVP, 100 para la hoja completa.
 */
export function buildTemplate(questionCount: 50 | 100 = 50): Template {
  if (questionCount > LAYOUT.questions.perColumn * LAYOUT.questions.columns) {
    throw new Error(`No caben ${questionCount} preguntas en el layout actual`);
  }

  return {
    id: "hoja-estandar",
    version: "1.0",
    page: { ...LAYOUT.page },
    bubbleDiameterMm: LAYOUT.bubbleDiameter,
    markers: makeMarkers(),
    calibration: makeCalibration(),
    groups: [...makeIdGroups(), ...makeQuestionGroups(questionCount)],
    reserved: [{ id: "qr", rect: { ...LAYOUT.qrReserve } }],
  };
}

// ─────────────────────────────────────────────────────────────
// Autocomprobación de geometría — corre esto tras cualquier cambio
// ─────────────────────────────────────────────────────────────

export function validateTemplate(t: Template): string[] {
  const errors: string[] = [];
  const SAFE_MARGIN = 20;   // zona de silencio alrededor de los marcadores
  const r = t.bubbleDiameterMm / 2;

  const all = t.groups.flatMap((g) => g.bubbles.map((b) => ({ g, b })));

  for (const { g, b } of all) {
    // ¿Se sale de la página?
    if (b.center.x - r < 5 || b.center.x + r > t.page.widthMm - 5 ||
        b.center.y - r < 5 || b.center.y + r > t.page.heightMm - 5) {
      errors.push(`${g.id}[${b.label}] fuera de página en (${b.center.x}, ${b.center.y})`);
    }
    // ¿Invade la zona de un marcador?
    for (const m of t.markers) {
      const d = Math.hypot(b.center.x - m.center.x, b.center.y - m.center.y);
      if (d < SAFE_MARGIN) {
        errors.push(`${g.id}[${b.label}] invade la zona del marcador ${m.id}`);
      }
    }
    // ¿Invade una zona reservada?
    for (const res of t.reserved) {
      if (b.center.x > res.rect.x - r && b.center.x < res.rect.x + res.rect.w + r &&
          b.center.y > res.rect.y - r && b.center.y < res.rect.y + res.rect.h + r) {
        errors.push(`${g.id}[${b.label}] invade la zona reservada '${res.id}'`);
      }
    }
  }

  // ¿Dos burbujas demasiado juntas? (solape físico o ambigüedad de lectura)
  const MIN_SEP = t.bubbleDiameterMm + 0.8;
  for (let i = 0; i < all.length; i++) {
    const first = all[i]!;
    for (let j = i + 1; j < all.length; j++) {
      const second = all[j]!;
      const a = first.b.center, c = second.b.center;
      if (Math.hypot(a.x - c.x, a.y - c.y) < MIN_SEP) {
        errors.push(`${first.g.id}[${first.b.label}] y ${second.g.id}[${second.b.label}] demasiado juntas`);
      }
    }
  }

  return errors;
}

// ─────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const t = buildTemplate(50);
  const errors = validateTemplate(t);
  const bubbles = t.groups.reduce((n, g) => n + g.bubbles.length, 0);

  console.log(`Plantilla ${t.id} v${t.version}`);
  console.log(`  grupos:   ${t.groups.length}`);
  console.log(`  burbujas: ${bubbles}`);
  console.log(`  lienzo @200 DPI: ${JSON.stringify(canvasSize(t, 200))}`);
  console.log(`  ROI de burbuja @200 DPI: ${JSON.stringify(bubbleRoi(t.groups.at(-1)!.bubbles[0]!, t, 200))}`);
  console.log(errors.length ? `\n✗ ${errors.length} errores:` : `\n✓ geometría válida`);
  errors.slice(0, 10).forEach((e) => console.log("  " + e));
}
