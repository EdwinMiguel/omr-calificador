/**
 * omrClient.ts — la cara amable del worker.
 *
 * Convierte el ir y venir de mensajes en algo que un componente de React
 * pueda usar sin saber que hay un hilo aparte: se llama `analyzeFile()`, se
 * reciben avisos de avance, y al final una lista de resultados.
 *
 * Un solo worker, reutilizado entre archivos: crearlo cuesta cargar de nuevo
 * OpenCV (unos MB de WASM que hay que compilar), así que levantarlo por cada
 * hoja sería mucho más caro que el análisis en sí.
 */

import type { SheetOutcome } from "../../../../packages/engine/analyzeSheet.ts";
import type { AnswerKey } from "../../../../packages/engine/scoring.ts";
import type { AnalyzeRequest, WorkerResponse } from "./omrWorker.ts";

export interface PageResult {
  pageIndex: number;
  outcome: SheetOutcome;
}

export interface AnalyzeCallbacks {
  /** Cuántas hojas trae el archivo. Llega apenas se abre, antes de procesar. */
  onPageCount?: (total: number) => void;
  /** Una hoja terminada. Llega de a una, no al final. */
  onPage?: (result: PageResult) => void;
}

let worker: Worker | null = null;

function getWorker(): Worker {
  if (!worker) {
    // `new URL(..., import.meta.url)` es la forma que Vite reconoce para
    // empaquetar un worker: detecta el patrón, lo compila aparte y reescribe
    // la ruta al archivo final. Con una ruta suelta en texto no funcionaría.
    worker = new Worker(new URL("./omrWorker.ts", import.meta.url), { type: "module" });
  }
  return worker;
}

let nextJobId = 0;

/**
 * Analiza un archivo (imagen o PDF) completo. Resuelve cuando terminaron
 * todas sus páginas; el avance llega antes por los callbacks.
 */
export function analyzeFile(
  file: File,
  answerKey: AnswerKey = {},
  callbacks: AnalyzeCallbacks = {}
): Promise<PageResult[]> {
  const w = getWorker();
  const jobId = `job-${nextJobId++}`;

  return new Promise((resolve, reject) => {
    const results: PageResult[] = [];

    const onMessage = (event: MessageEvent<WorkerResponse>): void => {
      const msg = event.data;
      // Un mismo worker puede tener varios archivos en vuelo: cada respuesta
      // trae su jobId y se ignora lo que no corresponde a esta llamada.
      if (msg.jobId !== jobId) return;

      switch (msg.kind) {
        case "pageCount":
          callbacks.onPageCount?.(msg.total);
          break;
        case "page": {
          const result = { pageIndex: msg.pageIndex, outcome: msg.outcome };
          results.push(result);
          callbacks.onPage?.(result);
          break;
        }
        case "done":
          cleanup();
          resolve(results);
          break;
        case "error":
          cleanup();
          reject(new Error(msg.message));
          break;
      }
    };

    const onError = (e: ErrorEvent): void => {
      cleanup();
      reject(new Error(`El worker falló: ${e.message}`));
    };

    function cleanup(): void {
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
    }

    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);

    const req: AnalyzeRequest = { kind: "analyze", jobId, file, answerKey };
    w.postMessage(req);
  });
}

/** Libera el worker. Útil al desmontar, o si se quiere forzar recarga del motor. */
export function terminateWorker(): void {
  worker?.terminate();
  worker = null;
}
