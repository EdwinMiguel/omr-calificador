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

/**
 * Contacto de soporte, visible en el pie del panel lateral en toda la app
 * — quien esté probando el sistema tiene que poder encontrar a quién
 * escribirle sin buscar. `whatsapp` va en formato wa.me (solo dígitos, con
 * código de país, sin +) para que el enlace abra directo.
 */
export const SUPPORT = {
  label: "Soporte",
  name: "Miguel Orellana Sotomayor",
  email: "miguelorellanasotomayor@gmail.com",
  phoneDisplay: "+51 933 789 071",
  whatsapp: "51933789071",
} as const;

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
    generate: "Generar hoja",
    upload: "Cargar hojas",
    results: "Resultados",
    resolve: "Resolver",
    review: "Revisión",
    rejected: "Rechazadas",
    configure: "Configurar",
    answerKey: "Clave de respuestas",
    metrics: "Métricas",
  },

  generate: {
    title: "Generar hoja",
    lead: "Cada mitad de A4 es la hoja privada de un alumno. Completa los tres campos y descarga el PDF listo para imprimir — quedan recordados para la próxima vez.",
    formHeading: "Datos del examen",
    institucionLabel: "Institución",
    institucionPlaceholder: "I.E. San Martín",
    cursoLabel: "Curso",
    cursoPlaceholder: "Comunicación",
    tipoExamenLabel: "Tipo de examen",
    tipoExamenPlaceholder: "Examen bimestral",
    button: "Generar y descargar PDF",
    needAllFields: "Completa los tres campos para generar la hoja.",
    downloaded: (fileName: string) => `Descargado: ${fileName}`,
    cutWarningTitle: "Corta por la línea punteada antes de repartir.",
    cutWarningBody:
      "El PDF trae DOS hojas en una A4 — una para cada alumno. Si se escanea o fotografía sin cortar, el sistema " +
      "la rechaza con un mensaje de código ilegible que no tiene nada que ver con el problema real: lo que faltó " +
      "fue el corte, no el código.",
    printHint: "Imprime al 100% de tamaño real — sin \"ajustar a página\" — o el motor no va a reconocer las coordenadas.",
  },

  upload: {
    title: "Cargar hojas",
    lead: "Arrastra los archivos del escáner. Cada archivo se identifica por su huella digital: si una hoja ya se procesó, se reconoce y no se vuelve a calificar.",
    templateHeading: "¿Todavía no imprimiste las hojas?",
    templateBody: "El sistema solo lee ESTA hoja: sus marcadores y sus burbujas están en coordenadas fijas que el motor ya conoce. Cualquier otra plantilla, aunque tenga las mismas 100 preguntas, no se va a leer.",
    templateGoToGenerate: "Generar hoja",
    dropTitle: "Suelta aquí las hojas escaneadas",
    dropSub: "o haz clic para elegir archivos",
    // TIFF ya no se anuncia: el motor corre en el navegador y ningún
    // navegador sabe decodificar TIFF (ver grayscale.ts). Anunciarlo hacía
    // que el profesor eligiera archivos que el sistema iba a rechazar.
    dropHint: "PDF de varias páginas · JPG · PNG — se recomienda escáner a 200 DPI",
    working: "Leyendo hojas…",
    preparing: "Preparando…",
    progress: (done: number, total: number) => `${done} de ${total} hojas leídas`,
    duplicate: "Ya procesada",
    processed: "Leída",
    rejectedLabel: "No se pudo leer",
    scannerNote:
      "El escaneo lee mejor que la foto de celular. Medido sobre la misma hoja: escaneada, 98 de 99 respuestas quedaron auto-aceptadas; fotografiada, 61. Ninguna de las dos produjo una respuesta incorrecta.",
  },

  roster: {
    heading: "Lista de códigos del curso",
    why:
      "El código del alumno son 7 dígitos sin dígito verificador: si el sistema lee un 7 donde había un 1, " +
      "el resultado parece un código válido y la nota se le acredita a otra persona sin ningún aviso. " +
      "Con la lista cargada, un código que no exista en el aula manda la hoja a revisión en vez de pasar en silencio.",
    optional: "Es opcional — sin lista el sistema funciona igual, solo que sin esta protección.",
    placeholder: "1234567\n2345678\n3456789",
    hint: "Pegá los códigos: uno por línea, o separados por comas. Podés copiarlos directo de una columna de Excel.",
    save: "Guardar lista",
    clear: "Quitar lista",
    active: (n: number) => `${n} ${n === 1 ? "código cargado" : "códigos cargados"}.`,
    none: "Todavía no cargaste la lista del curso.",
    parsed: (n: number) => `${n} ${n === 1 ? "código válido" : "códigos válidos"}`,
    invalid: (items: string[]) =>
      `${items.length} ${items.length === 1 ? "entrada no es un código" : "entradas no son códigos"} de 7 dígitos y ` +
      `${items.length === 1 ? "queda" : "quedan"} afuera: ${items.slice(0, 6).join(", ")}${items.length > 6 ? "…" : ""}`,
    zerosWarning:
      "Ojo con Excel: si un código empieza con cero, Excel lo guarda como número y se lo come al copiar. " +
      "El sistema NO los rellena solo — te los muestra como inválidos para que los revises.",
    duplicates: (items: string[]) =>
      `${items.length} ${items.length === 1 ? "código repetido" : "códigos repetidos"} (se guarda uno solo): ${items.join(", ")}`,
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
    unknownStudent: "Código desconocido",
    unknownStudentWarn: (n: number) =>
      `${n} ${n === 1 ? "hoja tiene un código que no figura" : "hojas tienen códigos que no figuran"} en la lista del curso. ` +
      `${n === 1 ? "Su nota está calculada pero no se sabe de quién es" : "Sus notas están calculadas pero no se sabe de quiénes son"} — ` +
      `resolvelo en "Hojas rechazadas" antes de exportar.`,
    exportCsv: "Exportar notas (CSV)",
    downloadBackup: "Descargar respaldo",
    columns: {
      code: "Código",
      state: "Estado",
      correct: "Correctas",
      incorrect: "Incorrectas",
      blank: "En blanco",
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
    batchTitle: "Confirmar por lote — esta hoja",
    batchLead: "La opción más oscura de cada pregunta, solo cuando se despega con claridad de las demás. Revisá la lista antes de confirmar: seguís siendo vos quien decide, no el sistema.",
    batchNone: "Ninguna pendiente de esta hoja tiene un ganador lo bastante claro — revisalas una por una abajo.",
    batchConfirm: (n: number) => `Confirmar ${n} seleccionada${n === 1 ? "" : "s"}`,
    batchNoSuggestion: "sin ganador claro",
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
    fixCode: "Corregir código",
    codePrompt: "Código del alumno (7 dígitos)",
    codeInvalid: "El código debe tener exactamente 7 dígitos.",
    codeNotInRoster: "Ese código tampoco figura en la lista del curso.",
    recovered: "Hoja recuperada: sus respuestas ya estaban leídas.",
    imageHint: "Así quedó el código en la hoja escaneada:",
    imageLoading: "Cargando la imagen de la hoja…",
    imageMissing: "No se guardó imagen de esta hoja.",
    unknownTitle: "El código no está en la lista del curso",
    unknownWhat:
      "Estas hojas se leyeron completas y sin dudas, pero el código que traen no figura entre los alumnos del curso. " +
      "Casi siempre es un dígito mal leído; también puede ser una hoja de otro curso que se coló en el lote.",
    unknownAction:
      "Compará el código con la imagen de la hoja y corregilo. Mientras no coincida con un alumno de la lista, " +
      "la nota está calculada pero no se sabe de quién es.",
    unknownRead: (code: string) => `el sistema leyó ${code}`,
  },

  answerKey: {
    title: "Clave de respuestas",
    lead: "Sin clave, el sistema lee las respuestas de cada alumno pero no puede decir si son correctas.",
    steps: ["1 · Sin clave", "2 · Completar clave", "3 · Clave activa"],
    emptyLead: (n: number) =>
      `${n} ${n === 1 ? "hoja leída" : "hojas leídas"}, ninguna calificada todavía. El sistema guardó las respuestas tal cual las marcó cada alumno. En cuanto exista una clave, todas las notas aparecen al instante.`,
    methodsTitle: "Elige cómo crearla",
    methods: {
      sheet: {
        title: "Escanear una hoja patrón",
        body: "Llena una hoja en blanco marcando las respuestas correctas y escanéala junto con las de los alumnos. El sistema la lee igual que cualquier otra hoja.",
        why: "Es lo más rápido y lo que ya sabes hacer: no hay que teclear nada, y la hoja queda como respaldo en papel de cuál fue la clave.",
        badge: "Recomendada",
      },
      click: {
        title: "Marcar las respuestas en pantalla",
        body: "Recorre las 100 preguntas en pantalla y toca la opción correcta de cada una — como llenar la hoja, pero con el mouse en vez de un lápiz.",
        why: "No hace falta imprimir nada ni escribir 100 letras seguidas: útil si no tienes una hoja en blanco a mano.",
      },
      manual: {
        title: "Escribirla a mano",
        body: "Teclea las 100 respuestas seguidas y el sistema las reparte por pregunta a medida que escribes.",
        why: "Más rápido que tocar una por una si ya la tienes memorizada o escrita en un papel al lado del teclado.",
      },
      import: {
        title: "Importar desde Excel",
        body: "Sube el archivo de Excel donde ya tienes la clave (una hoja de Google descargada como Excel también sirve).",
        why: "Para cuando ya llevas el control en una hoja de cálculo, sin tener que volver a escribirla acá.",
        comingSoon: "Próximamente",
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
    editQuestion: "editar",
    voidQuestion: "anular",
    restoreQuestion: "restaurar",
    voidedCount: (n: number) => (n === 0 ? "0 anuladas" : `${n} ${n === 1 ? "anulada" : "anuladas"}`),
    recalculated: (voided: number, effective: number) =>
      `${voided} ${voided === 1 ? "pregunta anulada" : "preguntas anuladas"} — las notas se recalcularon sobre ${effective} preguntas. Las respuestas de los alumnos no se tocaron.`,
    replace: "Reemplazar clave",
    pickSheet: "Elige la hoja patrón entre las ya cargadas",
    manualPlaceholder: "DBCDCDBBCE…",
    manualCount: (n: number, total: number) => `${n} de ${total} respuestas escritas`,
    manualTooMany: (n: number, total: number) =>
      `Se encontraron ${n} letras A-E y la clave necesita exactamente ${total}. ` +
      `Suele pasar al pegar el título del examen o el nombre del docente junto con las respuestas: ` +
      `esas letras se cuentan como respuestas y corren todas las demás de lugar. ` +
      `Deja en el recuadro solo las ${total} respuestas.`,
    manualTooFew: (n: number, total: number) =>
      `Faltan ${total - n}: se encontraron ${n} letras A-E de las ${total} que necesita la clave.`,
    useThis: "Usar esta clave",
  },

  detail: {
    title: (id: string) => `Hoja ${id}`,
    lead: "Todo lo que el sistema leyó en esta hoja, y cada cambio que se le hizo después. Nada se sobrescribe: una corrección es un registro nuevo que apunta al anterior.",
    aligned: "Hoja escaneada",
    showMarks: "Mostrar lo que leyó el programa",
    legendRead: "leída con confianza",
    legendReview: "quedó en duda",
    zoomIn: "Ver en tamaño real",
    zoomFit: "Ajustar a la pantalla",
    imageAlt: "Hoja escaneada del alumno con la lectura del programa señalada",
    imageUnavailable: "No se puede mostrar esta hoja: no se pudo enderezar para verla.",
    verifyHint:
      "Comprueba que cada anillo verde caiga sobre una burbuja realmente pintada. " +
      "Las marcas ámbar son las que el programa prefirió no decidir solo.",
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
    autoBlank: "Sin contestar",
    autoBlankNote: "cuentan 0 y no van a revisión",
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
    restoreBackup: "Restaurar respaldo",
    batchName: "Nombre del lote",
    createBatch: "Crear lote",
    noBatch: "Crea un lote para empezar a cargar hojas.",
    renameBatch: "Renombrar",
    renameBatchPrompt: "Nuevo nombre del lote",
    deleteBatch: "Borrar lote",
    confirmDeleteBatch: (label: string, sheets: number) =>
      `¿Borrar "${label}"? Se pierden las ${sheets} hoja${sheets === 1 ? "" : "s"} cargadas, la clave de respuestas ` +
      "y todas las correcciones. Esto no se puede deshacer.",
  },
} as const;
