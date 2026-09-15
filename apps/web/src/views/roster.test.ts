import { describe, expect, it } from "vitest";
import { parseRoster } from "./roster.ts";

describe("parseRoster", () => {
  it("lee una columna pegada de Excel, un código por línea", () => {
    const r = parseRoster("1234567\n2345678\n3456789");
    expect(r.codes).toEqual(["1234567", "2345678", "3456789"]);
    expect(r.invalid).toEqual([]);
  });

  it("acepta comas, punto y coma, espacios y saltos mezclados", () => {
    const r = parseRoster("1234567, 2345678;3456789\n4567890   5678901");
    expect(r.codes).toHaveLength(5);
    expect(r.invalid).toEqual([]);
  });

  it("ignora líneas vacías y espacios sobrantes", () => {
    const r = parseRoster("\n\n  1234567  \n\n  2345678\n\n");
    expect(r.codes).toEqual(["1234567", "2345678"]);
  });

  describe("lo que NO se inventa", () => {
    // Estas tres reglas son deliberadas: rellenar o recortar en silencio es
    // el mismo error que corría las respuestas de la clave pegada con el
    // encabezado del examen (ver typedAnswerKey.ts).

    it("un código de menos de 7 dígitos NO se rellena con ceros — se reporta", () => {
      // Caso real de Excel: "0012345" guardado como número pierde los ceros.
      const r = parseRoster("12345\n1234567");
      expect(r.codes).toEqual(["1234567"]);
      expect(r.invalid).toEqual(["12345"]);
    });

    it("un código de más de 7 dígitos NO se recorta — se reporta", () => {
      const r = parseRoster("123456789\n1234567");
      expect(r.codes).toEqual(["1234567"]);
      expect(r.invalid).toEqual(["123456789"]);
    });

    it("un nombre pegado junto al código no se cuela como código", () => {
      const r = parseRoster("Ana Cabrera 1234567\nLuis Paredes 2345678");
      expect(r.codes).toEqual(["1234567", "2345678"]);
      expect(r.invalid).toEqual(["Ana", "Cabrera", "Luis", "Paredes"]);
    });

    it("un código con letras o guiones queda afuera", () => {
      const r = parseRoster("12-34567\nA234567\n1234567");
      expect(r.codes).toEqual(["1234567"]);
      expect(r.invalid).toEqual(["12-34567", "A234567"]);
    });
  });

  it("descarta repetidos conservando uno, y los reporta", () => {
    const r = parseRoster("1234567\n2345678\n1234567\n1234567");
    expect(r.codes).toEqual(["1234567", "2345678"]);
    expect(r.duplicates).toEqual(["1234567"]);
  });

  it("texto vacío o sin ningún código da una lista vacía, no un error", () => {
    expect(parseRoster("").codes).toEqual([]);
    expect(parseRoster("   \n  \n").codes).toEqual([]);
    expect(parseRoster("no hay ningún código acá").codes).toEqual([]);
  });
});
