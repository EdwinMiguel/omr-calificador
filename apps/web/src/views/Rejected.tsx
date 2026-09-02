import { useState } from "react";
import type { BatchDetail, SheetSummary } from "../engine-browser/localClient.ts";
import { postCorrection } from "../engine-browser/localClient.ts";
import { UI, REJECTION } from "../strings.ts";
import { Card, Chip, ViewHead, Empty, Callout, Bubble } from "../ui/primitives.tsx";

export function Rejected({ detail, onResolved }: { detail: BatchDetail; onResolved: () => void }) {
  const rejected = detail.sheets.filter((s) => s.outcome.kind === "rejected" && !s.projected);

  if (rejected.length === 0) {
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
        {[...byReason.entries()]
          // Lo accionable primero: lo que no requiere nada del profesor va al final.
          .sort((a, b) => Number(REJECTION[b[0]]?.actionable ?? true) - Number(REJECTION[a[0]]?.actionable ?? true))
          .map(([reason, sheets]) => (
            <Group key={reason} reason={reason} sheets={sheets} onResolved={onResolved} />
          ))}
      </div>
    </>
  );
}

function Group({
  reason, sheets, onResolved,
}: { reason: string; sheets: SheetSummary[]; onResolved: () => void }) {
  const info = REJECTION[reason];
  const actionable = info?.actionable !== false;

  return (
    <Card className="reject-group">
      <div className="reject-head">
        <Chip tone={actionable ? "bad" : "idle"}>{actionable ? UI.rejected.needsAction : UI.rejected.normal}</Chip>
        <span className="reject-code">{info?.title ?? reason}</span>
        <span className="topbar-meta mono" style={{ marginLeft: "auto" }}>{UI.common.sheets(sheets.length)}</span>
      </div>
      <div className="reject-why">
        <b>Qué pasó:</b> {info?.what ?? "Motivo no documentado."}{" "}
        {actionable && <><b>Qué hacer:</b> {info?.action}</>}
      </div>
      <div className="filelist">
        {sheets.map((s) => (
          <Row key={s.id} sheet={s} reason={reason} onResolved={onResolved} />
        ))}
      </div>
    </Card>
  );
}

function Row({ sheet, reason, onResolved }: { sheet: SheetSummary; reason: string; onResolved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const recoverable = reason === "STUDENT_ID_UNREADABLE" && sheet.outcome.kind === "rejected" && !!sheet.outcome.partial;
  const columns = sheet.outcome.kind === "rejected" ? sheet.outcome.partial?.studentIdColumns ?? [] : [];
  const unreadable = columns.filter((c) => c.state.kind !== "ANSWERED").map((c) => c.ordinal + 1);

  async function save() {
    if (!/^\d{7}$/.test(code)) { setError(UI.rejected.codeInvalid); return; }
    setSaving(true);
    setError(null);
    try {
      await postCorrection(sheet.id, {
        ordinal: null,
        resolvedAs: null,
        resolvedStudentId: code,
        reason: "código ilegible, escrito a mano",
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
    <div className="filerow">
      <Bubble variant="faint" />
      <div style={{ minWidth: 0 }}>
        <div className="filerow-name">{sheet.fileName} · página {sheet.pageIndex + 1}</div>
        <div className="filerow-hash">
          {unreadable.length > 0
            ? `columna ${unreadable.join(", ")} sin lectura clara`
            : new Date(sheet.createdAt).toLocaleString("es-PE")}
          {recoverable && ` · ${UI.rejected.recovered}`}
        </div>
        {error && <div className="filerow-hash" style={{ color: "var(--bad)" }}>{error}</div>}
      </div>
      <div className="filerow-right">
        {recoverable && !editing && (
          <button className="btn btn--sm btn--primary" onClick={() => setEditing(true)}>
            {UI.rejected.writeCode}
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
  );
}
