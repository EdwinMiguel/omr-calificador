/**
 * primitives.tsx — las piezas visuales compartidas.
 *
 * Nada aquí sabe de OMR: son formas (una tarjeta, un chip de estado, una
 * burbuja). Las clases CSS vienen de styles.css, que es el mismo sistema
 * de diseño del prototipo aprobado — los componentes solo lo aplican.
 */

import type { ReactNode } from "react";

export type Tone = "ok" | "review" | "bad" | "idle";

export function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={`chip chip--${tone}`}>
      <span className="dot" />
      {children}
    </span>
  );
}

/**
 * El glifo de burbuja: el motivo que se repite en toda la interfaz.
 * "fill" = marca clara, "part" = dudosa, "faint" = rastro, vacío = sin marca.
 */
export function Bubble({ variant, size }: { variant?: "fill" | "part" | "faint"; size?: number }) {
  const style = size ? { width: size, height: size } : undefined;
  return <span className={`bub${variant ? ` bub--${variant}` : ""}`} style={style} />;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={`card${className ? " " + className : ""}`}>{children}</div>;
}

export function CardHead({ children }: { children: ReactNode }) {
  return <div className="card-head">{children}</div>;
}

export function Stat({
  label, value, note, tone,
}: { label: string; value: ReactNode; note?: string; tone?: Tone }) {
  return (
    <div className={`stat${tone ? ` stat--${tone}` : ""}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {note && <div className="stat-note">{note}</div>}
    </div>
  );
}

export function Callout({
  children, tone,
}: { children: ReactNode; tone?: "ok" | "warn" }) {
  return <div className={`callout${tone ? ` callout--${tone}` : ""}`}>{children}</div>;
}

export function ViewHead({ title, lead }: { title: string; lead: string }) {
  return (
    <div className="view-head">
      <h1>{title}</h1>
      <p>{lead}</p>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return (
    <Card>
      <div className="card-body" style={{ color: "var(--ink-muted)", textAlign: "center", padding: "40px 20px" }}>
        {children}
      </div>
    </Card>
  );
}
