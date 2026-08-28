import { useRef, useState } from "react";
import { uploadSheets, type UploadResult } from "../api/client.ts";
import { UI, REJECTION } from "../strings.ts";
import { Card, CardHead, Callout, ViewHead, Bubble, Chip } from "../ui/primitives.tsx";

export function Upload({ batchId, onUploaded }: { batchId: string; onUploaded: () => void }) {
  const [results, setResults] = useState<UploadResult[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function send(files: FileList | File[] | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await uploadSheets(batchId, Array.from(files));
      setResults((prev) => [...res.results, ...prev]);
      onUploaded();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ViewHead title={UI.upload.title} lead={UI.upload.lead} />
      <div className="stack">
        <div
          className="drop"
          tabIndex={0}
          role="button"
          aria-busy={busy}
          style={dragging ? { borderColor: "var(--accent-br)", background: "var(--accent-soft)" } : undefined}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); inputRef.current?.click(); } }}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); void send(e.dataTransfer.files); }}
        >
          <h3>{busy ? UI.upload.working : UI.upload.dropTitle}</h3>
          <p>{UI.upload.dropSub}</p>
          <div className="drop-hint">{UI.upload.dropHint}</div>
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".pdf,.jpg,.jpeg,.png,.tif,.tiff"
            hidden
            onChange={(e) => { void send(e.target.files); e.target.value = ""; }}
          />
        </div>

        {error && <Callout tone="warn"><strong>{UI.common.error}.</strong> {error}</Callout>}

        <Callout>{UI.upload.scannerNote}</Callout>

        {results.length > 0 && (
          <Card>
            <CardHead>
              <span className="eyebrow">{UI.common.sheets(results.length)}</span>
            </CardHead>
            <div className="filelist">
              {results.map((r, i) => {
                const rejected = r.status === "rejected";
                const dup = r.status === "duplicate";
                return (
                  <div className="filerow" key={`${r.sheetId}-${i}`}>
                    <Bubble variant={dup ? undefined : rejected ? "faint" : "fill"} />
                    <div>
                      <div className="filerow-name">{r.fileName}</div>
                      <div className="filerow-hash">página {r.pageIndex + 1}</div>
                    </div>
                    <div className="filerow-right">
                      {dup && <Chip tone="idle">{UI.upload.duplicate}</Chip>}
                      {rejected && <Chip tone="bad">{UI.upload.rejectedLabel}</Chip>}
                      {r.status === "processed" && <Chip tone="ok">{UI.upload.processed}</Chip>}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        )}
      </div>
    </>
  );
}

export { REJECTION };
