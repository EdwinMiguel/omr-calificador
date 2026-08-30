import { useSheet, type Correction } from "../api/client.ts";
import { UI } from "../strings.ts";
import { Card, CardHead, Stat, ViewHead, Empty, Bubble } from "../ui/primitives.tsx";
import { SheetImage } from "../ui/SheetImage.tsx";

export function SheetDetail({ sheetId }: { sheetId: string }) {
  const { data, loading, error } = useSheet(sheetId);

  if (loading) return <Empty>{UI.common.loading}</Empty>;
  if (error) return <Empty>{error}</Empty>;
  if (!data?.projected) return <Empty>Esta hoja no se pudo leer.</Empty>;

  const p = data.projected;
  const pending = p.pendingOrdinals.length;

  return (
    <>
      <ViewHead title={UI.detail.title(p.studentId)} lead={UI.detail.lead} />
      <div className="stack">
        <div className="statgrid">
          <Stat tone="ok" label={UI.results.columns.correct} value={p.score.correct} />
          <Stat tone="bad" label={UI.results.columns.incorrect} value={p.score.incorrect} />
          <Stat label={UI.results.columns.blank} value={p.blankOrdinals.length} />
          <Stat tone="review" label={UI.results.columns.review} value={pending} />
          <Stat
            label={UI.results.columns.grade}
            value={p.grade && pending === 0 ? p.grade.value : "—"}
            note={UI.common.of20}
          />
        </div>

        <Card>
          <CardHead>
            <span className="eyebrow">{UI.detail.aligned}</span>
            <span className="topbar-meta">{UI.detail.verifyHint}</span>
          </CardHead>
          <div className="card-body">
            <SheetImage sheetId={sheetId} />
          </div>
        </Card>

        <Card>
          <CardHead><span className="eyebrow">{UI.detail.history}</span></CardHead>
          <div className="card-body">
            <div className="audit">
              {[...data.corrections].reverse().map((c, i) => (
                <AuditRow key={c.id} correction={c} version={data.corrections.length - i + 1} />
              ))}
              <div className="audit-row">
                <span className="audit-v">v1</span>
                <div className="audit-body">
                  <b>{UI.detail.automatic}</b> — {p.score.correct} correctas, {p.score.incorrect} incorrectas,{" "}
                  {pending} a revisión.
                  <span className="audit-time">motor 0.1.0</span>
                </div>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <CardHead>
            <span className="eyebrow">{UI.detail.allAnswers}</span>
            <span className="topbar-meta">
              <Bubble variant="fill" size={9} /> {UI.detail.legend.correct} &nbsp;
              <Bubble variant="faint" size={9} /> {UI.detail.legend.incorrect} &nbsp;
              <Bubble variant="part" size={9} /> {UI.detail.legend.review}
            </span>
          </CardHead>
          <div className="card-body">
            <div className="answers">
              {p.questions.map((q) => {
                const label = q.state.kind === "ANSWERED" ? q.state.option : "?";
                const cls = q.correct === true ? "ans--ok" : q.correct === false ? "ans--bad" : "ans--rev";
                const variant = q.correct === true ? "fill" : q.correct === false ? "faint" : "part";
                return (
                  <div className={`ans ${cls}`} key={q.ordinal} title={q.corrected ? "corregida a mano" : undefined}>
                    <span className="ans-n">{q.ordinal}</span>
                    <Bubble variant={variant} />
                    <span className="ans-v">{label}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}

function AuditRow({ correction, version }: { correction: Correction; version: number }) {
  const when = new Date(correction.createdAt).toLocaleString("es-PE");
  const body =
    correction.ordinal === null
      ? UI.detail.idWritten(correction.resolvedStudentId ?? "")
      : `Pregunta ${correction.ordinal} ${UI.detail.correctedTo(
          correction.previousValue ?? "sin lectura",
          correction.resolvedAs ?? "en blanco"
        )}`;

  return (
    <div className="audit-row">
      <span className="audit-v">v{version}</span>
      <div className="audit-body">
        <b>{body}</b> — {correction.reason}.
        <span className="audit-time">{when} · {correction.createdBy}</span>
      </div>
    </div>
  );
}
