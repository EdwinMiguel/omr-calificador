/**
 * Review.tsx — resolver a mano lo que el motor no quiso adivinar.
 *
 * Se resuelve con teclado (A–E y Enter) a propósito: un lote real puede
 * dejar decenas de preguntas en revisión, y hacer clic decenas de veces es
 * exactamente el trabajo que este sistema existe para evitar.
 */

import { useEffect, useMemo, useState } from "react";
import type { BatchDetail, SheetSummary } from "../engine-browser/localClient.ts";
import { postCorrection } from "../engine-browser/localClient.ts";
import { UI, REVIEW_REASON } from "../strings.ts";
import { Card, Chip, ViewHead, Empty, Bubble } from "../ui/primitives.tsx";
import { SheetCanvas, type CanvasQuestion } from "../ui/SheetCanvas.tsx";

interface Item {
  sheetId: string;
  studentId: string;
  ordinal: number;
  reason: string;
  options: string[];
}

const OPTIONS = ["A", "B", "C", "D", "E"];

export function Review({ detail, onResolved }: { detail: BatchDetail; onResolved: () => void }) {
  const items = useMemo<Item[]>(() => {
    const out: Item[] = [];
    for (const s of detail.sheets) {
      if (!s.projected) continue;
      for (const q of s.projected.questions) {
        if (q.state.kind === "ANSWERED" || q.corrected) continue;
        out.push({
          sheetId: s.id,
          studentId: s.projected.studentId,
          ordinal: q.ordinal,
          reason: REVIEW_REASON[q.state.kind] ?? q.state.kind,
          options: OPTIONS,
        });
      }
    }
    return out;
  }, [detail]);

  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const current = items[Math.min(index, Math.max(0, items.length - 1))];

  useEffect(() => { setPicked(null); }, [current?.sheetId, current?.ordinal]);

  async function confirm(as: string | null) {
    if (!current || saving) return;
    setSaving(true);
    try {
      await postCorrection(current.sheetId, {
        ordinal: current.ordinal,
        resolvedAs: as,
        reason: "revisión manual",
      });
      setIndex((i) => Math.min(i, items.length - 2 < 0 ? 0 : items.length - 2));
      onResolved();
    } finally {
      setSaving(false);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!current) return;
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;
      const k = e.key.toUpperCase();
      if (OPTIONS.includes(k)) { setPicked(k); e.preventDefault(); }
      if (e.key === "Enter" && picked) { void confirm(picked); e.preventDefault(); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, picked, items.length]);

  if (items.length === 0) {
    return (
      <>
        <ViewHead title={UI.review.title} lead={UI.review.lead} />
        <Empty>{UI.review.empty}</Empty>
      </>
    );
  }

  const sheet = detail.sheets.find((s) => s.id === current!.sheetId);

  return (
    <>
      <ViewHead title={UI.review.title} lead={UI.review.lead} />
      <div className="review-layout">
        <div className="queue">
          <div className="queue-head">
            <div className="eyebrow">{UI.review.pendingLabel}</div>
            <div className="topbar-meta mono">
              {UI.common.questions(items.length)} · {UI.common.sheets(new Set(items.map((i) => i.sheetId)).size)}
            </div>
          </div>
          <div className="queue-list">
            {items.slice(0, 60).map((it, i) => (
              <button
                key={`${it.sheetId}-${it.ordinal}`}
                className="queue-item"
                aria-current={i === index}
                onClick={() => setIndex(i)}
              >
                <Bubble variant={it.reason === REVIEW_REASON.MULTIPLE ? "part" : "faint"} />
                <span>
                  <span className="queue-q">P{it.ordinal}</span>{" "}
                  <span style={{ fontSize: "var(--t-xs)", color: "var(--ink-muted)", fontFamily: "var(--mono)" }}>
                    {it.studentId || "sin código"}
                  </span>
                </span>
                <span className="queue-state">{it.reason}</span>
              </button>
            ))}
          </div>
        </div>

        <Card className="resolve">
          <div className="resolve-visual">
            <div className="sheet-frame">
              <SheetCanvas
                questions={neighbourhood(sheet, current!.ordinal)}
                focusOrdinal={current!.ordinal}
                options={OPTIONS}
                height={260}
              />
            </div>
            <div className="sheet-caption">
              hoja {current!.studentId || "sin código"} · pregunta {current!.ordinal}
              <br />
              {sheet?.outcome.kind === "processed" && (
                <>error de reproyección {sheet.outcome.reprojectionErrorPx.toFixed(3)} px · umbral {sheet.outcome.thresholdMethod}</>
              )}
            </div>
          </div>

          <div className="resolve-panel">
            <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 3 }}>
              <h2 style={{ fontSize: "var(--t-lg)" }}>{UI.review.question(current!.ordinal)}</h2>
              <Chip tone="review">{current!.reason}</Chip>
            </div>
            <p style={{ color: "var(--ink-2)", fontSize: "var(--t-sm)", marginBottom: 16 }}>
              El sistema no pudo resolverla con confianza y prefirió preguntarte antes que arriesgar una nota.
            </p>

            <div className="eyebrow" style={{ marginBottom: 8 }}>{UI.review.measured}</div>
            <Measure fills={sheetMeasurements(sheet)[current!.ordinal]} options={OPTIONS} />
            <div className="thresholds">
              <span>{UI.review.thresholds.blank} <b>0.15</b></span>
              <span>{UI.review.thresholds.mark} <b>0.25</b></span>
              <span>{UI.review.thresholds.margin} <b>0.08</b></span>
            </div>

            <div className="eyebrow" style={{ marginBottom: 8 }}>{UI.review.decision}</div>
            <div className="optrow">
              {OPTIONS.map((o) => (
                <button
                  key={o}
                  className="optbtn"
                  aria-pressed={picked === o}
                  onClick={() => setPicked(o)}
                >
                  {o}
                </button>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <button className="btn btn--primary" disabled={!picked || saving} onClick={() => void confirm(picked)}>
                {UI.review.confirm}
              </button>
              <button className="btn" disabled={saving} onClick={() => void confirm(null)}>
                {UI.review.leaveBlank}
              </button>
              <span style={{ fontSize: "var(--t-sm)", color: "var(--ink-muted)" }}>
                <span className="kbd">A</span>–<span className="kbd">E</span> {UI.review.keyboardHint} ·{" "}
                <span className="kbd">Enter</span> {UI.review.keyboardConfirm}
              </span>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}

/** Las preguntas vecinas dan contexto: se ve la marca dudosa entre marcas normales. */
function neighbourhood(sheet: SheetSummary | undefined, ordinal: number): CanvasQuestion[] {
  const questions = sheet?.projected?.questions ?? [];
  const measurements = sheetMeasurements(sheet);
  const out: CanvasQuestion[] = [];
  for (let n = ordinal - 2; n <= ordinal + 2; n++) {
    if (n < 1) continue;
    const q = questions.find((x) => x.ordinal === n);
    if (!q) continue;
    out.push({
      ordinal: n,
      answer: q.state.kind === "ANSWERED" ? q.state.option : undefined,
      // Valores REALES medidos por el motor, no una representación: es lo
      // que permite decidir mirando la marca en vez de confiar a ciegas.
      fills: measurements[n],
    });
  }
  return out;
}

/** La evidencia numérica: qué tan oscura salió cada opción. */
function Measure({ fills, options }: { fills: Record<string, number> | undefined; options: string[] }) {
  if (!fills) return null;
  const entries = options.map((o) => [o, fills[o] ?? 0] as const);
  const max = Math.max(0.5, ...entries.map(([, v]) => v));
  const top = entries.reduce((a, b) => (b[1] > a[1] ? b : a));

  return (
    <div className="measure">
      {entries.map(([opt, v]) => (
        <div className={`measure-row${opt === top[0] ? " is-top" : ""}`} key={opt}>
          <span className="measure-opt">{opt}</span>
          <span className="measure-bar">
            <i style={{ width: `${Math.max(0, (v / max) * 100).toFixed(1)}%` }} />
          </span>
          <span className="measure-val">{v.toFixed(3)}</span>
        </div>
      ))}
    </div>
  );
}

export function sheetMeasurements(sheet: SheetSummary | undefined): Record<number, Record<string, number>> {
  if (!sheet) return {};
  if (sheet.outcome.kind === "processed") return sheet.outcome.measurements;
  return sheet.outcome.partial?.measurements ?? {};
}
