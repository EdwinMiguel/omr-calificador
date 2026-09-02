import type { BatchDetail } from "../engine-browser/localClient.ts";
import { UI, REJECTION } from "../strings.ts";
import { Card, CardHead, Chip, Stat, ViewHead } from "../ui/primitives.tsx";

/**
 * Los umbrales que el motor está usando, con su origen. Están aquí y no en
 * un archivo de configuración de la UI porque PROMPT.md §7 exige que cada
 * calibrable sea explicable — mostrarlos al operador es parte de eso: si
 * mañana el sistema empieza a mandar demasiado a revisión, esta tabla es lo
 * primero que hay que mirar.
 */
const THRESHOLDS = [
  { name: "BLANK_MAX", value: "0.15", origin: "percentil 90 del papel sin marcar" },
  { name: "MARK_MIN", value: "0.25", origin: "ningún blanco real lo cruzó" },
  { name: "MARGIN_MIN", value: "0.08", origin: "separa doble marca de ruido" },
  { name: "error de reproyección", value: "5.0 px", origin: "máximo tolerado al alinear" },
];

export function Metrics({ detail }: { detail: BatchDetail }) {
  const m = detail.metrics;
  const totalAnswers = m.autoAcceptedCorrect + m.autoAcceptedIncorrect + m.sentToReview;
  const reviewPct = totalAnswers > 0 ? ((m.sentToReview / totalAnswers) * 100).toFixed(1) : "0";

  return (
    <>
      <ViewHead title={UI.metrics.title} lead={UI.metrics.lead} />
      <div className="stack">
        <div className="statgrid">
          <Stat tone="bad" label={UI.metrics.autoIncorrect} value={m.autoAcceptedIncorrect} note={UI.metrics.autoIncorrectNote} />
          <Stat tone="ok" label={UI.metrics.autoCorrect} value={m.autoAcceptedCorrect.toLocaleString("es-PE")} note="respuestas del lote" />
          <Stat tone="review" label={UI.metrics.toReview} value={m.sentToReview} note={`${reviewPct}% de las respuestas`} />
          <Stat tone="bad" label={UI.metrics.rejectedSheets} value={m.anomalousRejections} note={UI.metrics.rejectedNote} />
        </div>

        {totalAnswers > 0 && (
          <Card>
            <CardHead><span className="eyebrow">Reparto de las {totalAnswers} respuestas leídas</span></CardHead>
            <div className="card-body">
              <div className="bc-track" style={{ height: 26 }}>
                {m.autoAcceptedCorrect > 0 && (
                  <div className="bc-seg bc-seg--ok" style={{ width: `${(m.autoAcceptedCorrect / totalAnswers) * 100}%` }}>
                    {m.autoAcceptedCorrect}
                  </div>
                )}
                {m.sentToReview > 0 && (
                  <div className="bc-seg bc-seg--review" style={{ width: `${(m.sentToReview / totalAnswers) * 100}%` }}>
                    {m.sentToReview}
                  </div>
                )}
                {m.autoAcceptedIncorrect > 0 && (
                  <div className="bc-seg bc-seg--bad" style={{ width: `${(m.autoAcceptedIncorrect / totalAnswers) * 100}%` }}>
                    {m.autoAcceptedIncorrect}
                  </div>
                )}
              </div>
            </div>
          </Card>
        )}

        <div className="split-2">
          <Card>
            <CardHead><span className="eyebrow">{UI.metrics.reasonsTitle}</span></CardHead>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Motivo</th>
                    <th className="num">{UI.metrics.counts}</th>
                    <th>{UI.metrics.isProblem}</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.keys(REJECTION).map((reason) => {
                    const count = m.rejectionsByReason[reason] ?? 0;
                    const actionable = REJECTION[reason]!.actionable;
                    return (
                      <tr key={reason}>
                        <td className="mono">{REJECTION[reason]!.title}</td>
                        <td className="num mono">{count}</td>
                        <td>
                          <Chip tone={actionable ? "bad" : "idle"}>
                            {actionable ? UI.metrics.yes : UI.metrics.no}
                          </Chip>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHead><span className="eyebrow">{UI.metrics.thresholdsTitle}</span></CardHead>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>{UI.metrics.constant}</th>
                    <th className="num">{UI.metrics.value}</th>
                    <th>{UI.metrics.origin}</th>
                  </tr>
                </thead>
                <tbody>
                  {THRESHOLDS.map((t) => (
                    <tr key={t.name}>
                      <td className="mono">{t.name}</td>
                      <td className="num mono">{t.value}</td>
                      <td style={{ fontSize: "var(--t-sm)", color: "var(--ink-2)" }}>{t.origin}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}
