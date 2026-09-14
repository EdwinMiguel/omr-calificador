/**
 * batchSuggestion.ts — qué ofrece PRESELECCIONADO "Confirmar por lote".
 *
 * Vive aparte de Review.tsx y no como función suelta adentro del componente
 * porque decide algo con consecuencias sobre una nota, y eso tiene que poder
 * probarse sin montar React. Ver batchSuggestion.test.ts.
 *
 * LO QUE ESTO NO ES: no auto-acepta nada. Arma una sugerencia que una persona
 * confirma mirando el valor medido y el gráfico de barras. PROMPT.md §15 sigue
 * intacto: el motor no inventa respuestas, y esta pantalla tampoco.
 *
 * ── Por qué se excluyen las preguntas BLANK (medido, no supuesto) ──────────
 *
 * La primera versión de esta función usaba SOLO la prueba de razón
 * (PROMOTE_MAX_SECOND_RATIO): "el 2º no llega ni a la mitad del 1º". Esa
 * prueba no tiene escala — `0.032 contra 0.013` la pasa igual que
 * `0.40 contra 0.15`— y sobre papel vacío el ruido gana por goleada a otro
 * ruido con total naturalidad.
 *
 * Medido sobre las 12 hojas del dataset: de 27 preguntas que el motor
 * clasificó BLANK, 11 (41 %) llegaban al panel con una respuesta ya tildada,
 * con valores de hasta 0.032 — unas diez veces por debajo de lo que mide una
 * marca real en esas mismas hojas (markLevel 0.29-0.44). Una casilla tildada
 * sobre una pregunta que el alumno dejó vacía es exactamente la respuesta
 * inventada que §15 prohíbe, solo que pasando por la mano de alguien que
 * confirma rápido.
 *
 * NO se puede arreglar con un piso absoluto: en IMG_20260830_174156 las marcas
 * REALES pendientes miden 0.024-0.149, y el ganador de una pregunta vacía en
 * marcada-01 mide 0.112. Los dos rangos se pisan. Es el mismo límite duro que
 * ya documenta classification.ts para esa hoja (brecha de separación negativa:
 * ningún umbral sobre fillRatio separa sus marcas de sus no-marcas).
 *
 * Lo que SÍ los separa es una decisión que el motor ya tomó con un instrumento
 * mejor: la guarda de blanco (BLANK_MARGIN_MAX, calibrada contra 1.240
 * preguntas genuinamente vacías fabricadas por trasplante). Si una opción se
 * despega aunque sea 0.02, la pregunta sale de BLANK y va a AMBIGUOUS; si
 * queda BLANK es porque NADA se despegó, y entonces no hay evidencia de CUÁL
 * opción sugerir. Preseleccionar ahí sería contradecir esa calibración con una
 * razón sin escala.
 *
 * Con la exclusión: 0 de 27 preguntas vacías reciben sugerencia, y las 30
 * marcas reales pendientes de IMG_20260830_174156 (verdad dictada antes de
 * procesar) se siguen ofreciendo, las 30 con la opción correcta.
 *
 * Las BLANK no desaparecen: siguen en la cola de abajo, para revisarlas una
 * por una con el gráfico de barras a la vista.
 */

import { PROMOTE_MAX_SECOND_RATIO } from "../../../../packages/engine/classification.ts";

export interface Suggestion {
  label: string;
  value: number;
}

/**
 * @param kind veredicto del motor para la pregunta ("AMBIGUOUS", "MULTIPLE",
 * "BLANK"). Hace falta acá: sin él no hay forma de distinguir "nadie marcó" de
 * "marcó flojo", que es justo lo que separa el ruido de la marca real.
 * @param fills valores normalizados por opción, los mismos que muestra el
 * gráfico de barras.
 */
export function suggestionFor(
  kind: string,
  fills: Record<string, number> | undefined
): Suggestion | null {
  // El motor ya concluyó que acá no se despegó NADA. Ver la nota de arriba.
  if (kind === "BLANK") return null;
  if (!fills) return null;

  const sorted = Object.entries(fills).sort((a, b) => b[1] - a[1]);
  const top = sorted[0];
  if (!top || top[1] <= 0) return null;

  // Ganador inequívoco: la duda no puede ser sobre CUÁL opción es. Mismo
  // número que usa canPromote() en el motor, importado en vez de recopiado
  // para que las dos nociones de "inequívoco" no se desincronicen. También es
  // lo que descarta las MULTIPLE: dos marcas parejas nunca pasan esta prueba.
  const second = sorted[1];
  if (second && second[1] > top[1] * PROMOTE_MAX_SECOND_RATIO) return null;

  return { label: top[0], value: top[1] };
}
