import { describe, it, expect } from "vitest";
import { groupsBoundingBoxMm, sameColumnNeighbours } from "./template.ts";
import type { BubbleGroup } from "./template.ts";

/** Grupo sintético con control total de coordenadas, en vez de depender de
 * una plantilla real — esto es aritmética pura, se prueba con números
 * fáciles de verificar a mano. */
function question(ordinal: number, y: number, xs: number[]): BubbleGroup {
  return {
    id: `q.${ordinal}`,
    kind: "question",
    ordinal,
    printedLabel: String(ordinal),
    bubbles: xs.map((x, i) => ({ index: i, label: "ABCDE"[i]!, center: { x, y } })),
  };
}

describe("groupsBoundingBoxMm", () => {
  it("un solo grupo: el rectángulo envuelve sus burbujas con el margen pedido", () => {
    const g = question(1, 40, [10, 15, 20, 25, 30]);
    const box = groupsBoundingBoxMm([g], /* bubbleDiameterMm */ 3, /* marginMm */ 1);
    // r=1.5, margen=1 → 2.5 de aire a cada lado.
    expect(box).toEqual({ x: 10 - 2.5, y: 40 - 2.5, w: (30 - 10) + 2 * 2.5, h: 2 * 2.5 });
  });

  it("varios grupos (vecinas): el rectángulo envuelve a TODOS, no solo al primero", () => {
    const g1 = question(10, 40, [10, 30]);
    const g2 = question(11, 50, [10, 30]); // misma x, una fila más abajo
    const g3 = question(12, 45, [5, 35]); // más ancho que las otras dos
    const box = groupsBoundingBoxMm([g1, g2, g3], 3, 1)!;
    expect(box.x).toBeCloseTo(5 - 2.5, 5);
    expect(box.y).toBeCloseTo(40 - 2.5, 5);
    expect(box.x + box.w).toBeCloseTo(35 + 2.5, 5);
    expect(box.y + box.h).toBeCloseTo(50 + 2.5, 5);
  });

  it("sin grupos, devuelve null — no hay nada que envolver, no un rectángulo inventado", () => {
    expect(groupsBoundingBoxMm([], 3, 1)).toBeNull();
  });

  it("un grupo con burbujas pero también grupos vacíos intercalados: los vacíos no rompen el cálculo", () => {
    const vacio: BubbleGroup = { id: "q.x", kind: "question", ordinal: 99, printedLabel: "99", bubbles: [] };
    const g = question(1, 40, [10, 20]);
    const box = groupsBoundingBoxMm([vacio, g, vacio], 3, 1)!;
    expect(box.x).toBeCloseTo(10 - 2.5, 5);
    expect(box.x + box.w).toBeCloseTo(20 + 2.5, 5);
  });

  it("una sola burbuja: el rectángulo es un cuadrado del diámetro + 2×margen", () => {
    const g = question(1, 40, [10]);
    const box = groupsBoundingBoxMm([g], 3, 1)!;
    expect(box.w).toBeCloseTo(3 + 2, 5); // diámetro + 2×margen
    expect(box.h).toBeCloseTo(3 + 2, 5);
  });
});

describe("sameColumnNeighbours", () => {
  // Simula 2 columnas de 20 preguntas cada una, como hoja-media-a4: la
  // burbuja A de la columna 1 vive en x=10mm, la de la columna 2 en x=50mm.
  const columna1 = Array.from({ length: 20 }, (_, i) => question(i + 1, 30 + i * 5, [10, 13, 16, 19, 22]));
  const columna2 = Array.from({ length: 20 }, (_, i) => question(i + 21, 30 + i * 5, [50, 53, 56, 59, 62]));
  const groups = [...columna1, ...columna2];

  it("en medio de una columna, incluye las ±2 vecinas normalmente", () => {
    const result = sameColumnNeighbours(groups, 10, 2);
    expect(result.map((g) => g.ordinal).sort((a, b) => a - b)).toEqual([8, 9, 10, 11, 12]);
  });

  it(
    "el caso real que motivó esta función: en el BORDE de una columna, " +
    "NO cruza a la columna siguiente aunque el ordinal esté a distancia 2",
    () => {
      // Pregunta 20 es la última de la columna 1; 21 y 22 son las primeras
      // de la columna 2 — a distancia de ordinal ≤2, pero a 40mm de x.
      const result = sameColumnNeighbours(groups, 20, 2);
      expect(result.map((g) => g.ordinal).sort((a, b) => a - b)).toEqual([18, 19, 20]);
    }
  );

  it("simétrico: al comienzo de una columna, no incluye la anterior", () => {
    const result = sameColumnNeighbours(groups, 21, 2);
    expect(result.map((g) => g.ordinal).sort((a, b) => a - b)).toEqual([21, 22, 23]);
  });

  it("si el ordinal pedido no existe en absoluto, no filtra por columna — solo por rango (mejor mostrar de más que nada)", () => {
    const result = sameColumnNeighbours(groups, 999, 2);
    expect(result).toEqual([]); // tampoco hay nada a distancia 2 de 999, caso trivial
  });
});
