/**
 * generateSheet.ts — Dibuja la hoja física a partir de Template.
 *
 * Trabaja en puntos PDF (pt = 1/72 pulgada), no en píxeles: un PDF es
 * vectorial, no tiene DPI propio. mmToPt es la única conversión que usamos
 * aquí; mmToPx (template.ts) es para cuando alguien RASTERIZA algo a una
 * grilla de píxeles — eso todavía no pasa en este archivo.
 *
 * PDF-lib mide el origen (0,0) en la esquina INFERIOR izquierda, con el eje Y
 * creciendo hacia arriba. Template mide el origen en la esquina SUPERIOR
 * izquierda, con Y creciendo hacia abajo (igual que el papel real). toPdfXY
 * es donde se resuelve ese desajuste — únicamente ahí.
 */

import { PDFDocument, rgb, StandardFonts, type PDFPage, type PDFFont } from "pdf-lib";
import {
  buildTemplate,
  validateTemplate,
  type Template,
  type RectMm,
  type BubbleGroup,
} from "../../template.ts";

const PT_PER_MM = 72 / 25.4;
const mmToPt = (mm: number): number => mm * PT_PER_MM;

function toPdfXY(xMm: number, yMm: number, pageHeightMm: number): { x: number; y: number } {
  return { x: mmToPt(xMm), y: mmToPt(pageHeightMm - yMm) };
}

function drawSquareMm(
  page: PDFPage, centerXMm: number, centerYMm: number, sizeMm: number,
  pageHeightMm: number, color: ReturnType<typeof rgb>
): void {
  const half = sizeMm / 2;
  const { x, y } = toPdfXY(centerXMm - half, centerYMm + half, pageHeightMm);
  page.drawRectangle({ x, y, width: mmToPt(sizeMm), height: mmToPt(sizeMm), color });
}

/**
 * En Template, `rect.y` es el borde SUPERIOR y el rectángulo crece hacia
 * abajo — así lo interpreta validateTemplate() y así lo leerá el engine.
 * pdf-lib ancla el rectángulo en su esquina INFERIOR izquierda y crece hacia
 * arriba, de modo que hay que convertir el borde inferior (`rect.y + rect.h`),
 * no el superior. Convertir `rect.y` directamente desplaza el rectángulo
 * `rect.h` mm hacia arriba: la tinta acaba fuera de donde el engine muestrea.
 */
function drawRectMm(
  page: PDFPage, rect: RectMm, pageHeightMm: number,
  opts: { fill?: ReturnType<typeof rgb>; border?: ReturnType<typeof rgb> }
): void {
  const { x, y } = toPdfXY(rect.x, rect.y + rect.h, pageHeightMm);
  page.drawRectangle({
    x, y, width: mmToPt(rect.w), height: mmToPt(rect.h),
    color: opts.fill,
    borderColor: opts.border,
    borderWidth: opts.border ? 0.5 : undefined,
  });
}

function drawMarkers(page: PDFPage, t: Template): void {
  const H = t.page.heightMm;
  for (const m of t.markers) {
    drawSquareMm(page, m.center.x, m.center.y, m.sizeMm, H, rgb(0, 0, 0));
    // La muesca se dibuja ENCIMA, en blanco: "muerde" la esquina interior del TL.
    if (m.notch) drawRectMm(page, m.notch, H, { fill: rgb(1, 1, 1) });
  }
}

function drawCalibration(page: PDFPage, t: Template): void {
  const H = t.page.heightMm;
  for (const patch of t.calibration) {
    // Sin el trazo, el parche "blanco" es invisible sobre el fondo blanco del
    // PDF; el borde lo hace localizable para calibración (Día 10), no solo
    // inferible. Relleno y borde van en la MISMA llamada para que no puedan
    // desalinearse entre sí.
    drawRectMm(page, patch.rect, H, patch.kind === "black"
      ? { fill: rgb(0, 0, 0) }
      : { fill: rgb(1, 1, 1), border: rgb(0, 0, 0) });
  }
}

/**
 * Coloca la etiqueta impresa de un grupo (ej. "D3", "42", "FORMA").
 *
 * Un grupo "digit" es una COLUMNA vertical (dígitos apilados en Y) → la
 * etiqueta va centrada arriba del primer círculo. Un grupo "question" o
 * "version" es una FILA horizontal (opciones en X) → la etiqueta va pegada
 * a la izquierda del primer círculo. Es una propiedad general de cómo se
 * dibuja cada GroupKind, no un caso especial de esta plantilla.
 */
function drawGroupLabel(page: PDFPage, group: BubbleGroup, t: Template, font: PDFFont): void {
  const first = group.bubbles[0];
  if (!first) return;

  const H = t.page.heightMm;
  const r = t.bubbleDiameterMm / 2;
  const size = 6;
  const gapMm = 1.5;
  const widthPt = font.widthOfTextAtSize(group.printedLabel, size);

  if (group.kind === "digit") {
    const { x, y } = toPdfXY(first.center.x, first.center.y - r - gapMm, H);
    page.drawText(group.printedLabel, { x: x - widthPt / 2, y, size, font });
  } else {
    const { x, y } = toPdfXY(first.center.x - r - gapMm, first.center.y, H);
    page.drawText(group.printedLabel, { x: x - widthPt, y: y - size * 0.35, size, font });
  }
}

function drawBubbles(page: PDFPage, t: Template, font: PDFFont): void {
  const H = t.page.heightMm;
  const r = mmToPt(t.bubbleDiameterMm / 2);

  for (const group of t.groups) {
    drawGroupLabel(page, group, t, font);
    for (const b of group.bubbles) {
      const { x, y } = toPdfXY(b.center.x, b.center.y, H);
      page.drawCircle({ x, y, size: r, borderColor: rgb(0, 0, 0), borderWidth: 0.75 });
    }
  }
}

export async function generateSheetPdf(t: Template): Promise<Uint8Array> {
  const errors = validateTemplate(t);
  if (errors.length > 0) {
    throw new Error(`Template inválida, no se genera el PDF:\n${errors.join("\n")}`);
  }

  const doc = await PDFDocument.create();
  const page = doc.addPage([mmToPt(t.page.widthMm), mmToPt(t.page.heightMm)]);
  const font = await doc.embedFont(StandardFonts.Helvetica);

  drawMarkers(page, t);
  drawCalibration(page, t);
  drawBubbles(page, t, font);

  return doc.save();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  // Configuración PROVISIONAL (§1 del prompt): 100 preguntas x 5 opciones.
  // Aún no confirmada con el cliente — cambiar este número es un cambio de
  // parámetro, no de código.
  const t = buildTemplate(100);
  const bytes = await generateSheetPdf(t);
  const { writeFileSync } = await import("node:fs");
  writeFileSync("hoja-v1.pdf", bytes);
  console.log(`✓ hoja-v1.pdf generado (${bytes.length} bytes) — ${t.groups.length} grupos, ${t.page.widthMm}x${t.page.heightMm}mm, config: 100 preguntas x 5 opciones`);
}
