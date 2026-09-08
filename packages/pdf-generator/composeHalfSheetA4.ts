/**
 * composeHalfSheetA4.ts — Dibuja DOS medias hojas en una A4, para imprimir
 * y cortar por la mitad: cada mitad va a un alumno distinto.
 *
 * Sigue el mismo patrón de generateSheet.ts (dibuja desde cero, no hay PDF
 * base de un profesor) y DUPLICA sus primitivas de dibujo en vez de
 * importarlas — mismo criterio que composeOfficialSheet.ts, que ya duplicó
 * generateSheet.ts por la misma razón: cada script de este directorio es
 * autocontenido, y tocar generateSheet.ts u officialTemplate.ts para
 * "compartir" código arriesgaría la hoja oficial que ya está validada con
 * verdad conocida. Con este archivo son tres duplicaciones — si en algún
 * momento hay que tocar una de las tres, ESE es el momento de extraer un
 * módulo común (PROMPT.md §5), no antes.
 *
 * El motor NUNCA ve la A4 completa — solo una mitad ya cortada. Por eso
 * `buildHalfSheetTemplate()` describe una página de 210×148.5mm, y este
 * archivo la estampa dos veces en una A4 de 210×297mm (offset 0 y
 * offset 148.5) puramente para la impresión.
 */

import { PDFDocument, rgb, StandardFonts, type PDFPage, type PDFFont } from "pdf-lib";
import type { Template, RectMm, BubbleGroup } from "../../template.ts";
import { buildHalfSheetTemplate } from "./halfSheetTemplate.ts";

const PT_PER_MM = 72 / 25.4;
const mmToPt = (mm: number): number => mm * PT_PER_MM;

/**
 * A diferencia de generateSheet.ts (una sola hoja por página, offset
 * siempre 0), acá la MISMA plantilla se dibuja dos veces en alturas
 * distintas de una A4 física. `yOffsetMm` es la traducción vertical, en mm
 * de página real, DESPUÉS de invertir el eje Y de la media hoja — 0 para
 * la mitad de abajo, 148.5 (el alto de la media hoja) para la de arriba.
 */
function toPdfXY(xMm: number, yMm: number, halfHeightMm: number, yOffsetMm: number) {
  return { x: mmToPt(xMm), y: mmToPt(halfHeightMm - yMm + yOffsetMm) };
}

function drawRectMm(
  page: PDFPage, rect: RectMm, halfHeightMm: number, yOffsetMm: number,
  opts: { fill?: ReturnType<typeof rgb>; border?: ReturnType<typeof rgb> }
) {
  const { x, y } = toPdfXY(rect.x, rect.y + rect.h, halfHeightMm, yOffsetMm);
  page.drawRectangle({
    x, y, width: mmToPt(rect.w), height: mmToPt(rect.h),
    color: opts.fill,
    borderColor: opts.border,
    borderWidth: opts.border ? 0.5 : undefined,
  });
}

function drawMarkers(page: PDFPage, t: Template, yOffsetMm: number) {
  const H = t.page.heightMm;
  for (const m of t.markers) {
    const half = m.sizeMm / 2;
    drawRectMm(
      page, { x: m.center.x - half, y: m.center.y - half, w: m.sizeMm, h: m.sizeMm },
      H, yOffsetMm, { fill: rgb(0, 0, 0) }
    );
    if (m.notch) drawRectMm(page, m.notch, H, yOffsetMm, { fill: rgb(1, 1, 1) });
  }
}

function drawCalibration(page: PDFPage, t: Template, yOffsetMm: number) {
  const H = t.page.heightMm;
  for (const patch of t.calibration) {
    drawRectMm(page, patch.rect, H, yOffsetMm, patch.kind === "black"
      ? { fill: rgb(0, 0, 0) }
      : { fill: rgb(1, 1, 1), border: rgb(0, 0, 0) });
  }
}

/** Etiqueta del grupo: arriba si es columna de dígitos, a la izquierda si
 * es fila de pregunta — mismo criterio que generateSheet.ts. */
function drawGroupLabel(page: PDFPage, g: BubbleGroup, t: Template, font: PDFFont, yOffsetMm: number) {
  const first = g.bubbles[0];
  if (!first) return;

  const H = t.page.heightMm;
  const r = t.bubbleDiameterMm / 2;
  const size = 6;
  const gap = 1.2;
  const w = font.widthOfTextAtSize(g.printedLabel, size);

  if (g.kind === "digit") {
    const { x, y } = toPdfXY(first.center.x, first.center.y - r - gap, H, yOffsetMm);
    page.drawText(g.printedLabel, { x: x - w / 2, y, size, font });
  } else {
    const { x, y } = toPdfXY(first.center.x - r - gap, first.center.y, H, yOffsetMm);
    page.drawText(g.printedLabel, { x: x - w, y: y - size * 0.35, size, font });
  }
}

/** Fila 0-9 a la izquierda de la primera columna del código — sin esto el
 * alumno ve 10 burbujas idénticas y no sabe cuál es cuál (mismo problema
 * que ya resolvió composeOfficialSheet.ts::drawDigitRowLabels). */
function drawDigitRowLabels(page: PDFPage, t: Template, font: PDFFont, yOffsetMm: number) {
  const H = t.page.heightMm;
  const digitGroups = t.groups.filter((g) => g.kind === "digit");
  const first = digitGroups[0];
  if (!first) return;

  const xs = digitGroups.map((g) => g.bubbles[0]?.center.x).filter((x): x is number => x !== undefined);
  if (xs.length === 0) return;
  const leftMostX = Math.min(...xs);
  const size = 6;
  // 1mm, no 2: con 2mm el ancho del propio glifo ("0"-"9" a 6pt) empujaba
  // el borde izquierdo del texto DENTRO del hueco de la tabla de preguntas
  // — se veían pegadas en el PDF renderizado (ver la nota de idGrid.xStart
  // en halfSheetTemplate.ts, que es la otra mitad de este mismo arreglo).
  const gap = 1;

  for (const b of first.bubbles) {
    const w = font.widthOfTextAtSize(b.label, size);
    const { x, y } = toPdfXY(leftMostX - t.bubbleDiameterMm / 2 - gap, b.center.y, H, yOffsetMm);
    page.drawText(b.label, { x: x - w, y: y - size * 0.35, size, font });
  }
}

/**
 * "A B C D E" una sola vez por columna, arriba de la primera fila — no
 * repetido bajo cada burbuja como en la hoja oficial. Es lo que libera el
 * espacio entre filas que la media hoja necesita (ver la nota de cabecera
 * en halfSheetTemplate.ts). Las columnas se derivan de los datos reales del
 * Template (agrupando por la x de la opción A), no de una constante interna
 * de halfSheetTemplate.ts — así este archivo no depende de su layout privado.
 */
function drawColumnHeaders(page: PDFPage, t: Template, font: PDFFont, yOffsetMm: number) {
  const H = t.page.heightMm;
  const questionGroups = t.groups.filter((g) => g.kind === "question");
  if (questionGroups.length === 0) return;

  const topmostByColumnX = new Map<number, BubbleGroup>();
  for (const g of questionGroups) {
    const optionAX = g.bubbles[0]!.center.x;
    const current = topmostByColumnX.get(optionAX);
    if (!current || g.bubbles[0]!.center.y < current.bubbles[0]!.center.y) {
      topmostByColumnX.set(optionAX, g);
    }
  }

  const size = 6;
  const gap = 1.5;
  for (const g of topmostByColumnX.values()) {
    const topY = g.bubbles[0]!.center.y;
    for (const b of g.bubbles) {
      const w = font.widthOfTextAtSize(b.label, size);
      const { x, y } = toPdfXY(b.center.x, topY - t.bubbleDiameterMm / 2 - gap, H, yOffsetMm);
      page.drawText(b.label, { x: x - w / 2, y, size, font });
    }
  }
}

function drawBubbles(page: PDFPage, t: Template, font: PDFFont, yOffsetMm: number) {
  const H = t.page.heightMm;
  const r = mmToPt(t.bubbleDiameterMm / 2);

  for (const group of t.groups) {
    drawGroupLabel(page, group, t, font, yOffsetMm);
    for (const b of group.bubbles) {
      const { x, y } = toPdfXY(b.center.x, b.center.y, H, yOffsetMm);
      page.drawCircle({ x, y, size: r, borderColor: rgb(0, 0, 0), borderWidth: 0.75 });
    }
  }
  drawColumnHeaders(page, t, font, yOffsetMm);
  drawDigitRowLabels(page, t, font, yOffsetMm);
}

/** Lo que el profesor define en la app para esta media hoja concreta. */
export interface HeaderInfo {
  institucion: string;
  curso: string;
  tipoExamen: string;
}

/**
 * Cabecera: una línea impresa (lo que definió el profesor) + los renglones
 * manuscritos. El motor no lee nada de esto — es texto para la persona,
 * igual que el resto de la hoja fuera de las burbujas — pero SÍ está
 * declarado en `t.reserved` para que validateTemplate() garantice que
 * ninguna burbuja caiga encima.
 */
function drawCabecera(page: PDFPage, t: Template, info: HeaderInfo, font: PDFFont, bold: PDFFont, yOffsetMm: number) {
  const H = t.page.heightMm;
  const cab = t.reserved.find((r) => r.id === "cabecera")!.rect;

  const linea1 = `${info.institucion} · ${info.curso} · ${info.tipoExamen}`;
  {
    const { x, y } = toPdfXY(cab.x, cab.y + 3, H, yOffsetMm);
    page.drawText(linea1, { x, y, size: 8, font: bold });
  }

  const putLabel = (text: string, xMm: number, yMm: number, size: number) => {
    const { x, y } = toPdfXY(xMm, yMm, H, yOffsetMm);
    page.drawText(text, { x, y, size, font });
  };
  const drawLineMm = (x0: number, yMm: number, x1: number) => {
    const p0 = toPdfXY(x0, yMm, H, yOffsetMm);
    const p1 = toPdfXY(x1, yMm, H, yOffsetMm);
    page.drawLine({ start: p0, end: p1, thickness: 0.6, color: rgb(0, 0, 0) });
  };

  // Renglón 2: nombre completo, a todo el ancho de la cabecera — es el
  // campo que en el intento anterior (6 columnas, grid del código arriba)
  // no entraba: acá tiene los ~150mm que un nombre completo necesita.
  //
  // Espaciado entre renglones (4mm, no 5): en la primera pasada, el
  // renglón 3 (y=cab.y+13.5) quedaba a 0.5mm del encabezado "A B C D E" de
  // la tabla — casi la misma línea, texto superpuesto en el PDF
  // renderizado. Apretar acá deja ~4mm libres antes de esa fila (ver
  // halfSheetTemplate.ts::LAYOUT_HALF.cabecera para el otro lado del ajuste).
  // +31, no +34: medido con font.widthOfTextAtSize, la etiqueta ocupa
  // 29.7mm a 7pt — dejaba 4.3mm de aire de más antes de la línea, cuando
  // el renglón para el nombre es justamente el campo que el intento
  // anterior (6 columnas) no lograba encajar. Con 31 el renglón mide
  // ~139mm, sin apretar el texto de la etiqueta (1.3mm de gap real).
  const y2 = cab.y + 7;
  putLabel("NOMBRES Y APELLIDOS:", cab.x, y2, 7);
  drawLineMm(cab.x + 31, y2 + 0.8, cab.x + cab.w);

  // Renglón 3: grado/sección + fecha, comparten renglón.
  const y3 = cab.y + 11;
  putLabel("GRADO/SECCIÓN:", cab.x, y3, 7);
  drawLineMm(cab.x + 26, y3 + 0.8, cab.x + 75);
  putLabel("FECHA:", cab.x + 82, y3, 7);
  drawLineMm(cab.x + 94, y3 + 0.8, cab.x + cab.w);
}

/** Dibuja una media hoja completa (marcadores, calibración, burbujas,
 * cabecera) en `page`, desplazada `yOffsetMm` desde el borde inferior. */
function drawHalfSheet(page: PDFPage, t: Template, info: HeaderInfo, font: PDFFont, bold: PDFFont, yOffsetMm: number) {
  drawMarkers(page, t, yOffsetMm);
  drawCalibration(page, t, yOffsetMm);
  drawBubbles(page, t, font, yOffsetMm);
  drawCabecera(page, t, info, font, bold, yOffsetMm);
}

/**
 * Línea de corte punteada exactamente donde las dos mitades se tocan
 * (y = t.page.heightMm en la A4 completa) + una marca de tijera en cada
 * extremo. Sin esto, cortar "más o menos a la mitad" arriesga recortar un
 * marcador — a 12mm del borde de corte, un desvío de más de 12mm produce
 * MARKERS_NOT_FOUND (rechazo seguro), pero un desvío menor que deja pegado
 * un pedazo del marcador de la OTRA mitad puede confundir al detector.
 */
function drawCutGuide(page: PDFPage, fullHeightMm: number, widthMm: number) {
  const cutYMm = fullHeightMm / 2;
  const pt = (xMm: number) => ({ x: mmToPt(xMm), y: mmToPt(fullHeightMm - cutYMm) });

  const dashLenMm = 3, gapMm = 2;
  let x = 8;
  while (x < widthMm - 8) {
    const x1 = Math.min(x + dashLenMm, widthMm - 8);
    page.drawLine({ start: pt(x), end: pt(x1), thickness: 0.4, color: rgb(0.5, 0.5, 0.5) });
    x += dashLenMm + gapMm;
  }
}

export async function composeHalfSheetA4(t: Template, info: HeaderInfo): Promise<Uint8Array> {
  if (Math.abs(t.page.widthMm - 210) > 0.5) {
    throw new Error(`composeHalfSheetA4 espera una media hoja de 210mm de ancho, la Template mide ${t.page.widthMm}mm`);
  }

  const doc = await PDFDocument.create();
  const fullHeightMm = t.page.heightMm * 2;
  const page = doc.addPage([mmToPt(t.page.widthMm), mmToPt(fullHeightMm)]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // Mitad de abajo (offset 0) y mitad de arriba (offset = alto de una
  // media hoja): las dos son EL MISMO Template, dibujado dos veces — cada
  // una se convierte en la hoja privada de un alumno distinto al cortar.
  drawHalfSheet(page, t, info, font, bold, 0);
  drawHalfSheet(page, t, info, font, bold, t.page.heightMm);
  drawCutGuide(page, fullHeightMm, t.page.widthMm);

  return doc.save();
}

if (typeof process !== "undefined" && import.meta.url === `file://${process.argv[1]}`) {
  const { writeFileSync } = await import("node:fs");
  const t = buildHalfSheetTemplate(100);
  const bytes = await composeHalfSheetA4(t, {
    institucion: "I.E. Ejemplo",
    curso: "Comunicación",
    tipoExamen: "Examen bimestral",
  });
  writeFileSync("hoja-media-a4.pdf", bytes);
  console.log(`✓ hoja-media-a4.pdf generado (${bytes.length} bytes) — 2 mitades de ${t.page.widthMm}×${t.page.heightMm}mm en una A4`);
}
