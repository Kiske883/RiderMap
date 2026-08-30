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

Entre cada par de elementos del editor aparece **Añadir punto de paso**. Selecciona exactamente el tramo problemático, toca la carretera deseada en el mapa, confirma las coordenadas y asigna un nombre técnico como `D20` o `Cruce NA-4400`. El nuevo elemento `↳ VIA` se inserta entre esos dos puntos; no se intenta adivinar otra posición.

Los puntos de paso:

- se envían a GraphHopper en el orden completo de la ruta;
- no necesitan geocodificación porque nacen con coordenadas manuales;
- tienen marcadores pequeños y secundarios;
- pueden renombrarse, moverse, eliminarse o corregirse como cualquier fila;
- se guardan en los cinco días y en el JSON exportado;
- no cuentan como puerto, parada ni waypoint normal.

**COPIAR RUTA** genera la versión limpia sin puntos técnicos. **COPIAR RUTA TÉCNICA** los incluye como `[VIA D20]`. **COPIAR LISTA** conserva todas las líneas para edición y respaldo.

## Arquitectura

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
