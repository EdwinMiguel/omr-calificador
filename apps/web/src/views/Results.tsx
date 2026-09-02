import { useState } from "react";
import type { BatchDetail, SheetSummary } from "../engine-browser/localClient.ts";
import { repo } from "../engine-browser/localClient.ts";
import { gradesToCsv, downloadBlob } from "../engine-browser/exportGrades.ts";
import { exportBatchBackup, backupFileName } from "../engine-browser/backupRestore.ts";
import { UI, REJECTION } from "../strings.ts";
import { Card, CardHead, Chip, Stat, ViewHead, Empty, Callout } from "../ui/primitives.tsx";

type Filter = "all" | "doubts" | "rejected";

export function Results({
  detail, filter, onFilter, onOpenSheet, onGoReview, onGoRejected,
}: {
  detail: BatchDetail;
  filter: Filter;
  onFilter: (f: Filter) => void;
  onOpenSheet: (id: string) => void;
  onGoReview: () => void;
  onGoRejected: () => void;
}) {
  const { sheets, metrics, answerKey, batch } = detail;
  const [busy, setBusy] = useState<"csv" | "backup" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleExportCsv() {
    setBusy("csv"); setError(null);
    try {
      downloadBlob(gradesToCsv(detail), `notas-${batch.label.replace(/[^\p{L}\p{N}]+/gu, "-")}.csv`);
    } finally {
      setBusy(null);
    }
  }

  async function handleBackup() {
    setBusy("backup"); setError(null);
    try {
      const blob = await exportBatchBackup(batch.id, repo);
      downloadBlob(blob, backupFileName(batch));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const clean = sheets.filter((s) => s.projected && s.projected.pendingOrdinals.length === 0).length;
  const withDoubts = sheets.filter((s) => s.projected && s.projected.pendingOrdinals.length > 0).length;

  const visible = sheets.filter((s) => {
    if (filter === "doubts") return s.projected && s.projected.pendingOrdinals.length > 0;
    if (filter === "rejected") return s.outcome.kind === "rejected";
    return true;
  });

  return (
    <>
      <ViewHead title={UI.results.title} lead={UI.results.lead} />
      <div className="stack">
        {!answerKey && <Callout tone="warn">{UI.results.noKey}</Callout>}
        {error && <Callout tone="warn"><strong>{UI.common.error}.</strong> {error}</Callout>}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn btn--sm" disabled={busy !== null || sheets.length === 0} onClick={() => void handleExportCsv()}>
            {busy === "csv" ? UI.common.loading : UI.results.exportCsv}
          </button>
          <button className="btn btn--sm" disabled={busy !== null || sheets.length === 0} onClick={() => void handleBackup()}>
            {busy === "backup" ? UI.common.loading : UI.results.downloadBackup}
          </button>
        </div>

        <div className="statgrid">
          <Stat tone="ok" label={UI.results.graded} value={clean} note={`de ${UI.common.sheets(sheets.length)}`} />
          <Stat tone="review" label={UI.results.pending} value={metrics.sentToReview} note={`en ${UI.common.sheets(withDoubts)}`} />
          <Stat tone="bad" label={UI.results.rejected} value={metrics.anomalousRejections} note={UI.metrics.rejectedNote} />
          <Stat label={UI.results.average} value={metrics.averageGrade ?? "—"} note={UI.common.of20} />
        </div>

        {sheets.length === 0 ? (
          <Empty>{UI.results.empty}</Empty>
        ) : (
          <Card>
            <CardHead>
              <span className="eyebrow">{UI.common.sheets(sheets.length)}</span>
              <button className={`btn btn--sm${filter === "all" ? "" : " btn--ghost"}`} onClick={() => onFilter("all")}>Todas</button>
              <button className={`btn btn--sm${filter === "doubts" ? "" : " btn--ghost"}`} onClick={() => onFilter("doubts")}>Solo con dudas</button>
              <button className={`btn btn--sm${filter === "rejected" ? "" : " btn--ghost"}`} onClick={() => onFilter("rejected")}>Rechazadas</button>
            </CardHead>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{UI.results.columns.code}</th>
                    <th>{UI.results.columns.state}</th>
                    <th className="num">{UI.results.columns.correct}</th>
                    <th className="num">{UI.results.columns.incorrect}</th>
                    <th className="num">{UI.results.columns.blank}</th>
                    <th className="num">{UI.results.columns.review}</th>
                    <th className="num">{UI.results.columns.grade}</th>
                    <th>{UI.results.columns.origin}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((s) => (
                    <Row key={s.id} sheet={s} onOpen={() => onOpenSheet(s.id)} onReview={onGoReview} onRejected={onGoRejected} />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

function Row({
  sheet, onOpen, onReview, onRejected,
}: { sheet: SheetSummary; onOpen: () => void; onReview: () => void; onRejected: () => void }) {
  const p = sheet.projected;

  if (!p) {
    const reason = sheet.outcome.kind === "rejected" ? sheet.outcome.reason : "";
    const info = REJECTION[reason];
    return (
      <tr>
        <td className="mono">—</td>
        <td><Chip tone={info?.actionable === false ? "idle" : "bad"}>{info?.title ?? reason}</Chip></td>
        {/* Una celda por cada columna numérica: correctas, incorrectas,
            en blanco, a revisión y nota. */}
        <td className="num mono">—</td>
        <td className="num mono">—</td>
        <td className="num mono">—</td>
        <td className="num mono">—</td>
        <td className="num mono">—</td>
        <td className="mono topbar-meta">{sheet.fileName}</td>
        <td>
          {info?.actionable !== false && (
            <button className="btn btn--sm" onClick={onRejected}>{UI.common.resolve}</button>
          )}
        </td>
      </tr>
    );
  }

  const pending = p.pendingOrdinals.length;
  return (
    <tr>
      <td className="mono">
        {p.studentId}
        {p.studentIdCorrected && <span className="topbar-meta" style={{ marginLeft: 6 }}>escrito a mano</span>}
      </td>
      <td>
        {pending > 0
          ? <Chip tone="review">{UI.common.doubts(pending)}</Chip>
          : <Chip tone="ok">Calificada</Chip>}
      </td>
      <td className="num mono">{p.score.correct}</td>
      <td className="num mono">{p.score.incorrect}</td>
      <td className="num mono">{p.blankOrdinals.length}</td>
      <td className="num mono">{pending}</td>
      <td className="num mono">{p.grade && pending === 0 ? p.grade.value : "—"}</td>
      <td className="mono topbar-meta">{sheet.fileName}</td>
      <td>
        {pending > 0
          ? <button className="btn btn--sm" onClick={onReview}>{UI.common.review}</button>
          : <button className="btn btn--sm btn--ghost" onClick={onOpen}>{UI.common.view}</button>}
      </td>
    </tr>
  );
}
