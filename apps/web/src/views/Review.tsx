/**
 * Review.tsx — resolver a mano lo que el motor no quiso adivinar.
 *
 * Se resuelve con teclado (A–E y Enter) a propósito: un lote real puede
 * dejar decenas de preguntas en revisión, y hacer clic decenas de veces es
 * exactamente el trabajo que este sistema existe para evitar.
 */

import { useEffect, useMemo, useState } from "react";
import type { BatchDetail, SheetSummary } from "../engine-browser/localClient.ts";
import { postCorrection, useReviewImageUrl } from "../engine-browser/localClient.ts";
import { suggestionFor } from "./batchSuggestion.ts";
import { UI, REVIEW_REASON } from "../strings.ts";
import { Card, CardHead, Chip, ViewHead, Empty, Bubble } from "../ui/primitives.tsx";

interface Item {
  sheetId: string;
  studentId: string;
  ordinal: number;
  /** Veredicto del motor, sin traducir: lo necesita suggestionFor(). */
  kind: string;
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
        // BLANK no entra a la cola: una pregunta sin contestar no es una
        // duda que alguien tenga que resolver, es una respuesta que vale 0.
        // Mismo criterio que sheetProjection.ts::pendingOrdinals — ver ahí
        // por qué la guarda de blanco hace que esto sea seguro.
        if (q.state.kind === "ANSWERED" || q.state.kind === "BLANK" || q.corrected) continue;
        out.push({
          sheetId: s.id,
          studentId: s.projected.studentId,
          ordinal: q.ordinal,
          kind: q.state.kind,
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

  // Todas las pendientes de LA MISMA HOJA que la que se está mirando, cada
  // una con su sugerencia (o sin ninguna, si no hay ganador inequívoco).
  const sheetForCurrent = current ? detail.sheets.find((s) => s.id === current.sheetId) : undefined;
  const sheetItems = useMemo(() => {
    if (!current) return [];
    const measurements = sheetMeasurements(sheetForCurrent);
    return items
      .filter((it) => it.sheetId === current.sheetId)
      .map((it) => ({ ...it, suggestion: suggestionFor(it.kind, measurements[it.ordinal]) }));
  }, [items, current?.sheetId, sheetForCurrent]);

  const [included, setIncluded] = useState<Set<number>>(new Set());
  const [batchSaving, setBatchSaving] = useState(false);

  const suggestable = sheetItems.filter((it) => it.suggestion);
  // Firma del conjunto ofrecible. Es la dependencia correcta —y no solo la
  // hoja—: al confirmar un lote las preguntas resueltas salen de la cola sin
  // que cambie sheetId, y si el reinicio no mirara eso, `included` quedaría
  // con ordinales ya resueltos y el botón contaría preguntas que ya no están.
  const suggestableKey = suggestable.map((it) => it.ordinal).join(",");

  // Lo que realmente se va a escribir. Se deriva de lo ofrecible —no de
  // `included` a secas— para que el número del botón sea siempre el número de
  // preguntas que el botón va a confirmar.
  const selected = suggestable.filter((it) => included.has(it.ordinal));

  // Arranca con todas tildadas; el operador destilda las que no le convenzan
  // antes de confirmar.
  useEffect(() => {
    setIncluded(new Set(suggestable.map((it) => it.ordinal)));
  }, [current?.sheetId, suggestableKey]);

  function toggleIncluded(ordinal: number) {
    setIncluded((prev) => {
      const next = new Set(prev);
      if (next.has(ordinal)) next.delete(ordinal); else next.add(ordinal);
      return next;
    });
  }

  /**
   * Aplica la sugerencia de cada pregunta SELECCIONADA, una por una — mismo
   * postCorrection() que usa la confirmación individual, con el mismo
   * registro de auditoría (§13.9: append-only, nunca se sobrescribe nada).
   * Se distingue el motivo en el registro ("lote" vs "revisión manual") por
   * si alguna vez hace falta diferenciar cuántas se confirmaron así.
   */
  async function confirmBatch() {
    if (batchSaving || selected.length === 0) return;
    setBatchSaving(true);
    try {
      for (const it of selected) {
        await postCorrection(it.sheetId, {
          ordinal: it.ordinal,
          resolvedAs: it.suggestion!.label,
          reason: "revisión manual (lote)",
        });
      }
      setIndex(0);
    } finally {
      setBatchSaving(false);
      // Siempre, incluso si una corrección falló a mitad de camino: las
      // anteriores YA se escribieron, y la pantalla tiene que mostrar lo que
      // realmente quedó guardado, no lo que se intentó guardar.
      onResolved();
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

  // Ver la nota extensa de useReviewImageUrl() en localClient.ts: recorte
  // fotográfico REAL de la hoja, no una representación — con la pregunta
  // bajo revisión resaltada con su propio marco (ver FOCUS_COLOR en
  // readingOverlay.ts), distinto de los anillos verde/ámbar de lectura.
  //
  // ANTES del "if (items.length === 0) return" de abajo, a propósito: un
  // hook nunca puede quedar después de un return condicional — el número
  // de hooks que un componente llama tiene que ser el mismo en cada render,
  // React los identifica por ORDEN de llamada, no por nombre. Puesto después,
  // esto pasaba React.length===0 → 0 hooks; con items → 1 hook más que la
  // vez anterior — "Rendered more hooks than during the previous render",
  // confirmado en Chromium real al cargar la primera hoja de un lote nuevo.
  const reviewImage = useReviewImageUrl(current?.sheetId ?? null, current?.ordinal ?? null);

  if (items.length === 0) {
    return (
      <>
        <ViewHead title={UI.review.title} lead={UI.review.lead} />
        <Empty>{UI.review.empty}</Empty>
      </>
    );
  }

  const sheet = sheetForCurrent;

  return (
    <>
      <ViewHead title={UI.review.title} lead={UI.review.lead} />

      {sheetItems.length > 0 && (
        <Card style={{ marginBottom: 16 }}>
          <CardHead>
            <span className="eyebrow">{UI.review.batchTitle}</span>
            <span className="topbar-meta mono">{UI.common.questions(sheetItems.length)}</span>
          </CardHead>
          <p style={{ padding: "0 18px", margin: "8px 0 12px", color: "var(--ink-2)", fontSize: "var(--t-sm)" }}>
            {UI.review.batchLead}
          </p>
          {suggestable.length === 0 ? (
            <p style={{ padding: "0 18px 16px", color: "var(--ink-muted)", fontSize: "var(--t-sm)" }}>
              {UI.review.batchNone}
            </p>
          ) : (
            <>
              <div className="filelist">
                {sheetItems.map((it) => (
                  <label
                    key={it.ordinal}
                    className="filerow"
                    style={{ cursor: it.suggestion ? "pointer" : "default", opacity: it.suggestion ? 1 : 0.5 }}
                  >
                    <input
                      type="checkbox"
                      checked={included.has(it.ordinal)}
                      disabled={!it.suggestion}
                      onChange={() => toggleIncluded(it.ordinal)}
                      style={{ accentColor: "var(--accent)" }}
                    />
                    <div>
                      <div className="filerow-name">{UI.review.question(it.ordinal)}</div>
                      <div className="filerow-hash">{it.reason}</div>
                    </div>
                    <div className="filerow-right">
                      {it.suggestion ? (
                        <>
                          <span className="kbd">{it.suggestion.label}</span>
                          <span className="topbar-meta mono">{it.suggestion.value.toFixed(3)}</span>
                        </>
                      ) : (
                        <span className="topbar-meta">{UI.review.batchNoSuggestion}</span>
                      )}
                    </div>
                  </label>
                ))}
              </div>
              <div style={{ padding: 14 }}>
                <button
                  className="btn btn--primary"
                  disabled={selected.length === 0 || batchSaving}
                  onClick={() => void confirmBatch()}
                >
                  {batchSaving ? UI.common.loading : UI.review.batchConfirm(selected.length)}
                </button>
              </div>
            </>
          )}
        </Card>
      )}

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
              {reviewImage.loading && <div className="sheet-image-loading">{UI.common.loading}</div>}
              {reviewImage.error && <div className="sheet-image-empty">{UI.detail.imageUnavailable}</div>}
              {reviewImage.data && (
                <img
                  src={reviewImage.data}
                  alt={`Zona de la hoja en la pregunta ${current!.ordinal}`}
                />
              )}
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
