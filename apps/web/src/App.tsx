/**
 * App.tsx — el armazón: riel de navegación, lote activo, y qué vista se ve.
 *
 * La navegación sigue el flujo real del operador (cargar → resultados →
 * resolver → configurar), no una jerarquía de datos. Es la misma estructura
 * del prototipo que se aprobó antes de escribir esto.
 */

import { useEffect, useState } from "react";
import { useBatches, useBatch, createBatch } from "./api/client.ts";
import { UI, SUPPORT } from "./strings.ts";
import { Upload } from "./views/Upload.tsx";
import { Results } from "./views/Results.tsx";
import { Review } from "./views/Review.tsx";
import { Rejected } from "./views/Rejected.tsx";
import { AnswerKeyView } from "./views/AnswerKeyView.tsx";
import { SheetDetail } from "./views/SheetDetail.tsx";
import { Metrics } from "./views/Metrics.tsx";
import { Chip, Empty } from "./ui/primitives.tsx";

type View = "cargar" | "resultados" | "revision" | "rechazadas" | "clave" | "detalle" | "metricas";

export function App() {
  const batches = useBatches();
  const [batchId, setBatchId] = useState<string | null>(null);
  const [view, setView] = useState<View>("resultados");
  const [sheetId, setSheetId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "doubts" | "rejected">("all");

  // Al cargar, entra al lote más reciente en vez de dejar la pantalla vacía.
  useEffect(() => {
    if (!batchId && batches.data && batches.data.length > 0) setBatchId(batches.data[0]!.id);
  }, [batches.data, batchId]);

  const detail = useBatch(batchId);
  const d = detail.data;

  const pendingReview = d?.metrics.sentToReview ?? 0;
  const rejectedCount = d?.sheets.filter((s) => s.outcome.kind === "rejected" && !s.projected).length ?? 0;

  async function newBatch() {
    const label = window.prompt(UI.common.batchName, "3.º B · Comunicación");
    if (!label) return;
    const b = await createBatch(label);
    batches.reload();
    setBatchId(b.id);
    setView("cargar");
  }

  function refresh() {
    detail.reload();
  }

  return (
    <div className="app">
      <aside className="rail">
        <div className="brand">
          <svg className="brand-mark" viewBox="0 0 30 30" aria-hidden="true">
            <rect x="1" y="1" width="7" height="7" fill="#FFF" />
            <rect x="22" y="1" width="7" height="7" fill="#FFF" />
            <rect x="1" y="22" width="7" height="7" fill="#FFF" />
            <circle cx="12.5" cy="13" r="2.6" fill="none" stroke="#FFF" strokeWidth="1.4" opacity=".55" />
            <circle cx="20" cy="13" r="2.6" fill="#FFF" />
            <circle cx="12.5" cy="21.5" r="2.6" fill="#FFF" />
            <circle cx="20" cy="21.5" r="2.6" fill="none" stroke="#FFF" strokeWidth="1.4" opacity=".55" />
          </svg>
          <div>
            <div className="brand-name">{UI.appName}</div>
            <div className="brand-sub">{UI.engineLabel("0.1.0")}</div>
          </div>
        </div>

        <nav className="nav" aria-label="Vistas">
          <div className="nav-group">{UI.nav.process}</div>
          <NavItem step="01" view="cargar" active={view} onClick={setView}>{UI.nav.upload}</NavItem>
          <NavItem step="02" view="resultados" active={view} onClick={setView}>{UI.nav.results}</NavItem>

          <div className="nav-group">{UI.nav.resolve}</div>
          <NavItem step="03" view="revision" active={view} onClick={setView} count={pendingReview} tone="review">
            {UI.nav.review}
          </NavItem>
          <NavItem step="04" view="rechazadas" active={view} onClick={setView} count={rejectedCount} tone="bad">
            {UI.nav.rejected}
          </NavItem>

          <div className="nav-group">{UI.nav.configure}</div>
          <NavItem step="05" view="clave" active={view} onClick={setView}>{UI.nav.answerKey}</NavItem>
          <NavItem step="07" view="metricas" active={view} onClick={setView}>{UI.nav.metrics}</NavItem>
        </nav>

        <div className="rail-foot">
          plantilla: {d?.batch.templateId ?? "—"}
          <br />
          100 preguntas × A–E
          <br />
          código: 7 dígitos
        </div>

        <div className="rail-contact">
          <div className="rail-contact-label">{SUPPORT.label}</div>
          <div className="rail-contact-name">{SUPPORT.name}</div>
          <a className="rail-contact-link" href={`mailto:${SUPPORT.email}`}>
            {SUPPORT.email}
          </a>
          <a
            className="rail-contact-link"
            href={`https://wa.me/${SUPPORT.whatsapp}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {SUPPORT.phoneDisplay}
          </a>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <div className="topbar-ctx">
            <span className="topbar-batch">{d?.batch.label ?? UI.common.loading}</span>
            {d && <span className="topbar-meta">{UI.common.sheets(d.sheets.length)}</span>}
          </div>
          <div className="topbar-right">
            {d && d.metrics.autoAcceptedIncorrect === 0 && d.metrics.autoAcceptedCorrect > 0 && (
              <Chip tone="ok">0 auto-aceptadas incorrectas</Chip>
            )}
            <select
              className="btn btn--sm"
              value={batchId ?? ""}
              onChange={(e) => { setBatchId(e.target.value); setSheetId(null); }}
            >
              {(batches.data ?? []).map((b) => (
                <option key={b.id} value={b.id}>{b.label}</option>
              ))}
            </select>
            <button className="btn btn--sm" onClick={() => void newBatch()}>{UI.common.newBatch}</button>
          </div>
        </header>

        <section className="view">
          {!batchId && !batches.loading && <Empty>{UI.common.noBatch}</Empty>}
          {detail.loading && <Empty>{UI.common.loading}</Empty>}
          {detail.error && <Empty>{detail.error}</Empty>}

          {d && view === "cargar" && <Upload batchId={d.batch.id} onUploaded={refresh} />}
          {d && view === "resultados" && (
            <Results
              detail={d}
              filter={filter}
              onFilter={setFilter}
              onOpenSheet={(id) => { setSheetId(id); setView("detalle"); }}
              onGoReview={() => setView("revision")}
              onGoRejected={() => setView("rechazadas")}
            />
          )}
          {d && view === "revision" && <Review detail={d} onResolved={refresh} />}
          {d && view === "rechazadas" && <Rejected detail={d} onResolved={refresh} />}
          {d && view === "clave" && <AnswerKeyView detail={d} onChanged={refresh} />}
          {d && view === "detalle" && sheetId && <SheetDetail sheetId={sheetId} />}
          {d && view === "metricas" && <Metrics detail={d} />}
        </section>
      </div>
    </div>
  );
}

function NavItem({
  step, view, active, onClick, count, tone, children,
}: {
  step: string;
  view: View;
  active: View;
  onClick: (v: View) => void;
  count?: number;
  tone?: "review" | "bad";
  children: React.ReactNode;
}) {
  return (
    <button className="nav-item" aria-current={active === view} onClick={() => onClick(view)}>
      <span className="nav-step">{step}</span>
      {children}
      {count !== undefined && count > 0 && (
        <span className={`nav-count nav-count--${tone ?? "review"}`}>{count}</span>
      )}
    </button>
  );
}
