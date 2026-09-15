/**
 * Los casos de abajo son los que REPRODUJERON el bug antes de arreglarlo, no
 * casos inventados: textos que un profesor pega de verdad (el título del
 * examen, su propio nombre, la lista numerada que ya tenía escrita).
 *
 * La aserción que importa en casi todos es la última: `status !== "exact"`,
 * porque es lo único que separa "clave equivocada" de "lote entero calificado
 * contra una clave equivocada".
 */

import { describe, expect, it } from "vitest";
import { parseTypedAnswerKey } from "./typedAnswerKey.ts";

const TOTAL = 100;

/** Una clave de referencia determinista, para poder contar aciertos. */
const real: Record<number, string> = {};
for (let n = 1; n <= TOTAL; n++) real[n] = "ABCDE"[(n * 7) % 5]!;
const limpias = Array.from({ length: TOTAL }, (_, i) => real[i + 1]).join(" ");

const aciertos = (answers: Record<number, string>): number =>
  Array.from({ length: TOTAL }, (_, i) => i + 1).filter((n) => answers[n] === real[n]).length;

describe("parseTypedAnswerKey", () => {
  it("acepta las 100 respuestas limpias, que es el caso que tiene que seguir funcionando", () => {
    const r = parseTypedAnswerKey(limpias, TOTAL);
    expect(r.status).toBe("exact");
    expect(r.letters).toHaveLength(TOTAL);
    expect(aciertos(r.answers)).toBe(TOTAL);
  });

  it("acepta la lista numerada '1. A' — los dígitos y puntos no son letras A-E", () => {
    const numerada = Array.from({ length: TOTAL }, (_, i) => `${i + 1}. ${real[i + 1]}`).join("\n");
    const r = parseTypedAnswerKey(numerada, TOTAL);
    expect(r.status).toBe("exact");
    expect(aciertos(r.answers)).toBe(TOTAL);
  });

  it("acepta separadores mezclados: comas, saltos de línea, minúsculas", () => {
    const texto = Array.from({ length: TOTAL }, (_, i) => real[i + 1]!.toLowerCase())
      .map((l, i) => (i % 10 === 9 ? `${l}\n` : `${l}, `))
      .join("");
    const r = parseTypedAnswerKey(texto, TOTAL);
    expect(r.status).toBe("exact");
    expect(aciertos(r.answers)).toBe(TOTAL);
  });

  describe("letras de más: el bug que se arregló", () => {
    // Los tres textos de abajo daban `status` usable con la regla vieja
    // (`typed === 0`) y activaban la clave sin una sola advertencia.

    it("el nombre del docente pegado arriba desplaza TODO y no acierta ni una", () => {
      const r = parseTypedAnswerKey(`Prof. Ana Cabrera\n${limpias}`, TOTAL);
      expect(r.letters.length).toBeGreaterThan(TOTAL);
      expect(aciertos(r.answers)).toBe(0);
      expect(r.status).toBe("tooMany"); // <- lo único que impide calificar con esto
    });

    it("el título del examen pegado arriba deja casi todo mal", () => {
      const r = parseTypedAnswerKey(
        `Examen de Comunicacion 3.o B - Clave de respuestas\n${limpias}`,
        TOTAL
      );
      expect(aciertos(r.answers)).toBeLessThan(10);
      expect(r.status).toBe("tooMany");
    });

    it("una sola letra de más ya corre todas las respuestas siguientes", () => {
      const r = parseTypedAnswerKey(`E ${limpias}`, TOTAL);
      expect(r.letters).toHaveLength(TOTAL + 1);
      expect(r.status).toBe("tooMany");
      // Q2 en adelante son la respuesta de la pregunta anterior.
      expect(r.answers[2]).toBe(real[1]);
    });

    it("recorta el borrador a `total`: nunca guarda ordinales fuera de rango", () => {
      const r = parseTypedAnswerKey(`Prof. Ana Cabrera\n${limpias}`, TOTAL);
      const ordinales = Object.keys(r.answers).map(Number);
      expect(Math.max(...ordinales)).toBe(TOTAL);
      expect(ordinales).toHaveLength(TOTAL);
    });
  });

  describe("letras de menos", () => {
    it("marca incompleto cuando falta una respuesta", () => {
      const r = parseTypedAnswerKey(limpias.split(" ").slice(0, 99).join(" "), TOTAL);
      expect(r.status).toBe("incomplete");
      expect(r.answers[100]).toBeUndefined();
    });

    it("una letra inválida en el medio (un typo 'X' en Q50) deja la clave corta", () => {
      const conTypo = limpias.split(" ").map((l, i) => (i === 49 ? "X" : l)).join(" ");
      const r = parseTypedAnswerKey(conTypo, TOTAL);
      expect(r.status).toBe("incomplete");
      // Y además desplaza de Q50 en adelante: por eso no alcanza con contar.
      expect(aciertos(r.answers)).toBeLessThan(TOTAL);
    });

    it("texto vacío o sin ninguna letra A-E", () => {
      expect(parseTypedAnswerKey("", TOTAL).status).toBe("empty");
      expect(parseTypedAnswerKey("1 2 3 - ¿?", TOTAL).status).toBe("empty");
      expect(parseTypedAnswerKey("XYZ WQ", TOTAL).status).toBe("empty");
    });
  });

  it("respeta un total distinto de 100", () => {
    const cortas = "ABCDE";
    expect(parseTypedAnswerKey(cortas, 5).status).toBe("exact");
    expect(parseTypedAnswerKey(cortas, 4).status).toBe("tooMany");
    expect(parseTypedAnswerKey(cortas, 6).status).toBe("incomplete");
  });
});
