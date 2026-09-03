import { describe, it, expect } from "vitest";
import { analyzeSheet } from "./analyzeSheet.ts";
import { buildOfficialTemplate } from "../pdf-generator/officialTemplate.ts";
import { loadPages } from "../../apps/cli/io/loadPages.ts";
import type { GrayImage } from "./types.ts";
import { existsSync, readFileSync } from "node:fs";

describe("analyzeSheet — rechazos tempranos", () => {
  it("rechaza BLANK_PAGE antes de intentar geometría, sobre una imagen sin ningún contenido", async () => {
    const t = buildOfficialTemplate(100);
    // Papel uniformemente blanco: ni marcadores, ni tabla, ni nada —
    // el caso real es el reverso en blanco de un dúplex.
    const img: GrayImage = { data: new Uint8Array(500 * 700).fill(250), width: 500, height: 700 };
    const outcome = await analyzeSheet(img, t, 200, {});
    expect(outcome).toEqual({ kind: "rejected", reason: "BLANK_PAGE" });
  });

  it("rechaza MARKERS_NOT_FOUND en vez de BLANK_PAGE cuando SÍ hay contenido pero no se arman los 4 marcadores", async () => {
    const t = buildOfficialTemplate(100);
    // Ruido disperso: suficiente tinta para no ser "blanco", insuficiente
    // estructura para encontrar 4 marcadores reales.
    const data = new Uint8Array(500 * 700).fill(250);
    for (let i = 0; i < data.length; i += 37) data[i] = 10;
    const img: GrayImage = { data, width: 500, height: 700 };
    const outcome = await analyzeSheet(img, t, 200, {});
    expect(outcome.kind).toBe("rejected");
    if (outcome.kind === "rejected") expect(outcome.reason).not.toBe("BLANK_PAGE");
  });
});

describe("analyzeSheet — alignedImage (necesaria para 'Ver hoja' en el navegador)", () => {
  it(
    "una hoja procesada trae la imagen ya enderezada, útil para mostrarla — " +
    "sin esto, la versión del navegador no tiene dónde guardarla (no hay disco " +
    "de servidor que la recalcule bajo demanda) y 'Ver hoja' queda inalcanzable",
    async () => {
      const t = buildOfficialTemplate(100);
      const img = (await loadPages("dataset/fotos-marcadas/hoja-resuelta-escaneada.jpg"))[0]!;
      const outcome = await analyzeSheet(img, t, 200, {});

      // Esta hoja se rechaza por STUDENT_ID_UNREADABLE (código con doble
      // marca a propósito, ver ground-truth/) — pero la geometría sí se
      // resolvió antes de llegar ahí, así que igual debe traer la imagen.
      expect(outcome.kind).toBe("rejected");
      if (outcome.kind !== "rejected") return;
      expect(outcome.reason).toBe("STUDENT_ID_UNREADABLE");

      expect(outcome.alignedImage).toBeDefined();
      // Tamaño del lienzo canónico, no de la foto original — es la hoja YA
      // enderezada, mismo contrato que geo.normalized en geometry.ts.
      expect(outcome.alignedImage!.width).toBeGreaterThan(0);
      expect(outcome.alignedImage!.height).toBeGreaterThan(0);
      expect(outcome.alignedImage!.data.length).toBe(
        outcome.alignedImage!.width * outcome.alignedImage!.height
      );
    }
  );

  it("una hoja rechazada ANTES de alinear (sin marcadores) no trae alignedImage — no hay nada que mostrar", async () => {
    const t = buildOfficialTemplate(100);
    const img: GrayImage = { data: new Uint8Array(500 * 700).fill(250), width: 500, height: 700 };
    const outcome = await analyzeSheet(img, t, 200, {});
    expect(outcome.kind).toBe("rejected");
    if (outcome.kind === "rejected") expect(outcome.alignedImage).toBeUndefined();
  });
});

/**
 * La barrera de PROMPT.md §15 medida donde importa: contra verdades
 * dictadas mirando el papel, no la pantalla (§14).
 *
 * Cada hoja de esta lista cubre un régimen distinto y ninguna sola alcanza:
 *
 *   escaneada ....... escáner, marcas normales. Benigna: casi cualquier
 *                     umbral la resuelve.
 *   IMG_...172453 ... foto de celular, contraste bajo. Encontró el fallo
 *                     de la referencia de papel por vecindario (Q95).
 *   IMG_...174156 ... foto de celular con marcas de lápiz extremadamente
 *                     tenues. Su brecha de separación es NEGATIVA: la peor
 *                     marca verdadera mide por debajo de la mejor no-marca
 *                     verdadera, así que ningún umbral las separa. Es la
 *                     hoja que obliga a NO auto-aceptar en esa zona, y por
 *                     eso la que sostiene BLANK_MARGIN_MAX.
 *
 * Un veredicto BLANK sobre una pregunta que SÍ tenía marca cuenta como
 * incorrecta, no como "a revisión": BLANK se auto-acepta y baja la nota
 * igual que una letra equivocada.
 */
describe("analyzeSheet — AUTO_ACCEPTED_INCORRECT contra verdad conocida", () => {
  const hojas = [
    ["dataset/fotos-marcadas/hoja-resuelta-escaneada.jpg", "ground-truth/hoja-resuelta-escaneada.json"],
    ["dataset/fotos-marcadas/IMG_20260830_172453.jpg", "ground-truth/IMG_20260830_172453.json"],
    ["dataset/fotos-marcadas/IMG_20260830_174156.jpg", "ground-truth/IMG_20260830_174156.json"],
  ] as const;

  for (const [foto, verdad] of hojas) {
    // dataset/ está en .gitignore: en un clon limpio la foto no existe y el
    // test se salta en vez de fallar por una razón que no es del código.
    const hayFixture = existsSync(foto) && existsSync(verdad);
    const nombre = foto.split("/").pop()!;

    it.skipIf(!hayFixture)(`${nombre}: ninguna respuesta auto-aceptada contradice la verdad`, async () => {
      const t = buildOfficialTemplate(100);
      const img = (await loadPages(foto))[0]!;
      const outcome = await analyzeSheet(img, t, 200, {});

      const marks = (JSON.parse(readFileSync(verdad, "utf8")) as { marks: Record<string, string | null> }).marks;

      // Estas hojas se rechazan por STUDENT_ID_UNREADABLE (el código no se
      // lee con confianza — en 174156 la verdad confirma que la columna 6
      // quedó literalmente sin rellenar). Sus 100 respuestas viajan igual en
      // `partial` y son las que hay que auditar: ver PartialRead.
      const questions =
        outcome.kind === "processed" ? outcome.result.questions : outcome.partial?.questions;
      expect(questions).toBeDefined();

      const incorrectas: string[] = [];
      for (const q of questions!) {
        const esperada = marks[String(q.ordinal)] ?? null;
        if (q.state.kind === "ANSWERED" && q.state.option !== esperada) {
          incorrectas.push(`Q${q.ordinal}: leyó ${q.state.option}, el alumno marcó ${esperada}`);
        }
        if (q.state.kind === "BLANK" && esperada !== null) {
          incorrectas.push(`Q${q.ordinal}: leyó BLANCO, el alumno marcó ${esperada}`);
        }
      }
      expect(incorrectas).toEqual([]);
    });
  }
});
