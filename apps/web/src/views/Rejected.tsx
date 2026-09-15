/**
 * Rejected.tsx — todo lo que necesita una decisión sobre la IDENTIDAD de
 * una hoja, en un solo lugar.
 *
 * Son dos problemas distintos que el profesor resuelve exactamente igual
 * (mirando la hoja y escribiendo el código), así que van juntos aunque
 * técnicamente no lo sean:
 *
 *   STUDENT_ID_UNREADABLE — el motor NO pudo leer el código y rechazó la
 *   hoja. Lo detecta identification.ts.
 *
 *   código fuera de la nómina — el motor SÍ leyó el código, con confianza,
 *   pero ese alumno no existe en el curso. La hoja NO está rechazada: se
 *   leyó entera y bien, y hasta tiene nota calculada. Lo que no se sabe es
 *   de quién es. Ver ProjectedSheet::studentIdInRoster.
 *
 * El segundo caso es el más peligroso de los dos y el que menos se nota:
 * sin la nómina, esa hoja aparecía entre las calificadas normales y nadie
 * la miraba nunca.
 */

import { useState } from "react";
import type { BatchDetail, SheetSummary } from "../engine-browser/localClient.ts";
import { postCorrection, useStudentIdImageUrl } from "../engine-browser/localClient.ts";
import { UI, REJECTION } from "../strings.ts";
import { Card, Chip, ViewHead, Empty, Callout, Bubble } from "../ui/primitives.tsx";

/** Ancho del recorte del código: entra cómodo en la fila sin pedir la
 * resolución completa (ver la nota de targetWidth en sheetImageBrowser). */
const CODE_IMAGE_WIDTH = 520;

export function Rejected({ detail, onResolved }: { detail: BatchDetail; onResolved: () => void }) {
  const rejected = detail.sheets.filter((s) => s.outcome.kind === "rejected" && !s.projected);
  const unknownCode = detail.sheets.filter((s) => s.projected?.studentIdInRoster === false);

  if (rejected.length === 0 && unknownCode.length === 0) {
    return (
      <>
        <ViewHead title={UI.rejected.title} lead={UI.rejected.lead} />
        <Empty>{UI.rejected.empty}</Empty>
      </>
    );
  }

  const byReason = new Map<string, SheetSummary[]>();
  for (const s of rejected) {
    const reason = s.outcome.kind === "rejected" ? s.outcome.reason : "";
    byReason.set(reason, [...(byReason.get(reason) ?? []), s]);
  }

  return (
    <>
      <ViewHead title={UI.rejected.title} lead={UI.rejected.lead} />
      <div className="stack">
        <Callout>{UI.rejected.duplexNote}</Callout>

        {/* Primero: la hoja se leyó bien pero no se sabe de quién es. Va
            arriba de los rechazos porque es lo único de esta pantalla que
            ya tiene una NOTA calculada esperando dueño. */}
        {unknownCode.length > 0 && (
          <Group
            title={UI.rejected.unknownTitle}
            what={UI.rejected.unknownWhat}
            action={UI.rejected.unknownAction}
            sheets={unknownCode}
            onResolved={onResolved}
          />
        )}

        {[...byReason.entries()]
          // Lo accionable primero: lo que no requiere nada del profesor va al final.
          .sort((a, b) => Number(REJECTION[b[0]]?.actionable ?? true) - Number(REJECTION[a[0]]?.actionable ?? true))
          .map(([reason, sheets]) => {
            const info = REJECTION[reason];
            return (
              <Group
                key={reason}
                title={info?.title ?? reason}
                what={info?.what ?? "Motivo no documentado."}
                action={info?.actionable !== false ? info?.action : undefined}
                reason={reason}
                sheets={sheets}
                onResolved={onResolved}
              />
            );
          })}
      </div>
    </>
  );
}

function Group({
  title, what, action, reason, sheets, onResolved,
}: {
  title: string;
  what: string;
  action?: string;
  reason?: string;
  sheets: SheetSummary[];
  onResolved: () => void;
}) {
  const actionable = action !== undefined;

  return (
    <Card className="reject-group">
      <div className="reject-head">
        <Chip tone={actionable ? "bad" : "idle"}>{actionable ? UI.rejected.needsAction : UI.rejected.normal}</Chip>
        <span className="reject-code">{title}</span>
        <span className="topbar-meta mono" style={{ marginLeft: "auto" }}>{UI.common.sheets(sheets.length)}</span>
      </div>
      <div className="reject-why">
        <b>Qué pasó:</b> {what} {actionable && <><b>Qué hacer:</b> {action}</>}
      </div>
      <div className="filelist">
        {sheets.map((s) => (
          <Row key={s.id} sheet={s} reason={reason} onResolved={onResolved} />
        ))}
      </div>
    </Card>
  );
}

function Row({ sheet, reason, onResolved }: { sheet: SheetSummary; reason?: string; onResolved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // La imagen se pide SOLO mientras el profesor está escribiendo el código:
  // decodificar el PNG guardado y recortarlo cuesta, y en un lote con 20
  // hojas de código ilegible no hay ninguna razón para pagar ese costo 20
  // veces de entrada cuando se van a resolver de a una.
  const image = useStudentIdImageUrl(editing ? sheet.id : null, CODE_IMAGE_WIDTH);

  const unreadable = reason === "STUDENT_ID_UNREADABLE";
  const outOfRoster = sheet.projected?.studentIdInRoster === false;
  const recoverable = unreadable && sheet.outcome.kind === "rejected" && !!sheet.outcome.partial;
  const columns = sheet.outcome.kind === "rejected" ? sheet.outcome.partial?.studentIdColumns ?? [] : [];
  const badColumns = columns.filter((c) => c.state.kind !== "ANSWERED").map((c) => c.ordinal + 1);

  const canFix = recoverable || outOfRoster;

  async function save() {
    if (!/^\d{7}$/.test(code)) { setError(UI.rejected.codeInvalid); return; }
    setSaving(true);
    setError(null);
    try {
      await postCorrection(sheet.id, {
        ordinal: null,
        resolvedAs: null,
        resolvedStudentId: code,
        reason: outOfRoster ? "código fuera de la lista, corregido a mano" : "código ilegible, escrito a mano",
      });
      setEditing(false);
      onResolved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="filerow filerow--stack">
      <div className="filerow-main">
        <Bubble variant="faint" />
        <div style={{ minWidth: 0 }}>
          <div className="filerow-name">{sheet.fileName} · página {sheet.pageIndex + 1}</div>
          <div className="filerow-hash">
            {outOfRoster
              ? UI.rejected.unknownRead(sheet.projected!.studentId)
              : badColumns.length > 0
                ? `columna ${badColumns.join(", ")} sin lectura clara`
                : new Date(sheet.createdAt).toLocaleString("es-PE")}
            {recoverable && ` · ${UI.rejected.recovered}`}
          </div>
          {error && <div className="filerow-hash" style={{ color: "var(--bad)" }}>{error}</div>}
        </div>
        <div className="filerow-right">
          {canFix && !editing && (
            <button className="btn btn--sm btn--primary" onClick={() => setEditing(true)}>
              {outOfRoster ? UI.rejected.fixCode : UI.rejected.writeCode}
            </button>
          )}
          {editing && (
            <>
              <input
                className="code-input mono"
                autoFocus
                inputMode="numeric"
                maxLength={7}
                placeholder="0000000"
                aria-label={UI.rejected.codePrompt}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                onKeyDown={(e) => { if (e.key === "Enter") void save(); if (e.key === "Escape") setEditing(false); }}
              />
              <button className="btn btn--sm btn--primary" disabled={saving} onClick={() => void save()}>
                {UI.common.save}
              </button>
              <button className="btn btn--sm btn--ghost" onClick={() => setEditing(false)}>{UI.common.cancel}</button>
            </>
          )}
        </div>
      </div>

      {/* La hoja escaneada, a la vista mientras se escribe: transcribir 7
          dígitos de memoria o yendo a buscar el papel a la pila es
          exactamente cómo se cuela un código mal tecleado, que tiene la
          misma consecuencia que uno mal leído. */}
      {editing && (
        <div className="codeshot">
          <div className="topbar-meta">{UI.rejected.imageHint}</div>
          {image.loading && <div className="topbar-meta">{UI.rejected.imageLoading}</div>}
          {image.error && <div className="topbar-meta">{UI.rejected.imageMissing}</div>}
          {image.data && <img src={image.data} alt={UI.rejected.codePrompt} />}
        </div>
      )}
    </div>
  );
}
