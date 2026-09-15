/**
 * RosterCard.tsx — cargar la lista de códigos del curso.
 *
 * Vive en "Cargar hojas" porque es parte de preparar el lote, junto con
 * conseguir las hojas: el profesor pasa por acá antes de subir nada.
 *
 * La vista previa (válidos / inválidos / repetidos) no es decoración: es la
 * misma lección del bug de la clave pegada con el encabezado del examen
 * (ver typedAnswerKey.ts). Pegar texto de otro lado mete basura, y el
 * sistema tiene que MOSTRAR qué se quedó afuera en vez de recortar o
 * rellenar por su cuenta.
 */

import { useState } from "react";
import { setBatchRoster } from "../engine-browser/localClient.ts";
import { parseRoster } from "./roster.ts";
import { UI } from "../strings.ts";
import { Card, CardHead, Callout } from "../ui/primitives.tsx";

export function RosterCard({
  batchId, roster, onChanged,
}: {
  batchId: string;
  roster: string[] | undefined;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loaded = roster?.length ?? 0;
  const parsed = parseRoster(text);

  // Un código de menos de 7 dígitos es la firma del problema de Excel con
  // los ceros a la izquierda — solo se avisa cuando aparece de verdad.
  const looksLikeLostZeros = parsed.invalid.some((t) => /^\d{1,6}$/.test(t));

  async function save(codes: string[]) {
    setBusy(true);
    setError(null);
    try {
      await setBatchRoster(batchId, codes);
      setText("");
      setOpen(false);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card>
      <CardHead>
        <span className="eyebrow">{UI.roster.heading}</span>
        <span className="topbar-meta mono">
          {loaded > 0 ? UI.roster.active(loaded) : UI.roster.none}
        </span>
        <button className="btn btn--sm" style={{ marginLeft: "auto" }} onClick={() => setOpen((v) => !v)}>
          {open ? UI.common.cancel : loaded > 0 ? UI.roster.save : UI.roster.heading}
        </button>
      </CardHead>

      {open && (
        <div className="card-body">
          <p className="method-why" style={{ borderTop: 0, paddingTop: 0, marginTop: 0 }}>
            {UI.roster.why} <em>{UI.roster.optional}</em>
          </p>

          {error && <Callout tone="warn"><strong>{UI.common.error}.</strong> {error}</Callout>}

          <textarea
            className="keytext mono"
            rows={6}
            autoFocus
            placeholder={UI.roster.placeholder}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <div className="topbar-meta" style={{ marginTop: 8 }}>{UI.roster.hint}</div>

          {parsed.invalid.length > 0 && (
            <Callout tone="warn">
              <strong>{UI.roster.invalid(parsed.invalid)}</strong>
              {looksLikeLostZeros && <div style={{ marginTop: 6 }}>{UI.roster.zerosWarning}</div>}
            </Callout>
          )}
          {parsed.duplicates.length > 0 && (
            <Callout>{UI.roster.duplicates(parsed.duplicates)}</Callout>
          )}

          <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
            <span className="topbar-meta mono">{UI.roster.parsed(parsed.codes.length)}</span>
            {loaded > 0 && (
              <button className="btn btn--sm btn--ghost" disabled={busy} onClick={() => void save([])}>
                {UI.roster.clear}
              </button>
            )}
            <button
              className="btn btn--primary"
              style={{ marginLeft: "auto" }}
              disabled={busy || parsed.codes.length === 0}
              onClick={() => void save(parsed.codes)}
            >
              {UI.roster.save}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}
