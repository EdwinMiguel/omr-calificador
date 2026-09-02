/**
 * AnswerKeyView.tsx — crear y mantener la clave del examen.
 *
 * La decisión de diseño más importante está en el paso de verificación:
 * una clave NO se puede activar mientras alguna respuesta siga dudosa.
 * Es deliberadamente más estricto que el resto del sistema — en la hoja de
 * un alumno una duda va a revisión y afecta una nota; en la clave afectaría
 * a todo el lote, y con apariencia de normalidad (mismo principio que
 * PROMPT.md §13.8 sobre la versión de examen).
 */

import { useMemo, useState } from "react";
import type { BatchDetail } from "../engine-browser/localClient.ts";
import { postAnswerKey, readSheetAsAnswerKey } from "../engine-browser/localClient.ts";
import { UI } from "../strings.ts";
import { Card, CardHead, ViewHead, Callout, Bubble } from "../ui/primitives.tsx";

type Step = "empty" | "verify" | "active";
const OPTIONS = ["A", "B", "C", "D", "E"];

/**
 * La hoja real tiene las 100 preguntas en 4 columnas verticales de 25
 * (1-25, 26-50, 51-75, 76-100) — así la imprime `officialTemplate.ts`. La
 * grilla de la clave tiene que verse igual, o buscar "la pregunta 63" en
 * pantalla no coincide con dónde está en el papel que el profesor tiene
 * al lado. El array de datos se queda ordenado 1→100 (DOM y accesibilidad
 * no cambian); es solo la variable CSS la que le dice a `grid-auto-flow:
 * column` cuántas filas tiene cada columna antes de saltar a la próxima.
 */
function keygridStyle(total: number): React.CSSProperties {
  return { "--kg-rows": Math.ceil(total / 4) } as React.CSSProperties;
}

export function AnswerKeyView({ detail, onChanged }: { detail: BatchDetail; onChanged: () => void }) {
  const existing = detail.answerKey;
  const [step, setStep] = useState<Step>(existing ? "active" : "empty");
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [unresolved, setUnresolved] = useState<number[]>([]);
  const [source, setSource] = useState<"sheet" | "manual" | "import">("manual");
  const [sourceSheetId, setSourceSheetId] = useState<string | undefined>();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const total = detail.sheets[0]?.projected?.questions.length ?? 100;
  const pending = unresolved.filter((n) => !draft[n]);

  async function useSheetAsKey(sheetId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await readSheetAsAnswerKey(sheetId);
      const parsed: Record<number, string> = {};
      for (const [k, v] of Object.entries(res.answers)) parsed[Number(k)] = v;
      setDraft(parsed);
      setUnresolved(res.unresolved);
      setSource("sheet");
      setSourceSheetId(sheetId);
      setStep("verify");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function useTypedKey(text: string) {
    const letters = text.toUpperCase().replace(/[^A-E]/g, "").split("");
    const parsed: Record<number, string> = {};
    letters.forEach((l, i) => { parsed[i + 1] = l; });
    setDraft(parsed);
    setUnresolved(Array.from({ length: total }, (_, i) => i + 1).filter((n) => !parsed[n]));
    setSource("manual");
    setSourceSheetId(undefined);
    setStep("verify");
  }

  async function activate() {
    setBusy(true);
    setError(null);
    try {
      const answers: Record<string, string> = {};
      for (const [k, v] of Object.entries(draft)) answers[k] = v;
      await postAnswerKey(detail.batch.id, {
        answers,
        voided: existing?.voided ?? [],
        source,
        sourceSheetId,
        createdBy: "operador",
      });
      setStep("active");
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function toggleVoid(ordinal: number) {
    if (!existing) return;
    const voided = existing.voided.includes(ordinal)
      ? existing.voided.filter((n) => n !== ordinal)
      : [...existing.voided, ordinal];
    setBusy(true);
    try {
      await postAnswerKey(detail.batch.id, {
        answers: existing.answers,
        voided,
        source: existing.source,
        sourceSheetId: existing.sourceSheetId,
        createdBy: "operador",
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ViewHead title={UI.answerKey.title} lead={UI.answerKey.lead} />

      <div className="keystate">
        {(["empty", "verify", "active"] as Step[]).map((s, i) => (
          <button
            key={s}
            className="keystate-btn"
            aria-current={step === s}
            disabled={s === "verify" && Object.keys(draft).length === 0}
            onClick={() => setStep(s)}
          >
            {UI.answerKey.steps[i]}
          </button>
        ))}
      </div>

      {error && <Callout tone="warn"><strong>{UI.common.error}.</strong> {error}</Callout>}

      {step === "empty" && (
        <EmptyStep detail={detail} busy={busy} onUseSheet={useSheetAsKey} onTyped={useTypedKey} />
      )}

      {step === "verify" && (
        <VerifyStep
          draft={draft}
          total={total}
          pending={pending}
          busy={busy}
          onPick={(n, opt) => setDraft((d) => ({ ...d, [n]: opt }))}
          onActivate={() => void activate()}
          sheetCount={detail.sheets.length}
        />
      )}

      {step === "active" && existing && (
        <ActiveStep
          answers={existing.answers}
          voided={existing.voided}
          createdAt={existing.createdAt}
          busy={busy}
          onToggleVoid={(n) => void toggleVoid(n)}
          onReplace={() => { setDraft({}); setUnresolved([]); setStep("empty"); }}
        />
      )}
    </>
  );
}

function EmptyStep({
  detail, busy, onUseSheet, onTyped,
}: {
  detail: BatchDetail;
  busy: boolean;
  onUseSheet: (id: string) => void;
  onTyped: (text: string) => void;
}) {
  const [mode, setMode] = useState<null | "sheet" | "manual">(null);
  const [text, setText] = useState("");
  const readable = detail.sheets.filter((s) => s.projected || s.outcome.kind === "processed");
  const typed = text.toUpperCase().replace(/[^A-E]/g, "").length;

  return (
    <div className="stack">
      <Callout>{UI.answerKey.emptyLead(detail.sheets.length)}</Callout>
      <div className="eyebrow">{UI.answerKey.methodsTitle}</div>
      <div className="methods">
        <button className="method method--rec" onClick={() => setMode("sheet")} disabled={busy}>
          <div className="method-badge">{UI.answerKey.methods.sheet.badge}</div>
          <h3>{UI.answerKey.methods.sheet.title}</h3>
          <p>{UI.answerKey.methods.sheet.body}</p>
          <div className="method-why">{UI.answerKey.methods.sheet.why}</div>
        </button>
        <button className="method" onClick={() => setMode("manual")} disabled={busy}>
          <h3>{UI.answerKey.methods.manual.title}</h3>
          <p>{UI.answerKey.methods.manual.body}</p>
          <div className="method-why">{UI.answerKey.methods.manual.why}</div>
        </button>
        <button className="method" onClick={() => setMode("manual")} disabled={busy}>
          <h3>{UI.answerKey.methods.import.title}</h3>
          <p>{UI.answerKey.methods.import.body}</p>
          <div className="method-why">{UI.answerKey.methods.import.why}</div>
        </button>
      </div>

      {mode === "sheet" && (
        <Card>
          <CardHead><span className="eyebrow">{UI.answerKey.pickSheet}</span></CardHead>
          <div className="filelist">
            {readable.length === 0 && (
              <div className="filerow"><span className="topbar-meta">Todavía no hay hojas legibles cargadas.</span></div>
            )}
            {readable.map((s) => (
              <div className="filerow" key={s.id}>
                <Bubble variant="fill" />
                <div>
                  <div className="filerow-name">{s.fileName} · página {s.pageIndex + 1}</div>
                  <div className="filerow-hash">
                    {s.projected ? `código ${s.projected.studentId}` : "sin código"}
                  </div>
                </div>
                <div className="filerow-right">
                  <button className="btn btn--sm btn--primary" disabled={busy} onClick={() => onUseSheet(s.id)}>
                    {UI.answerKey.useThis}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {mode === "manual" && (
        <Card>
          <CardHead><span className="eyebrow">{UI.answerKey.methods.manual.title}</span></CardHead>
          <div className="card-body">
            <textarea
              className="keytext mono"
              rows={5}
              autoFocus
              placeholder={UI.answerKey.manualPlaceholder}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 12 }}>
              <span className="topbar-meta mono">{UI.answerKey.manualCount(typed, 100)}</span>
              <button
                className="btn btn--primary"
                style={{ marginLeft: "auto" }}
                disabled={typed === 0}
                onClick={() => onTyped(text)}
              >
                {UI.answerKey.useThis}
              </button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}

function VerifyStep({
  draft, total, pending, busy, onPick, onActivate, sheetCount,
}: {
  draft: Record<number, string>;
  total: number;
  pending: number[];
  busy: boolean;
  onPick: (n: number, opt: string) => void;
  onActivate: () => void;
  sheetCount: number;
}) {
  const numbers = useMemo(() => Array.from({ length: total }, (_, i) => i + 1), [total]);
  const clean = numbers.filter((n) => draft[n]).length;

  return (
    <div className="stack">
      <Callout tone="warn"><strong>{UI.answerKey.verifyWarning}</strong></Callout>
      <Card>
        <CardHead><span className="eyebrow">Clave propuesta</span></CardHead>
        <div className="card-body">
          <div className="verify-summary">
            <div className="vs-item"><span className="vs-num num">{clean}</span><span className="vs-label">{UI.answerKey.verifyClean}</span></div>
            <div className="vs-item vs-item--review"><span className="vs-num num">{pending.length}</span><span className="vs-label">{UI.answerKey.verifyUnsure}</span></div>
          </div>

          <div className="eyebrow" style={{ margin: "20px 0 10px" }}>Las {total} respuestas</div>
          <div className="keygrid" style={keygridStyle(total)}>
            {numbers.map((n) => {
              const ans = draft[n];
              return (
                <div className={`keycell${ans ? "" : " is-unsure"}`} key={n}>
                  <span className="keycell-n">{n}</span>
                  {ans ? (
                    <>
                      <Bubble variant="fill" />
                      <span className="keycell-ans">{ans}</span>
                    </>
                  ) : (
                    <>
                      <Bubble variant="part" />
                      <span className="keycell-pick">
                        {OPTIONS.map((o) => (
                          <button key={o} onClick={() => onPick(n, o)}>{o}</button>
                        ))}
                      </span>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
        <div className="card-head" style={{ borderBottom: 0, borderTop: "1px solid var(--rule)" }}>
          <span className="topbar-meta">
            {pending.length > 0 ? UI.answerKey.verifyPending(pending.length) : UI.answerKey.verifyReady}
          </span>
          <button
            className="btn btn--primary"
            style={{ marginLeft: "auto" }}
            disabled={pending.length > 0 || busy}
            onClick={onActivate}
          >
            {UI.answerKey.activate(sheetCount)}
          </button>
        </div>
      </Card>
    </div>
  );
}

function ActiveStep({
  answers, voided, createdAt, busy, onToggleVoid, onReplace,
}: {
  answers: Record<string, string>;
  voided: number[];
  createdAt: string;
  busy: boolean;
  onToggleVoid: (n: number) => void;
  onReplace: () => void;
}) {
  const numbers = Object.keys(answers).map(Number).sort((a, b) => a - b);
  const voidedSet = new Set(voided);

  return (
    <div className="stack">
      {voided.length > 0 && (
        <Callout tone="ok">
          <strong>Notas recalculadas.</strong>{" "}
          {UI.answerKey.recalculated(voided.length, numbers.length - voided.length)}
        </Callout>
      )}
      <Callout tone="ok">
        {UI.answerKey.activeSince(new Date(createdAt).toLocaleString("es-PE"))}
      </Callout>
      <Card>
        <CardHead>
          <span className="eyebrow">{UI.common.questions(numbers.length)}</span>
          <span className="topbar-meta mono">{UI.answerKey.voidedCount(voided.length)}</span>
          <button className="btn btn--sm" onClick={onReplace}>{UI.answerKey.replace}</button>
        </CardHead>
        <div className="card-body">
          <div className="keygrid" style={keygridStyle(numbers.length)}>
            {numbers.map((n) => {
              const isVoid = voidedSet.has(n);
              return (
                <div className={`keycell${isVoid ? " is-void" : ""}`} key={n}>
                  <span className="keycell-n">{n}</span>
                  <Bubble variant="fill" />
                  <span className="keycell-ans">{answers[String(n)]}</span>
                  <button className="keycell-void" disabled={busy} onClick={() => onToggleVoid(n)}>
                    {isVoid ? UI.answerKey.restoreQuestion : UI.answerKey.voidQuestion}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      </Card>
    </div>
  );
}
