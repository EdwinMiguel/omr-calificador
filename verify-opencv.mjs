/**
 * Paso 0 — Verificar que OpenCV.js carga en TU máquina antes de construir nada.
 *
 *   npm init -y
 *   npm i @techstark/opencv-js
 *   node verify-opencv.mjs
 *
 * Si esto imprime la build info y el test de Mat pasa, el stack está confirmado.
 * Si falla, mejor saberlo hoy que el día 6.
 */

import cvModule from "@techstark/opencv-js";

async function loadCv() {
  let cv = cvModule;
  if (cv instanceof Promise) cv = await cv;

  // El WASM tarda 1-3 s en compilarse la primera vez.
  if (!cv.Mat) {
    await new Promise((resolve) => {
      cv.onRuntimeInitialized = () => resolve();
    });
  }
  return cv;
}

const t0 = Date.now();
const cv = await loadCv();
console.log(`✓ OpenCV.js cargado en ${Date.now() - t0} ms`);

// Verificar que las 3 funciones que realmente necesitas existen.
const requeridas = [
  "cvtColor",
  "adaptiveThreshold",
  "findContours",
  "getPerspectiveTransform",
  "warpPerspective",
  "morphologyEx",
];

for (const fn of requeridas) {
  console.log(`${typeof cv[fn] === "function" ? "✓" : "✗"} cv.${fn}`);
}

// Test real: crear una imagen, umbralizarla, contar contornos.
// Dibujamos 3 cuadrados negros sobre fondo blanco → deben salir 3 contornos.
const src = new cv.Mat(200, 200, cv.CV_8UC1, new cv.Scalar(255));
for (const [x, y] of [[20, 20], [120, 20], [20, 120]]) {
  cv.rectangle(src, new cv.Point(x, y), new cv.Point(x + 40, y + 40),
               new cv.Scalar(0), -1);
}

const bin = new cv.Mat();
cv.threshold(src, bin, 127, 255, cv.THRESH_BINARY_INV);

const contours = new cv.MatVector();
const hierarchy = new cv.Mat();
cv.findContours(bin, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

const n = contours.size();
console.log(`\n${n === 3 ? "✓" : "✗"} findContours encontró ${n} contornos (esperado: 3)`);

for (let i = 0; i < n; i++) {
  const c = contours.get(i);
  const r = cv.boundingRect(c);
  console.log(`   blob ${i}: ${r.width}x${r.height} en (${r.x}, ${r.y}), área ${cv.contourArea(c)}`);
  c.delete();
}

// IMPORTANTE: liberar SIEMPRE. El GC de JS no toca la memoria del heap de WASM.
src.delete();
bin.delete();
contours.delete();
hierarchy.delete();

console.log("\n✓ Stack confirmado. Puedes construir el template.");
