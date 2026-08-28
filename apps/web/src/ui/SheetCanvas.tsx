/**
 * SheetCanvas.tsx — el visor de la hoja.
 *
 * Dibuja la zona de la hoja alrededor de una pregunta, con las burbujas y
 * su oscuridad real medida. NO es decoración: es lo que permite que una
 * persona decida mirando la marca, no el número — que es todo el punto de
 * la revisión manual (PROMPT.md §8, "salida visual siempre").
 *
 * PENDIENTE CONOCIDO: dibuja una representación de la lectura, no el
 * recorte fotográfico real de la hoja. El motor ya produce la imagen
 * alineada (`analyzeGeometry().normalized`) y el siguiente paso natural es
 * que la API la sirva como PNG por ROI para mostrar el papel de verdad.
 * Se deja explícito para no dar por real lo que todavía es un esquema.
 */

import { useEffect, useRef } from "react";

export interface CanvasQuestion {
  ordinal: number;
  /** Oscuridad normalizada por opción; ausente = pregunta vecina ya resuelta. */
  fills?: Record<string, number>;
  answer?: string;
}

function token(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function SheetCanvas({
  questions, focusOrdinal, options, height = 300,
}: {
  questions: CanvasQuestion[];
  focusOrdinal: number;
  options: string[];
  height?: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const w = parent.clientWidth - 28; // padding del marco
      const h = height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const paper = token("--paper");
      const pencil = token("--pencil");
      const accent = token("--accent-br");
      const review = token("--review");

      ctx.fillStyle = paper;
      ctx.fillRect(0, 0, w, h);

      const rows = questions.length;
      if (rows === 0) return;
      const rowH = h / (rows + 0.5);
      const bubR = Math.min(rowH * 0.26, 14);
      const x0 = w * 0.24;
      const gap = (w * 0.64) / Math.max(1, options.length - 1);

      questions.forEach((q, r) => {
        const cy = rowH * (r + 0.7);
        const isFocus = q.ordinal === focusOrdinal;

        if (isFocus) {
          ctx.fillStyle = review;
          ctx.globalAlpha = 0.13;
          ctx.fillRect(0, cy - rowH * 0.46, w, rowH * 0.92);
          ctx.globalAlpha = 1;
        }

        ctx.fillStyle = pencil;
        ctx.font = `500 ${Math.round(rowH * 0.3)}px 'IBM Plex Mono', monospace`;
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillText(String(q.ordinal), x0 - bubR * 2.6, cy);

        options.forEach((opt, i) => {
          const cx = x0 + gap * i;
          const measured = q.fills?.[opt];
          const fill = measured !== undefined
            ? Math.max(0, Math.min(1, measured / 0.5))
            : q.answer === opt ? 0.95 : 0.02;

          ctx.beginPath();
          ctx.arc(cx, cy, bubR, 0, Math.PI * 2);
          ctx.strokeStyle = pencil;
          ctx.globalAlpha = 0.45;
          ctx.lineWidth = 1.3;
          ctx.stroke();
          ctx.globalAlpha = 1;

          if (fill > 0.05) {
            ctx.beginPath();
            ctx.arc(cx, cy, bubR * 0.82, 0, Math.PI * 2);
            ctx.fillStyle = pencil;
            ctx.globalAlpha = Math.min(1, fill * 1.05);
            ctx.fill();
            ctx.globalAlpha = 1;
          }

          ctx.fillStyle = pencil;
          ctx.globalAlpha = 0.4;
          ctx.font = `${Math.round(bubR * 0.85)}px 'IBM Plex Sans', sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(opt, cx, cy + bubR * 2.1);
          ctx.globalAlpha = 1;

          if (isFocus) {
            ctx.strokeStyle = accent;
            ctx.lineWidth = 1.4;
            ctx.setLineDash([3, 3]);
            ctx.strokeRect(cx - bubR * 1.25, cy - bubR * 1.25, bubR * 2.5, bubR * 2.5);
            ctx.setLineDash([]);
          }
        });
      });
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(parent);
    // El tema puede cambiar bajo los pies (el visor lo estampa en <html>):
    // sin esto el canvas se quedaría con los colores del tema anterior.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", draw);
    return () => { ro.disconnect(); mq.removeEventListener("change", draw); };
  }, [questions, focusOrdinal, options, height]);

  return <canvas ref={ref} role="img" aria-label={`Zona de la hoja en la pregunta ${focusOrdinal}`} />;
}
