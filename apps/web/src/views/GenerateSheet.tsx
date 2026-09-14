/**
 * GenerateSheet.tsx — imprimir la hoja que el resto de la app va a leer.
 *
 * Sin esto no hay examen que tomar: hasta ahora la app solo ofrecía un PDF
 * ESTÁTICO pre-generado (con "I.E. Ejemplo · Comunicación · Examen
 * bimestral" impreso), así que cualquier profesor que la usara hoy repartía
 * a sus alumnos una hoja que dice el nombre de otro colegio. Este es el
 * primer paso real del flujo, no uno más — por eso vive primero en el menú
 * (ver App.tsx).
 *
 * composeHalfSheetA4() y buildHalfSheetTemplate() ya existían y ya estaban
 * probados (Fase 1-2 de la media hoja): esta vista es la puerta de entrada
 * que le faltaba, no un motor nuevo. pdf-lib corre igual de bien en el
 * navegador que en Node (ya es dependencia del proyecto), así que la
 * generación es 100% cliente, sin servidor — mismo principio que el resto.
 */

import { useEffect, useState } from "react";
import { downloadBlob } from "../engine-browser/exportGrades.ts";
import { UI } from "../strings.ts";
import { Card, CardHead, Callout, ViewHead } from "../ui/primitives.tsx";

const STORAGE_KEY = "omr-calificador:generateSheetDefaults";

interface Fields {
  institucion: string;
  curso: string;
  tipoExamen: string;
}

const EMPTY: Fields = { institucion: "", curso: "", tipoExamen: "" };

/**
 * Los tres campos quedan recordados entre hojas: institución y curso casi
 * nunca cambian de un examen a otro, y no tiene sentido retipearlos cada
 * vez. try/catch porque localStorage puede fallar (navegación privada,
 * almacenamiento bloqueado) y esto es una comodidad, no algo de lo que la
 * pantalla dependa para funcionar.
 */
function loadSaved(): Fields {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<Fields>;
    return { institucion: parsed.institucion ?? "", curso: parsed.curso ?? "", tipoExamen: parsed.tipoExamen ?? "" };
  } catch {
    return EMPTY;
  }
}

function saveFields(f: Fields): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(f));
  } catch {
    // sin persistencia esta vez — la hoja se genera igual, solo no queda recordada.
  }
}

/** Nombre de archivo descriptivo, no genérico: "hoja-media-a4.pdf" a secas
 * no ayuda si el profesor descarga varias hojas de distintos cursos. */
function fileNameFor(f: Fields): string {
  const slug = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const parts = [slug(f.curso), slug(f.tipoExamen)].filter(Boolean);
  return (parts.length > 0 ? `hoja-${parts.join("-")}` : "hoja-examen") + ".pdf";
}

export function GenerateSheet() {
  const [fields, setFields] = useState<Fields>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFileName, setLastFileName] = useState<string | null>(null);

  useEffect(() => { setFields(loadSaved()); }, []);

  const ready = fields.institucion.trim() !== "" && fields.curso.trim() !== "" && fields.tipoExamen.trim() !== "";

  function set<K extends keyof Fields>(key: K, value: string) {
    setFields((f) => ({ ...f, [key]: value }));
    setLastFileName(null); // cambiar un campo invalida la confirmación anterior
  }

  async function generate() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      // Import dinámico, no estático: pdf-lib pesa ~180KB gzip y hasta acá
      // ninguna vista del navegador lo necesitaba (solo lo usaban scripts de
      // Node vía CLI). Con un import estático, TODAS las vistas de la app
      // pagan ese peso siempre, aunque nadie visite "Generar hoja" — MEDIDO:
      // el bundle principal saltó de 82.57KB a 265.67KB gzip con el import
      // estático. Con el dinámico, ese trozo separado solo se descarga la
      // primera vez que alguien genera una hoja.
      const [{ composeHalfSheetA4 }, { buildHalfSheetTemplate }] = await Promise.all([
        import("../../../../packages/pdf-generator/composeHalfSheetA4.ts"),
        import("../../../../packages/pdf-generator/halfSheetTemplate.ts"),
      ]);
      const t = buildHalfSheetTemplate(100);
      const bytes = await composeHalfSheetA4(t, fields);
      const fileName = fileNameFor(fields);
      downloadBlob(new Blob([bytes], { type: "application/pdf" }), fileName);
      saveFields(fields);
      setLastFileName(fileName);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ViewHead title={UI.generate.title} lead={UI.generate.lead} />
      <div className="stack">
        <Card>
          <CardHead><span className="eyebrow">{UI.generate.formHeading}</span></CardHead>
          <div className="card-body">
            <div className="fieldgrid">
              <label className="field">
                <span className="field-label">{UI.generate.institucionLabel}</span>
                <input
                  className="field-input"
                  value={fields.institucion}
                  placeholder={UI.generate.institucionPlaceholder}
                  onChange={(e) => set("institucion", e.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">{UI.generate.cursoLabel}</span>
                <input
                  className="field-input"
                  value={fields.curso}
                  placeholder={UI.generate.cursoPlaceholder}
                  onChange={(e) => set("curso", e.target.value)}
                />
              </label>
              <label className="field">
                <span className="field-label">{UI.generate.tipoExamenLabel}</span>
                <input
                  className="field-input"
                  value={fields.tipoExamen}
                  placeholder={UI.generate.tipoExamenPlaceholder}
                  onChange={(e) => set("tipoExamen", e.target.value)}
                />
              </label>
            </div>

            {fields.institucion && fields.curso && fields.tipoExamen && (
              <div className="generate-preview mono">{fields.institucion} · {fields.curso} · {fields.tipoExamen}</div>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
              <button className="btn btn--primary" disabled={!ready || busy} onClick={() => void generate()}>
                {busy ? UI.common.loading : UI.generate.button}
              </button>
              {!ready && <span className="topbar-meta">{UI.generate.needAllFields}</span>}
              {lastFileName && <span className="topbar-meta">{UI.generate.downloaded(lastFileName)}</span>}
            </div>
          </div>
        </Card>

        {error && <Callout tone="warn"><strong>{UI.common.error}.</strong> {error}</Callout>}

        <Callout tone="warn">
          <strong>{UI.generate.cutWarningTitle}</strong> {UI.generate.cutWarningBody}
        </Callout>

        <Callout>{UI.generate.printHint}</Callout>
      </div>
    </>
  );
}
