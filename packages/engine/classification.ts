/**
 * classification.ts — Día 9: convertir números en decisiones conservadoras.
 *
 * Recibe fillRatios ya NORMALIZADOS por hoja (calibration.ts) — nunca
 * crudos, porque "0.45" no significa nada sin saber contra qué hoja se
 * midió. Clasificación conservadora (PROMPT.md §13.1): ninguna guarda
 * `else` que adivine — lo no resuelto limpiamente cae en AMBIGUOUS.
 */

export type ClassificationState =
  | { kind: "ANSWERED"; option: string }
  | { kind: "BLANK" }
  | { kind: "MULTIPLE"; options: string[] }
  | { kind: "AMBIGUOUS" };

/**
 * Los tres umbrales nombrados que exige PROMPT.md §7 — con su origen y su
 * estado explícitos, no números mágicos.
 *
 * RECALIBRADOS CON EVIDENCIA REAL (foto-11.jpeg, hoja marcada casi
 * completa, 100 preguntas): para cada pregunta se tomó el valor más alto
 * de sus 5 opciones (≈marca real, dado que casi todo estaba marcado) y
 * también los otros 4 valores de cada pregunta (≈papel en blanco real,
 * 400 muestras). Los dos grupos SE SUPERPONEN — hay marcas reales tan
 * débiles como 0.016 y "blancos" tan ruidosos como 0.228 — así que ningún
 * corte separa el 100% de los casos; eso es justamente evidencia real,
 * no una falla de calibración.
 *
 *   MARK_MIN=0.25  → 0 de 400 valores "blanco" lo cruzan (máximo real
 *                    observado: 0.228) — cero falsos positivos, prioridad
 *                    del proyecto (§15, AUTO_ACCEPTED_INCORRECT=0).
 *   BLANK_MAX=0.15 → por debajo, el percentil 90 de los "blancos" reales
 *                    (0.139) — la franja 0.15-0.25 queda deliberadamente
 *                    como zona de incertidumbre real (AMBIGUOUS), no un
 *                    error: en esta calidad de foto, una parte de las
 *                    marcas genuinamente débiles no se puede distinguir
 *                    con confianza de una mancha, y eso tiene que ir a
 *                    revisión manual, no a un lado o al otro por default.
 *
 * El valor original (MARK_MIN=0.5) asumía que una marca de lápiz se
 * acerca a la densidad óptica de la tinta de impresora de los parches de
 * calibración — medido: NO es así, ni de cerca (ver la nota extensa sobre
 * esto en fiducials.ts, mismo hallazgo). CALIBRAR de nuevo si cambia la
 * calidad de foto esperada (luz, enfoque, resolución) o el grosor de
 * burbuja del template.
 */
export const BLANK_MAX = 0.15;
export const MARK_MIN = 0.25;
export const MARGIN_MIN = 0.08;

/**
 * ── Guarda de blanco ─────────────────────────────────────────────────────
 *
 * PROBLEMA MEDIDO, y es estructural: BLANK es un veredicto que se
 * AUTO-ACEPTA —la pregunta cuenta como no contestada y nadie la revisa—
 * pero era el único que no exigía ninguna prueba de margen. Dos preguntas
 * muy distintas recibían la misma respuesta:
 *
 *     las cinco opciones miden ≈0        → nadie marcó nada
 *     una mide 0.147 y las otras ≈0      → alguien marcó, flojo
 *
 * El segundo caso es real: Q95 de la foto de celular anotada
 * (ground-truth/IMG_20260830_172453.json, verdad dictada antes de
 * procesar). El alumno marcó C; con la escala de entonces medía 0.147
 * contra BLANK_MAX=0.15 y la hoja salía con una nota mal calculada, en
 * silencio. AUTO_ACCEPTED_INCORRECT = 1, que es exactamente lo que
 * PROMPT.md §15 prohíbe. Nótese que classify() ya tenía una ruta de rescate
 * elaborada para la franja 0.15-0.25 y ninguna para lo que cae debajo.
 *
 * LA REGLA: para declarar BLANK no alcanza con que el máximo sea bajo;
 * hace falta además que NINGUNA opción se despegue de las otras. Si una se
 * despega, la pregunta va a revisión. Es estrictamente conservadora — solo
 * puede mover BLANK → AMBIGUOUS, nunca producir una respuesta — así que por
 * construcción no puede introducir un error nuevo, solo cola de revisión.
 *
 * DE DÓNDE SALE 0.06. Se fabricaron preguntas genuinamente en blanco sobre
 * las imágenes reales: para cada marca verdadera se trasplanta el bloque de
 * una burbuja que el alumno NO marcó, de la misma columna y a pocas filas
 * (misma x exacta ⇒ mismo anillo impreso, misma etiqueta, casi la misma
 * luz), mezclando `nuevo = donante + α·(original − donante)`. Con α=0 la
 * pregunta queda vacía con papel, anillo y sombreado REALES; la verdad no
 * cambia, así que toda respuesta perdida es culpa de la atenuación y toda
 * inventada es un fallo de la regla. 40 semillas × 15 preguntas borradas ×
 * 2 hojas × 2 niveles de α = 16.000 preguntas evaluadas.
 *
 * En esas 1.240 preguntas genuinamente en blanco, el margen entre la 1ª y
 * la 2ª opción llega como máximo a 0.093 y solo un 5-7% supera 0.06. En las
 * marcas reales que caían por debajo de BLANK_MAX, el margen mínimo fue
 * 0.118.
 *
 * ── 0.06 → 0.02 (2026-09-03), con una TERCERA hoja con verdad ───────────
 *
 * Apareció el régimen que las dos primeras hojas no cubrían.
 * IMG_20260830_174156.jpg tiene marcas de lápiz extremadamente tenues: la
 * más floja mide 0.008 de fillRatio crudo por encima del papel de su propia
 * fila, unos 2 niveles de gris sobre 255. Con 0.06, OCHO preguntas con
 * marca real (Q32-Q39) se auto-aceptaban como "sin contestar" — ocho notas
 * mal calculadas en silencio sobre una sola hoja.
 *
 * Esa hoja además demuestra el límite duro de este estadístico: su brecha
 * de separación es NEGATIVA a cualquier radio de búsqueda (-0.037 en el
 * mejor caso), o sea que la peor marca verdadera mide por debajo de la
 * mejor no-marca verdadera. Ningún umbral sobre fillRatio las separa. Por
 * eso la respuesta correcta no es "afinar el corte" sino "no auto-aceptar
 * ahí": exactamente lo que hace esta guarda.
 *
 * Bajar el margen solo puede mover BLANK → revisión, nunca inventar una
 * respuesta, así que la única contrapartida es cola de revisión. Barrido
 * sobre las TRES hojas con verdad (300 preguntas), con radio de búsqueda
 * ±8 (ver measurement.ts):
 *
 *   G      correctas   INCORRECTAS   a revisión
 *   0.06      264           7            29
 *   0.04      264           6            30
 *   0.03      264           5            31
 *   0.02      264           0            36     ← única con la barrera §15
 *   0.015     264           0            36
 *
 * COSTE, sobre 900 preguntas genuinamente en blanco fabricadas con el
 * trasplante descrito arriba: pasan a revisión el 2% con G=0.06 y el 37%
 * con G=0.02. Suena caro, pero se paga SOLO en preguntas sin contestar, y
 * en el conjunto se compensa: sobre las 12 hojas del dataset (1200
 * preguntas) la cola total de revisión pasa de 368 a 372 — cuatro más — y
 * las respuestas auto-aceptadas suben 83, porque el radio ±8 resuelve más
 * de lo que esta guarda manda a revisar.
 *
 * CALIBRAR si cambia la calidad de foto esperada.
 *
 * RESULTADO del banco (notas mal calculadas y auto-aceptadas, sobre 4.000
 * preguntas por escenario; α=0.8 modela un lápiz más flojo):
 *
 *                                    escaneada        celular
 *                                   α=1    α=0.8    α=1    α=0.8
 *   antes (vecindario, sin guarda)    0      0       19      67
 *   referencia de fila, sin guarda    0      0        0      31
 *   referencia de fila + esta guarda  0      0        0       0
 *
 * COSTO: sobre las 12 hojas reales mueve 171 preguntas de BLANK a revisión,
 * pero la cuenta se concentra en las hojas medio vacías del dataset de
 * pruebas (marcada-01: 31, marcada-02: 32). En las tres hojas que parecen
 * un examen completo de verdad cuesta 0, 0 y 2 preguntas.
 *
 * SE PROBÓ UNA VARIANTE ADAPTATIVA y se descartó: exigir además que el
 * ganador supere el noiseHigh de la hoja baja la cola de revisión del banco
 * de 47 a 33 y de 70 a 53, y cuesta 0 en las hojas sucias — pero se apaga
 * sola justo en las hojas donde el veredicto BLANK es MENOS fiable (ahí
 * noiseHigh > BLANK_MAX), y esas hojas no tienen verdad conocida con la que
 * comprobar que apagarla sea seguro. §15: se prefiere la cola de revisión.
 */
export const BLANK_MARGIN_MAX = 0.02;

export interface LabeledFill {
  label: string;
  normalized: number;
}

/**
 * ── Rescate de marcas reales que no llegan a MARK_MIN ───────────────────
 *
 * PROBLEMA REAL, no teórico. Caso Q97 de la hoja escaneada: el alumno marcó
 * la E, en el papel se ve una marca normal, y el motor la mandaba a revisión.
 * Medido: la TINTA de esa marca es tan oscura como la de sus vecinas (el 10%
 * de píxeles más oscuros da 0.514, contra 0.490-0.549 de las preguntas de al
 * lado); lo único distinto es que cubre un poco menos de área (15% contra
 * 16-19%). Como `fillRatio` promedia la oscuridad de TODA la burbuja, una
 * marca igual de negra pero un poco más chica mide menos y cae del lado malo
 * de un umbral fijo. Su segunda opción medía 0.04 contra 0.236 de la
 * ganadora: no había ninguna duda sobre CUÁL opción marcó.
 *
 * Ahí está la clave: el clasificador mezcla dos preguntas distintas.
 *   ¿QUÉ opción marcó?  → lo responde el margen con la segunda.
 *   ¿Marcó algo?        → lo responde la oscuridad absoluta.
 * Cuando el margen es enorme, la primera pregunta está resuelta y solo queda
 * la segunda. Y para esa, una constante universal (0.25) es el mismo error
 * que ya se corrigió en calibration.ts con la referencia de blanco: la hoja
 * misma dice cuánto mide marcar EN ELLA.
 *
 * DOS REFERENCIAS, las dos sacadas de la propia hoja:
 *   `markLevel` — cuánto mide una marca que el motor ya aceptó con confianza
 *                 (mediana de esas). Medido: 0.30-0.40 según la hoja.
 *   `noiseHigh` — cuánto llega a medir una burbuja SIN marcar en esa hoja
 *                 (percentil 99 de las opciones perdedoras de las preguntas
 *                 ya resueltas). Medido: 0.06 en un escaneo limpio, hasta
 *                 0.44 en una foto mala.
 * Esa segunda referencia es la que hace la regla segura sola: en una foto
 * sucia el piso sube por encima de MARK_MIN y NO se promueve nada, sin que
 * haga falta detectar "foto mala" por ningún otro medio.
 *
 * VALIDACIÓN (por qué estos números y no otros). Con una sola hoja anotada
 * no alcanza, así que se fabricaron casos límite con verdad conocida: se
 * partió de las mediciones reales de esa hoja y se atenuó la marca que el
 * alumno SÍ hizo (la verdad no cambia), y se inyectó como ruido en las
 * opciones no marcadas la distribución REAL medida en las 9 fotos del
 * dataset (1448 muestras). 5 semillas × 10 escenarios, incluyendo preguntas
 * dejadas genuinamente en blanco con ruido en las 5 opciones. Resultado del
 * barrido: sin el margen sobre el ruido la regla INVENTABA respuestas donde
 * no había marca (2-3 casos); con margen 0.10 quedó en CERO inventadas y
 * CERO opciones equivocadas en las 5 semillas. Por eso el margen es 0.10 y
 * no 0.05.
 *
 * LÍMITE DECLARADO: esto NO se aplica al código del alumno (grupos de
 * dígitos). Una respuesta mal leída afecta una nota; un dígito mal leído
 * asigna la hoja a otro alumno. `analyzeSheet` pasa el contexto solo para
 * las preguntas, así que la lectura del código sigue exactamente igual de
 * estricta que antes.
 */
const PROMOTE_MAX_SECOND_RATIO = 0.5;
const PROMOTE_MIN_LEVEL_FRACTION = 0.55;
const PROMOTE_NOISE_MARGIN = 0.10;
const PROMOTE_MIN_CONFIDENT_MARKS = 10;

/** Lo que la hoja sabe de sí misma, para decidir sus propios casos límite. */
export interface SheetMarkContext {
  /** Mediana de las marcas que el motor ya aceptó con confianza. */
  markLevel: number;
  /** Percentil 99 de las burbujas sin marcar de esas mismas preguntas. */
  noiseHigh: number;
  /** Cuántas marcas confiables sostienen las dos referencias de arriba. */
  confidentMarks: number;
}

function percentile(sorted: number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
}

/**
 * Deriva las referencias de la hoja a partir de los grupos ya medidos.
 *
 * No hay circularidad con `classify()`: para saber si una marca es
 * "confiable" alcanza con mirar si supera MARK_MIN, que sale directo de los
 * números medidos, sin necesidad de clasificar nada primero.
 */
export function deriveSheetMarkContext(groups: LabeledFill[][]): SheetMarkContext {
  const marks: number[] = [];
  const losers: number[] = [];

  for (const bubbles of groups) {
    const sorted = [...bubbles].sort((a, b) => b.normalized - a.normalized);
    const top = sorted[0];
    if (!top || top.normalized < MARK_MIN) continue;
    marks.push(top.normalized);
    for (let i = 1; i < sorted.length; i++) losers.push(sorted[i]!.normalized);
  }

  marks.sort((a, b) => a - b);
  losers.sort((a, b) => a - b);

  return {
    markLevel: marks.length > 0 ? percentile(marks, 0.5) : NaN,
    noiseHigh: losers.length > 0 ? percentile(losers, 0.99) : NaN,
    confidentMarks: marks.length,
  };
}

/** ¿Se puede rescatar esta pregunta dudosa sin arriesgar una nota inventada? */
function canPromote(top: LabeledFill, second: number, sheet: SheetMarkContext): boolean {
  if (sheet.confidentMarks < PROMOTE_MIN_CONFIDENT_MARKS) return false;
  if (!Number.isFinite(sheet.markLevel) || !Number.isFinite(sheet.noiseHigh)) return false;
  // Ganador inequívoco: la duda no puede ser sobre CUÁL opción es.
  if (second > top.normalized * PROMOTE_MAX_SECOND_RATIO) return false;
  // Se parece a lo que mide marcar en esta hoja...
  if (top.normalized < sheet.markLevel * PROMOTE_MIN_LEVEL_FRACTION) return false;
  // ...y está claramente por encima de lo que mide NO marcar en esta hoja.
  return top.normalized >= sheet.noiseHigh + PROMOTE_NOISE_MARGIN;
}

/**
 * MEDIDO — bug real, no teórico: la primera versión llamaba MULTIPLE en
 * cuanto DOS burbujas cruzaban MARK_MIN, sin mirar qué tan lejos estaban
 * entre sí. En columnas de dígito (10 opciones, más candidatos que en una
 * pregunta de 5) esto disparaba falsos MULTIPLE: la marca real a 0.71 y un
 * segundo candidato con ruido a 0.41 — ambos por encima de 0.25, pero con
 * una brecha de 0.30 entre sí, nada parecido a una doble marca real (que
 * debería verse pareja, no con un ganador claro). Una doble marca genuina
 * y "una marca clara + ruido secundario que también cruzó el umbral" son
 * distinguibles por lo mismo: qué tan CERCA está el 2º lugar del 1º — no
 * si el 2º cruzó independientemente la misma línea fija que el 1º.
 */
function classifyByMargin(sorted: LabeledFill[], sheet?: SheetMarkContext): ClassificationState {
  const top = sorted[0]!;
  const second = sorted[1];

  if (top.normalized < BLANK_MAX) {
    // "Nadie marcó nada" exige que nadie se despegue. Si una opción se
    // despega de las demás hay algo escrito ahí, aunque sea demasiado flojo
    // para leerlo: eso es duda, no una pregunta sin contestar. Ver la nota
    // de BLANK_MARGIN_MAX.
    if (second && top.normalized - second.normalized >= BLANK_MARGIN_MAX) {
      return { kind: "AMBIGUOUS" };
    }
    return { kind: "BLANK" };
  }
  if (top.normalized < MARK_MIN) {
    // Zona de duda. Solo se rescata con el contexto de la hoja y si se
    // cumplen TODAS las condiciones — si no, sigue yendo a revisión igual
    // que siempre. Ver la nota extensa sobre el rescate más arriba.
    if (sheet && second && canPromote(top, second.normalized, sheet)) {
      return { kind: "ANSWERED", option: top.label };
    }
    return { kind: "AMBIGUOUS" };
  }

  if (second && top.normalized - second.normalized < MARGIN_MIN) {
    // El 2º está pisándole los talones al 1º: o los dos son marca real
    // (pareja, ambos oscuros) o el 1º gana por muy poco para confiar.
    if (second.normalized >= MARK_MIN) {
      return { kind: "MULTIPLE", options: [top.label, second.label] };
    }
    return { kind: "AMBIGUOUS" };
  }

  return { kind: "ANSWERED", option: top.label };
}

/**
 * @param bubbles fillRatios ya normalizados (calibration.ts::normalize),
 * uno por burbuja del grupo (las 5 opciones de una pregunta, o los 10
 * dígitos de una columna de código).
 * @param sheet contexto de la hoja para rescatar marcas reales que no
 * llegan a MARK_MIN. OMITIRLO deja el comportamiento estricto de siempre —
 * es lo que se hace con el código del alumno, donde equivocarse cambia de
 * dueño la hoja entera.
 */
export function classify(bubbles: LabeledFill[], sheet?: SheetMarkContext): ClassificationState {
  const sorted = [...bubbles].sort((a, b) => b.normalized - a.normalized);
  return classifyByMargin(sorted, sheet);
}
