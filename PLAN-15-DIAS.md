# PLAN — 15 días

**Inicio:** viernes 21 de agosto de 2026. **Demo objetivo:** viernes 4 de septiembre.
Si no trabajo fines de semana, desplazar (~10 de septiembre). ~4 h/día.

La secuencia se sigue salvo que una puerta de aceptación demuestre que hay que replanificar. **Las puertas tienen prioridad sobre la fecha** (§0 del prompt).

---

## Día 1 — vie 21 ago · La hoja física

```
Objetivo      Hoja impresa cuya geometría coincide exactamente con template.ts
Conceptos     DPI, conversión mm↔px, marcadores fiduciales, por qué controlar
              el formato colapsa la dificultad del OMR
Código        template.ts (incorporar) + packages/pdf-generator
Test          validateTemplate() sin errores; test de mmToPx
Salida        hoja-v1.pdf, impresa en papel
PUERTA        Impresa al 100% (sin "ajustar a página"). Marcadores medidos con
              regla coinciden con el JSON dentro de ±0.5 mm
```

## Día 2 — sáb 22 ago · Entrada y depuración visual

```
Objetivo      Cualquier archivo de entrada → GrayImage + PNG inspeccionable
Conceptos     Formatos de imagen, profundidad de bits, buffers raw,
              documentos multipágina
Código        loadPages(file) → GrayImage[]  (JPG/PNG/TIFF/PDF)
              dumpDebug(stage, image)
Test          Los 4 formatos + un PDF de 3 páginas
Salida        01-original.png, 02-gray.png
PUERTA        10 fotos propias procesadas sin error
Además        Imprimir 10 hojas, llenarlas a mano con variedad deliberada
              (fuerte, débil, doble, borrada, blanca), fotografiarlas
```

## Día 3 — dom 23 ago · Umbralización

```
Objetivo      Separar tinta de papel de forma robusta
Conceptos     Histograma, umbral global, método de Otsu, umbral adaptativo
              y POR QUÉ el global falla con sombras
Código        Script comparativo de los tres métodos sobre el dataset
Test          Comparación sobre las 10 fotos del día 2
Salida        03-threshold.png (uno por método, lado a lado)
PUERTA        ≥8/10 fotos con burbujas claramente separadas del papel
              usando umbral adaptativo
```

## Día 4 — lun 24 ago · Morfología y blobs

```
Objetivo      Pasar de imagen binaria a lista de objetos con propiedades
Conceptos     Erosión, dilatación, opening (quita ruido), closing (rellena),
              kernels; componentes conectados y contornos
Código        Limpieza morfológica + findContours + listado de blobs
              (área, bounding box, centroide, aspecto, solidez)
Test          3 cuadrados sintéticos → exactamente 3 blobs con las
              dimensiones esperadas
Salida        04-morphology.png, 05-contours.png
PUERTA        Lista de blobs en la que reconozco los 4 marcadores por su tamaño
```

## Día 5 — mar 25 ago · Detección de fiduciales

```
Objetivo      Encontrar y ordenar los 4 marcadores de forma fiable
Conceptos     Filtrado por área/aspecto/solidez/cuadrante; ordenamiento
              TL/TR/BR/BL; marca de orientación para resolver rotación 180°
Código        findFiducials(blobs, template) → Marker[4] | null
Test          10 imágenes, incluida una rotada 180°
Salida        06-fiducials.png con los marcadores resaltados y etiquetados
PUERTA        10/10 con los 4 marcadores en el orden correcto
```

## Día 6 — mié 26 ago · Homografía

```
Objetivo      Convertir cualquier foto en una hoja frontal y alineada
Conceptos     Transformación proyectiva, 4 puntos → matriz 3×3,
              error de reproyección como verificación de calidad
Código        computeHomography() + warpToCanonical()
Test          Error de reproyección bajo el umbral en las 10 imágenes
Salida        07-normalized.png
PUERTA        El grid de la plantilla superpuesto cae sobre las burbujas
              impresas en todas las imágenes
```

## Día 7 — jue 27 ago · Pipeline geométrico · ★ GATE 1

```
Objetivo      Consolidar; overlay; primera prueba de desacoplamiento
Conceptos     Ninguno nuevo de CV (día de consolidación deliberada)
Código        analyzeGeometry() como función pura + renderOverlay()
              + Template B sintético: MISMA configuración que Template A
                (mismo nº de preguntas y opciones), otro origen, otro pitch,
                otras dimensiones; generado con el mismo pdf-generator
Test          Suite geométrica completa sobre el dataset
              + analyzeGeometry(imageB, templateB) sin lógica específica
                de ninguna plantilla   ← Nivel 1
Salida        Overlay legible de un vistazo, para ambas plantillas
PUERTA        ★ GATE 1 COMPLETO. Si vengo atrasado, este día lo absorbe.
              Si el Gate 1 no pasa hoy, replanificar ANTES de comprometer
              fecha con el cliente.
```

## Día 8 — vie 28 ago · ROIs y fillRatio · ★ GATE 2

```
Objetivo      Medir cuánta tinta hay en cada burbuja
Conceptos     ROI, encogimiento del rectángulo para no contar el contorno
              impreso, fill ratio
Código        bubbleRoi() + fillRatio()
Test          Tabla numérica de todas las burbujas de una hoja
Salida        08-rois.png con los rectángulos de muestreo dibujados
PUERTA        ★ GATE 2. Mirando la tabla numérica distingo a ojo las
              marcadas de las vacías, en las 10 hojas
```

## Día 9 — sáb 29 ago · Clasificación

```
Objetivo      Convertir números en decisiones conservadoras
Conceptos     Umbrales BLANK_MAX / MARK_MIN / MARGIN_MIN, margen entre
              primera y segunda opción, estados de excepción
Código        classify(fills, config) → ClassificationState
Test          Los 7 casos límite: marca limpia, blanco, doble, débil,
              borrado, margen bajo, marca normal
Salida        09-classification.png con color por estado
PUERTA        Coincide con el ground truth de las 10 hojas llenadas a mano
```

## Día 10 — dom 30 ago · Calibración por hoja · ★ GATE 3

```
Objetivo      Que las mismas constantes funcionen bajo iluminaciones distintas
Conceptos     Parches de calibración impresos, normalización por hoja,
              derivar umbrales de la distribución de la propia hoja
Código        readCalibrationPatches() + deriveThresholds()
Test          El dataset completo bajo 3 condiciones de luz
Salida        Comparativa de fillRatios antes/después de normalizar
PUERTA        ★ GATE 3. Sin tocar constantes, funciona con luz buena, mala
              y con sombra. Este es el día que decide si el sistema es usable.
```

## Día 11 — lun 31 ago · Identificación, clave y puntaje

```
Objetivo      Resultado completo por hoja
Conceptos     Decodificación de grid de dígitos; clave por versión de examen;
              puntaje derivado (no almacenado)
Código        decodeDigitGrid() + applyAnswerKey() + computeScore()
Test          SheetResult completo y correcto para las 10 hojas
Salida        Overlay con DNI y puntaje anotados
PUERTA        analyzeSheet() devuelve un objeto completo y correcto.
              Fin de la fase CLI-only.
```

## Día 12 — mar 1 sep · API y base de datos

```
Objetivo      Persistir resultados de forma auditable
Conceptos     Esquema append-only, idempotencia por hash, migraciones
Código        Fastify + esquema Postgres + POST /sheets
Test          Subir la misma imagen dos veces no duplica registros
Salida        (verificar por consultas SQL)
PUERTA        curl con una imagen → fila correcta en la base
```

## Día 13 — mié 2 sep · React · ★ GATE 4

```
Objetivo      Flujo completo desde el navegador
Conceptos     Ninguno nuevo de CV
Código        Carga drag & drop, tabla de resultados, visor de overlay,
              pantalla de revisión
Test          Flujo end-to-end manual
Salida        La aplicación misma
PUERTA        ★ GATE 4. imagen → OMR → resultado → UI
```

## Día 14 — jue 3 sep · Dataset adversarial y métricas

```
Objetivo      Saber objetivamente qué tan bueno es el sistema, y validar el
              desacoplamiento con una segunda plantilla FÍSICA
Conceptos     Ground truth independiente, matriz de confusión,
              entradas inválidas
Código        packages/synthetic-dataset + pnpm eval (métricas por plantilla)
Test          200 sintéticas + 90 fotos + las 10 entradas inválidas
              + ExternalTemplate: representar una hoja OMR pública como
                Template, imprimirla, fotografiarla, procesarla   ← Nivel 2
Salida        Carpeta failures/ con el overlay de cada error
PUERTA        metrics.json POR PLANTILLA; AUTO_ACCEPTED_INCORRECT reportado.
              La plantilla externa se procesa por el MISMO pipeline, sin
              forks ni ramas por plantilla. Ampliar una capacidad general
              es aceptable; un if (template.id === ...) no lo es.
```

## Día 15 — vie 4 sep · Correcciones, demo y limitaciones

```
Objetivo      Demo defendible ante el cliente
Conceptos     Ninguno nuevo
Código        Corregir los 3 fallos más frecuentes de failures/
Test          Prueba de aceptación completa (dataset final, no el reducido)
Salida        Guion de demo ensayado
PUERTA        AUTO_ACCEPTED_INCORRECT = 0 en todo el dataset.
              Documento de limitaciones explícitas escrito.
```

---

## Guion de la demo

Que maneje el cliente, no yo:

1. Le entrego 5 hojas impresas en blanco desde mi PDF.
2. **Él las llena** delante de mí — como quiera, incluso mal a propósito.
3. **Él las fotografía** con su propio celular.
4. Las sube en el navegador.
5. Ve: DNI detectado, respuestas, puntaje, hojas marcadas para revisión.
6. Abre el overlay: el sistema mostrando su trabajo sobre su propia hoja.
7. Le muestro qué pasa con una hoja mal fotografiada: **rechazo explícito**,
   no un resultado inventado.

El paso 7 es el que genera confianza. Cualquiera puede enseñar el caso feliz.

**Entregables junto a la demo:** la aplicación · el PDF de la hoja · un documento de una página con las limitaciones explícitas (no es humildad, es protección del alcance por escrito).
