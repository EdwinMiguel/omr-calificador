import { describe, it, expect } from "vitest";
import { classify, deriveSheetMarkContext, BLANK_MAX, MARK_MIN, MARGIN_MIN, BLANK_MARGIN_MAX } from "./classification.ts";

const opts = (values: number[]): { label: string; normalized: number }[] =>
  values.map((v, i) => ({ label: "ABCDE"[i]!, normalized: v }));

/**
 * Los casos se expresan RELATIVOS a los umbrales, no con números fijos.
 *
 * Antes estaban escritos con valores pegados a MARK_MIN=0.25 ("0.20 está en
 * la zona gris", "0.24 no llega a marcada"), así que al recalibrar el umbral
 * los tests fallaban aunque la regla siguiera siendo exactamente la misma.
 * Eso los volvía tests de la calibración, no del comportamiento. Escritos
 * así prueban lo que de verdad importa —qué decide la regla en cada zona— y
 * sobreviven a cualquier recalibración futura.
 */
describe("classify — los 7 casos límite del plan (Día 9)", () => {
  it("marca limpia: una sola burbuja bien oscura", () => {
    expect(classify(opts([0.05, 0.9, 0.03, 0.02, 0.04]))).toEqual({ kind: "ANSWERED", option: "B" });
  });

  it("blanco: todas cerca de 0", () => {
    expect(classify(opts([0.02, 0.05, 0.01, 0.03, 0.0]))).toEqual({ kind: "BLANK" });
  });

  it("doble: dos burbujas claramente marcadas", () => {
    expect(classify(opts([0.85, 0.05, 0.8, 0.03, 0.02]))).toEqual({ kind: "MULTIPLE", options: ["A", "C"] });
  });

  it("débil: una burbuja en la zona gris entre BLANK_MAX y MARK_MIN, ninguna llega a marcada", () => {
    const gris = (BLANK_MAX + MARK_MIN) / 2;
    const r = classify(opts([0.05, gris, 0.02, 0.03, 0.04]));
    expect(r.kind).toBe("AMBIGUOUS");
  });

  it("borrada: zona gris residual tras borrar, no vuelve a blanco puro", () => {
    // Apenas por encima de BLANK_MAX: hay rastro de grafito, pero no llega
    // a marca. No es blanco ni es respuesta — es duda.
    const rastro = BLANK_MAX + (MARK_MIN - BLANK_MAX) * 0.25;
    const r = classify(opts([rastro, 0.05, 0.04, 0.03, 0.02]));
    expect(r.kind).toBe("AMBIGUOUS");
  });

  it(
    "margen bajo: una cruza MARK_MIN y otra queda cerca pero POR DEBAJO del " +
    "umbral — es una marca dudosa, no dos marcas",
    () => {
      const top = MARK_MIN + MARGIN_MIN * 0.4;
      const second = MARK_MIN - MARGIN_MIN * 0.25; // cerca del top, pero no es marca
      expect(top - second).toBeLessThan(MARGIN_MIN);
      expect(second).toBeLessThan(MARK_MIN);
      const r = classify(opts([top, second, 0.02, 0.03, 0.04]));
      expect(r.kind).toBe("AMBIGUOUS");
    }
  );

  it(
    "si la segunda TAMBIÉN cruza MARK_MIN y está dentro del margen, es MULTIPLE " +
    "— por eso bajar MARK_MIN convierte en 'doble marca' lo que antes era " +
    "'marca con ruido al lado'. Ambos van a revisión igual, pero la etiqueta cambia",
    () => {
      const top = MARK_MIN + MARGIN_MIN * 0.6;
      const second = MARK_MIN + MARGIN_MIN * 0.1;
      expect(top - second).toBeLessThan(MARGIN_MIN);
      expect(second).toBeGreaterThanOrEqual(MARK_MIN);
      expect(classify(opts([top, second, 0.02, 0.03, 0.04])).kind).toBe("MULTIPLE");
    }
  );

  it("marca normal: oscura y con margen amplio sobre el resto", () => {
    expect(classify(opts([0.02, 0.03, 0.04, 0.95, 0.05]))).toEqual({ kind: "ANSWERED", option: "D" });
  });

  it("los umbrales mantienen un orden coherente entre sí", () => {
    // Si MARK_MIN cayera por debajo de BLANK_MAX, un mismo valor sería a la
    // vez "en blanco" y "marcado", y la primera guarda de classifyByMargin
    // ganaría siempre: nada podría clasificarse nunca como respuesta.
    expect(BLANK_MAX).toBeLessThan(MARK_MIN);
    expect(MARGIN_MIN).toBeGreaterThan(0);
  });
});

/**
 * El rescate de marcas reales que no llegan a MARK_MIN (caso Q97: marca de
 * tinta normal pero con menos cobertura, que medía 0.236 contra un umbral de
 * 0.25, con la segunda opción en 0.04 — o sea, sin ninguna duda sobre CUÁL
 * marcó). Ver la nota extensa en classification.ts.
 */
describe("classify — rescate con el contexto de la hoja", () => {
  /** Una hoja sana: marcas alrededor de 0.40, ruido bajo. */
  const hojaLimpia = deriveSheetMarkContext([
    ...Array.from({ length: 30 }, () => opts([0.40, 0.03, 0.02, 0.01, 0.04])),
  ]);

  it("rescata el caso Q97: ganador inequívoco, parecido a una marca de esta hoja", () => {
    const casoQ97 = opts([0.236, 0.04, 0.005, -0.001, -0.024]);
    // Sin contexto —como se clasifica el código del alumno— sigue dudosa.
    expect(classify(casoQ97).kind).toBe("AMBIGUOUS");
    // Con el contexto de la hoja, se resuelve.
    expect(classify(casoQ97, hojaLimpia)).toEqual({ kind: "ANSWERED", option: "A" });
  });

  it("NO inventa respuesta en una pregunta en blanco con ruido: el piso sube con el ruido de la hoja", () => {
    // Misma hoja pero sucia: sus propias perdedoras llegan alto, así que el
    // piso se levanta solo y la misma medición ya no alcanza.
    const hojaSucia = deriveSheetMarkContext([
      ...Array.from({ length: 30 }, () => opts([0.40, 0.22, 0.19, 0.05, 0.03])),
    ]);
    expect(hojaSucia.noiseHigh).toBeGreaterThan(hojaLimpia.noiseHigh);
    expect(classify(opts([0.236, 0.04, 0.005, 0.0, 0.0]), hojaSucia).kind).toBe("AMBIGUOUS");
  });

  it("NO rescata si la segunda opción está cerca: ahí la duda es CUÁL, no si marcó", () => {
    expect(classify(opts([0.236, 0.20, 0.01, 0.0, 0.0]), hojaLimpia).kind).toBe("AMBIGUOUS");
  });

  it("NO rescata una marca demasiado floja para lo que mide marcar en esta hoja", () => {
    // Muy por debajo de la marca típica (0.40) aunque gane por lejos.
    expect(classify(opts([0.17, 0.01, 0.0, 0.0, 0.0]), hojaLimpia).kind).toBe("AMBIGUOUS");
  });

  it("NO rescata si la hoja no tiene suficientes marcas confiables de las que fiarse", () => {
    const hojaPobre = deriveSheetMarkContext([
      ...Array.from({ length: 3 }, () => opts([0.40, 0.03, 0.02, 0.01, 0.04])),
    ]);
    expect(hojaPobre.confidentMarks).toBeLessThan(10);
    expect(classify(opts([0.236, 0.04, 0.005, 0.0, 0.0]), hojaPobre).kind).toBe("AMBIGUOUS");
  });

  it("no toca lo que ya se decidía: en blanco sigue en blanco, marca clara sigue clara", () => {
    expect(classify(opts([0.02, 0.05, 0.01, 0.03, 0.0]), hojaLimpia).kind).toBe("BLANK");
    expect(classify(opts([0.05, 0.9, 0.03, 0.02, 0.04]), hojaLimpia)).toEqual({ kind: "ANSWERED", option: "B" });
  });
});

/**
 * La guarda de blanco. BLANK se AUTO-ACEPTA —la pregunta cuenta como no
 * contestada y nadie la revisa— así que exigirle una prueba de margen es
 * lo mismo que ya se le exige a ANSWERED. Ver BLANK_MARGIN_MAX.
 */
describe("classify — guarda de blanco", () => {
  it(
    "REGRESIÓN Q95: una opción que se despega del resto NO es una pregunta " +
    "sin contestar, aunque no llegue a BLANK_MAX",
    () => {
      // Números reales de Q95 de ground-truth/IMG_20260830_172453.json (foto
      // de celular, verdad dictada antes de procesar): el alumno marcó C.
      // Medía 0.147 contra BLANK_MAX=0.15 y el motor la daba por no
      // contestada, auto-aceptando una nota mal calculada.
      const q95 = opts([-0.065, -0.071, 0.147, -0.051, 0.014]);
      expect(q95[2]!.normalized).toBeLessThan(BLANK_MAX);
      expect(classify(q95).kind).toBe("AMBIGUOUS");
    }
  );

  it("una pregunta genuinamente en blanco sigue siendo BLANK: nadie se despega", () => {
    // Las cinco opciones dentro del ruido de la hoja, sin ganador.
    expect(classify(opts([0.02, 0.05, 0.01, 0.03, 0.0])).kind).toBe("BLANK");
    // Justo por debajo del margen de la guarda: sigue siendo blanco.
    const casi = BLANK_MARGIN_MAX * 0.9;
    expect(classify(opts([casi, 0.0, 0.0, 0.0, 0.0])).kind).toBe("BLANK");
  });

  it(
    "la guarda solo puede mandar a revisión, nunca producir una respuesta — " +
    "ni siquiera con el contexto de una hoja que rescataría",
    () => {
      const hoja = deriveSheetMarkContext([
        ...Array.from({ length: 30 }, () => opts([0.40, 0.03, 0.02, 0.01, 0.04])),
      ]);
      // Por debajo de BLANK_MAX el rescate ni siquiera se evalúa: la rama de
      // promoción vive más abajo, en la franja BLANK_MAX-MARK_MIN.
      const r = classify(opts([BLANK_MAX - 0.001, 0.0, 0.0, 0.0, 0.0]), hoja);
      expect(r.kind).toBe("AMBIGUOUS");
      expect(r.kind).not.toBe("ANSWERED");
    }
  );

  it("el margen de la guarda es más exigente que el ruido de una hoja limpia", () => {
    // Si BLANK_MARGIN_MAX fuera 0, toda pregunta en blanco con un pelo de
    // ruido en una opción iría a revisión y la cola se volvería inútil.
    expect(BLANK_MARGIN_MAX).toBeGreaterThan(0);
    expect(BLANK_MARGIN_MAX).toBeLessThan(BLANK_MAX);
  });
});
