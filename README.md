# Mi salud

Panel diario de salud para Jorge: **tensión, peso, glucosa, movimiento y medicación** en una sola pantalla («Hoy»), con tendencias de las últimas 4–8 semanas en lenguaje llano. PWA estática, sin servidor ni dependencias. Publicada en <https://prodesin.github.io/mi-salud/>.

> Orientativa. No sustituye a tu médico y no diagnostica nada.

## Funciones

- **Hoy**: última tensión (misma clasificación y colores que Mi tensión) con aviso suave y, desde las 13:00, más visible si falta; peso comparado con el peso más cercano de hace ≥ 7 y ≥ 30 días (si no lo hay, «—» y «sin dato de hace una semana»), IMC y lo que falta para la meta (88 kg); cintura; glucosa opcional con rangos orientativos y avisos (< 70 y > 250); caminata y fuerza frente a la meta semanal (150 min y 2–3 sesiones); medicación con recordatorios dentro de la app; «Comida de hoy» si hay datos de Mi plato o del contador de Mi entrenador.
- **Tendencia**: resumen en 3–5 frases y gráficas SVG (tensión media y % en objetivo, peso, glucosa, minutos caminados, fuerza, cumplimiento de la medicación). Cada gráfica tiene su tabla de datos.
- **Historial**: todo por días; lo apuntado aquí se puede editar y borrar.
- **Más**: ajustes, medicación, traer datos de otras apps, fuentes, copia de seguridad, enlaces, privacidad y aviso médico.
- Medicación: «Ozempic (semaglutida)» viene **en pausa**, semanal; con el interruptor «La estoy tomando» se activa desde ese día. No se usan notificaciones del móvil: los avisos salen en Hoy.
- Entrada manual de todo; se acepta coma decimal (93,4). Claro/oscuro, rail de navegación a la derecha y layout para iPhone Duo (exterior e interior).

## De dónde salen los datos

Solo se **leen** (nunca se escriben) estas claves de `localStorage`, que comparten las apps del mismo origen `prodesin.github.io`:

| Clave | App | Uso |
|---|---|---|
| `mi-tension:v1` | Mi tensión | lecturas |
| `mi-entrenador:v1` | Mi entrenador | pesos, caminatas, fuerza, glucosa, comidas (`cal-logs`) |
| `mi-menu:v2` | Mi menú | objetivos de kcal y proteína |
| `mi-plato:v1` | Mi plato | comidas: `{schema, data:{comidas:[{fecha, items:[{g, por100:{kcal,p}}]}]}}`; las kcal y la proteína de cada comida se suman de sus alimentos (g/100 × por100). Su exportación (`{app:'mi-plato', data:{comidas,…}}`) se importa igual |

Lo que apuntas aquí se guarda en `mi-salud:v1` (`{schema, data}`). Si el mismo dato está en varias fuentes no se cuenta dos veces (mismo instante y valores en tensión; misma fecha en peso, caminata y glucosa). Mi entrenador funde al leer sus datos precargados (`REGISTROS`, `PESOS`) respetando `borrados-*`; Mi salud aplica la misma fusión.

### Por qué en el iPhone hay que importar

Cuando una app se añade a la pantalla de inicio, iOS le da **su propio almacenamiento aislado**: no comparte datos con Safari ni con otras apps instaladas, aunque sean del mismo origen. Por eso, en **Más › Traer datos de otras apps** se pueden elegir (uno o varios) los ficheros que exportan Mi tensión, Mi entrenador, Mi menú y Mi plato. Se guardan como copia con la fecha de importación, sin duplicar, y se pueden volver a importar para actualizar. La tarjeta **Fuentes** dice de dónde sale cada dato y cuándo se actualizó.

Además, la app arranca con datos precargados (8 lecturas de Mi tensión, registros y pesos de Mi entrenador, cintura de 104,6 cm el 26/11) para no estar vacía.

## Instalación

Safari › Compartir › **Añadir a pantalla de inicio**.

## Copia de seguridad

**Más › Copia de seguridad**: exporta `{app: 'mi-salud', schema, exportedAt, data}` e impórtala (se valida y se pide confirmación; reemplaza los datos actuales).

## Privacidad

Sin servidor, cuentas, analítica ni CDNs; fuentes del sistema. Lo que apuntas solo está en el dispositivo. Los datos precargados (tensión, pesos y registros de noviembre) están en el repositorio público.

## Desarrollo y publicación

Vanilla JS, sin build: `index.html`, `styles.css`, `data.js` (datos y fusión), `app.js` (interfaz), `sw.js`. Iconos: `python3 tools/make_icons.py .` (requiere Pillow). Probar en local: `python3 -m http.server 8781`.

**Al publicar una versión nueva, sube `CACHE_VERSION` en `sw.js`** (hoy `'v2'`); si no, los móviles seguirán con la caché antigua.
