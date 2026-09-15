/**
 * roster.ts — la lista de códigos de alumno de un curso.
 *
 * POR QUÉ EXISTE, y es el hueco de seguridad más grande que tenía el
 * sistema: el código del alumno son 7 dígitos SIN dígito verificador. Si el
 * motor lee un 7 donde había un 1, el resultado es un código que parece
 * perfectamente válido, y la nota entera se le acredita a otra persona —en
 * silencio, y arruinando a DOS alumnos: uno recibe una nota ajena y el otro
 * nunca recibe la suya—. identification.ts ya protege el caso "no se lee
 * con confianza" (rechaza la hoja entera si CUALQUIER columna sale dudosa),
 * pero no tenía ninguna defensa contra "se lee con confianza y está mal".
 *
 * La lista del curso es esa defensa: un código leído que no existe en el
 * aula es, con certeza, un error de lectura o una hoja de otro curso. No
 * detecta el caso en que un dígito mal leído da JUSTO el código de otro
 * compañero del mismo curso —para eso haría falta un dígito verificador en
 * la hoja—, pero convierte la gran mayoría de los fallos silenciosos en
 * fallos avisados, que es la diferencia que importa.
 *
 * Es OPCIONAL a propósito: sin lista el sistema funciona igual que antes,
 * solo que sin esta red. No se le puede exigir al profesor tener la nómina
 * digitada para poder calificar.
 */

/** Los códigos son 7 dígitos numéricos — ver client_sheet_requirements. */
const CODE_RE = /^\d{7}$/;

export interface RosterParse {
  /** Códigos válidos, únicos, en orden de aparición. */
  codes: string[];
  /** Entradas que NO son un código de 7 dígitos, tal cual se escribieron. */
  invalid: string[];
  /** Códigos que aparecían más de una vez (se conserva uno solo). */
  duplicates: string[];
}

/**
 * Acepta lo que sea que el profesor pegue: una columna de Excel (un código
 * por línea), separados por comas, por espacios, o mezclado. Lo que no
 * tolera es inventar: cualquier cosa que no sean exactamente 7 dígitos se
 * reporta en `invalid` en vez de recortarse o rellenarse, para que el
 * profesor vea qué se quedó afuera en lugar de que el sistema adivine.
 *
 * NOTA sobre el riesgo de Excel: una columna de códigos con ceros a la
 * izquierda ("0012345") se guarda como número y pierde los ceros al
 * copiarla. Por eso un código de menos de 7 dígitos NO se rellena con
 * ceros automáticamente — se reporta como inválido y el profesor decide.
 * Rellenar en silencio sería exactamente el tipo de suposición que causó
 * el bug de la clave pegada con el encabezado.
 */
export function parseRoster(text: string): RosterParse {
  const tokens = text.split(/[\s,;]+/).filter((t) => t.length > 0);

  const codes: string[] = [];
  const invalid: string[] = [];
  const duplicates: string[] = [];
  const seen = new Set<string>();

  for (const raw of tokens) {
    if (!CODE_RE.test(raw)) {
      invalid.push(raw);
      continue;
    }
    if (seen.has(raw)) {
      if (!duplicates.includes(raw)) duplicates.push(raw);
      continue;
    }
    seen.add(raw);
    codes.push(raw);
  }

  return { codes, invalid, duplicates };
}
