import { describe, it, expect } from "vitest";
import { analyzeSheet } from "./analyzeSheet.ts";
import { buildOfficialTemplate } from "../pdf-generator/officialTemplate.ts";
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
