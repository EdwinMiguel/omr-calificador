/**
 * cv.ts — Carga única de OpenCV.js, compartida por todo packages/engine.
 *
 * El WASM tarda 1-3s en compilar la primera vez (verify-opencv.mjs lo mide:
 * 88ms en esta máquina). Cargar el módulo una sola vez y reutilizarlo evita
 * pagar ese costo en cada función de análisis.
 */

import { createRequire } from "node:module";
import type { CV } from "@techstark/opencv-js";

let cvPromise: Promise<CV> | null = null;

function hasMat(value: unknown): value is CV {
  return typeof value === "object" && value !== null && "Mat" in value;
}

async function initCv(): Promise<CV> {
  // require(), no import estático: @techstark/opencv-js es CJS y su
  // `module.exports` ES DIRECTAMENTE una Promise (el propio archivo lo
  // confirma: `cv` es una función async, y `module.exports = factory()` la
  // ejecuta). Bajo tsx, `import cvModule from "..."` funciona porque Node
  // simplemente expone ese module.exports tal cual. Bajo Vitest, el
  // transformador ESM de Vite trata ese caso especial (CJS export
  // thenable) y termina envolviéndolo como un objeto Module de ES en vez
  // de la Promise real — falla con "Promise.prototype.then called on
  // incompatible receiver [object Module]" ANTES de que este código
  // corra. require() vía createRequire no pasa por esa interoperabilidad:
  // devuelve exports.module sin envolver, igual en tsx y en Vitest.
  const require = createRequire(import.meta.url);
  const raw: unknown = require("@techstark/opencv-js");
  const loaded: unknown = raw instanceof Promise ? await raw : raw;

  if (hasMat(loaded)) return loaded;

  // Módulo cargado pero WASM aún compilando: onRuntimeInitialized avisa
  // cuándo cv.Mat y el resto de la API quedan realmente disponibles.
  return new Promise((resolve) => {
    (loaded as { onRuntimeInitialized: () => void }).onRuntimeInitialized = () => {
      resolve(loaded as CV);
    };
  });
}

export function loadCv(): Promise<CV> {
  if (!cvPromise) cvPromise = initCv();
  return cvPromise;
}
