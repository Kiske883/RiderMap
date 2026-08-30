# Transpirenaica Route Builder

Planificador web estático para rutas de moto de varios días. Nació para **Transpirenaica 2026** y conserva exactamente el orden elegido para carreteras, puertos y paradas.

> No optimizamos kilómetros. Optimizamos recuerdos.

No usa backend, base de datos, plataformas cartográficas comerciales, servicios de pago obligatorios, Node ni compilación. Se publica directamente en GitHub Pages. Su coste obligatorio es **0 €**.

## Servicios utilizados

| Función | Servicio | Cuenta o clave | Coste obligatorio |
|---|---|---|---|
| Renderizado | MapLibre GL JS desde un CDN | No | 0 € |
| Mapa base | Teselas estándar de OpenStreetMap | No | 0 €; uso personal moderado y sujeto a su política |
| Búsqueda de nombres | Nominatim público de OpenStreetMap | No | 0 €; máximo 1 petición/segundo y uso moderado |
| Rutas por carretera | GraphHopper Directions API | Sí, clave gratuita | 0 €; el plan gratuito no pide tarjeta y tiene cuota |

GraphHopper es el único servicio que necesita una cuenta y una clave. Según su página oficial, el plan Free cuesta 0 €, no requiere tarjeta, permite actualmente 500 créditos diarios y cinco ubicaciones por petición para uso no comercial. Estos términos pueden cambiar: consulta siempre la [tarifa oficial de GraphHopper](https://www.graphhopper.com/pricing/).

Las teselas y Nominatim son servicios comunitarios de capacidad limitada, sin garantía de disponibilidad. Este proyecto no descarga mapas en masa, no ofrece modo offline, conserva la atribución visible y limita Nominatim a menos de una petición por segundo. Lee las políticas oficiales de [teselas OSM](https://operations.osmfoundation.org/policies/tiles/) y [Nominatim](https://operations.osmfoundation.org/policies/nominatim/).

## Funciones

- Días 1–5 independientes con nombre, notas, gasolina y alojamiento.
- Pegado de un punto por línea, filas editables, tipos, subida, bajada y borrado.
- Geocodificación de nombres con caché persistente en `localStorage`.
- Corrección manual de latitud/longitud y asignación haciendo clic en el mapa.
- Puntos de paso técnicos insertados entre un par seleccionado para forzar una carretera concreta.
- MapLibre con zoom, desplazamiento, interacción táctil, marcadores, GeoJSON y ajuste automático.
- Segmentación automática de rutas largas en grupos de cinco puntos solapados.
- Distancia, duración, tabla entre puntos y resumen de días calculados.
- Panel desplegable por tramo con carreteras, instrucciones, coordenadas, advertencias de desvío y resaltado en el mapa.
- Copia de rutas e importación/exportación JSON validada.
- Diseño responsive sin funcionalidad dependiente de `hover`.

## Configuración gratuita

1. Crea una cuenta gratuita en [GraphHopper](https://www.graphhopper.com/).
2. Crea una clave para Directions API. No hace falta activar una cuenta de facturación ni introducir una tarjeta para el plan Free.
3. Copia `config.example.js` a `config.js` si es necesario.
4. Añade la clave:

   ```js
   window.APP_CONFIG = {
     ROUTING_PROVIDER: "graphhopper",
     GRAPHHOPPER_API_KEY: "TU_CLAVE_GRATUITA"
   };
   ```

Si el proveedor o la clave faltan, la aplicación muestra: «No hay ningún motor de rutas configurado». La clave está necesariamente visible porque la aplicación es estática. No es un secreto de servidor; controla su consumo desde el panel de GraphHopper. La aplicación reconoce errores de autenticación y cuota agotada y los explica en español.

Para depurar rutas durante el desarrollo se puede añadir `DEBUG_ROUTING: true` a `config.js`. En `localhost` el diagnóstico ya se activa automáticamente. La consola muestra el proveedor, coordenadas ordenadas enviadas, estado HTTP, respuesta de GraphHopper, distancia, duración y cantidad de vértices de la geometría. La clave nunca se escribe en el log.

## Uso

La interfaz se divide en cuatro vistas que comparten el mismo día y estado, sin recargas:

- **MAPA** dedica prácticamente toda la ventana a MapLibre, cálculo, puntos VIA y modo de mapa completo.
- **CARRETERAS** usa todo el ancho para la tabla, filtro, tarjetas de instrucciones y diagnóstico.
- **RUTA** reúne el texto original, editor estructurado, metadatos, copias y JSON.
- **RESUMEN** muestra el día seleccionado y los totales reales de los cinco días.

La vista activa se conserva en el hash (`#map`, `#roads`, `#route` o `#summary`). Al volver a MAPA se ejecuta `map.resize()` para que MapLibre recupere siempre el tamaño correcto. **MAPA COMPLETO** aplica un modo de enfoque mediante CSS, sin depender de Fullscreen API.

Pega un punto por línea en el orden exacto de paso:

```text
Hondarribia
Jaizkibel
Etxalar
Col de Lizarrieta
Larrau
```

La primera línea es el origen y la última el destino. Pulsa **CALCULAR RUTA**. La aplicación:

1. Usa primero las coordenadas manuales.
2. Reutiliza ubicaciones ya almacenadas en caché.
3. Consulta Nominatim, secuencialmente, para los nombres restantes.
4. Informa de todos los puntos no resueltos sin sustituirlos silenciosamente.
5. Divide la lista en peticiones admitidas por el plan gratuito.
6. Une geometrías, estadísticas y tramos y dibuja una sola ruta.

La línea del mapa se crea exclusivamente con `paths[0].points.coordinates` devuelto por GraphHopper usando `points_encoded=false`. Esos vértices se validan y normalizan como `[longitud, latitud]`. Los marcadores solo se usan como referencias y para ajustar el encuadre; nunca se convierten en una falsa polilínea recta.

Para veinte puntos se generan, por ejemplo, grupos `1–5`, `5–9`, `9–13`, etc. El último punto de cada petición se repite como primero de la siguiente para mantener continuidad. No se solicita optimización y nunca se descarta ni reordena un punto.

### Corregir un puerto mal localizado

Pulsa el botón **⌖ Corregir ubicación** de una fila. Puedes escribir latitud y longitud o elegir **Elegir en mapa** y tocar el lugar correcto. La corrección se guarda localmente, se exporta con el viaje y tiene prioridad sobre Nominatim en cálculos futuros.

Cambiar un nombre borra sus coordenadas geocodificadas para evitar reutilizar un resultado antiguo. Las coordenadas marcadas manualmente se conservan deliberadamente.

### Forzar una carretera con puntos de paso

En escritorio puedes usar cualquiera de estos métodos:

- **Shift + clic** sobre la carretera.
- **Clic derecho** sobre la carretera.
- Activar **+ PUNTO DE PASO** y hacer un clic normal; el modo se desactiva automáticamente.

Mientras Shift o el modo explícito están activos, el cursor cambia a una cruz. Escape o volver a pulsar el botón cancela el modo y restaura el mapa. Un clic normal, sin ninguno de esos modos, conserva el comportamiento habitual de MapLibre.

En móvil, mantén pulsado el mapa durante unos 700 ms sin mover el dedo. Si el dedo se desplaza, la detección se cancela para permitir el paneo normal. Todos los métodos abren directamente el diálogo con las coordenadas exactas, obligan a elegir el par consecutivo donde se insertará y permiten asignar un nombre como `D20`. No se geocodifica, adivina ni altera silenciosamente la posición.

También se conserva el acceso **Añadir punto de paso** entre las filas del editor: selecciona primero el tramo y luego toca la carretera en el mapa. Ambos flujos terminan en el mismo diálogo de confirmación.

Los puntos de paso:

- se envían a GraphHopper en el orden completo de la ruta;
- no necesitan geocodificación porque nacen con coordenadas manuales;
- tienen marcadores pequeños y secundarios;
- pueden renombrarse, eliminarse o corregirse como cualquier fila;
- se pueden arrastrar en el mapa sin lanzar peticiones mientras se mueven;
- en móvil se pueden tocar y elegir **MOVER**, y después tocar su nueva posición;
- se guardan en los cinco días y en el JSON exportado;
- no cuentan como puerto, parada ni waypoint normal.

La casilla **Mostrar puntos de paso** oculta únicamente sus marcadores; la ruta calculada permanece visible. Es posible añadir varios puntos técnicos consecutivos para forzar la entrada, el centro y la salida de una misma carretera.

Cualquier alta, movimiento, edición, eliminación o reordenación marca la ruta como desactualizada. La geometría anterior se muestra atenuada y discontinua junto al aviso **Ruta modificada — pulsa CALCULAR RUTA para actualizar**. GraphHopper solo se consulta al pulsar el botón, nunca durante el arrastre. Un cálculo correcto limpia el estado pendiente.

**COPIAR RUTA** genera la versión limpia sin puntos técnicos. **COPIAR RUTA TÉCNICA** los incluye como `[VIA D20]`. **COPIAR LISTA** conserva todas las líneas para edición y respaldo.

### Coordenadas estables y correcciones manuales

Cada waypoint conserva su nombre como etiqueta y sus coordenadas como identidad geográfica. La resolución aplica esta prioridad: corrección manual guardada para el nombre, coordenadas del waypoint actual, caché automática y, por último, Nominatim.

Todos los marcadores se pueden arrastrar. RiderMap guarda la nueva posición y recalcula una sola vez al terminar el arrastre, nunca mientras se mueve. Cada fila muestra las coordenadas y una insignia **Manual** o **Automática**. Desde **Corregir ubicación** se puede elegir otro punto en el mapa o restablecer la geocodificación automática. La acción global **Borrar ubicaciones corregidas** elimina las correcciones de puntos normales con confirmación; los VIA conservan su posición deliberada.

## Arquitectura

### Fiabilidad de la sesión y semántica de puntos

Una sesión **En ruta** sin terminar se guarda separadamente en `ridermap-active-ride-session-v1`. Contiene una instantánea versionada de la ruta y sus waypoints, distancia alcanzada, estados `pending`, `completed` o `skipped`, una única última posición y fechas de creación/actualización. No contiene historial GPS. Las escrituras se limitan a avances de 500 m, cambios de objetivo, intervalos de 10 segundos y eventos importantes como ocultar o cerrar la página.

Al abrir RiderMap se ofrece **Continuar ruta** o **Descartar**. Continuar restaura la ruta y el progreso con el GPS detenido; hay que pulsar **Iniciar GPS** expresamente. Descartar elimina sólo la sesión activa, nunca el viaje ni las correcciones de coordenadas. Una sesión corrupta o incompatible se elimina de forma defensiva sin impedir el arranque.

Los tipos disponibles son punto normal, puerto, gasolina, parada, comida, fin de etapa, interés y técnico. Las rutas antiguas sin tipo pasan a `normal`, y los antiguos `via` pasan a `technical`. Un punto técnico conserva coordenadas, orden y participación en GraphHopper, pero no aparece como destino principal durante la conducción. **Saltar punto** cambia únicamente su estado de sesión y admite deshacer; nunca elimina el waypoint ni recalcula la geometría.

### Modo En ruta

**EN RUTA** inicia una sesión GPS explícita para el día seleccionado. Requiere una ruta calculada y actualizada; nunca se reanuda por sí sola al recargar. Usa `watchPosition` con alta precisión y detiene el seguimiento mediante `clearWatch` al salir. Las muestras GPS no se guardan ni se envían a ningún servidor, y no provocan peticiones a GraphHopper.

El progreso se calcula localmente proyectando la posición sobre la geometría ya guardada. RiderMap muestra el siguiente waypoint, el posterior, distancia y tiempo restantes, precisión y velocidad cuando está disponible. Tolera pequeños saltos hacia atrás y exige tres lecturas fiables fuera de un umbral adaptado a la precisión antes de alertar. La ruta planificada nunca se reemplaza ni recalcula automáticamente.

Al mover o ampliar el mapa se pausa el seguimiento visual hasta pulsar **Volver a mi posición**. Wake Lock y pantalla completa se usan sólo cuando el navegador los permite. Con `DEBUG_ROUTING: true` (o en localhost) aparece un simulador que recorre la geometría y puede introducir un desvío de prueba usando el mismo procesador que el GPS real.

Sin conexión, el GPS del dispositivo puede continuar funcionando y la geometría calculada permanece en memoria/localStorage. Las teselas que no estén en la caché del navegador no cargarán, y no se podrá consultar Nominatim ni GraphHopper. No se incluyen mapas offline. La recalculación manual desde la posición actual queda como mejora futura para evitar alterar accidentalmente una ruta diseñada.

```text
.
├── index.html
├── css/styles.css
├── config.js
├── config.example.js
└── js/
    ├── app.js          Interfaz, cinco días y orquestación
    ├── parser.js       Normalización y validación
    ├── storage.js      localStorage e importación/exportación
    ├── geocoding.js    Nominatim, caché y coordenadas manuales
    ├── routing.js      Abstracción, GraphHopper y segmentación
    └── map.js          MapLibre, GeoJSON y marcadores
```

`app.js` solo consume una ruta normalizada:

```js
{
  distanceMeters: 268400,
  durationSeconds: 22440,
  geometry: {
    type: "LineString",
    coordinates: [[longitude, latitude], ...]
  },
  legs: [...]
}
```

### Detalles de ruta

La misma petición de ruta solicita instrucciones a GraphHopper. `routing.js` divide esas instrucciones y la geometría mediante los intervalos de vértices asociados a cada waypoint; no se hacen peticiones adicionales. `route-details.js` elimina carreteras duplicadas conservando el orden, descarta nombres genéricos y extrae referencias como `D918`, `GI-3440` o `NA-2600` del nombre y del texto de maniobra.

Cada tarjeta compara la distancia por carretera con la distancia Haversine entre sus extremos. Una relación superior a `2.5` muestra **Posible desvío**, únicamente como diagnóstico. Al seleccionar una tarjeta, su geometría real de GraphHopper se resalta y el mapa encuadra ese tramo y sus puntos.

**Mostrar datos de depuración** presenta un JSON acotado con métricas, carreteras, instrucciones y número de vértices; omite la enorme lista global de coordenadas. GraphHopper no proporciona de forma consistente una lista estructurada de pueblos atravesados en Routing API, por lo que ese dato solo aparece si el proveedor lo incluye. Los cálculos guardados por versiones anteriores deben recalcularse una vez para obtener instrucciones, nombres de vías y geometría individual por tramo.

El proveedor queda aislado en `routing.js`. Para añadir OSRM, Valhalla o un motor propio basta implementar un adaptador que devuelva este modelo y registrarlo en `PROVIDERS`; el mapa y la interfaz no necesitan cambios.

Los resultados de ruta guardados incluyen geometría GeoJSON, métricas y tramos. Una recarga puede restaurar el mapa sin consumir otra petición. Las ubicaciones resueltas también viven en cada waypoint y en una caché separada para reutilizarlas entre días.

## Desarrollo local

Los módulos JavaScript y las peticiones web requieren HTTP. No abras el proyecto mediante `file://`. Desde la carpeta ejecuta opcionalmente:

```bash
python -m http.server 8080
```

Abre `http://localhost:8080/`. Python solo actúa como servidor estático de desarrollo; no forma parte de la aplicación. VS Code Live Server también sirve.

## Publicar en GitHub Pages

1. Sube los archivos a la rama `main` de un repositorio.
2. Abre **Repository → Settings → Pages**.
3. Selecciona **Deploy from a branch**.
4. Elige **main** y **/(root)**.
5. Abre `https://TU-USUARIO.github.io/TU-REPOSITORIO/`.

Las rutas del proyecto son relativas y funcionan desde el subdirectorio de GitHub Pages. No hay proceso de build ni servidor de producción.

## Cuotas, privacidad y uso responsable

- Cada grupo de ruta consume cuota de GraphHopper. La interfaz se detiene con un mensaje claro ante HTTP 429; no intenta eludir límites.
- Nominatim recibe los nombres introducidos. Las búsquedas exitosas se guardan para reducir consultas repetidas.
- GraphHopper recibe las coordenadas de la ruta, no las notas privadas del día.
- OpenStreetMap recibe únicamente solicitudes de las teselas visibles en el mapa.
- No introduzcas datos personales o confidenciales en servicios públicos.
- Los cinco días permanecen en el navegador. Exporta JSON antes de borrar datos del sitio.

Para un proyecto con mucho tráfico habría que sustituir las instancias públicas de teselas/Nominatim por proveedores con capacidad adecuada o servicios propios. La configuración actual está orientada exclusivamente a un proyecto personal pequeño.
