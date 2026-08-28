/**
 * composeOfficialSheet.ts — Añade al PDF oficial del profesor lo que le falta
 * para ser procesable, sin redibujar ni alterar su contenido.
 *
 * A diferencia de generateSheet.ts (que dibuja una hoja entera desde cero a
 * partir de un Template), aquí el PDF del profesor es la BASE: se carga tal
 * cual y se dibuja ENCIMA. Su título, campos, tabla y las 500 burbujas
 * quedan byte a byte como los diseñó él.
 *
 * Se añaden: marcadores fiduciales, parches de calibración, grid del código
 * del alumno y burbujas de tipo de examen — todos en la franja libre bajo
 * el contenido, cuyas coordenadas vienen de officialTemplate.ts.
 *
 * Igual que generateSheet.ts: pdf-lib usa origen abajo-izquierda con Y hacia
 * arriba, y Template usa origen arriba-izquierda con Y hacia abajo. toPdfXY
 * es el único punto donde se resuelve ese desajuste.
 */

import { PDFDocument, rgb, StandardFonts, type PDFPage, type PDFFont } from "pdf-lib";
import { readFileSync, writeFileSync } from "node:fs";
import type { Template, RectMm, BubbleGroup } from "../../template.ts";
import {
  buildOfficialTemplate,
  validateAddedGeometry,
  REGIONS,
  CODIGO_TEXTO_TAPA,
} from "./officialTemplate.ts";

const PT_PER_MM = 72 / 25.4;
const mmToPt = (mm: number): number => mm * PT_PER_MM;

function toPdfXY(xMm: number, yMm: number, pageHeightMm: number) {
  return { x: mmToPt(xMm), y: mmToPt(pageHeightMm - yMm) };
}

/**
 * En Template, `rect.y` es el borde SUPERIOR y el rectángulo crece hacia
 * abajo. pdf-lib ancla en la esquina INFERIOR izquierda y crece hacia arriba,
 * así que se convierte el borde inferior (`rect.y + rect.h`). Convertir
 * `rect.y` a secas desplaza la tinta `rect.h` mm fuera de donde el engine
 * va a muestrear.
 */
function drawRectMm(
  page: PDFPage, rect: RectMm, H: number,
  opts: { fill?: ReturnType<typeof rgb>; border?: ReturnType<typeof rgb> }
) {
  const { x, y } = toPdfXY(rect.x, rect.y + rect.h, H);
  page.drawRectangle({
    x, y, width: mmToPt(rect.w), height: mmToPt(rect.h),
    color: opts.fill,
    borderColor: opts.border,
    borderWidth: opts.border ? 0.5 : undefined,
  });
}

function drawMarkers(page: PDFPage, t: Template) {
  const H = t.page.heightMm;
  for (const m of t.markers) {
    const half = m.sizeMm / 2;
    drawRectMm(
      page, { x: m.center.x - half, y: m.center.y - half, w: m.sizeMm, h: m.sizeMm },
      H, { fill: rgb(0, 0, 0) }
    );
    // La muesca va encima en blanco: "muerde" la esquina interior del TL.
    // Es la única asimetría entre los 4 marcadores, y por tanto lo que
    // permite distinguir una hoja derecha de una rotada 180°.
    if (m.notch) drawRectMm(page, m.notch, H, { fill: rgb(1, 1, 1) });
  }
}

function drawCalibration(page: PDFPage, t: Template) {
  const H = t.page.heightMm;
  for (const patch of t.calibration) {
    // Sin borde, un parche blanco sobre papel blanco es imposible de
    // localizar; el trazo lo hace medible en el Día 10. Relleno y borde
    // van en la MISMA llamada para que no puedan desalinearse entre sí.
    drawRectMm(page, patch.rect, H, patch.kind === "black"
      ? { fill: rgb(0, 0, 0) }
      : { fill: rgb(1, 1, 1), border: rgb(0, 0, 0) });
  }
}

/** Etiqueta del grupo: arriba si es columna de dígitos, a la izquierda si es fila. */
function drawGroupLabel(page: PDFPage, g: BubbleGroup, t: Template, font: PDFFont) {
  const first = g.bubbles[0];
  if (!first) return;

  const H = t.page.heightMm;
  const r = t.bubbleDiameterMm / 2;
  const size = 6;
  const gap = 1.5;
  const w = font.widthOfTextAtSize(g.printedLabel, size);

  if (g.kind === "digit") {
    const { x, y } = toPdfXY(first.center.x, first.center.y - r - gap, H);
    page.drawText(g.printedLabel, { x: x - w / 2, y, size, font });
  } else {
    const { x, y } = toPdfXY(first.center.x - r - gap, first.center.y, H);
    page.drawText(g.printedLabel, { x: x - w, y: y - size * 0.35, size, font });
  }
}

/**
 * Numera las filas del grid de dígitos (0-9) a la izquierda de la primera
 * columna. Sin esto el alumno ve 10 burbujas idénticas y no sabe cuál es
 * el 0 y cuál el 9: la hoja sería incorrecta de llenar, no solo incómoda.
 * A 3 mm de diámetro el dígito no cabe dentro de la burbuja, por eso va
 * fuera y una sola vez por fila, no repetido en cada columna.
 */
function drawDigitRowLabels(page: PDFPage, t: Template, font: PDFFont) {
  const H = t.page.heightMm;
  const digitGroups = t.groups.filter((g) => g.kind === "digit");
  const first = digitGroups[0];
  if (!first) return;

  const xs = digitGroups.map((g) => g.bubbles[0]?.center.x).filter((x): x is number => x !== undefined);
  if (xs.length === 0) return;
  const leftMostX = Math.min(...xs);
  const size = 6;
  const gap = 2.5;

  for (const b of first.bubbles) {
    const w = font.widthOfTextAtSize(b.label, size);
    const { x, y } = toPdfXY(leftMostX - t.bubbleDiameterMm / 2 - gap, b.center.y, H);
    page.drawText(b.label, { x: x - w, y: y - size * 0.35, size, font });
  }
}

/** Solo dibuja los grupos AÑADIDOS: las preguntas ya están impresas en el PDF base. */
function drawAddedBubbles(page: PDFPage, t: Template, font: PDFFont) {
  const H = t.page.heightMm;
  const r = mmToPt(t.bubbleDiameterMm / 2);

  for (const g of t.groups) {
    if (g.kind === "question") continue;
    drawGroupLabel(page, g, t, font);
    for (const b of g.bubbles) {
      const { x, y } = toPdfXY(b.center.x, b.center.y, H);
      page.drawCircle({ x, y, size: r, borderColor: rgb(0, 0, 0), borderWidth: 0.75 });
    }
  }
  drawDigitRowLabels(page, t, font);
}

/**
 * Rótulos de las secciones nuevas, para que el alumno entienda qué llenar.
 * El PDF oficial ya pide el código y el tipo como texto escrito a mano; esto
 * añade la versión en burbujas, que es la que el sistema lee. El texto
 * manuscrito se conserva como respaldo para la revisión manual.
 */
function drawAddedLabels(page: PDFPage, t: Template, font: PDFFont) {
  const H = t.page.heightMm;
  const put = (text: string, xMm: number, yMm: number, size: number) => {
    const { x, y } = toPdfXY(xMm, yMm, H);
    page.drawText(text, { x, y, size, font });
  };

  put("CÓDIGO DEL ALUMNO — rellene una burbuja por columna", 40, 41, 7);
  // Entre el final de la tabla recolocada (y≈250.5) y los parches de
  // calibración (y=261): no debe pisar ninguno de los dos.
  put("No escriba ni marque sobre los recuadros de abajo.", 40, 256, 6);
}

/**
 * Recompone la página del PDF oficial en tres bloques verticales.
 *
 * pdf-lib embebe cada región como un XObject recortado por su bounding box
 * (en coordenadas PDF del original: origen abajo-izquierda) y luego la dibuja
 * en la posición que le indiquemos. Así el contenido del profesor se conserva
 * vectorialmente —no se rasteriza ni se redibuja— pero puede reubicarse.
 */
async function recomposePage(doc: PDFDocument, basePdf: Uint8Array, t: Template) {
  const src = await PDFDocument.load(basePdf);
  const srcPage = src.getPage(0);
  const { width: Wpt } = srcPage.getSize();
  const H = t.page.heightMm;

  const page = doc.addPage([Wpt, mmToPt(H)]);

  for (const region of [REGIONS.titulo, REGIONS.header, REGIONS.tabla]) {
    // Coordenadas del recorte en el PDF original (Y hacia arriba).
    const bottomPt = mmToPt(H - region.bottomMm);
    const topPt = mmToPt(H - region.topMm);

    const embedded = await doc.embedPage(srcPage, {
      left: 0, right: Wpt, bottom: bottomPt, top: topPt,
    });

    page.drawPage(embedded, {
      x: 0,
      y: bottomPt - mmToPt(region.shiftMm),
      width: embedded.width,
      height: embedded.height,
    });
  }

  return page;
}

export async function composeOfficialSheet(basePdf: Uint8Array, t: Template): Promise<Uint8Array> {
  const errors = validateAddedGeometry(t);
  if (errors.length > 0) {
    throw new Error(`Geometría añadida inválida, no se compone:\n${errors.join("\n")}`);
  }

  // El Template dice A4; si el PDF base no lo fuera, todas las coordenadas
  // caerían desplazadas sin aviso. Se comprueba en vez de suponerlo.
  const probe = await PDFDocument.load(basePdf);
  const { width, height } = probe.getPage(0).getSize();
  const wMm = width / PT_PER_MM;
  const hMm = height / PT_PER_MM;
  if (Math.abs(wMm - t.page.widthMm) > 1 || Math.abs(hMm - t.page.heightMm) > 1) {
    throw new Error(
      `El PDF base mide ${wMm.toFixed(1)}×${hMm.toFixed(1)} mm pero el Template ` +
      `describe ${t.page.widthMm}×${t.page.heightMm} mm`
    );
  }

  const doc = await PDFDocument.create();
  const page = await recomposePage(doc, basePdf, t);

  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);

  // Tapar el "CÓDIGO: ______" manuscrito ANTES de dibujar lo demás encima.
  // "GRADO/SECCIÓN: __________" acaba en x=40.47 y la tapa arranca en 41.4,
  // así que sobrevive intacto y no hay que repintarlo.
  drawRectMm(page, { ...CODIGO_TEXTO_TAPA }, t.page.heightMm, { fill: rgb(1, 1, 1) });

  drawMarkers(page, t);
  drawCalibration(page, t);
  drawAddedBubbles(page, t, font);
  drawAddedLabels(page, t, bold);

  return doc.save();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const BASE = "Hoja_Respuestas_OMR_100_Preguntas_Compacta_Una_Cara.pdf";
  const OUT = "hoja-oficial-procesable.pdf";

  const t = buildOfficialTemplate(100);
  const bytes = await composeOfficialSheet(readFileSync(BASE), t);
  writeFileSync(OUT, bytes);

  console.log(`✓ ${OUT} generado (${bytes.length} bytes)`);
  console.log(`  base:      ${BASE} (contenido intacto)`);
  console.log(`  añadido:   ${t.markers.length} marcadores, ${t.calibration.length} parches, ` +
              `${t.groups.filter((g) => g.kind === "digit").length} columnas de código`);
  console.log(`  retirado:  "CÓDIGO: ______" manuscrito (ahora va en burbujas)`);
}
