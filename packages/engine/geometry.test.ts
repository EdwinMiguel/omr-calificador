import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { analyzeGeometry, renderOverlay } from "./geometry.ts";
import { loadPages } from "../../apps/cli/io/loadPages.ts";
import { buildOfficialTemplate } from "../pdf-generator/officialTemplate.ts";
import { buildTemplate as buildTemplateB } from "../../template.ts";

const DPI = 200;

describe("analyzeGeometry — Template A (hoja oficial, sobre foto real)", () => {
  it("alinea una foto real y devuelve reprojectionErrorPx bajo", async () => {
    const templateA = buildOfficialTemplate(100);
    const pages = await loadPages(
      "dataset/fotos/WhatsApp Image 2026-08-26 at 8.24.20 PM (1).jpeg"
    );
    const outcome = await analyzeGeometry(pages[0]!, templateA, DPI);

    expect(outcome.kind).toBe("aligned");
    if (outcome.kind === "aligned") {
      expect(outcome.reprojectionErrorPx).toBeLessThan(1);
    }
  });
});

describe("analyzeGeometry — Template B sintético (Nivel 1, PROMPT.md §4)", () => {
  it(
    "alinea Template B — MISMA función, MISMO número de preguntas y " +
    "opciones que Template A, geometría completamente distinta (pitch " +
    "6mm vs 5mm, diámetro de burbuja 4.5mm vs 3mm, otro origen) — sin " +
    "ninguna rama de código específica de plantilla en geometry.ts",
    async () => {
      const templateB = buildTemplateB(100);
      expect(templateB.groups.filter((g) => g.kind === "question")).toHaveLength(100);
      expect(templateB.groups.find((g) => g.kind === "question")!.bubbles).toHaveLength(5);

      const { generateSheetPdf } = await import("../pdf-generator/generateSheet.ts");
      const pdfBytes = await generateSheetPdf(templateB);
      const { writeFileSync, mkdtempSync } = await import("node:fs");
      const { join } = await import("node:path");
      const { tmpdir } = await import("node:os");
      const dir = mkdtempSync(join(tmpdir(), "template-b-"));
      const pdfPath = join(dir, "template-b.pdf");
      writeFileSync(pdfPath, pdfBytes);

      const pages = await loadPages(pdfPath);
      const outcome = await analyzeGeometry(pages[0]!, templateB, DPI);

      expect(outcome.kind).toBe("aligned");
      if (outcome.kind === "aligned") {
        // Un PDF rasterizado sin distorsión: la homografía debería ser
        // prácticamente perfecta, no solo "aceptable".
        expect(outcome.reprojectionErrorPx).toBeLessThan(0.5);

        // renderOverlay también es agnóstico de plantilla: se prueba con
        // Template B, no solo con la oficial.
        const overlay = renderOverlay(outcome.normalized, templateB, DPI);
        expect(overlay.length).toBe(outcome.normalized.width * outcome.normalized.height * 3);
      }
    }
  );
});

describe("renderOverlay — Template A", () => {
  it("los círculos de burbuja caen sobre la burbuja impresa real (no en blanco)", async () => {
    const templateA = buildOfficialTemplate(100);
    const pages = await loadPages(
      "dataset/fotos/WhatsApp Image 2026-08-26 at 8.24.20 PM (1).jpeg"
    );
    const outcome = await analyzeGeometry(pages[0]!, templateA, DPI);
    expect(outcome.kind).toBe("aligned");
    if (outcome.kind !== "aligned") return;

    const overlay = renderOverlay(outcome.normalized, templateA, DPI);
    const { width } = outcome.normalized;

    // Verificación real, no visual: bajo el overlay de la primera burbuja
    // de la pregunta 1, la imagen normalizada debe tener tinta (el trazo
    // impreso del círculo), no papel en blanco — si la homografía cayera
    // desalineada, este punto caería sobre papel.
    const q1 = templateA.groups.find((g) => g.id === "q.1")!;
    const b = q1.bubbles[0]!;
    const mmToPx = (mm: number) => (mm / 25.4) * DPI;
    const cx = Math.round(mmToPx(b.center.x));
    const cy = Math.round(mmToPx(b.center.y));
    const r = Math.round(mmToPx(templateA.bubbleDiameterMm) / 2);

    let darkPixelsOnRing = 0;
    for (let a = 0; a < 360; a += 10) {
      const rad = (a * Math.PI) / 180;
      const px = Math.round(cx + r * Math.cos(rad));
      const py = Math.round(cy + r * Math.sin(rad));
      if (outcome.normalized.data[py * width + px]! < 200) darkPixelsOnRing++;
    }
    // Se espera que buena parte del anillo (36 puntos muestreados) caiga
    // sobre el trazo impreso, no que todos caigan en blanco por casualidad.
    expect(darkPixelsOnRing).toBeGreaterThan(5);
  });
});
