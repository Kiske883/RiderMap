const ROUTE_SOURCE = "transpirenaica-route";
const HIGHLIGHT_SOURCE = "transpirenaica-segment-highlight";
const COMPLETED_SOURCE = "ridermap-completed-route";
const LONG_PRESS_MS = 700;
const MOVE_TOLERANCE_PX = 12;
let map;
let readyPromise;
let markers = [];
let placementHandler = null;
let viaCreationHandler = null;
let viaPlacementMode = false;
let placementStateHandler = null;
let pointerOverMap = false;
let shiftPressed = false;
let riderMarker = null;
let rideInteractionHandler = null;

export function initializeMap() {
  if (readyPromise) return readyPromise;
  readyPromise = new Promise((resolve, reject) => {
    if (!window.maplibregl) { reject(new Error("No se pudo cargar MapLibre. Revisa la conexión a Internet.")); return; }
    map = new maplibregl.Map({
      container: "map",
      style: { version: 8, sources: { osm: { type: "raster", tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"], tileSize: 256, attribution: "© OpenStreetMap contributors" } }, layers: [{ id: "osm", type: "raster", source: "osm" }] },
      center: [0.2, 42.7], zoom: 6.4, attributionControl: false
    });
    map.addControl(new maplibregl.AttributionControl({ customAttribution: '<a href="https://www.graphhopper.com/" target="_blank" rel="noopener">Routing © GraphHopper</a>' }), "bottom-right");
    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");
    map.on("load", () => {
      map.addSource(ROUTE_SOURCE, { type: "geojson", data: emptyFeature() });
      const layout = { "line-join": "round", "line-cap": "round" };
      map.addLayer({ id: "route-shadow", type: "line", source: ROUTE_SOURCE, layout, paint: { "line-color": "#111317", "line-width": 8, "line-opacity": .7 } });
      map.addLayer({ id: "route-line", type: "line", source: ROUTE_SOURCE, layout, paint: { "line-color": "#ef5a35", "line-width": 5 } });
      map.addSource(COMPLETED_SOURCE, { type: "geojson", data: emptyFeature() });
      map.addLayer({ id: "completed-route-line", type: "line", source: COMPLETED_SOURCE, layout, paint: { "line-color": "#718096", "line-width": 5, "line-opacity": .9 } });
      map.addSource(HIGHLIGHT_SOURCE, { type: "geojson", data: emptyFeature() });
      map.addLayer({ id: "segment-highlight", type: "line", source: HIGHLIGHT_SOURCE, layout, paint: { "line-color": "#ffd166", "line-width": 8, "line-opacity": .9 } });
      map.on("click", handleMapClick);
      installContextInteractions(); map.on("dragstart", userMapInteraction); map.on("zoomstart", userMapInteraction); updateCursor(); resolve(map);
    });
    map.on("error", (event) => console.warn("MapLibre error", event.error || event));
  });
  return readyPromise;
}

export function setViaCreationHandler(handler) { viaCreationHandler = handler; }
export function setViaPlacementStateHandler(handler) { placementStateHandler = handler; handler(viaPlacementMode); }
export function toggleViaPlacementMode() { setViaPlacementMode(!viaPlacementMode); return viaPlacementMode; }
export function cancelViaPlacementMode() { setViaPlacementMode(false); }
export async function resizeMap() { await initializeMap(); map.resize(); }
export async function fitMapToRoute(route, waypoints = []) { await initializeMap(); const coordinates = route?.geometry?.coordinates?.length ? route.geometry.coordinates : waypoints.filter(hasCoordinates).map((point) => [point.lon, point.lat]); fitCoordinates(coordinates); }
export function setRideInteractionHandler(handler) { rideInteractionHandler = handler; }
export async function updateRiderPosition(position, follow = false) {
  await initializeMap(); const coordinate = [position.longitude, position.latitude];
  if (!riderMarker) { const element = document.createElement("div"); element.className = "rider-position-marker"; element.innerHTML = '<span class="rider-arrow">▲</span>'; riderMarker = new maplibregl.Marker({ element }).setLngLat(coordinate).addTo(map); }
  riderMarker.setLngLat(coordinate); const arrow = riderMarker.getElement().querySelector(".rider-arrow"); arrow.style.transform = Number.isFinite(position.heading) ? `rotate(${position.heading}deg)` : "";
  if (follow) map.easeTo({ center: coordinate, zoom: Math.max(map.getZoom(), 13), padding: { top: 60, bottom: Math.round(map.getContainer().clientHeight * .32), left: 40, right: 40 }, duration: 550 });
}
export function updateCompletedRoute(prepared, progress) { if (!map || !prepared) return; const end = Math.min(progress.segmentIndex + 1, prepared.coordinates.length - 1); const coordinates = prepared.coordinates.slice(0, end + 1); if (progress.coordinate) coordinates[coordinates.length - 1] = progress.coordinate; map.getSource(COMPLETED_SOURCE)?.setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } }); }
export function clearRideDisplay() { riderMarker?.remove(); riderMarker = null; map?.getSource(COMPLETED_SOURCE)?.setData(emptyFeature()); }

export async function updateMap(waypoints, route = null, options = {}) {
  await initializeMap(); clearRouteSegmentHighlight(); clearMarkers();
  const { selectedId = null, showViaPoints = true, routeDirty = false, onMarkerSelect, onMarkerDragEnd, onViaMove, onViaDelete } = options;
  const located = waypoints.filter(hasCoordinates);
  markers = located.filter((point) => showViaPoints || !isTechnicalWaypoint(point)).map((point) => {
    const isVia = isTechnicalWaypoint(point); const element = document.createElement("button"); const color = point.id === selectedId ? "#ffb34d" : isVia ? "#8f79d9" : "#ef5a35";
    element.className = `map-marker${isVia ? " via-marker" : ""}`; element.type = "button"; element.setAttribute("aria-label", isVia ? `VIA ${point.name}` : point.name);
    element.dataset.pointId = point.id;
    if (isVia) { const dot = document.createElement("span"); dot.textContent = "·"; dot.style.cssText = `display:grid;place-items:center;width:20px;height:20px;border-radius:50%;border:1px solid #fff;background:${color};box-shadow:0 2px 8px #0008`; element.append(dot); element.style.cssText = "display:grid;place-items:center;width:44px;height:44px;border:0;background:transparent;color:#fff;font-weight:900;padding:0"; }
    else { element.textContent = String(normalWaypointNumber(waypoints, point)); element.style.cssText = `width:30px;height:30px;border-radius:50%;border:2px solid #fff;background:${color};color:#fff;font-weight:900;box-shadow:0 2px 8px #0008;padding:0`; }
    const popup = isVia ? createViaPopup(point, onViaMove, onViaDelete) : new maplibregl.Popup({ offset: 20 }).setText(point.name);
    const marker = new maplibregl.Marker({ element, draggable: true }).setLngLat([point.lon, point.lat]).setPopup(popup).addTo(map);
    element.addEventListener("click", (event) => { event.stopPropagation(); onMarkerSelect?.(point); });
    element.addEventListener("contextmenu", (event) => { event.preventDefault(); event.stopPropagation(); });
    marker.on("dragend", () => { const location = marker.getLngLat(); onMarkerDragEnd?.(point, toCoordinate(location)); });
    return marker;
  });
  const geometry = route?.geometry?.coordinates?.length ? route.geometry : { type: "LineString", coordinates: [] };
  map.getSource(ROUTE_SOURCE).setData({ type: "Feature", properties: { outdated: routeDirty }, geometry });
  map.setPaintProperty("route-line", "line-opacity", routeDirty ? .42 : 1);
  map.setPaintProperty("route-line", "line-dasharray", routeDirty ? [2, 1.5] : null);
  const coordinates = geometry.coordinates.length ? geometry.coordinates : located.map((point) => [point.lon, point.lat]); fitCoordinates(coordinates);
}

export async function clearMap() { if (!map) return; await readyPromise; clearRouteSegmentHighlight(); clearMarkers(); map.getSource(ROUTE_SOURCE)?.setData(emptyFeature()); }
export function highlightRouteSegment(segment) {
  if (!map || !segment?.geometry?.coordinates?.length) return;
  document.querySelectorAll(".map-marker.segment-highlight-marker").forEach((element) => element.classList.remove("segment-highlight-marker"));
  for (const id of [segment.origin?.id, segment.destination?.id]) if (id) document.querySelector(`.map-marker[data-point-id="${CSS.escape(id)}"]`)?.classList.add("segment-highlight-marker");
  map.getSource(HIGHLIGHT_SOURCE)?.setData({ type: "Feature", properties: {}, geometry: segment.geometry }); fitCoordinates(segment.geometry.coordinates);
}

export function clearRouteSegmentHighlight() {
  if (!map) return; map.getSource(HIGHLIGHT_SOURCE)?.setData(emptyFeature()); document.querySelectorAll(".map-marker.segment-highlight-marker").forEach((element) => element.classList.remove("segment-highlight-marker"));
}
export function beginCoordinatePlacement(callback) { setViaPlacementMode(false); placementHandler = callback; updateCursor(); }
export function cancelCoordinatePlacement() { placementHandler = null; updateCursor(); }

function installContextInteractions() {
  const canvas = map.getCanvas(); let timer = null; let start = null;
  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  map.on("contextmenu", (event) => { event.preventDefault(); if (!placementHandler) { createViaCandidate(toCoordinate(event.lngLat)); setViaPlacementMode(false); } });
  canvas.addEventListener("mouseenter", () => { pointerOverMap = true; updateCursor(); }); canvas.addEventListener("mouseleave", () => { pointerOverMap = false; updateCursor(); });
  document.addEventListener("keydown", (event) => { if (event.key === "Shift") { shiftPressed = true; updateCursor(); } if (event.key === "Escape" && viaPlacementMode) setViaPlacementMode(false); });
  document.addEventListener("keyup", (event) => { if (event.key === "Shift") { shiftPressed = false; updateCursor(); } });
  window.addEventListener("blur", () => { shiftPressed = false; updateCursor(); });
  const cancel = () => { if (timer) clearTimeout(timer); timer = null; start = null; };
  canvas.addEventListener("touchstart", (event) => {
    if (placementHandler || event.touches.length !== 1) { cancel(); return; }
    const touch = event.touches[0]; start = { x: touch.clientX, y: touch.clientY };
    timer = setTimeout(() => { const rect = canvas.getBoundingClientRect(); const lngLat = map.unproject([start.x - rect.left, start.y - rect.top]); createViaCandidate(toCoordinate(lngLat)); setViaPlacementMode(false); if (navigator.vibrate) navigator.vibrate(35); timer = null; }, LONG_PRESS_MS);
  }, { passive: true });
  canvas.addEventListener("touchmove", (event) => { if (!start || event.touches.length !== 1) { cancel(); return; } const touch = event.touches[0]; if (Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > MOVE_TOLERANCE_PX) cancel(); }, { passive: true });
  canvas.addEventListener("touchend", cancel, { passive: true }); canvas.addEventListener("touchcancel", cancel, { passive: true });
}

function handleMapClick(event) {
  debugMap("Map click", event.lngLat); debugMap("Shift pressed", Boolean(event.originalEvent?.shiftKey)); debugMap("Via placement mode", viaPlacementMode);
  if (placementHandler) { placementHandler(toCoordinate(event.lngLat)); return; }
  if (!viaPlacementMode && !event.originalEvent?.shiftKey) return;
  event.preventDefault(); createViaCandidate(toCoordinate(event.lngLat)); setViaPlacementMode(false);
}

function createViaCandidate(coordinate) { debugMap("Creating Via Point candidate at:", coordinate.lat, coordinate.lon); viaCreationHandler?.(coordinate); }

function setViaPlacementMode(active) { viaPlacementMode = Boolean(active); placementStateHandler?.(viaPlacementMode); updateCursor(); }
function updateCursor() { if (!map) return; const crosshair = placementHandler || viaPlacementMode || (pointerOverMap && shiftPressed); map.getCanvas().style.cursor = crosshair ? "crosshair" : ""; }
function userMapInteraction(event) { if (event.originalEvent) rideInteractionHandler?.(); }

function createViaPopup(point, onMove, onDelete) {
  const content = document.createElement("div"); content.className = "via-marker-popup";
  const title = document.createElement("strong"); title.textContent = `VIA · ${point.name}`;
  const coords = document.createElement("code"); coords.textContent = `${point.lat.toFixed(6)}\n${point.lon.toFixed(6)}`;
  const actions = document.createElement("div"); const move = document.createElement("button"); move.type = "button"; move.textContent = "MOVER"; move.addEventListener("click", () => onMove?.(point));
  const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "ELIMINAR"; remove.addEventListener("click", () => onDelete?.(point)); actions.append(move, remove); content.append(title, coords, actions);
  return new maplibregl.Popup({ offset: 18 }).setDOMContent(content);
}

function fitCoordinates(coordinates) { if (!coordinates.length) return; if (coordinates.length === 1) { map.easeTo({ center: coordinates[0], zoom: 11 }); return; } const bounds = coordinates.reduce((box, coordinate) => box.extend(coordinate), new maplibregl.LngLatBounds(coordinates[0], coordinates[0])); map.fitBounds(bounds, { padding: 55, maxZoom: 13, duration: 700 }); }
function clearMarkers() { markers.forEach((marker) => marker.remove()); markers = []; }
function hasCoordinates(point) { return Number.isFinite(point.lat) && Number.isFinite(point.lon); }
function normalWaypointNumber(waypoints, target) { return waypoints.slice(0, waypoints.indexOf(target) + 1).filter((point) => !isTechnicalWaypoint(point)).length; }
function toCoordinate(lngLat) { return { lat: Number(lngLat.lat), lon: Number(lngLat.lng) }; }
function emptyFeature() { return { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [] } }; }
function debugMap(...values) { if (window.APP_CONFIG?.DEBUG_ROUTING || ["localhost", "127.0.0.1"].includes(window.location.hostname)) console.log(...values); }
import { isTechnicalWaypoint } from "./parser.js";
