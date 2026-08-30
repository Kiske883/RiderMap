const ROUTE_SOURCE = "transpirenaica-route";
let map;
let readyPromise;
let markers = [];
let placementHandler = null;

export function initializeMap() {
  if (readyPromise) return readyPromise;
  readyPromise = new Promise((resolve, reject) => {
    if (!window.maplibregl) { reject(new Error("No se pudo cargar MapLibre. Revisa la conexión a Internet.")); return; }
    map = new maplibregl.Map({
      container: "map",
      style: {
        version: 8,
        sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" } },
        layers: [{ id: "osm", type: "raster", source: "osm" }]
      },
      center: [0.2, 42.7], zoom: 6.4, attributionControl: false
    });
    map.addControl(new maplibregl.AttributionControl({ customAttribution: '<a href="https://www.graphhopper.com/" target="_blank" rel="noopener">Routing © GraphHopper</a>' }), "bottom-right");
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    map.on("load", () => {
      map.addSource(ROUTE_SOURCE, { type: "geojson", data: emptyFeature() });
      const lineLayout = { "line-join": "round", "line-cap": "round" };
      map.addLayer({ id: "route-shadow", type: "line", source: ROUTE_SOURCE, layout: lineLayout, paint: { "line-color": "#111317", "line-width": 8, "line-opacity": .7 } });
      map.addLayer({ id: "route-line", type: "line", source: ROUTE_SOURCE, layout: lineLayout, paint: { "line-color": "#ef5a35", "line-width": 5 } });
      map.on("click", (event) => { if (placementHandler) placementHandler({ lat: event.lngLat.lat, lon: event.lngLat.lng }); });
      resolve(map);
    });
    map.on("error", (event) => console.warn("MapLibre error", event.error || event));
  });
  return readyPromise;
}

export async function updateMap(waypoints, route = null, selectedId = null, onMarkerSelect = null) {
  await initializeMap();
  clearMarkers();
  const located = waypoints.filter(hasCoordinates);
  markers = located.map((point, index) => {
    const element = document.createElement("button");
    const isVia = point.type === "via";
    element.className = `map-marker${isVia ? " via-marker" : ""}`; element.type = "button"; element.textContent = isVia ? "·" : String(normalWaypointNumber(waypoints, point));
    const size = isVia ? 16 : 30; const color = point.id === selectedId ? "#ffb34d" : isVia ? "#8f79d9" : "#ef5a35";
    element.style.cssText = `width:${size}px;height:${size}px;border-radius:50%;border:${isVia ? 1 : 2}px solid #fff;background:${color};color:#fff;font-weight:900;box-shadow:0 2px 8px #0008;padding:0`;
    if (onMarkerSelect) element.addEventListener("click", (event) => { event.stopPropagation(); onMarkerSelect(point); });
    const popup = new maplibregl.Popup({ offset: 20 }).setText(point.name);
    return new maplibregl.Marker({ element }).setLngLat([point.lon, point.lat]).setPopup(popup).addTo(map);
  });
  const geometry = route?.geometry?.coordinates?.length ? route.geometry : { type: "LineString", coordinates: [] };
  if (route && (window.APP_CONFIG?.DEBUG_ROUTING || ["localhost", "127.0.0.1"].includes(window.location.hostname))) console.log("MapLibre road geometry coordinates:", geometry.coordinates.length);
  map.getSource(ROUTE_SOURCE).setData({ type: "Feature", properties: {}, geometry });
  const coordinates = geometry.coordinates.length ? geometry.coordinates : located.map((p) => [p.lon, p.lat]);
  fitCoordinates(coordinates);
}

export async function clearMap() {
  if (!map) return;
  await readyPromise; clearMarkers(); map.getSource(ROUTE_SOURCE)?.setData(emptyFeature());
}

export function beginCoordinatePlacement(callback) {
  placementHandler = callback;
  map?.getCanvas().classList.add("map-placement-active");
  if (map) map.getCanvas().style.cursor = "crosshair";
}

export function cancelCoordinatePlacement() {
  placementHandler = null;
  if (map) map.getCanvas().style.cursor = "";
}

function fitCoordinates(coordinates) {
  if (!coordinates.length) return;
  if (coordinates.length === 1) { map.easeTo({ center: coordinates[0], zoom: 11 }); return; }
  const bounds = coordinates.reduce((box, coordinate) => box.extend(coordinate), new maplibregl.LngLatBounds(coordinates[0], coordinates[0]));
  map.fitBounds(bounds, { padding: 55, maxZoom: 13, duration: 700 });
}

function clearMarkers() { markers.forEach((marker) => marker.remove()); markers = []; }
function hasCoordinates(point) { return Number.isFinite(point.lat) && Number.isFinite(point.lon); }
function normalWaypointNumber(waypoints, target) { return waypoints.slice(0, waypoints.indexOf(target) + 1).filter((point) => point.type !== "via").length; }
function emptyFeature() { return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [] } }; }
