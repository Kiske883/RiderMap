import { createViaPoint, createWaypoint, isRideTarget, isTechnicalWaypoint, pointsToText, reconcileWaypoints, validateRoute, WAYPOINT_TYPES } from "./parser.js";
import { cacheManualCoordinate, clearAllManualCoordinates, clearCachedName, clearManualCoordinate, resolveWaypoints, validCoordinates } from "./geocoding.js";
import { calculateRoute, getRoutingConfiguration } from "./routing.js";
import { beginCoordinatePlacement, cancelCoordinatePlacement, cancelViaPlacementMode, clearMap, fitMapToRoute, highlightRouteSegment, initializeMap, resizeMap, setViaCreationHandler, setViaPlacementStateHandler, toggleViaPlacementMode, updateMap } from "./map.js";
import { exportTrip, importTripFile, loadTrip, saveTrip } from "./storage.js";
import { buildRouteSegments, createRoutingDebugData } from "./route-details.js";
import { createProgressTracker, prepareRouteProgress } from "./route-progress.js";
import { createGpsTracker } from "./gps-tracker.js";
import { createRideSession, discardRideSession, loadRideSession, saveRideSession, updateRideSession } from "./ride-session.js";
import { advanceWaypointStatuses, createWaypointStatuses, nextMeaningfulWaypoint, skipWaypoint, undoSkippedWaypoint } from "./waypoint-status.js";
import { clearRideDisplay, setRideInteractionHandler, updateCompletedRoute, updateRiderPosition } from "./map.js";

const EXAMPLE_POINTS = ["Hondarribia", "Santuario de Guadalupe", "Jaizkibel", "Lezo", "Etxalar", "Col de Lizarrieta", "Sare", "Ainhoa", "Dantxarinea", "Puerto de Otxondo", "Erratzu", "Col d'Izpegi", "Saint-Étienne-de-Baïgorry", "Saint-Jean-Pied-de-Port", "Mendive", "Col de Burdincurutcheta", "Chalets d'Iraty", "Col de Bagargui", "Col d'Orgambidesca", "Larrau"];
const $ = (selector) => document.querySelector(selector);
const elements = { tabs: $("#day-tabs"), primaryTabs: $("#primary-tabs"), notice: $("#notice"), tripName: $("#trip-name"), headerStats: $("#header-day-stats"), heading: $("#active-day-heading"), dayName: $("#day-name"), input: $("#route-input"), list: $("#waypoint-list"), notes: $("#notes"), fuel: $("#fuel-stops"), accommodation: $("#accommodation"), calculate: $("#calculate-route"), calculateEditor: $("#calculate-route-editor"), loading: $("#loading"), loadingText: $("#loading-text"), saveStatus: $("#save-status"), results: $("#route-results"), roadsEmpty: $("#roads-empty"), roadFilter: $("#road-filter"), segments: $("#segment-body"), detailCards: $("#route-detail-cards"), debugToggle: $("#toggle-routing-debug"), debugData: $("#routing-debug-data"), importFile: $("#import-file"), summaryName: $("#summary-name"), summaryStats: $("#summary-stats"), tripDaysSummary: $("#trip-days-summary"), selectedSummaryTitle: $("#selected-day-summary-title"), selectedSummaryStats: $("#selected-day-summary-stats"), selectedDayNotes: $("#selected-day-notes"), coordinateHelp: $("#map-coordinate-help"), mapActionMessage: $("#map-action-message"), dirty: $("#route-dirty"), showVia: $("#show-via-points"), viaPlacementButton: $("#via-placement-mode"), mapFocusToggle: $("#map-focus-toggle"), viaDialog: $("#via-dialog"), viaForm: $("#via-form"), viaCoordinates: $("#via-dialog-coordinates"), viaSegment: $("#via-segment-select"), viaPairPreview: $("#via-pair-preview"), viaName: $("#via-name") };
let trip = loadTrip();
let saveTimer;
const openCoordinateEditors = new Set();
let selectedWaypointId = null;
let pendingViaCoordinate = null;
let ride = null; let wakeLock = null; let simulationTimer = null; let simulationDistance = 0; let simulationOffset = false; let recoveredSession = null; let lastSessionSaveAt = 0; let lastSavedProgress = 0;

start();

function start() {
  bindEvents(); renderTabs(); renderActiveDay(); renderSummary();
  const initialTab = location.hash.slice(1); activateTab(validTab(initialTab) && initialTab !== "ride" ? initialTab : "map", false);
  setViaCreationHandler((coordinate) => openViaDialog(coordinate));
  setViaPlacementStateHandler(renderViaPlacementMode);
  setRideInteractionHandler(pauseRideFollow);
  initializeMap().then(() => refreshMap()).catch((error) => showNotice(error.message, "error"));
  try { getRoutingConfiguration(); } catch (error) { showNotice(error.message, "error"); }
  showRideRecoveryIfAvailable();
}

function bindEvents() {
  elements.tabs.addEventListener("click", (event) => { const button = event.target.closest("[data-day]"); if (!button) return; if (ride) stopRideMode(); syncFormToDay(); trip.activeDay = Number(button.dataset.day); cancelPlacement(); persistNow(); renderTabs(); renderActiveDay(); });
  elements.input.addEventListener("input", () => { const day = currentDay(); day.waypoints = reconcileWaypoints(elements.input.value, day.waypoints); invalidateRoute(day); renderWaypointList(); queueSave(); });
  elements.list.addEventListener("input", handleWaypointEdit); elements.list.addEventListener("change", handleWaypointEdit); elements.list.addEventListener("click", handleWaypointAction);
  elements.tripName.addEventListener("input", () => { trip.tripName = elements.tripName.value; renderSummary(); queueSave(); });
  for (const [element, key] of [[elements.dayName, "name"], [elements.notes, "notes"], [elements.fuel, "fuelStops"], [elements.accommodation, "accommodation"]]) element.addEventListener("input", () => { currentDay()[key] = element.value; if (key === "name") renderTabs(); queueSave(); });
  $("#add-waypoint").addEventListener("click", addWaypoint); $("#load-example").addEventListener("click", loadExample);
  $("#clear-manual-locations").addEventListener("click", resetAllManualLocations);
  $("#save-day").addEventListener("click", () => { syncFormToDay(); persistNow(); showNotice(`${dayTitle(trip.activeDay)} guardado en este navegador.`, "success"); });
  $("#clear-day").addEventListener("click", clearDay); elements.calculate.addEventListener("click", handleCalculate);
  elements.calculateEditor.addEventListener("click", handleCalculate);
  $("#copy-pretty").addEventListener("click", () => copyRoute(true)); $("#copy-technical").addEventListener("click", () => copyRoute("technical")); $("#copy-plain").addEventListener("click", () => copyRoute(false));
  $("#export-trip").addEventListener("click", () => { syncFormToDay(); persistNow(); exportTrip(trip); showNotice("Copia JSON exportada.", "success"); });
  $("#import-trip").addEventListener("click", () => elements.importFile.click()); elements.importFile.addEventListener("change", handleImport);
  $("#cancel-map-selection").addEventListener("click", cancelPlacement);
  elements.showVia.addEventListener("change", () => refreshMap());
  elements.viaPlacementButton.addEventListener("click", () => toggleViaPlacementMode());
  elements.viaSegment.addEventListener("change", renderViaPairPreview);
  elements.viaForm.addEventListener("submit", handleViaDialogSubmit);
  elements.debugToggle.addEventListener("click", toggleRoutingDebug);
  elements.primaryTabs.addEventListener("click", (event) => { const button = event.target.closest("[data-tab]"); if (!button) return; if (button.dataset.tab === "ride") startRideMode(); else { if (ride) stopRideMode(); activateTab(button.dataset.tab); } });
  window.addEventListener("hashchange", () => { const tab = location.hash.slice(1); if (tab === "ride" && !ride) { activateTab("map"); return; } if (validTab(tab)) activateTab(tab, false); });
  $("#fit-route").addEventListener("click", () => fitMapToRoute(currentDay().route, currentDay().waypoints));
  elements.mapFocusToggle.addEventListener("click", toggleMapFocus);
  elements.roadFilter.addEventListener("input", filterRoadSegments);
  $("#exit-ride-mode").addEventListener("click", stopRideMode); $("#ride-recenter").addEventListener("click", resumeRideFollow); $("#ride-wake-lock").addEventListener("click", toggleWakeLock); $("#ride-fullscreen").addEventListener("click", toggleFullscreen);
  $("#ride-start-gps").addEventListener("click", startRideGps); $("#ride-skip-waypoint").addEventListener("click", skipNextWaypoint); $("#continue-ride-session").addEventListener("click", continueRecoveredSession); $("#discard-ride-session").addEventListener("click", discardRecoveredSession);
  $("#simulation-toggle").addEventListener("click", toggleSimulation); $("#simulation-reset").addEventListener("click", resetSimulation); $("#simulation-offroute").addEventListener("click", () => { simulationOffset = !simulationOffset; $("#simulation-offroute").classList.toggle("active", simulationOffset); });
  window.addEventListener("pagehide", () => { persistRideProgress(true); stopRideServices(); }); document.addEventListener("visibilitychange", () => { if (document.hidden) { persistRideProgress(true); releaseWakeLock(); } });
  document.querySelectorAll(".dialog-cancel").forEach((button) => button.addEventListener("click", () => elements.viaDialog.close()));
}

function validTab(tab) { return ["map", "roads", "route", "summary", "ride"].includes(tab); }
function activateTab(tab, updateHash = true) {
  if (!validTab(tab)) tab = "map";
  const viewTab = tab === "ride" ? "map" : tab; document.querySelectorAll("[data-tab-view]").forEach((view) => { const active = view.dataset.tabView === viewTab; view.hidden = !active; view.classList.toggle("active", active); });
  elements.primaryTabs.querySelectorAll("[data-tab]").forEach((button) => { const active = button.dataset.tab === tab; button.classList.toggle("active", active); button.setAttribute("aria-selected", String(active)); });
  const activeButton = elements.primaryTabs.querySelector(`[data-tab="${tab}"]`); if (activeButton) elements.primaryTabs.scrollTo({ left: activeButton.offsetLeft - (elements.primaryTabs.clientWidth - activeButton.offsetWidth) / 2, behavior: "smooth" });
  if (updateHash && location.hash !== `#${tab}`) history.replaceState(null, "", `#${tab}`);
  if (tab === "map") requestAnimationFrame(() => resizeMap());
  if (tab === "roads") renderResults(currentDay());
  if (tab === "summary") renderSummary();
}

function toggleMapFocus() { const active = document.body.classList.toggle("map-focus"); elements.mapFocusToggle.textContent = active ? "SALIR DE MAPA COMPLETO" : "⛶ MAPA COMPLETO"; requestAnimationFrame(() => resizeMap()); }

function renderTabs() {
  elements.tabs.replaceChildren(...trip.days.map((day, index) => { const button = document.createElement("button"); button.type = "button"; button.className = `day-tab${index === trip.activeDay ? " active" : ""}`; button.dataset.day = index; button.textContent = day.name.trim() ? `Día ${index + 1} · ${day.name.trim()}` : `Día ${index + 1}`; button.setAttribute("aria-current", index === trip.activeDay ? "page" : "false"); return button; }));
}

function renderActiveDay() {
  const day = currentDay(); elements.tripName.value = trip.tripName; elements.heading.textContent = dayTitle(trip.activeDay); elements.dayName.value = day.name; elements.input.value = pointsToText(day.waypoints); elements.notes.value = day.notes; elements.fuel.value = day.fuelStops; elements.accommodation.value = day.accommodation;
  renderWaypointList(); renderResults(day); renderSummary(); renderDirtyState(); refreshMap();
}

function renderWaypointList() {
  const waypoints = currentDay().waypoints;
  if (!waypoints.length) { const empty = document.createElement("div"); empty.className = "waypoint-empty"; empty.textContent = "Pega una lista arriba o añade el primer punto."; elements.list.replaceChildren(empty); return; }
  const normalNumbers = new Map(); let normalNumber = 0; const children = [];
  waypoints.forEach((point) => { if (!isTechnicalWaypoint(point)) normalNumber += 1; normalNumbers.set(point.id, isTechnicalWaypoint(point) ? "↳" : normalNumber); });
  waypoints.forEach((point, index) => {
    const row = document.createElement("div"); row.className = "waypoint-row"; row.dataset.index = index; row.dataset.id = point.id;
    if (isTechnicalWaypoint(point)) row.classList.add("via-row");
    const number = document.createElement("span"); number.className = "waypoint-number"; number.textContent = normalNumbers.get(point.id);
    const input = document.createElement("input"); input.className = "waypoint-name"; input.value = point.name; input.setAttribute("aria-label", `Punto ${index + 1}`);
    const select = document.createElement("select"); select.className = "type-select"; select.setAttribute("aria-label", `Tipo del punto ${index + 1}`); WAYPOINT_TYPES.forEach((type) => select.add(new Option(type.label, type.value, false, point.type === type.value)));
    const actions = document.createElement("div"); actions.className = "row-actions"; actions.append(actionButton("↑", "up", "Subir", index === 0), actionButton("↓", "down", "Bajar", index === waypoints.length - 1), actionButton("⌖", "correct", "Corregir ubicación"), actionButton("×", "delete", "Eliminar"));
    row.append(number, input, select, actions, createLocationMeta(point), createCoordinateEditor(point, index)); children.push(row);
    if (index < waypoints.length - 1) children.push(createSegmentSelector(point, waypoints[index + 1], index));
  });
  elements.list.replaceChildren(...children);
}

function createSegmentSelector(from, to, index) {
  const button = document.createElement("button"); button.type = "button"; button.className = "segment-selector"; button.dataset.action = "add-via"; button.dataset.segmentIndex = index;
  button.textContent = `＋ Añadir punto de paso · ${from.name} → ${to.name}`; button.setAttribute("aria-label", `Añadir punto de paso entre ${from.name} y ${to.name}`); return button;
}

function createCoordinateEditor(point, index) {
  const editor = document.createElement("div"); editor.className = "coordinate-editor"; editor.hidden = !openCoordinateEditors.has(point.id);
  const lat = document.createElement("input"); lat.type = "number"; lat.step = "any"; lat.className = "coordinate-input latitude"; lat.placeholder = "Latitud"; lat.value = Number.isFinite(point.lat) ? point.lat : ""; lat.setAttribute("aria-label", `Latitud del punto ${index + 1}`);
  const lon = document.createElement("input"); lon.type = "number"; lon.step = "any"; lon.className = "coordinate-input longitude"; lon.placeholder = "Longitud"; lon.value = Number.isFinite(point.lon) ? point.lon : ""; lon.setAttribute("aria-label", `Longitud del punto ${index + 1}`);
  const mapButton = document.createElement("button"); mapButton.type = "button"; mapButton.className = "button button-small"; mapButton.dataset.action = "pick-map"; mapButton.textContent = "Elegir en mapa";
  const saveButton = document.createElement("button"); saveButton.type = "button"; saveButton.className = "button button-small"; saveButton.dataset.action = "save-coordinates"; saveButton.textContent = "Guardar coordenadas";
  const resetButton = document.createElement("button"); resetButton.type = "button"; resetButton.className = "button button-small reset-location"; resetButton.dataset.action = "reset-location"; resetButton.textContent = "Restablecer ubicación automática"; resetButton.hidden = point.locationSource !== "manual" || isTechnicalWaypoint(point);
  const status = document.createElement("span"); status.className = `coordinate-status${validCoordinates(point.lat, point.lon) ? " resolved" : ""}`; status.textContent = coordinateStatus(point);
  editor.append(lat, lon, saveButton, mapButton, resetButton, status); return editor;
}

function createLocationMeta(point) {
  const meta = document.createElement("div"); meta.className = "waypoint-location-meta";
  if (!validCoordinates(point.lat, point.lon)) { meta.textContent = "Sin coordenadas"; return meta; }
  const badge = document.createElement("span"); badge.className = `location-badge${point.locationSource === "manual" ? "" : " auto"}`; badge.textContent = point.locationSource === "manual" ? "📍 Manual" : "Automática";
  const coordinates = document.createElement("span"); coordinates.textContent = `${Number(point.lat).toFixed(6)}, ${Number(point.lon).toFixed(6)}`; meta.append(badge, coordinates); return meta;
}

function coordinateStatus(point) { if (!validCoordinates(point.lat, point.lon)) return "Sin resolver: se buscará por nombre al calcular."; if (point.locationSource === "manual") return "Ubicación manual (tiene prioridad)."; return point.resolvedName ? `Resultado: ${point.resolvedName}` : "Ubicación resuelta y guardada."; }
function actionButton(text, action, label, disabled = false) { const button = document.createElement("button"); button.type = "button"; button.className = `icon-button${action === "delete" ? " delete" : ""}`; button.dataset.action = action; button.textContent = text; button.title = label; button.setAttribute("aria-label", label); button.disabled = disabled; return button; }

function handleWaypointEdit(event) {
  const row = event.target.closest(".waypoint-row"); if (!row) return; const point = currentDay().waypoints[Number(row.dataset.index)]; if (!point) return;
  if (event.target.matches(".waypoint-name")) { const previousName = point.name; point.name = event.target.value; if (previousName !== point.name) { if (point.locationSource === "manual" && validCoordinates(point.lat, point.lon)) { clearManualCoordinate(previousName); cacheManualCoordinate(point.name, point.lat, point.lon); } else { clearCachedName(previousName); clearPointCoordinates(point); } } elements.input.value = pointsToText(currentDay().waypoints); invalidateRoute(currentDay()); }
  if (event.target.matches(".type-select") && point.type !== event.target.value) { point.type = event.target.value; point.manualCoordinates = isTechnicalWaypoint(point) || point.manualCoordinates === true; invalidateRoute(currentDay()); renderWaypointList(); }
  queueSave(); renderSummary();
}

function applyCoordinateInputs(row, point, eventType) {
  const lat = Number(row.querySelector(".latitude").value); const lon = Number(row.querySelector(".longitude").value);
  if (!validCoordinates(lat, lon)) { if (eventType === "change") { showNotice("Coordenadas no válidas. La latitud debe estar entre -90 y 90 y la longitud entre -180 y 180.", "error"); row.querySelector(".latitude").value = Number.isFinite(point.lat) ? point.lat : ""; row.querySelector(".longitude").value = Number.isFinite(point.lon) ? point.lon : ""; } return false; }
  Object.assign(point, { lat, lon, locationSource: "manual", manualCoordinates: true, resolvedName: "Ubicación corregida manualmente" }); cacheManualCoordinate(point.name, lat, lon); row.querySelector(".coordinate-status").className = "coordinate-status resolved"; row.querySelector(".coordinate-status").textContent = coordinateStatus(point); invalidateRoute(currentDay()); refreshMap(point.id); return true;
}

function handleWaypointAction(event) {
  const button = event.target.closest("[data-action]"); if (!button) return;
  if (button.dataset.action === "add-via") { startViaPlacement(Number(button.dataset.segmentIndex)); return; }
  const row = button.closest(".waypoint-row"); if (!row) return; const index = Number(row.dataset.index); const points = currentDay().waypoints; const point = points[index];
  if (button.dataset.action === "correct") { openCoordinateEditors.has(point.id) ? openCoordinateEditors.delete(point.id) : openCoordinateEditors.add(point.id); renderWaypointList(); return; }
  if (button.dataset.action === "pick-map") { startPlacement(point); return; }
  if (button.dataset.action === "save-coordinates") { if (applyCoordinateInputs(row, point, "change")) { persistNow(); showNotice(`Coordenadas guardadas para ${point.name}. Recalculando ruta…`, "success"); handleCalculate(); } return; }
  if (button.dataset.action === "reset-location") { resetManualLocation(point); return; }
  if (button.dataset.action === "delete") points.splice(index, 1);
  if (button.dataset.action === "up" && index > 0) [points[index - 1], points[index]] = [points[index], points[index - 1]];
  if (button.dataset.action === "down" && index < points.length - 1) [points[index + 1], points[index]] = [points[index], points[index + 1]];
  invalidateRoute(currentDay()); elements.input.value = pointsToText(points); renderWaypointList(); queueSave(); refreshMap();
}

function startPlacement(point) {
  selectedWaypointId = point.id; elements.mapActionMessage.textContent = `Haz clic en el mapa para asignar la ubicación a ${point.name}.`; elements.coordinateHelp.hidden = false; refreshMap(point.id);
  beginCoordinatePlacement(async (coordinate) => { Object.assign(point, coordinate, { locationSource: "manual", manualCoordinates: true, resolvedName: "Ubicación elegida en el mapa" }); cacheManualCoordinate(point.name, point.lat, point.lon); invalidateRoute(currentDay()); cancelPlacement(); renderWaypointList(); await refreshMap(); persistNow(); showNotice(`Ubicación manual guardada para ${point.name}. Recalculando ruta…`, "success"); await handleCalculate(); });
}

function startViaPlacement(segmentIndex) {
  const points = currentDay().waypoints; const from = points[segmentIndex]; const to = points[segmentIndex + 1]; if (!from || !to) return;
  selectedWaypointId = null; elements.mapActionMessage.textContent = `Haz clic en la carretera deseada para añadir un punto de paso entre ${from.name} → ${to.name}.`; elements.coordinateHelp.hidden = false;
  beginCoordinatePlacement((coordinate) => { cancelPlacement(); openViaDialog(coordinate, segmentIndex); });
}

function openViaDialog(coordinate, preferredIndex = 0) {
  const points = currentDay().waypoints;
  if (points.length < 2) { showNotice("Añade al menos dos puntos de ruta antes de crear un punto de paso.", "error"); return; }
  pendingViaCoordinate = coordinate; elements.viaCoordinates.textContent = `${coordinate.lat.toFixed(6)}, ${coordinate.lon.toFixed(6)}`; elements.viaName.value = ""; elements.viaSegment.replaceChildren();
  points.slice(0, -1).forEach((point, index) => { const next = points[index + 1]; const option = new Option(`${index + 1}. ${point.name} → ${next.name}`, String(index), false, index === preferredIndex); elements.viaSegment.add(option); });
  elements.viaSegment.value = String(Math.min(Math.max(preferredIndex, 0), points.length - 2)); renderViaPairPreview(); elements.viaDialog.showModal(); elements.viaName.focus();
}

function renderViaPairPreview() {
  const index = Number(elements.viaSegment.value); const points = currentDay().waypoints; if (!points[index] || !points[index + 1]) { elements.viaPairPreview.textContent = ""; return; }
  elements.viaPairPreview.replaceChildren(document.createTextNode(points[index].name), document.createElement("span"), document.createTextNode(points[index + 1].name)); elements.viaPairPreview.querySelector("span").textContent = "↓";
}

function handleViaDialogSubmit(event) {
  event.preventDefault(); if (!pendingViaCoordinate) return;
  const index = Number(elements.viaSegment.value); const points = currentDay().waypoints; if (!points[index] || !points[index + 1]) { showNotice("El segmento seleccionado ya no existe. Vuelve a intentarlo.", "error"); elements.viaDialog.close(); return; }
  const name = elements.viaName.value.trim() || nextViaName(points); const via = createViaPoint(name, pendingViaCoordinate.lat, pendingViaCoordinate.lon); points.splice(index + 1, 0, via); cacheManualCoordinate(via.name, via.lat, via.lon);
  pendingViaCoordinate = null; elements.viaDialog.close(); elements.input.value = pointsToText(points); openCoordinateEditors.add(via.id); markRouteDirty(currentDay()); renderWaypointList(); refreshMap(via.id); queueSave(); showNotice(`VIA · ${via.name} añadido. Pulsa CALCULAR RUTA para actualizar el recorrido.`, "success");
}

function nextViaName(points) { let number = 1; const names = new Set(points.filter(isTechnicalWaypoint).map((point) => point.name)); while (names.has(`VIA ${number}`)) number += 1; return `VIA ${number}`; }

function cancelPlacement() { selectedWaypointId = null; elements.coordinateHelp.hidden = true; cancelCoordinatePlacement(); cancelViaPlacementMode(); refreshMap(); }
function renderViaPlacementMode(active) { elements.viaPlacementButton.classList.toggle("placement-active", active); elements.viaPlacementButton.setAttribute("aria-pressed", String(active)); elements.viaPlacementButton.textContent = active ? "CANCELAR PUNTO DE PASO" : "+ PUNTO DE PASO"; }
function addWaypoint() { currentDay().waypoints.push(createWaypoint("Nuevo punto")); invalidateRoute(currentDay()); elements.input.value = pointsToText(currentDay().waypoints); renderWaypointList(); queueSave(); const inputs = elements.list.querySelectorAll(".waypoint-name"); inputs.at(-1)?.select(); }
function loadExample() { if (trip.activeDay !== 0) { showNotice("El ejemplo solo se carga en el Día 1.", "error"); return; } currentDay().waypoints = EXAMPLE_POINTS.map((name) => createWaypoint(name)); invalidateRoute(currentDay()); elements.input.value = pointsToText(currentDay().waypoints); renderWaypointList(); queueSave(); showNotice("Ejemplo cargado. Las ubicaciones se resolverán al calcular la ruta.", "success"); }

async function handleCalculate() {
  syncFormToDay(); let points;
  try { points = validateRoute(currentDay().waypoints); getRoutingConfiguration(); } catch (error) { showNotice(error.message, "error"); return; }
  invalidateRoute(currentDay());
  setLoading(true, "Preparando ubicaciones..."); hideNotice();
  try {
    points = await resolveWaypoints(points, (current, total, name) => setLoading(true, `Localizando ${current}/${total}: ${name}`));
    currentDay().waypoints = points; renderWaypointList(); await refreshMap();
    const route = await calculateRoute(points, (current, total) => setLoading(true, `Calculando tramo ${current}/${total}...`));
    currentDay().route = route; currentDay().routeDirty = false; persistNow(); renderResults(currentDay()); renderSummary(); renderDirtyState(); await refreshMap(); showNotice("Ruta calculada sin reordenar ningún punto.", "success");
  } catch (error) { console.error("Route calculation error", error); currentDay().route = null; persistNow(); renderWaypointList(); refreshMap(); const message = error.routingFailure ? `No se han podido conectar los puntos por carretera. ${error.message}` : error.message; showNotice(message, "error"); }
  finally { setLoading(false); }
}

function renderResults(day) {
  const normalPoints = day.waypoints.filter(isRideTarget); const viaPoints = day.waypoints.filter(isTechnicalWaypoint);
  $("#map-stat-points").textContent = `${normalPoints.length} waypoints · ${viaPoints.length} VIA`;
  if (!day.route) { elements.results.hidden = true; elements.roadsEmpty.hidden = false; elements.detailCards.replaceChildren(); elements.debugData.textContent = ""; elements.headerStats.textContent = "Ruta sin calcular"; $("#map-stat-distance").textContent = "— km"; $("#map-stat-duration").textContent = "—"; return; } elements.results.hidden = false; elements.roadsEmpty.hidden = true;
  $("#stat-distance").textContent = formatDistance(day.route.distanceMeters); $("#stat-duration").textContent = formatDuration(day.route.durationSeconds); $("#stat-points").textContent = `${normalPoints.length} waypoints`; $("#stat-waypoints").textContent = `${viaPoints.length} puntos de paso`; $("#stat-origin").textContent = normalPoints[0]?.name || "—"; $("#stat-destination").textContent = normalPoints.at(-1)?.name || "—";
  elements.headerStats.textContent = `${formatDistance(day.route.distanceMeters)} · ${formatDuration(day.route.durationSeconds)}`; $("#map-stat-distance").textContent = formatDistance(day.route.distanceMeters); $("#map-stat-duration").textContent = formatDuration(day.route.durationSeconds);
  const detailedSegments = buildRouteSegments(day.route, day.waypoints); elements.segments.replaceChildren(...detailedSegments.map(createSegmentRow)); renderRouteDetails(day.route, day.waypoints, detailedSegments); filterRoadSegments();
}

function renderRouteDetails(route, waypoints, segments = buildRouteSegments(route, waypoints)) {
  elements.detailCards.replaceChildren(...segments.map(createRouteDetailCard));
  elements.debugData.textContent = JSON.stringify(createRoutingDebugData(route, segments), null, 2); elements.debugData.hidden = true; elements.debugToggle.setAttribute("aria-expanded", "false"); elements.debugToggle.textContent = "MOSTRAR DATOS DE DEPURACIÓN";
}

function createRouteDetailCard(segment) {
  const details = document.createElement("details"); details.className = `route-detail-card${segment.suspicious ? " suspicious" : ""}`;
  details.dataset.segmentIndex = segment.index; details.dataset.search = segmentSearchText(segment);
  const summary = document.createElement("summary"); const heading = document.createElement("span"); heading.className = "segment-title"; heading.textContent = `${String(segment.index + 1).padStart(2, "0")}. ${segment.origin?.name || "—"} → ${segment.destination?.name || "—"}`;
  const meta = document.createElement("span"); meta.className = "segment-meta"; meta.textContent = `${formatDistance(segment.distanceMeters)} · ${formatDuration(segment.durationSeconds)}`;
  if (segment.suspicious) { const warning = document.createElement("span"); warning.className = "detour-warning"; warning.textContent = `⚠ Posible desvío · ×${segment.detourRatio.toFixed(1)}`; summary.append(heading, meta, warning); } else summary.append(heading, meta);
  summary.addEventListener("click", () => highlightRouteSegment(segment));
  const body = document.createElement("div"); body.className = "segment-detail-body";
  body.append(detailLine("Carreteras", segment.roads.length ? segment.roads.join(" → ") : "No disponibles en la respuesta"), detailLine("Origen", formatPointLocation(segment.origin)), detailLine("Destino", formatPointLocation(segment.destination)));
  if (segment.places.length) body.append(detailLine("Lugares", segment.places.join(" → ")));
  const instructionTitle = document.createElement("h4"); instructionTitle.textContent = "Instrucciones"; body.append(instructionTitle);
  if (segment.instructions.length) { const list = document.createElement("ol"); list.className = "instruction-list"; segment.instructions.forEach((instruction) => { const item = document.createElement("li"); const text = instruction.text || instruction.maneuver; item.textContent = `${text}${instruction.streetName ? ` · ${instruction.streetName}` : ""} · ${formatDistance(instruction.distanceMeters)}`; list.append(item); }); body.append(list); }
  else { const empty = document.createElement("p"); empty.className = "muted-copy"; empty.textContent = "Este cálculo guardado no contiene instrucciones. Recalcula para obtener nombres de carreteras."; body.append(empty); }
  details.append(summary, body); return details;
}

function detailLine(label, value) { const row = document.createElement("p"); const strong = document.createElement("strong"); strong.textContent = `${label}: `; row.append(strong, document.createTextNode(value)); return row; }
function formatCoordinates(point) { return Number.isFinite(point?.lat) && Number.isFinite(point?.lon) ? `${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}` : "No disponibles"; }
function formatPointLocation(point) { const source = point?.locationSource === "manual" ? "Manual" : point?.locationSource ? "Automática" : "Fuente desconocida"; return `${formatCoordinates(point)} · ${source}`; }
function toggleRoutingDebug() { const expanded = elements.debugToggle.getAttribute("aria-expanded") === "true"; elements.debugToggle.setAttribute("aria-expanded", String(!expanded)); elements.debugData.hidden = expanded; elements.debugToggle.textContent = expanded ? "MOSTRAR DATOS DE DEPURACIÓN" : "OCULTAR DATOS DE DEPURACIÓN"; }

function createSegmentRow(segment) { const row = document.createElement("tr"); row.dataset.segmentIndex = segment.index; row.dataset.search = segmentSearchText(segment); const type = isTechnicalWaypoint(segment.origin) || isTechnicalWaypoint(segment.destination) ? "Técnico" : typeLabel(segment.destination?.type); const observation = segment.suspicious ? `⚠ Posible desvío ×${segment.detourRatio.toFixed(1)}` : ""; [segment.index + 1, segment.origin?.name || "—", segment.destination?.name || "—", segment.roads.length ? segment.roads.join(" → ") : "—", formatDistance(segment.distanceMeters), formatDuration(segment.durationSeconds), type, observation].forEach((value) => { const cell = document.createElement("td"); cell.textContent = value; row.append(cell); }); row.addEventListener("click", () => { const card = elements.detailCards.querySelector(`[data-segment-index="${segment.index}"]`); if (card) { card.open = true; card.scrollIntoView({ behavior: "smooth", block: "start" }); } highlightRouteSegment(segment); }); return row; }
function segmentSearchText(segment) { return `${segment.origin?.name || ""} ${segment.destination?.name || ""} ${segment.roads.join(" ")} ${segment.origin?.type || ""} ${segment.destination?.type || ""}`.toLocaleLowerCase("es"); }
function filterRoadSegments() { const query = elements.roadFilter.value.trim().toLocaleLowerCase("es"); document.querySelectorAll("#segment-body tr,.route-detail-card").forEach((element) => { element.hidden = Boolean(query && !element.dataset.search.includes(query)); }); }
function typeLabel(type) { return ({ normal: "Punto", pass: "Puerto", stop: "Parada", fuel: "Gasolina", food: "Comida", hotel: "Fin de etapa", interest: "Interés", technical: "Técnico", lodging: "Fin de etapa", via: "Técnico" })[type] || "Punto"; }
function renderSummary() {
  const day = currentDay(); const normal = day.waypoints.filter(isRideTarget); const vias = day.waypoints.filter(isTechnicalWaypoint); const passes = day.waypoints.filter((point) => point.type === "pass").length;
  elements.selectedSummaryTitle.textContent = `${dayTitle(trip.activeDay)}${normal.length >= 2 ? ` · ${normal[0].name} → ${normal.at(-1).name}` : ""}`;
  elements.selectedSummaryStats.replaceChildren(...summaryItems([["Distancia", day.route ? formatDistance(day.route.distanceMeters) : "Sin calcular"], ["Conducción", day.route ? formatDuration(day.route.durationSeconds) : "Sin calcular"], ["Waypoints", normal.length], ["VIA", vias.length], ["Puertos", passes]]));
  const notes = [["Gasolina", day.fuelStops || "Sin planificar"], ["Alojamiento", day.accommodation || "Sin indicar"], ["Notas", day.notes || "Sin notas"]]; elements.selectedDayNotes.replaceChildren(...notes.map(([label, value]) => { const item = document.createElement("div"); item.className = "summary-note"; const span = document.createElement("span"); span.textContent = label; const text = document.createElement("p"); text.textContent = value; item.append(span, text); return item; }));
  elements.tripDaysSummary.replaceChildren(...trip.days.map((tripDay, index) => { const row = document.createElement("div"); row.className = "trip-day-row"; const points = tripDay.waypoints.filter((point) => point.type !== "via"); const title = tripDay.name || (points.length >= 2 ? `${points[0].name} → ${points.at(-1).name}` : "Sin configurar"); for (const value of [`Día ${index + 1}`, title, tripDay.route ? formatDistance(tripDay.route.distanceMeters) : "—", tripDay.route ? formatDuration(tripDay.route.durationSeconds) : "—", `${tripDay.waypoints.filter((point) => point.type === "via").length} VIA`]) { const cell = document.createElement(value === `Día ${index + 1}` ? "strong" : "span"); cell.textContent = value; row.append(cell); } return row; }));
  const calculated = trip.days.filter((tripDay) => tripDay.route); const stats = [["Días calculados", calculated.length], ["Kilómetros totales", formatDistance(calculated.reduce((sum, tripDay) => sum + tripDay.route.distanceMeters, 0))], ["Conducción total", formatDuration(calculated.reduce((sum, tripDay) => sum + tripDay.route.durationSeconds, 0))], ["Waypoints", calculated.reduce((sum, tripDay) => sum + tripDay.waypoints.filter((point) => point.type !== "via").length, 0)], ["Puntos de paso", calculated.reduce((sum, tripDay) => sum + tripDay.waypoints.filter((point) => point.type === "via").length, 0)], ["Puertos", calculated.reduce((sum, tripDay) => sum + tripDay.waypoints.filter((point) => point.type === "pass").length, 0)]];
  elements.summaryName.textContent = trip.tripName || "Transpirenaica 2026"; elements.summaryStats.replaceChildren(...summaryItems(stats));
}
function summaryItems(stats) { return stats.map(([label, value]) => { const item = document.createElement("div"); item.className = "summary-item"; const span = document.createElement("span"); span.textContent = label; const strong = document.createElement("strong"); strong.textContent = value; item.append(span, strong); return item; }); }

async function copyRoute(mode) { const allPoints = currentDay().waypoints.filter((point) => point.name.trim()); const points = mode === true ? allPoints.filter((point) => point.type !== "via") : allPoints; if (!points.length) { showNotice("No hay puntos para copiar.", "error"); return; } const title = `DÍA ${trip.activeDay + 1}${currentDay().name ? ` — ${currentDay().name}` : ""}`; const labels = points.map((point) => mode === "technical" && point.type === "via" ? `[VIA ${point.name.trim()}]` : point.name.trim()); const text = mode === false ? labels.join("\n") : `${title}\n\n${labels.join("\n↓\n")}`; try { await navigator.clipboard.writeText(text); showNotice(mode === true ? "Ruta limpia copiada sin puntos de paso." : mode === "technical" ? "Ruta técnica copiada con puntos de paso." : "Lista completa copiada, lista para volver a pegar.", "success"); } catch (error) { console.warn("Clipboard unavailable", error); showNotice("El navegador no permitió copiar. Selecciona la lista manualmente.", "error"); } }
async function handleImport() { try { const imported = await importTripFile(elements.importFile.files[0]); if (!confirm("La importación reemplazará los cinco días guardados. ¿Continuar?")) return; trip = imported; cancelPlacement(); persistNow(); renderTabs(); renderActiveDay(); renderSummary(); showNotice("Viaje importado y validado correctamente.", "success"); } catch (error) { console.error("Import error", error); showNotice(error.message, "error"); } finally { elements.importFile.value = ""; } }
function clearDay() { if (!confirm(`¿Limpiar todos los datos de ${dayTitle(trip.activeDay)}?`)) return; const index = trip.activeDay; trip.days[index] = { label: `Día ${index + 1}`, name: "", waypoints: [], notes: "", fuelStops: "", accommodation: "", route: null, routeDirty: false, updatedAt: null }; cancelPlacement(); clearMap(); persistNow(); renderTabs(); renderActiveDay(); renderSummary(); showNotice(`${dayTitle(index)} se ha limpiado.`, "success"); }
function syncFormToDay() { const day = currentDay(); day.waypoints = reconcileWaypoints(elements.input.value, day.waypoints); day.name = elements.dayName.value; day.notes = elements.notes.value; day.fuelStops = elements.fuel.value; day.accommodation = elements.accommodation.value; }
function clearPointCoordinates(point) { Object.assign(point, { lat: null, lon: null, locationSource: null, resolvedName: "" }); }
function invalidateRoute(day) { markRouteDirty(day); }
function markRouteDirty(day) { day.routeDirty = true; renderResults(day); renderSummary(); renderDirtyState(); refreshMap(); }
function renderDirtyState() { elements.dirty.hidden = !currentDay().routeDirty; }
async function refreshMap(selectedId = selectedWaypointId) { try { await updateMap(currentDay().waypoints, currentDay().route, { selectedId, showViaPoints: elements.showVia.checked, routeDirty: currentDay().routeDirty, onMarkerSelect: handleMarkerSelect, onMarkerDragEnd: handleMarkerDragEnd, onViaMove: startPlacement, onViaDelete: deleteViaPoint }); } catch (error) { console.warn("Map refresh error", error); } }
function handleMarkerSelect(point) { openCoordinateEditors.add(point.id); renderWaypointList(); showNotice(`${point.name} · ${point.lat.toFixed(6)}, ${point.lon.toFixed(6)} · ${point.locationSource === "manual" ? "Manual" : "Automática"}. Puedes corregirlo o arrastrar su marcador.`, "success"); }
async function handleMarkerDragEnd(point, coordinate) { Object.assign(point, coordinate, { locationSource: "manual", manualCoordinates: true, resolvedName: "Ubicación movida manualmente" }); cacheManualCoordinate(point.name, point.lat, point.lon); markRouteDirty(currentDay()); renderWaypointList(); await refreshMap(point.id); persistNow(); showNotice(`${point.name} se ha movido. Recalculando ruta…`, "success"); await handleCalculate(); }

async function resetManualLocation(point) {
  if (isTechnicalWaypoint(point)) return;
  clearManualCoordinate(point.name); clearCachedName(point.name); clearPointCoordinates(point); point.manualCoordinates = false; invalidateRoute(currentDay()); renderWaypointList(); persistNow();
  showNotice(`Se ha eliminado la corrección de ${point.name}. Buscando de nuevo…`, "success"); await handleCalculate();
}

function resetAllManualLocations() {
  if (!confirm("¿Borrar todas las ubicaciones corregidas? Los puntos VIA conservarán sus coordenadas porque no se pueden geocodificar automáticamente.")) return;
  clearAllManualCoordinates();
  for (const day of trip.days) for (const point of day.waypoints) if (!isTechnicalWaypoint(point) && point.locationSource === "manual") { clearPointCoordinates(point); point.manualCoordinates = false; day.routeDirty = true; }
  persistNow(); renderActiveDay(); showNotice("Ubicaciones corregidas borradas. Recalcula para volver a geocodificarlas.", "success");
}
function deleteViaPoint(point) { const points = currentDay().waypoints; const index = points.findIndex((candidate) => candidate.id === point.id); if (index < 0 || !isTechnicalWaypoint(point)) return; if (!confirm(`¿Eliminar el punto de paso ${point.name}?`)) return; points.splice(index, 1); openCoordinateEditors.delete(point.id); elements.input.value = pointsToText(points); markRouteDirty(currentDay()); renderWaypointList(); refreshMap(); queueSave(); showNotice("Punto de paso eliminado. Pulsa CALCULAR RUTA para actualizar.", "success"); }
function startRideMode(options = {}) {
  const day = currentDay(); if (!day.route || day.routeDirty) { showNotice("Calcula una ruta antes de iniciar el modo En ruta.", "error"); return; }
  stopRideServices(); const session = options.session || createRideSession({ tripName: trip.tripName, dayIndex: trip.activeDay, day }); const prepared = prepareRouteProgress(day.route, day.waypoints); const tracker = createProgressTracker(prepared, session.distanceCompleted);
  const gps = createGpsTracker({ onPosition: processRidePosition, onError: (error) => { $("#ride-status").textContent = error.message; showNotice(error.message, "error"); } }); const statuses = createWaypointStatuses(day.waypoints, session.statuses);
  ride = { prepared, tracker, gps, follow: true, lastPosition: session.lastKnownPosition, lastProgress: null, route: day.route, statuses, session, lastNextId: null };
  document.body.classList.add("ride-mode"); $("#ride-panel").hidden = false; $("#ride-recenter").hidden = true; $("#ride-start-gps").hidden = options.startGps !== false; $("#ride-status").textContent = options.startGps === false ? "Sesión recuperada · GPS detenido" : "Esperando GPS…"; activateTab("ride"); renderRecoveredRideState();
  const debug = Boolean(window.APP_CONFIG?.DEBUG_ROUTING || ["localhost", "127.0.0.1"].includes(location.hostname)); $("#ride-simulation").hidden = !debug; $("#ride-debug").hidden = !debug; saveRideSession(session); if (options.startGps !== false) startRideGps();
}
function startRideGps() { if (!ride) return; $("#ride-start-gps").hidden = true; $("#ride-status").textContent = "Esperando GPS…"; ride.gps.start(); requestWakeLock(); }
function stopRideMode() { persistRideProgress(true); stopRideServices(); ride = null; document.body.classList.remove("ride-mode"); $("#ride-panel").hidden = true; clearRideDisplay(); if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); activateTab("map"); }
function stopRideServices() { ride?.gps?.stop(); stopSimulation(); releaseWakeLock(); }
function processRidePosition(position) { if (!ride) return; const progress = ride.tracker.update(position); ride.lastPosition = position; ride.lastProgress = progress; updateWaypointStatuses(progress); updateRiderPosition(position, ride.follow); updateCompletedRoute(ride.prepared, progress); renderRideProgress(position, progress); persistRideProgress(progress.completed); }
function renderRideProgress(position, progress) {
  const points = ride.prepared.waypointProgress; const targets = points.filter((point) => isRideTarget(point) && ride.statuses[point.id] === "pending"); const next = targets[0] || null; const after = targets[1] || null; progress.completed = !next || progress.completed;
  $("#ride-status").textContent = progress.completed ? "Ruta completada" : progress.lowConfidence ? "GPS con baja precisión" : "Siguiendo la ruta planificada";
  $("#ride-next-name").textContent = next?.name || "Ruta completada"; $("#ride-next-distance").textContent = next ? formatDistance(Math.max(0, next.routeDistance - progress.distanceAlong)) : "0 km"; $("#ride-after-name").textContent = after?.name || "—"; $("#ride-after-distance").textContent = after ? formatDistance(Math.max(0, after.routeDistance - progress.distanceAlong)) : "—";
  $("#ride-remaining-distance").textContent = formatDistance(progress.remainingDistance); $("#ride-remaining-time").textContent = formatDuration(ride.route.durationSeconds * progress.remainingDistance / Math.max(1, ride.prepared.totalDistance)); $("#ride-accuracy").textContent = `±${Math.round(position.accuracy)} m`;
  const hasSpeed = Number.isFinite(position.speed) && position.speed >= 0; $("#ride-speed-item").hidden = !hasSpeed; if (hasSpeed) $("#ride-speed").textContent = `${Math.round(position.speed * 3.6)} km/h`; $("#ride-off-route").hidden = !progress.offRoute; $("#ride-off-route-distance").textContent = `${Math.round(progress.distanceToRoute)} m de la ruta`; renderRideWaypointList(progress);
  $("#ride-skip-waypoint").hidden = !next; if (!$("#ride-debug").hidden) $("#ride-debug").textContent = JSON.stringify({ gps: position, statuses: ride.statuses, route: { closestPoint: progress.coordinate, distanceToRoute: Math.round(progress.distanceToRoute), progressPercent: +(progress.progress * 100).toFixed(2), completedMeters: Math.round(progress.distanceAlong), remainingMeters: Math.round(progress.remainingDistance), nextWaypoint: next?.name || null, offRoute: progress.offRoute } }, null, 2);
}
function renderRideWaypointList() { if (!ride) return; const next = nextRideTarget(); $("#ride-waypoint-list").replaceChildren(...ride.prepared.waypointProgress.map((point) => { const row = document.createElement("div"); const status = ride.statuses[point.id]; const current = point.id === next?.id; row.className = `ride-waypoint-item ${status}${current ? " current" : ""}${isTechnicalWaypoint(point) ? " technical" : ""}`; row.textContent = `${status === "completed" ? "✓" : status === "skipped" ? "↷" : current ? "→" : isTechnicalWaypoint(point) ? "🔧" : typeIcon(point.type)} ${point.name}`; if (status === "skipped") { const undo = document.createElement("button"); undo.type = "button"; undo.textContent = "Deshacer"; undo.addEventListener("click", () => undoSkip(point.id)); row.append(undo); } return row; })); }
function typeIcon(type) { return ({ pass: "⛰", fuel: "⛽", stop: "☕", hotel: "🏨", interest: "★", food: "🍴" })[type] || "·"; }
function nextRideTarget() { return ride ? nextMeaningfulWaypoint(ride.prepared.waypointProgress, ride.statuses) : null; }
function updateWaypointStatuses(progress) { advanceWaypointStatuses(ride.prepared.waypointProgress, ride.statuses, progress.distanceAlong, Math.max(150, (ride.lastPosition?.accuracy || 0) * 2)); }
function skipNextWaypoint() { const point = nextRideTarget(); if (!point || !confirm(`¿Saltar ${point.name}?\n\nEl punto permanecerá en la ruta original.`)) return; skipWaypoint(ride.statuses, point.id); renderRecoveredRideState(); persistRideProgress(true); showNotice(`${point.name} marcado como saltado. La geometría original no ha cambiado.`, "success"); }
function undoSkip(id) { if (!ride || ride.statuses[id] !== "skipped") return; undoSkippedWaypoint(ride.statuses, id); renderRecoveredRideState(); persistRideProgress(true); }
function renderRecoveredRideState() { if (!ride) return; const distance = ride.lastProgress?.distanceAlong ?? ride.session.distanceCompleted ?? 0; const progress = { distanceAlong: distance, remainingDistance: Math.max(0, ride.prepared.totalDistance - distance), completed: !nextRideTarget(), lowConfidence: false, offRoute: false, distanceToRoute: 0, coordinate: null, progress: ride.prepared.totalDistance ? distance / ride.prepared.totalDistance : 0 }; const position = ride.lastPosition || { accuracy: 0, speed: null }; renderRideProgress(position, progress); updateCompletedRoute(ride.prepared, { ...progress, segmentIndex: segmentIndexForDistance(ride.prepared, progress.distanceAlong) }); if (ride.lastPosition) updateRiderPosition(ride.lastPosition, false); }
function segmentIndexForDistance(prepared, distance) { const index = prepared.cumulative.findIndex((value) => value >= distance); return Math.max(0, index - 1); }
function persistRideProgress(force = false) { if (!ride) return; const distance = ride.lastProgress?.distanceAlong ?? ride.session.distanceCompleted ?? 0; const nextId = nextRideTarget()?.id || null; const now = Date.now(); if (!force && now - lastSessionSaveAt < 10000 && Math.abs(distance - lastSavedProgress) < 500 && nextId === ride.lastNextId) return; const completed = !nextId; ride.session = updateRideSession(ride.session, { progress: distance, statuses: ride.statuses, lastKnownPosition: ride.lastPosition, completed }); saveRideSession(ride.session); lastSessionSaveAt = now; lastSavedProgress = distance; ride.lastNextId = nextId; if (completed) discardRideSession(); }

function showRideRecoveryIfAvailable() { recoveredSession = loadRideSession(); if (!recoveredSession) return; try { const prepared = prepareRouteProgress(recoveredSession.day.route, recoveredSession.day.waypoints); const next = prepared.waypointProgress.find((point) => isRideTarget(point) && (recoveredSession.statuses[point.id] || "pending") === "pending"); $("#recovery-route-name").textContent = recoveredSession.routeName; $("#recovery-next-waypoint").textContent = next?.name || "Ruta completada"; $("#recovery-remaining").textContent = formatDistance(Math.max(0, prepared.totalDistance - recoveredSession.distanceCompleted)); $("#recovery-updated-at").textContent = `Última actividad: ${new Date(recoveredSession.updatedAt).toLocaleString("es-ES")}`; $("#ride-recovery-dialog").showModal(); } catch (error) { console.warn("No se pudo preparar la sesión recuperada", error); discardRideSession(); recoveredSession = null; } }
function continueRecoveredSession() { if (!recoveredSession) return; $("#ride-recovery-dialog").close(); trip.days[recoveredSession.dayIndex] = recoveredSession.day; trip.activeDay = recoveredSession.dayIndex; saveTrip(trip); renderTabs(); renderActiveDay(); const session = recoveredSession; recoveredSession = null; startRideMode({ session, startGps: false }); }
function discardRecoveredSession() { discardRideSession(); recoveredSession = null; $("#ride-recovery-dialog").close(); showNotice("Sesión En ruta descartada. La ruta y las ubicaciones guardadas no se han eliminado.", "success"); }
function pauseRideFollow() { if (!ride?.follow) return; ride.follow = false; $("#ride-recenter").hidden = false; }
function resumeRideFollow() { if (!ride?.lastPosition) return; ride.follow = true; $("#ride-recenter").hidden = true; updateRiderPosition(ride.lastPosition, true); }
async function requestWakeLock() { if (!ride || !navigator.wakeLock || wakeLock) return; try { wakeLock = await navigator.wakeLock.request("screen"); $("#ride-wake-lock").textContent = "PANTALLA ACTIVA"; wakeLock.addEventListener("release", () => { wakeLock = null; $("#ride-wake-lock").textContent = "MANTENER PANTALLA ACTIVA"; }); } catch (error) { console.warn("Wake lock unavailable", error); } }
function releaseWakeLock() { const lock = wakeLock; wakeLock = null; lock?.release().catch(() => {}); }
function toggleWakeLock() { wakeLock ? releaseWakeLock() : requestWakeLock(); }
async function toggleFullscreen() { try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); } catch { showNotice("El navegador no permitió activar la pantalla completa.", "error"); } }
function toggleSimulation() { if (!ride) return; if (simulationTimer) { stopSimulation(); return; } ride.gps.stop(); $("#simulation-toggle").textContent = "PAUSAR"; simulationTimer = setInterval(stepSimulation, 500); }
function stopSimulation() { if (simulationTimer) clearInterval(simulationTimer); simulationTimer = null; const button = $("#simulation-toggle"); if (button) button.textContent = "INICIAR"; }
function resetSimulation() { stopSimulation(); simulationDistance = 0; simulationOffset = false; if (ride) { ride.tracker.reset(); ride.statuses = createWaypointStatuses(ride.prepared.waypointProgress); ride.lastProgress = null; ride.session.distanceCompleted = 0; simulateAtDistance(0); persistRideProgress(true); } }
function stepSimulation() { if (!ride) return; const multiplier = Number($("#simulation-speed").value) || 1; simulationDistance = Math.min(ride.prepared.totalDistance, simulationDistance + 10 * multiplier); simulateAtDistance(simulationDistance); if (simulationDistance >= ride.prepared.totalDistance) stopSimulation(); }
function simulateAtDistance(target) { const data = ride.prepared; let index = data.cumulative.findIndex((value) => value >= target); if (index < 1) index = 1; const startDistance = data.cumulative[index - 1]; const span = Math.max(1, data.cumulative[index] - startDistance); const ratio = Math.max(0, Math.min(1, (target - startDistance) / span)); const a = data.coordinates[index - 1]; const b = data.coordinates[index]; const offset = simulationOffset ? .004 : 0; processRidePosition({ latitude: a[1] + (b[1] - a[1]) * ratio + offset, longitude: a[0] + (b[0] - a[0]) * ratio, accuracy: 8, speed: 20, heading: null, timestamp: Date.now() }); }

function currentDay() { return trip.days[trip.activeDay]; }
function dayTitle(index) { return trip.days[index].name.trim() ? `Día ${index + 1} — ${trip.days[index].name.trim()}` : `Día ${index + 1}`; }
function formatDistance(meters) { return `${(meters / 1000).toLocaleString("es-ES", { minimumFractionDigits: meters ? 1 : 0, maximumFractionDigits: 1 })} km`; }
function formatDuration(seconds) { const minutes = Math.round(seconds / 60); const hours = Math.floor(minutes / 60); const rest = minutes % 60; return hours ? `${hours} h ${rest} min` : `${rest} min`; }
function setLoading(active, text = "Calculando ruta...") { elements.loading.hidden = !active; elements.loadingText.textContent = text; for (const button of [elements.calculate, elements.calculateEditor]) { button.disabled = active; button.textContent = active ? "CALCULANDO RUTA..." : "CALCULAR RUTA"; } }
function queueSave() { elements.saveStatus.textContent = "Guardando..."; clearTimeout(saveTimer); saveTimer = setTimeout(persistNow, 350); }
function persistNow() { currentDay().updatedAt = new Date().toISOString(); saveTrip(trip); elements.saveStatus.textContent = "Guardado local"; }
function hideNotice() { elements.notice.hidden = true; elements.notice.replaceChildren(); }
function showNotice(message, type = "") { elements.notice.className = `notice ${type}`.trim(); elements.notice.textContent = message; elements.notice.hidden = false; }
