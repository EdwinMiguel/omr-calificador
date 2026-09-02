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
 * hoja y clasificar las burbujas.
 *
 * QUÉ VUELVE A LA PÁGINA, MEDIDO: además de los números y estados, vuelve
 * `alignedImage` (la hoja enderezada, 1654×2339 = 3.7 MB por página), que es
 * lo que la página guarda como PNG para "Ver hoja". No hay alternativa
 * barata: en el navegador no existe el disco del servidor donde recalcularla
 * después (ver analyzeSheet.ts, comentario de alignedImage).
 *
 * CONSECUENCIA EN MEMORIA, MEDIDA en Chromium con un PDF de 20 páginas: el
 * heap de la pestaña sube ~4.5 MB por página mientras dura la subida de UN
 * archivo (pico 97 MB) y vuelve a 7 MB en cuanto termina — es un pico
 * transitorio, no una fuga (retenido tras GC: 0.2 MB). El generador de
 * `loadPagesBrowser` acota la parte de DECODIFICACIÓN a una página por vez;
 * lo que se acumula son los resultados ya calculados, que la página suelta
 * al terminar el archivo. Comparación con el fallo que motivó todo esto: el
 * servidor acumulaba ~174 MB por página y moría a las 10 páginas.
 *
 * El hilo principal NO se bloquea, que es la razón de que exista este
 * worker: durante esas 20 páginas el hueco máximo entre latidos de 50 ms fue
 * de 82 ms, ninguno por encima de 100 ms.
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
