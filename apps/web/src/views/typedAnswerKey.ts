/**
 * typedAnswerKey.ts — leer una clave escrita o pegada a mano.
 *
 * POR QUÉ ES UN MÓDULO APARTE Y NO DOS LÍNEAS DENTRO DE LA VISTA: la misma
 * regla la necesitaban dos lugares de AnswerKeyView.tsx (el contador que
 * habilita el botón, y la función que arma el borrador), y estaban escritas
 * por separado — la segunda duplicación real, el momento en que PROMPT.md §5
 * dice extraer. Que se separaran es justo lo que dejó pasar el bug de abajo.
 *
 * EL BUG QUE ORIGINA ESTO, reproducido: la asignación es POSICIONAL sobre las
 * letras A-E que queden después de borrar todo lo demás. Una sola letra de
 * más al principio corre TODAS las respuestas un lugar. Medido con una clave
 * de 100 respuestas:
 *
 *   texto pegado                             letras   aciertos   ¿activaba?
 *   las 100 respuestas limpias                  100    100/100   sí (correcto)
 *   "Prof. Ana Cabrera" + las 100               107      0/100   SÍ, sin avisar
 *   título del examen + las 100                 118      5/100   SÍ, sin avisar
 *   una letra inválida en el medio (Q50)         99     49/100   no (faltaba Q100)
 *
 * La puerta anterior era `typed === 0`: solo detectaba el caso de MENOS
 * letras. El de más pasaba entero y calificaba el lote completo contra una
 * clave inventada, con apariencia de normalidad — el fallo que PROMPT.md
 * §13.8 considera peor que un rechazo, porque nadie lo va a mirar dos veces.
 */

/** Qué tan lejos está el texto de ser una clave usable. */
export type TypedKeyStatus = "empty" | "incomplete" | "exact" | "tooMany";

export interface TypedKeyParse {
  /** Las letras A-E encontradas, en orden de aparición. */
  letters: string[];
  /**
   * Ordinal → letra, recortado a `total`. Nunca trae ordinales fuera de
   * rango: es la segunda barrera, para que ni por un camino futuro se
   * guarde en IndexedDB una clave con 118 respuestas para 100 preguntas.
   */
  answers: Record<number, string>;
  status: TypedKeyStatus;
}

export function parseTypedAnswerKey(text: string, total: number): TypedKeyParse {
  const letters = text.toUpperCase().replace(/[^A-E]/g, "").split("").filter((l) => l !== "");

  const answers: Record<number, string> = {};
  letters.slice(0, total).forEach((l, i) => { answers[i + 1] = l; });

  const status: TypedKeyStatus =
    letters.length === 0 ? "empty"
    : letters.length > total ? "tooMany"
    : letters.length < total ? "incomplete"
    : "exact";

  return { letters, answers, status };
}
