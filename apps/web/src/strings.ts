/**
 * strings.ts — todo el texto visible de la interfaz, en un solo lugar.
 *
 * PROMPT.md §9 ("Idioma"): "Código en inglés. UI en español, centralizada
 * en un módulo de strings." No es preparación para traducir a otro idioma:
 * es para que el vocabulario que ve el profesor sea consistente y revisable
 * de una sentada, sin cazar literales por doce componentes.
 *
 * Regla de redacción aplicada aquí: se nombra lo que la persona reconoce,
 * no cómo está construido el sistema. El profesor no sabe qué es un
 * "fillRatio" ni una "homografía"; sabe qué es una marca floja y una hoja
 * torcida. Los términos técnicos solo aparecen en los detalles de
 * diagnóstico, donde sirven para reportar un problema.
 */

/** Motivos de rechazo: qué pasó y qué puede hacer la persona al respecto. */
export const REJECTION: Record<string, { title: string; what: string; action: string; actionable: boolean }> = {
  STUDENT_ID_UNREADABLE: {
    title: "Código ilegible",
    what: "Una de las siete columnas del código no se leyó con claridad, así que no se sabe de qué alumno es la hoja.",
    action: "Escribe el código a mano. Las respuestas ya están leídas: la hoja se califica sin volver a escanearla.",
    actionable: true,
  },
  MARKERS_NOT_FOUND: {
    title: "Marcadores no encontrados",
    what: "No se ubicaron las cuatro marcas de esquina, así que no hay forma de saber dónde cae cada burbuja.",
    action: "Vuelve a escanear la hoja sin doblarla y con las cuatro esquinas dentro del cristal.",
    actionable: true,
  },
  BAD_HOMOGRAPHY: {
    title: "Hoja demasiado deformada",
    what: "Las esquinas se encontraron, pero la hoja está tan torcida o curvada que las posiciones no cuadran.",
    action: "Vuelve a escanearla apoyada plana sobre el cristal.",
    actionable: true,
  },
  CALIBRATION_FAILED: {
    title: "Sin contraste suficiente",
    what: "No se distingue el negro del blanco en esta hoja: puede estar muy clara, velada o sobreexpuesta.",
    action: "Vuelve a escanearla con la configuración normal del escáner.",
    actionable: true,
  },
  BLANK_PAGE: {
    title: "Página en blanco",
    what: "La página no tiene nada impreso ni marcado. Es el reverso de una hoja escaneada a doble cara.",
    action: "No requiere acción.",
    actionable: false,
  },
};

/** Por qué una pregunta llegó a revisión, en términos de lo que se ve. */
export const REVIEW_REASON: Record<string, string> = {
  AMBIGUOUS: "Marca débil",
  MULTIPLE: "Dos marcas",
  BLANK: "Sin marca",
};

export const UI = {
  appName: "Calificador",
  engineLabel: (v: string) => `motor ${v}`,

  nav: {
    process: "Procesar",
    upload: "Cargar hojas",
    results: "Resultados",
    resolve: "Resolver",
    review: "Revisión",
    rejected: "Rechazadas",
    configure: "Configurar",
    answerKey: "Clave de respuestas",
    metrics: "Métricas",
  },

  upload: {
    title: "Cargar hojas",
    lead: "Arrastra los archivos del escáner. Cada archivo se identifica por su huella digital: si una hoja ya se procesó, se reconoce y no se vuelve a calificar.",
    dropTitle: "Suelta aquí las hojas escaneadas",
    dropSub: "o haz clic para elegir archivos",
    dropHint: "PDF de varias páginas · JPG · PNG · TIFF — se recomienda escáner a 200 DPI",
    working: "Leyendo hojas…",
    duplicate: "Ya procesada",
    processed: "Leída",
    rejectedLabel: "No se pudo leer",
    scannerNote:
      "El escaneo lee mejor que la foto de celular. Medido sobre la misma hoja: escaneada, 98 de 99 respuestas quedaron auto-aceptadas; fotografiada, 61. Ninguna de las dos produjo una respuesta incorrecta.",
  },

  results: {
    title: "Resultados del lote",
    lead: "Una fila por hoja. La nota se calcula al momento desde las respuestas leídas — si más tarde anulas una pregunta, todas se recalculan sin volver a escanear.",
    graded: "Calificadas sin dudas",
    pending: "Esperan tu revisión",
    rejected: "Rechazadas",
    average: "Promedio del aula",
    empty: "Todavía no hay hojas en este lote.",
    noKey: "Falta la clave de respuestas: las hojas están leídas pero aún no calificadas.",
    columns: {
      code: "Código",
      state: "Estado",
      correct: "Correctas",
      incorrect: "Incorrectas",
      review: "A revisión",
      grade: "Nota",
      origin: "Origen",
    },
  },

  review: {
    title: "Revisión manual",
    lead: "El sistema nunca adivina: cuando una marca no supera el umbral con claridad, la pregunta llega aquí en vez de convertirse en una nota equivocada.",
    empty: "No hay nada pendiente de revisar. Todas las respuestas se leyeron con claridad.",
    pendingLabel: "Pendientes",
    question: (n: number) => `Pregunta ${n}`,
    measured: "Oscuridad medida por opción",
    decision: "Tu decisión",
    confirm: "Confirmar y seguir",
    leaveBlank: "Dejar en blanco",
    keyboardHint: "elegir",
    keyboardConfirm: "confirmar",
    thresholds: { blank: "en blanco <", mark: "marca ≥", margin: "margen mín." },
  },

  rejected: {
    title: "Hojas rechazadas",
    lead: "Hojas que el sistema se negó a calificar, con el motivo exacto. Un rechazo explícito siempre es preferible a una nota inventada.",
    empty: "Ninguna hoja fue rechazada en este lote.",
    duplexNote:
      "Los reversos en blanco no cuentan como problema. Al escanear a doble cara cada hoja produce un reverso vacío que el sistema descarta solo; se listan aparte para que no escondan un rechazo que sí necesita tu atención.",
    needsAction: "Acción necesaria",
    normal: "Normal en doble cara",
    writeCode: "Escribir código",
    codePrompt: "Código del alumno (7 dígitos)",
    codeInvalid: "El código debe tener exactamente 7 dígitos.",
    recovered: "Hoja recuperada: sus respuestas ya estaban leídas.",
  },

  answerKey: {
    title: "Clave de respuestas",
    lead: "Sin clave, el sistema lee las respuestas de cada alumno pero no puede decir si son correctas.",
    steps: ["1 · Sin clave", "2 · Verificar hoja patrón", "3 · Clave activa"],
    emptyLead: (n: number) =>
      `${n} ${n === 1 ? "hoja leída" : "hojas leídas"}, ninguna calificada todavía. El sistema guardó las respuestas tal cual las marcó cada alumno. En cuanto exista una clave, todas las notas aparecen al instante.`,
    methodsTitle: "Tres maneras de crearla",
    methods: {
      sheet: {
        title: "Escanear una hoja patrón",
        body: "Llena una hoja en blanco marcando las respuestas correctas y escanéala junto con las de los alumnos. El sistema la lee igual que cualquier otra hoja.",
        why: "Es lo más rápido y lo que ya sabes hacer: no hay que teclear nada, y la hoja queda como respaldo en papel de cuál fue la clave.",
        badge: "Recomendada",
      },
      manual: {
        title: "Escribirla a mano",
        body: "Teclea las 100 respuestas seguidas y el sistema las reparte por pregunta a medida que escribes.",
        why: "Útil cuando no tienes una hoja impresa a mano, o para corregir una pregunta suelta después.",
      },
      import: {
        title: "Importar un archivo",
        body: "Pega la clave separada por espacios o comas, o súbela desde un archivo de texto.",
        why: "Sirve si ya tenías la clave escrita en la computadora antes de usar este sistema.",
      },
    },
    verifyWarning:
      "Revisa esta clave antes de activarla. Un error en la hoja de un alumno afecta una nota; un error aquí afecta todas. Por eso la clave no se puede activar mientras quede una sola marca dudosa.",
    verifyClean: "leídas con claridad",
    verifyUnsure: "sin lectura clara",
    verifyPending: (n: number) => `Faltan ${n} ${n === 1 ? "pregunta" : "preguntas"} por confirmar`,
    verifyReady: "Todas las respuestas están confirmadas. La clave puede activarse.",
    activate: (n: number) => `Activar clave y calificar ${n} ${n === 1 ? "hoja" : "hojas"}`,
    activeSince: (d: string) => `Clave activa desde el ${d}.`,
    voidQuestion: "anular",
    restoreQuestion: "restaurar",
    voidedCount: (n: number) => (n === 0 ? "0 anuladas" : `${n} ${n === 1 ? "anulada" : "anuladas"}`),
    recalculated: (voided: number, effective: number) =>
      `${voided} ${voided === 1 ? "pregunta anulada" : "preguntas anuladas"} — las notas se recalcularon sobre ${effective} preguntas. Las respuestas de los alumnos no se tocaron.`,
    replace: "Reemplazar clave",
    pickSheet: "Elige la hoja patrón entre las ya cargadas",
    manualPlaceholder: "DBCDCDBBCE…",
    manualCount: (n: number, total: number) => `${n} de ${total} respuestas escritas`,
    useThis: "Usar esta clave",
  },

  detail: {
    title: (id: string) => `Hoja ${id}`,
    lead: "Todo lo que el sistema leyó en esta hoja, y cada cambio que se le hizo después. Nada se sobrescribe: una corrección es un registro nuevo que apunta al anterior.",
    aligned: "Hoja alineada",
    history: "Historial de la hoja",
    allAnswers: "Las 100 respuestas leídas",
    automatic: "Lectura automática",
    correctedTo: (from: string, to: string) => `corregida de ${from} a ${to}`,
    idWritten: (id: string) => `Código escrito a mano: ${id}`,
    legend: { correct: "correcta", incorrect: "incorrecta", review: "a revisión" },
  },

  metrics: {
    title: "Calidad de lectura",
    lead: "La medida que importa no es cuántas respuestas se auto-aceptan, sino cuántas se auto-aceptan mal. Ese número debe ser cero: es preferible mandar diez a revisión que equivocar una nota.",
    autoIncorrect: "Auto-aceptadas incorrectas",
    autoIncorrectNote: "el objetivo del sistema",
    autoCorrect: "Auto-aceptadas correctas",
    toReview: "Enviadas a revisión",
    rejectedSheets: "Hojas rechazadas",
    rejectedNote: "sin contar reversos en blanco",
    reasonsTitle: "Motivos de rechazo",
    counts: "Hojas",
    isProblem: "Cuenta como problema",
    yes: "Sí",
    no: "No",
    thresholdsTitle: "Umbrales en uso",
    constant: "Constante",
    value: "Valor",
    origin: "De dónde sale",
  },

  common: {
    loading: "Cargando…",
    error: "Algo falló",
    retry: "Reintentar",
    cancel: "Cancelar",
    save: "Guardar",
    close: "Cerrar",
    sheets: (n: number) => `${n} ${n === 1 ? "hoja" : "hojas"}`,
    questions: (n: number) => `${n} ${n === 1 ? "pregunta" : "preguntas"}`,
    doubts: (n: number) => `${n} ${n === 1 ? "duda" : "dudas"}`,
    of20: "sobre 20",
    view: "Ver hoja",
    review: "Revisar",
    resolve: "Resolver",
    newBatch: "Nuevo lote",
    batchName: "Nombre del lote",
    createBatch: "Crear lote",
    noBatch: "Crea un lote para empezar a cargar hojas.",
  },
} as const;
