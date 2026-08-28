import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { PDFDocument, rgb } from "pdf-lib";
import { loadPages } from "./loadPages.ts";
import { dumpDebug } from "./dumpDebug.ts";

let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "omr-loadpages-"));
});

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
});

/**
 * Imagen sintética de 4x4: mitad izquierda negra, mitad derecha blanca.
 * Con un valor conocido de antemano podemos comprobar que decodificar no
 * solo "no falla" sino que los píxeles llegan donde deben — un PNG corrupto
 * o mal interpretado puede devolver dimensiones correctas con datos basura.
 */
async function makeHalfBlackHalfWhite(): Promise<Buffer> {
  const w = 4, h = 4;
  const raw = Buffer.alloc(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      raw[y * w + x] = x < w / 2 ? 0 : 255;
    }
  }
  return sharp(raw, { raw: { width: w, height: h, channels: 1 } }).png().toBuffer();
}

describe("loadPages — formatos raster", () => {
  it("decodifica PNG a GrayImage con los píxeles correctos", async () => {
    const png = await makeHalfBlackHalfWhite();
    const path = join(dir, "test.png");
    await sharp(png).toFile(path);

    const pages = await loadPages(path);
    expect(pages).toHaveLength(1);
    const page = pages[0]!;
    expect(page.width).toBe(4);
    expect(page.height).toBe(4);
    expect(page.data[0]).toBe(0);   // esquina superior izq: negra
    expect(page.data[3]).toBe(255); // esquina superior der: blanca
  });

  it("decodifica JPG (con su compresión con pérdida) a GrayImage", async () => {
    const png = await makeHalfBlackHalfWhite();
    const path = join(dir, "test.jpg");
    await sharp(png).jpeg({ quality: 95 }).toFile(path);

    const pages = await loadPages(path);
    expect(pages).toHaveLength(1);
    const page = pages[0]!;
    expect(page.width).toBe(4);
    // JPG es con pérdida: no exigimos 0/255 exactos, solo que el contraste
    // sobreviva reconociblemente (lado izquierdo oscuro, derecho claro).
    expect(page.data[0]).toBeLessThan(60);
    expect(page.data[3]).toBeGreaterThan(200);
  });

  it("decodifica TIFF a GrayImage con los píxeles correctos", async () => {
    const png = await makeHalfBlackHalfWhite();
    const path = join(dir, "test.tiff");
    // compression:"none" — el default de sharp para TIFF es CON pérdida
    // (confirmado: sin esto, 0 y 255 llegan como 1 y 254). loadPages() solo
    // LEE TIFFs ajenos (los produce el scanner, no nosotros), así que esto
    // es para que el fixture del test sea fiel, no un ajuste al código real.
    await sharp(png).tiff({ compression: "none" }).toFile(path);

    const pages = await loadPages(path);
    const page = pages[0]!;
    expect(page.data[0]).toBe(0);
    expect(page.data[3]).toBe(255);
  });

  it("convierte una imagen a color a un único canal de grises", async () => {
    const path = join(dir, "color.png");
    await sharp({
      create: { width: 2, height: 1, channels: 3, background: { r: 255, g: 0, b: 0 } },
    }).png().toFile(path);

    const pages = await loadPages(path);
    // 1 byte por píxel, no 3: la conversión a escala de grises ya ocurrió.
    expect(pages[0]!.data.length).toBe(2 * 1);
  });

  it("rechaza un formato no soportado en vez de adivinar", async () => {
    const path = join(dir, "nota.txt");
    await writeFile(path, "esto no es una imagen");
    await expect(loadPages(path)).rejects.toThrow(/Formato no soportado/);
  });
});

describe("loadPages — PDF (rasterización + multipágina)", () => {
  it("decodifica un PDF de 1 página como GrayImage[] de longitud 1", async () => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    const path = join(dir, "una-pagina.pdf");
    await writeFile(path, await doc.save());

    const pages = await loadPages(path);
    expect(pages).toHaveLength(1);
  });

  it("decodifica un PDF de 3 páginas en orden, sin mezclarlas ni repetirlas", async () => {
    const doc = await PDFDocument.create();
    const grays = [0.9, 0.5, 0.1]; // → ~230, ~128, ~26 en 0-255
    for (const g of grays) {
      const page = doc.addPage([120, 120]);
      page.drawRectangle({ x: 0, y: 0, width: 120, height: 120, color: rgb(g, g, g) });
    }
    const path = join(dir, "tres-paginas.pdf");
    await writeFile(path, await doc.save());

    const pages = await loadPages(path);
    expect(pages).toHaveLength(3);

    const centerGray = (img: (typeof pages)[number]) => img.data[Math.floor(img.data.length / 2)]!;
    const [tone0, tone1, tone2] = pages.map(centerGray);

    // Tolerancia de rasterización/antialiasing, no exactitud a pixel: lo que
    // importa es el ORDEN y que sean distinguibles entre sí, no el valor exacto.
    expect(tone0).toBeGreaterThan(200);
    expect(tone1).toBeGreaterThan(100);
    expect(tone1).toBeLessThan(160);
    expect(tone2).toBeLessThan(60);
  });
});

describe("dumpDebug — salida visual inspeccionable", () => {
  it("escribe un PNG que al releerlo reproduce el mismo GrayImage", async () => {
    const png = await makeHalfBlackHalfWhite();
    const srcPath = join(dir, "roundtrip-src.png");
    await sharp(png).toFile(srcPath);
    const original = await loadPages(srcPath);

    const outPath = await dumpDebug("01-original", original[0]!, join(dir, "debug"));
    const reloaded = await loadPages(outPath);

    expect([...reloaded[0]!.data]).toEqual([...original[0]!.data]);
  });
});
