/// <reference lib="webworker" />
/**
 * omrWorker.ts — el motor OMR corriendo en un hilo aparte.
 *
 * POR QUÉ UN WORKER Y NO EL HILO PRINCIPAL: analizar una hoja cuesta ~1.2 s
 * de CPU sostenida (medido). En el hilo principal eso congela la pantalla
 * entera: no responden los clics, no avanza la barra de progreso, el
 * navegador puede llegar a ofrecer "cerrar la pestaña que no responde". Con
 * 30 hojas serían ~36 s de interfaz trabada. Acá la página sigue viva y
 * recibe el avance hoja por hoja.
 *
 * El worker hace TODO el trabajo pesado: decodificar el archivo, alinear la
 * hoja y clasificar las burbujas. A la página solo le vuelven resultados
 * (números y estados), nunca imágenes — así el paso de mensajes es barato.
 *
 * Nota sobre memoria: `loadPagesBrowser` es un generador, así que la hoja
 * N+1 no se decodifica hasta que la N terminó de analizarse y se soltó. Esa
 * es la propiedad que evita repetir dentro del navegador el desborde que
 * tiró abajo al servidor.
 */

import { analyzeSheet, type SheetOutcome } from "../../../../packages/engine/analyzeSheet.ts";
import { buildOfficialTemplate } from "../../../../packages/pdf-generator/officialTemplate.ts";
import { loadPagesBrowser } from "./loadPagesBrowser.ts";
import type { AnswerKey } from "../../../../packages/engine/scoring.ts";

/** Mismo DPI que usa el resto del sistema para razonar sobre tamaños. */
const DPI = 200;

export interface AnalyzeRequest {
  kind: "analyze";
  /** Identificador que la página elige para correlacionar respuestas. */
  jobId: string;
  file: File;
  /** Se pasa vacío cuando todavía no hay clave: las respuestas se leen igual. */
  answerKey: AnswerKey;
}

export type WorkerResponse =
  | { kind: "pageCount"; jobId: string; total: number }
  | { kind: "page"; jobId: string; pageIndex: number; outcome: SheetOutcome }
  | { kind: "done"; jobId: string; pagesProcessed: number }
  | { kind: "error"; jobId: string; message: string };

// La plantilla se construye una sola vez por worker, no por hoja: es
// determinista y su costo (calcular ~570 posiciones) no tiene por qué
// pagarse en cada página de un lote.
const template = buildOfficialTemplate(100);

const post = (msg: WorkerResponse): void => self.postMessage(msg);

self.addEventListener("message", (event: MessageEvent<AnalyzeRequest>) => {
  const req = event.data;
  if (req.kind !== "analyze") return;

  void (async () => {
    let pageIndex = 0;
    try {
      for await (const page of loadPagesBrowser(req.file, (total) =>
        post({ kind: "pageCount", jobId: req.jobId, total })
      )) {
        const outcome = await analyzeSheet(page, template, DPI, req.answerKey);
        post({ kind: "page", jobId: req.jobId, pageIndex, outcome });
        pageIndex++;
      }
      post({ kind: "done", jobId: req.jobId, pagesProcessed: pageIndex });
    } catch (e) {
      // Un fallo al decodificar (archivo dañado, TIFF, formato ajeno) no
      // debe matar el worker: se informa y queda listo para el próximo
      // archivo del lote.
      post({
        kind: "error",
        jobId: req.jobId,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  })();
});
