/**
 * halfSheetTemplate.test.ts — a diferencia de template.ts y officialTemplate.ts
 * (que solo se ejercen vía geometry.test.ts / analyzeSheet.test.ts, con
 * imágenes reales), esta geometría es NUEVA y todavía no tiene una sola
 * hoja física que la haya puesto a prueba. Antes de eso, lo mínimo
 * verificable por código es: la forma (100 preguntas × 5, 7 dígitos × 10),
 * la validación geométrica de siempre, y la invariante que motivó todo el
 * diseño — el margen real de medición — que validateTemplate() NO revisa
 * (su propio piso, bubbleDiameterMm + 0.8, es más laxo que el que impone
 * measurement.ts en la práctica; ver la nota extensa en halfSheetTemplate.ts).
 */

import { describe, it, expect } from "vitest";
import { buildHalfSheetTemplate, minBubbleSeparationMm, MEASUREMENT_REACH_MM } from "./halfSheetTemplate.ts";
import { validateTemplate } from "../../template.ts";

describe("buildHalfSheetTemplate", () => {
  it("geometría válida: ninguna burbuja se sale de página, invade un marcador, invade la cabecera, o queda demasiado cerca de otra", () => {
    const t = buildHalfSheetTemplate(100);
    expect(validateTemplate(t)).toEqual([]);
  });

  it("100 preguntas de 5 opciones — igual forma que la hoja completa, solo cambia la geometría", () => {
    const t = buildHalfSheetTemplate(100);
    const questions = t.groups.filter((g) => g.kind === "question");
    expect(questions).toHaveLength(100);
    for (const q of questions) expect(q.bubbles.map((b) => b.label)).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("código de 7 dígitos × 10 valores (0-9) — mismo contrato que la hoja oficial, decodeDigitGrid no distingue de dónde viene", () => {
    const t = buildHalfSheetTemplate(100);
    const digits = t.groups.filter((g) => g.kind === "digit");
    expect(digits).toHaveLength(7);
    for (const d of digits) expect(d.bubbles.map((b) => b.label)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
  });

  it("página de 210×148.5mm — el ANCHO de una A4 completa, solo el alto se parte a la mitad", () => {
    const t = buildHalfSheetTemplate(100);
    expect(t.page.widthMm).toBe(210);
    expect(t.page.heightMm).toBeCloseTo(297 / 2, 5);
  });

  it("diámetro de burbuja SIN CAMBIOS respecto a la hoja oficial (3mm) — la señal que mide el motor por burbuja es idéntica a la de hoy", () => {
    const t = buildHalfSheetTemplate(100);
    expect(t.bubbleDiameterMm).toBe(3);
  });

  /**
   * LA INVARIANTE QUE IMPORTA. Medida en measurement.ts, no elegida: el ROI
   * de una burbuja (3mm × shrink 0.8 → 19px @200dpi) más el radio de
   * búsqueda (SEARCH_RADIUS_PX=8px) alcanzan 2.22mm desde el centro. Con
   * paso `p`, el margen antes de que ese alcance toque la tinta de la
   * burbuja vecina es `p - r - alcance`. Positivo pero apretado (0.78mm)
   * fue la conclusión explícita del plan — este test es la guardia para
   * que nadie lo achique sin darse cuenta al tocar rowPitch/optionPitch.
   *
   * Rechaza expresamente CUALQUIER valor ≤ 0: eso significaría que el ROI
   * de búsqueda de una burbuja puede tocar la tinta de la vecina, el mismo
   * tipo de contaminación entre burbujas que el plan identificó como el
   * riesgo principal de este diseño (declarado, no oculto: si la Fase 2
   * — hojas físicas reales — lo confirma insuficiente, ESTE test es el
   * primer lugar que hay que mirar, no medir de nuevo a mano).
   */
  it("margen real de medición entre burbujas vecinas es positivo (piso de measurement.ts, no el de validateTemplate)", () => {
    const t = buildHalfSheetTemplate(100);
    const minSep = minBubbleSeparationMm(t);
    const r = t.bubbleDiameterMm / 2;
    const realMargin = minSep - r - MEASUREMENT_REACH_MM;

    expect(realMargin).toBeGreaterThan(0);
    // Documenta el valor medido esta semana (2026-09-08): si cambia, es
    // porque alguien tocó el pitch — y eso exige la misma evidencia que
    // pide PROMPT.md §7 para cualquier calibrable, no un ajuste silencioso.
    expect(realMargin).toBeCloseTo(0.78, 2);
  });

  it("rechaza más de 100 preguntas: el layout no tiene dónde ponerlas", () => {
    expect(() => buildHalfSheetTemplate(101)).toThrow(/solo tiene espacio/);
  });
});
