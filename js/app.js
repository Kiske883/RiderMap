import { createViaPoint, createWaypoint, pointsToText, reconcileWaypoints, validateRoute, WAYPOINT_TYPES } from "./parser.js";
import { cacheManualCoordinate, clearCachedName, resolveWaypoints, validCoordinates } from "./geocoding.js";
import { calculateRoute, getRoutingConfiguration } from "./routing.js";
import { beginCoordinatePlacement, cancelCoordinatePlacement, clearMap, initializeMap, updateMap } from "./map.js";
import { exportTrip, importTripFile, loadTrip, saveTrip } from "./storage.js";

const EXAMPLE_POINTS = ["Hondarribia", "Santuario de Guadalupe", "Jaizkibel", "Lezo", "Etxalar", "Col de Lizarrieta", "Sare", "Ainhoa", "Dantxarinea", "Puerto de Otxondo", "Erratzu", "Col d'Izpegi", "Saint-Étienne-de-Baïgorry", "Saint-Jean-Pied-de-Port", "Mendive", "Col de Burdincurutcheta", "Chalets d'Iraty", "Col de Bagargui", "Col d'Orgambidesca", "Larrau"];
const $ = (selector) => document.querySelector(selector);
const elements = { tabs: $("#day-tabs"), notice: $("#notice"), tripName: $("#trip-name"), heading: $("#active-day-heading"), dayName: $("#day-name"), input: $("#route-input"), list: $("#waypoint-list"), notes: $("#notes"), fuel: $("#fuel-stops"), accommodation: $("#accommodation"), calculate: $("#calculate-route"), loading: $("#loading"), loadingText: $("#loading-text"), saveStatus: $("#save-status"), results: $("#route-results"), segments: $("#segment-body"), importFile: $("#import-file"), summaryName: $("#summary-name"), summaryStats: $("#summary-stats"), coordinateHelp: $("#map-coordinate-help"), mapActionMessage: $("#map-action-message") };
let trip = loadTrip();
let saveTimer;
const openCoordinateEditors = new Set();
let selectedWaypointId = null;

start();

function start() {
  bindEvents(); renderTabs(); renderActiveDay(); renderSummary();
  initializeMap().then(() => refreshMap()).catch((error) => showNotice(error.message, "error"));
  try { getRoutingConfiguration(); } catch (error) { showNotice(error.message, "error"); }
}

function bindEvents() {
  elements.tabs.addEventListener("click", (event) => { const button = event.target.closest("[data-day]"); if (!button) return; syncFormToDay(); trip.activeDay = Number(button.dataset.day); cancelPlacement(); persistNow(); renderTabs(); renderActiveDay(); });
  elements.input.addEventListener("input", () => { const day = currentDay(); day.waypoints = reconcileWaypoints(elements.input.value, day.waypoints); invalidateRoute(day); renderWaypointList(); queueSave(); });
  elements.list.addEventListener("input", handleWaypointEdit); elements.list.addEventListener("change", handleWaypointEdit); elements.list.addEventListener("click", handleWaypointAction);
  elements.tripName.addEventListener("input", () => { trip.tripName = elements.tripName.value; renderSummary(); queueSave(); });
  for (const [element, key] of [[elements.dayName, "name"], [elements.notes, "notes"], [elements.fuel, "fuelStops"], [elements.accommodation, "accommodation"]]) element.addEventListener("input", () => { currentDay()[key] = element.value; if (key === "name") renderTabs(); queueSave(); });
  $("#add-waypoint").addEventListener("click", addWaypoint); $("#load-example").addEventListener("click", loadExample);
  $("#save-day").addEventListener("click", () => { syncFormToDay(); persistNow(); showNotice(`${dayTitle(trip.activeDay)} guardado en este navegador.`, "success"); });
  $("#clear-day").addEventListener("click", clearDay); elements.calculate.addEventListener("click", handleCalculate);
  $("#copy-pretty").addEventListener("click", () => copyRoute(true)); $("#copy-technical").addEventListener("click", () => copyRoute("technical")); $("#copy-plain").addEventListener("click", () => copyRoute(false));
  $("#export-trip").addEventListener("click", () => { syncFormToDay(); persistNow(); exportTrip(trip); showNotice("Copia JSON exportada.", "success"); });
  $("#import-trip").addEventListener("click", () => elements.importFile.click()); elements.importFile.addEventListener("change", handleImport);
  $("#cancel-map-selection").addEventListener("click", cancelPlacement);
}

function renderTabs() {
  elements.tabs.replaceChildren(...trip.days.map((day, index) => { const button = document.createElement("button"); button.type = "button"; button.className = `day-tab${index === trip.activeDay ? " active" : ""}`; button.dataset.day = index; button.textContent = day.name.trim() ? `Día ${index + 1} · ${day.name.trim()}` : `Día ${index + 1}`; button.setAttribute("aria-current", index === trip.activeDay ? "page" : "false"); return button; }));
}

function renderActiveDay() {
  const day = currentDay(); elements.tripName.value = trip.tripName; elements.heading.textContent = dayTitle(trip.activeDay); elements.dayName.value = day.name; elements.input.value = pointsToText(day.waypoints); elements.notes.value = day.notes; elements.fuel.value = day.fuelStops; elements.accommodation.value = day.accommodation;
  renderWaypointList(); renderResults(day); refreshMap();
}

function renderWaypointList() {
  const waypoints = currentDay().waypoints;
  if (!waypoints.length) { const empty = document.createElement("div"); empty.className = "waypoint-empty"; empty.textContent = "Pega una lista arriba o añade el primer punto."; elements.list.replaceChildren(empty); return; }
  const normalNumbers = new Map(); let normalNumber = 0; const children = [];
  waypoints.forEach((point) => { if (point.type !== "via") normalNumber += 1; normalNumbers.set(point.id, point.type === "via" ? "↳" : normalNumber); });
  waypoints.forEach((point, index) => {
    const row = document.createElement("div"); row.className = "waypoint-row"; row.dataset.index = index; row.dataset.id = point.id;
    if (point.type === "via") row.classList.add("via-row");
    const number = document.createElement("span"); number.className = "waypoint-number"; number.textContent = normalNumbers.get(point.id);
    const input = document.createElement("input"); input.className = "waypoint-name"; input.value = point.name; input.setAttribute("aria-label", `Punto ${index + 1}`);
    const select = document.createElement("select"); select.className = "type-select"; select.setAttribute("aria-label", `Tipo del punto ${index + 1}`); WAYPOINT_TYPES.forEach((type) => select.add(new Option(type.label, type.value, false, point.type === type.value)));
    const actions = document.createElement("div"); actions.className = "row-actions"; actions.append(actionButton("↑", "up", "Subir", index === 0), actionButton("↓", "down", "Bajar", index === waypoints.length - 1), actionButton("⌖", "correct", "Corregir ubicación"), actionButton("×", "delete", "Eliminar"));
    row.append(number, input, select, actions, createCoordinateEditor(point, index)); children.push(row);
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
  const status = document.createElement("span"); status.className = `coordinate-status${validCoordinates(point.lat, point.lon) ? " resolved" : ""}`; status.textContent = coordinateStatus(point);
  editor.append(lat, lon, mapButton, status); return editor;
}

function coordinateStatus(point) { if (!validCoordinates(point.lat, point.lon)) return "Sin resolver: se buscará por nombre al calcular."; if (point.locationSource === "manual") return "Ubicación manual (tiene prioridad)."; return point.resolvedName ? `Resultado: ${point.resolvedName}` : "Ubicación resuelta y guardada."; }
function actionButton(text, action, label, disabled = false) { const button = document.createElement("button"); button.type = "button"; button.className = `icon-button${action === "delete" ? " delete" : ""}`; button.dataset.action = action; button.textContent = text; button.title = label; button.setAttribute("aria-label", label); button.disabled = disabled; return button; }

function handleWaypointEdit(event) {
  const row = event.target.closest(".waypoint-row"); if (!row) return; const point = currentDay().waypoints[Number(row.dataset.index)]; if (!point) return;
  if (event.target.matches(".waypoint-name")) { const previousName = point.name; point.name = event.target.value; if (point.locationSource !== "manual" && previousName !== point.name) { clearCachedName(previousName); clearPointCoordinates(point); } elements.input.value = pointsToText(currentDay().waypoints); invalidateRoute(currentDay()); }
  if (event.target.matches(".type-select") && point.type !== event.target.value) { point.type = event.target.value; point.manualCoordinates = point.type === "via" || point.manualCoordinates === true; invalidateRoute(currentDay()); renderWaypointList(); }
  if (event.target.matches(".latitude,.longitude")) applyCoordinateInputs(row, point);
  queueSave(); renderSummary();
}

function applyCoordinateInputs(row, point) {
  const lat = Number(row.querySelector(".latitude").value); const lon = Number(row.querySelector(".longitude").value);
  if (!validCoordinates(lat, lon)) return;
  Object.assign(point, { lat, lon, locationSource: "manual", manualCoordinates: true, resolvedName: "Ubicación corregida manualmente" }); cacheManualCoordinate(point.name, lat, lon); row.querySelector(".coordinate-status").className = "coordinate-status resolved"; row.querySelector(".coordinate-status").textContent = coordinateStatus(point); invalidateRoute(currentDay()); refreshMap(point.id);
}

function handleWaypointAction(event) {
  const button = event.target.closest("[data-action]"); if (!button) return;
  if (button.dataset.action === "add-via") { startViaPlacement(Number(button.dataset.segmentIndex)); return; }
  const row = button.closest(".waypoint-row"); if (!row) return; const index = Number(row.dataset.index); const points = currentDay().waypoints; const point = points[index];
  if (button.dataset.action === "correct") { openCoordinateEditors.has(point.id) ? openCoordinateEditors.delete(point.id) : openCoordinateEditors.add(point.id); renderWaypointList(); return; }
  if (button.dataset.action === "pick-map") { startPlacement(point); return; }
  if (button.dataset.action === "delete") points.splice(index, 1);
  if (button.dataset.action === "up" && index > 0) [points[index - 1], points[index]] = [points[index], points[index - 1]];
  if (button.dataset.action === "down" && index < points.length - 1) [points[index + 1], points[index]] = [points[index], points[index + 1]];
  invalidateRoute(currentDay()); elements.input.value = pointsToText(points); renderWaypointList(); queueSave(); refreshMap();
}

function startPlacement(point) {
  selectedWaypointId = point.id; elements.mapActionMessage.textContent = `Haz clic en el mapa para asignar la ubicación a ${point.name}.`; elements.coordinateHelp.hidden = false; refreshMap(point.id);
  beginCoordinatePlacement((coordinate) => { Object.assign(point, coordinate, { locationSource: "manual", manualCoordinates: true, resolvedName: "Ubicación elegida en el mapa" }); cacheManualCoordinate(point.name, point.lat, point.lon); invalidateRoute(currentDay()); cancelPlacement(); renderWaypointList(); refreshMap(); queueSave(); showNotice(`Ubicación manual guardada para ${point.name}.`, "success"); });
}

function startViaPlacement(segmentIndex) {
  const points = currentDay().waypoints; const from = points[segmentIndex]; const to = points[segmentIndex + 1]; if (!from || !to) return;
  selectedWaypointId = null; elements.mapActionMessage.textContent = `Haz clic en la carretera deseada para añadir un punto de paso entre ${from.name} → ${to.name}.`; elements.coordinateHelp.hidden = false;
  beginCoordinatePlacement((coordinate) => {
    const currentPoints = currentDay().waypoints; const currentIndex = currentPoints.findIndex((point) => point.id === from.id);
    if (currentIndex < 0 || currentPoints[currentIndex + 1]?.id !== to.id) { cancelPlacement(); showNotice("El segmento ha cambiado. Selecciónalo de nuevo antes de añadir el punto de paso.", "error"); return; }
    const confirmation = `Añadir punto de paso entre:\n${from.name} → ${to.name}\n\nCoordenadas: ${coordinate.lat.toFixed(6)}, ${coordinate.lon.toFixed(6)}`;
    if (!confirm(confirmation)) return;
    const enteredName = prompt("Nombre técnico del punto de paso (carretera, cruce, puente...):", "Punto de paso");
    const via = createViaPoint(enteredName?.trim() || "Punto de paso", coordinate.lat, coordinate.lon); currentPoints.splice(currentIndex + 1, 0, via); cacheManualCoordinate(via.name, via.lat, via.lon);
    invalidateRoute(currentDay()); cancelPlacement(); elements.input.value = pointsToText(currentPoints); openCoordinateEditors.add(via.id); renderWaypointList(); refreshMap(via.id); queueSave(); showNotice(`Punto de paso añadido entre ${from.name} y ${to.name}. Recalcula la ruta para forzar ese paso.`, "success");
  });
}

function cancelPlacement() { selectedWaypointId = null; elements.coordinateHelp.hidden = true; cancelCoordinatePlacement(); refreshMap(); }
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
    currentDay().route = route; persistNow(); renderResults(currentDay()); renderSummary(); await refreshMap(); showNotice("Ruta calculada sin reordenar ningún punto.", "success");
  } catch (error) { console.error("Route calculation error", error); currentDay().route = null; persistNow(); renderWaypointList(); refreshMap(); const message = error.routingFailure ? `No se han podido conectar los puntos por carretera. ${error.message}` : error.message; showNotice(message, "error"); }
  finally { setLoading(false); }
}

function renderResults(day) {
  if (!day.route) { elements.results.hidden = true; return; } elements.results.hidden = false;
  const normalPoints = day.waypoints.filter((point) => point.type !== "via"); const viaPoints = day.waypoints.filter((point) => point.type === "via");
  $("#stat-distance").textContent = formatDistance(day.route.distanceMeters); $("#stat-duration").textContent = formatDuration(day.route.durationSeconds); $("#stat-points").textContent = `${normalPoints.length} waypoints`; $("#stat-waypoints").textContent = `${viaPoints.length} puntos de paso`; $("#stat-origin").textContent = normalPoints[0]?.name || "—"; $("#stat-destination").textContent = normalPoints.at(-1)?.name || "—";
  const rows = day.route.legs.map((leg, index) => createSegmentRow(leg, index)); if (day.waypoints.length) rows.push(createSegmentRow({ from: day.waypoints.at(-1).name, to: "—" }, day.waypoints.length - 1, true)); elements.segments.replaceChildren(...rows);
}

function createSegmentRow(segment, index, final = false) { const row = document.createElement("tr"); [index + 1, segment.from, segment.to, final ? "—" : formatDistance(segment.distanceMeters), final ? "—" : formatDuration(segment.durationSeconds)].forEach((value) => { const cell = document.createElement("td"); cell.textContent = value; row.append(cell); }); return row; }
function renderSummary() { const calculated = trip.days.filter((day) => day.route); const stats = [["Días configurados", calculated.length], ["Kilómetros calculados", formatDistance(calculated.reduce((sum, day) => sum + day.route.distanceMeters, 0))], ["Conducción estimada", formatDuration(calculated.reduce((sum, day) => sum + day.route.durationSeconds, 0))], ["Waypoints", calculated.reduce((sum, day) => sum + day.waypoints.filter((point) => point.type !== "via").length, 0)], ["Puntos de paso", calculated.reduce((sum, day) => sum + day.waypoints.filter((point) => point.type === "via").length, 0)], ["Pasos marcados", calculated.reduce((sum, day) => sum + day.waypoints.filter((point) => point.type === "pass").length, 0)]]; elements.summaryName.textContent = trip.tripName || "Transpirenaica 2026"; elements.summaryStats.replaceChildren(...stats.map(([label, value]) => { const item = document.createElement("div"); item.className = "summary-item"; const span = document.createElement("span"); span.textContent = label; const strong = document.createElement("strong"); strong.textContent = value; item.append(span, strong); return item; })); }

async function copyRoute(mode) { const allPoints = currentDay().waypoints.filter((point) => point.name.trim()); const points = mode === true ? allPoints.filter((point) => point.type !== "via") : allPoints; if (!points.length) { showNotice("No hay puntos para copiar.", "error"); return; } const title = `DÍA ${trip.activeDay + 1}${currentDay().name ? ` — ${currentDay().name}` : ""}`; const labels = points.map((point) => mode === "technical" && point.type === "via" ? `[VIA ${point.name.trim()}]` : point.name.trim()); const text = mode === false ? labels.join("\n") : `${title}\n\n${labels.join("\n↓\n")}`; try { await navigator.clipboard.writeText(text); showNotice(mode === true ? "Ruta limpia copiada sin puntos de paso." : mode === "technical" ? "Ruta técnica copiada con puntos de paso." : "Lista completa copiada, lista para volver a pegar.", "success"); } catch (error) { console.warn("Clipboard unavailable", error); showNotice("El navegador no permitió copiar. Selecciona la lista manualmente.", "error"); } }
async function handleImport() { try { const imported = await importTripFile(elements.importFile.files[0]); if (!confirm("La importación reemplazará los cinco días guardados. ¿Continuar?")) return; trip = imported; cancelPlacement(); persistNow(); renderTabs(); renderActiveDay(); renderSummary(); showNotice("Viaje importado y validado correctamente.", "success"); } catch (error) { console.error("Import error", error); showNotice(error.message, "error"); } finally { elements.importFile.value = ""; } }
function clearDay() { if (!confirm(`¿Limpiar todos los datos de ${dayTitle(trip.activeDay)}?`)) return; const index = trip.activeDay; trip.days[index] = { label: `Día ${index + 1}`, name: "", waypoints: [], notes: "", fuelStops: "", accommodation: "", route: null, updatedAt: null }; cancelPlacement(); clearMap(); persistNow(); renderTabs(); renderActiveDay(); renderSummary(); showNotice(`${dayTitle(index)} se ha limpiado.`, "success"); }
function syncFormToDay() { const day = currentDay(); day.waypoints = reconcileWaypoints(elements.input.value, day.waypoints); day.name = elements.dayName.value; day.notes = elements.notes.value; day.fuelStops = elements.fuel.value; day.accommodation = elements.accommodation.value; }
function clearPointCoordinates(point) { Object.assign(point, { lat: null, lon: null, locationSource: null, resolvedName: "" }); }
function invalidateRoute(day) { day.route = null; renderResults(day); renderSummary(); refreshMap(); }
async function refreshMap(selectedId = selectedWaypointId) { try { await updateMap(currentDay().waypoints, currentDay().route, selectedId, handleMarkerSelect); } catch (error) { console.warn("Map refresh error", error); } }
function handleMarkerSelect(point) { if (point.type !== "via") return; openCoordinateEditors.add(point.id); renderWaypointList(); showNotice(`Punto de paso: ${point.name} · ${point.lat.toFixed(6)}, ${point.lon.toFixed(6)}. Puedes renombrarlo, moverlo o eliminarlo en el editor.`, "success"); document.querySelector(`[data-id="${CSS.escape(point.id)}"]`)?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }
function currentDay() { return trip.days[trip.activeDay]; }
function dayTitle(index) { return trip.days[index].name.trim() ? `Día ${index + 1} — ${trip.days[index].name.trim()}` : `Día ${index + 1}`; }
function formatDistance(meters) { return `${(meters / 1000).toLocaleString("es-ES", { minimumFractionDigits: meters ? 1 : 0, maximumFractionDigits: 1 })} km`; }
function formatDuration(seconds) { const minutes = Math.round(seconds / 60); const hours = Math.floor(minutes / 60); const rest = minutes % 60; return hours ? `${hours} h ${rest} min` : `${rest} min`; }
function setLoading(active, text = "Calculando ruta...") { elements.loading.hidden = !active; elements.loadingText.textContent = text; elements.calculate.disabled = active; elements.calculate.textContent = active ? "CALCULANDO..." : "CALCULAR RUTA"; }
function queueSave() { elements.saveStatus.textContent = "Guardando..."; clearTimeout(saveTimer); saveTimer = setTimeout(persistNow, 350); }
function persistNow() { currentDay().updatedAt = new Date().toISOString(); saveTrip(trip); elements.saveStatus.textContent = "Guardado local"; }
function hideNotice() { elements.notice.hidden = true; elements.notice.replaceChildren(); }
function showNotice(message, type = "") { elements.notice.className = `notice ${type}`.trim(); elements.notice.textContent = message; elements.notice.hidden = false; }
