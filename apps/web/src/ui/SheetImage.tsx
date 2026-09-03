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
import { useSheetImageUrl } from "../engine-browser/localClient.ts";

type Zoom = "fit" | "full";

export function SheetImage({ sheetId }: { sheetId: string }) {
  const [overlay, setOverlay] = useState(true);
  const [zoom, setZoom] = useState<Zoom>("fit");

  // MEDIDO: la hoja completa a 200 dpi pesa ~1.8 MB en PNG; a 1000 px de
  // ancho, ~680 KB y se ve idéntica mientras está ajustada a la pantalla.
  // La resolución completa se pide solo al hacer zoom, que es cuando de
  // verdad hace falta distinguir una marca floja de una mancha.
  const image = useSheetImageUrl(sheetId, overlay, zoom === "fit" ? 1000 : undefined);
  const loading = image.loading;

  if (image.error) {
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
            onChange={(e) => setOverlay(e.target.checked)}
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
          onClick={() => setZoom((z) => (z === "fit" ? "full" : "fit"))}
        >
          {zoom === "fit" ? UI.detail.zoomIn : UI.detail.zoomFit}
        </button>
      </div>

      <div className={`sheet-image-viewport${zoom === "full" ? " is-full" : ""}`}>
        {loading && <div className="sheet-image-loading">{UI.common.loading}</div>}
        {image.data && (
          <img
            src={image.data}
            alt={UI.detail.imageAlt}
            className={zoom === "full" ? "is-full" : undefined}
          />
        )}
      </div>
    </div>
  );
}
