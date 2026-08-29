/**
 * SheetImage.tsx — la hoja escaneada, para verificar la lectura a ojo.
 *
 * PROMPT.md §8 pide salida visual siempre, y esta es la que le importa al
 * profesor: comprobar que lo que el programa leyó coincide con lo que el
 * alumno pintó, sin tener que confiar en una tabla de letras.
 *
 * El interruptor de marcas no es un adorno: al apagarlas se ve la hoja tal
 * cual salió del escáner. Es la forma de comprobar que los anillos verdes
 * no están "tapando" una duda — si algo parece raro, se apagan y se mira
 * el papel sin intervención del programa.
 */

import { useState } from "react";
import { UI } from "../strings.ts";

type Zoom = "fit" | "full";

export function SheetImage({ sheetId }: { sheetId: string }) {
  const [overlay, setOverlay] = useState(true);
  const [zoom, setZoom] = useState<Zoom>("fit");
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // MEDIDO: la hoja completa a 200 dpi pesa ~1.8 MB en PNG; a 1000 px de
  // ancho, ~680 KB y se ve idéntica mientras está ajustada a la pantalla.
  // La resolución completa se pide solo al hacer zoom, que es cuando de
  // verdad hace falta distinguir una marca floja de una mancha.
  const src = `/api/sheets/${sheetId}/image?overlay=${overlay ? 1 : 0}` +
    (zoom === "fit" ? "&width=1000" : "");

  if (failed) {
    return (
      <div className="sheet-image-empty">{UI.detail.imageUnavailable}</div>
    );
  }

  return (
    <div className="sheet-image">
      <div className="sheet-image-bar">
        <label className="toggle">
          <input
            type="checkbox"
            checked={overlay}
            onChange={(e) => { setOverlay(e.target.checked); setLoading(true); }}
          />
          <span>{UI.detail.showMarks}</span>
        </label>
        <div className="sheet-image-legend">
          <span className="legend-item"><i className="legend-dot legend-dot--read" />{UI.detail.legendRead}</span>
          <span className="legend-item"><i className="legend-dot legend-dot--review" />{UI.detail.legendReview}</span>
        </div>
        <button
          className="btn btn--sm"
          style={{ marginLeft: "auto" }}
          onClick={() => { setZoom((z) => (z === "fit" ? "full" : "fit")); setLoading(true); }}
        >
          {zoom === "fit" ? UI.detail.zoomIn : UI.detail.zoomFit}
        </button>
      </div>

      <div className={`sheet-image-viewport${zoom === "full" ? " is-full" : ""}`}>
        {loading && <div className="sheet-image-loading">{UI.common.loading}</div>}
        <img
          src={src}
          alt={UI.detail.imageAlt}
          className={zoom === "full" ? "is-full" : undefined}
          onLoad={() => setLoading(false)}
          onError={() => { setLoading(false); setFailed(true); }}
        />
      </div>
    </div>
  );
}
