import { describe, it, expect } from "vitest";
import { analyzeSheet } from "./analyzeSheet.ts";
import { buildOfficialTemplate } from "../pdf-generator/officialTemplate.ts";
import { loadPages } from "../../apps/cli/io/loadPages.ts";
import type { GrayImage } from "./types.ts";

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
