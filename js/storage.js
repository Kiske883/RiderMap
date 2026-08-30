const STORAGE_KEY = "transpirenaica-route-builder-v1";
const DAY_COUNT = 5;

export function createEmptyDay(index) {
  return {
    label: `Día ${index + 1}`,
    name: "",
    waypoints: [],
    notes: "",
    fuelStops: "",
    accommodation: "",
    route: null,
    updatedAt: null
  };
}

export function createDefaultTrip() {
  return { version: 1, tripName: "Transpirenaica 2026", activeDay: 0, days: Array.from({ length: DAY_COUNT }, (_, i) => createEmptyDay(i)) };
}

export function loadTrip() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultTrip();
    return normalizeTrip(JSON.parse(raw));
  } catch (error) {
    console.warn("No se pudieron cargar los datos locales.", error);
    return createDefaultTrip();
  }
}

export function saveTrip(trip) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...trip, version: 1 }));
}

export function exportTrip(trip) {
  const payload = JSON.stringify({ ...trip, version: 1, exportedAt: new Date().toISOString() }, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${slugify(trip.tripName) || "transpirenaica"}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export async function importTripFile(file) {
  if (!file) throw new Error("No se ha seleccionado ningún archivo.");
  if (file.size > 2_000_000) throw new Error("El archivo es demasiado grande para ser una copia válida.");
  let parsed;
  try { parsed = JSON.parse(await file.text()); }
  catch { throw new Error("El archivo no contiene JSON válido."); }
  return normalizeTrip(parsed, true);
}

function normalizeTrip(value, strict = false) {
  if (!value || typeof value !== "object" || value.version !== 1 || !Array.isArray(value.days)) {
    throw new Error("La copia no tiene un formato de viaje compatible (versión 1).");
  }
  if (strict && value.days.length !== DAY_COUNT) throw new Error("La copia debe contener exactamente cinco días.");
  const days = Array.from({ length: DAY_COUNT }, (_, index) => normalizeDay(value.days[index], index));
  return {
    version: 1,
    tripName: safeString(value.tripName).slice(0, 80) || "Transpirenaica 2026",
    activeDay: Number.isInteger(value.activeDay) && value.activeDay >= 0 && value.activeDay < DAY_COUNT ? value.activeDay : 0,
    days
  };
}

function normalizeDay(day, index) {
  const base = createEmptyDay(index);
  if (!day || typeof day !== "object") return base;
  const waypoints = Array.isArray(day.waypoints) ? day.waypoints.slice(0, 200).map((point, pointIndex) => {
    if (!point || typeof point !== "object" || !safeString(point.name).trim()) return null;
    const lat = validCoordinate(point.lat, -90, 90) ? Number(point.lat) : null;
    const lon = validCoordinate(point.lon, -180, 180) ? Number(point.lon) : null;
    const type = ["pass", "stop", "fuel", "food", "lodging", "via"].includes(point.type) ? point.type : "pass";
    return { id: safeString(point.id) || `import-${index}-${pointIndex}`, name: safeString(point.name).trim().slice(0, 300), type, lat, lon, locationSource: ["manual", "geocoded", "cache"].includes(point.locationSource) ? point.locationSource : null, manualCoordinates: type === "via" || point.manualCoordinates === true, resolvedName: safeString(point.resolvedName).slice(0, 500) };
  }).filter(Boolean) : [];
  return {
    ...base,
    name: safeString(day.name).slice(0, 100), waypoints,
    notes: safeString(day.notes).slice(0, 5000), fuelStops: safeString(day.fuelStops).slice(0, 1000), accommodation: safeString(day.accommodation).slice(0, 1000),
    route: normalizeRoute(day.route, waypoints.length), updatedAt: safeString(day.updatedAt) || null
  };
}

function normalizeRoute(route, pointCount) {
  if (!route || typeof route !== "object" || !Number.isFinite(route.distanceMeters) || !Number.isFinite(route.durationSeconds) || !Array.isArray(route.legs) || route.geometry?.type !== "LineString" || !Array.isArray(route.geometry.coordinates)) return null;
  if (route.pointCount !== pointCount) return null;
  const coordinates = route.geometry.coordinates.filter((pair) => Array.isArray(pair) && validCoordinate(pair[0], -180, 180) && validCoordinate(pair[1], -90, 90)).map((pair) => [Number(pair[0]), Number(pair[1])]);
  if (coordinates.length < 2) return null;
  return { provider: safeString(route.provider), distanceMeters: route.distanceMeters, durationSeconds: route.durationSeconds, pointCount, calculatedAt: safeString(route.calculatedAt), geometry: { type: "LineString", coordinates }, legs: route.legs.map((s) => ({ from: safeString(s.from), to: safeString(s.to), distanceMeters: Number(s.distanceMeters) || 0, durationSeconds: Number(s.durationSeconds) || 0 })) };
}

function safeString(value) { return typeof value === "string" ? value : ""; }
function validCoordinate(value, minimum, maximum) { return value !== null && value !== "" && Number.isFinite(Number(value)) && Number(value) >= minimum && Number(value) <= maximum; }
function slugify(value) { return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""); }
