/**
 * Los casos de abajo NO son inventados: son valores medidos por el motor
 * sobre las hojas reales del dataset. Cada uno tiene su procedencia anotada,
 * para que si alguien cambia la regla vea contra qué evidencia está chocando.
 */

import { describe, expect, it } from "vitest";
import { suggestionFor } from "./batchSuggestion.ts";

describe("suggestionFor", () => {
  describe("preguntas que el motor dio por vacías", () => {
    // Medidos sobre dataset/fotos-marcadas: el motor las clasificó BLANK y la
    // versión anterior de esta función igual proponía una respuesta. 11 de 27
    // preguntas vacías del dataset caían acá.
    const vacíasConRuidoQueGanaPorGoleada: [string, Record<string, number>][] = [
      ["marcada-03 Q7", { A: 0.004, B: -0.002, C: 0.032, D: 0.013, E: 0.001 }],
      ["marcada-03 Q22", { A: 0.002, B: 0.011, C: -0.004, D: 0.005, E: 0.028 }],
      ["marcada-06 Q19", { A: 0.018, B: 0.003, C: -0.001, D: 0.002, E: -0.005 }],
    ];

    for (const [nombre, fills] of vacíasConRuidoQueGanaPorGoleada) {
      it(`no sugiere nada en ${nombre}, aunque el ruido gane por razón amplia`, () => {
        // La prueba de razón sola las aprobaba: el 2º no llega a la mitad del 1º.
        const sorted = Object.values(fills).sort((a, b) => b - a);
        expect(sorted[1]!).toBeLessThan(sorted[0]! * 0.5);
        // Pero el motor ya dijo que acá no se despegó nada.
        expect(suggestionFor("BLANK", fills)).toBeNull();
      });
    }
  });

  describe("marcas reales que el motor mandó a revisión", () => {
    // IMG_20260830_174156: marcas de lápiz extremadamente tenues, verdad
    // dictada mirando el papel ANTES de procesar (ground-truth/…174156.json).
    // Son el caso que motivó todo el panel: 30 preguntas donde el motor sabe
    // perfectamente CUÁL opción se marcó, pero no auto-acepta por el valor bajo.
    it("sugiere la opción marcada aunque el valor sea muy bajo (0.024)", () => {
      const fills = { A: 0.024, B: 0.011, C: 0.002, D: -0.003, E: 0.001 };
      expect(suggestionFor("AMBIGUOUS", fills)).toEqual({ label: "A", value: 0.024 });
    });

    it("sugiere la opción marcada en el extremo alto del rango (0.149)", () => {
      const fills = { A: 0.012, B: 0.149, C: 0.004, D: 0.021, E: -0.008 };
      expect(suggestionFor("AMBIGUOUS", fills)).toEqual({ label: "B", value: 0.149 });
    });
  });

  describe("cuando la duda es sobre CUÁL opción", () => {
    it("no sugiere si el segundo pasa la mitad del primero", () => {
      // marcada-10 Q84, medido: E=0.058 con D=0.047 pisándole los talones.
      const fills = { A: -0.059, B: -0.063, C: -0.049, D: 0.047, E: 0.058 };
      expect(suggestionFor("AMBIGUOUS", fills)).toBeNull();
    });

    it("no sugiere en una doble marca real", () => {
      const fills = { A: 0.41, B: 0.38, C: 0.01, D: 0.0, E: 0.02 };
      expect(suggestionFor("MULTIPLE", fills)).toBeNull();
    });
  });

  describe("bordes", () => {
    it("no sugiere sin mediciones", () => {
      expect(suggestionFor("AMBIGUOUS", undefined)).toBeNull();
    });

    it("no sugiere si el ganador no es siquiera más oscuro que el papel", () => {
      const fills = { A: -0.01, B: -0.02, C: -0.03, D: -0.04, E: -0.05 };
      expect(suggestionFor("AMBIGUOUS", fills)).toBeNull();
    });

    it("no sugiere si el ganador mide exactamente cero", () => {
      expect(suggestionFor("AMBIGUOUS", { A: 0, B: -0.01, C: -0.02, D: -0.03, E: -0.04 })).toBeNull();
    });

    it("un ganador negativo grande no vuelve válido a un segundo negativo", () => {
      // Con números negativos la razón se da vuelta; que no se cuele por ahí.
      expect(suggestionFor("AMBIGUOUS", { A: -0.10, B: -0.50 })).toBeNull();
    });
  });
});
