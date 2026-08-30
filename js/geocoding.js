const CACHE_KEY = "transpirenaica-geocoding-cache-v1";
const MANUAL_CACHE_KEY = "ridermap-manual-locations-v1";
const REQUEST_INTERVAL_MS = 1100;
let lastRequestAt = 0;

export async function resolveWaypoints(waypoints, onProgress = () => {}) {
  const cache = loadCache();
  const manualCache = loadManualCache();
  const resolved = [];
  const unresolved = [];
  for (let index = 0; index < waypoints.length; index += 1) {
    const point = waypoints[index]; onProgress(index + 1, waypoints.length, point.name);
    const key = normalizeKey(point.name);
    const manual = manualCache[key];
    if (manual && validCoordinates(manual.lat, manual.lon)) {
      Object.assign(point, { lat: Number(manual.lat), lon: Number(manual.lon), locationSource: "manual", manualCoordinates: true, resolvedName: "Ubicación corregida manualmente" });
      resolved.push({ ...point }); continue;
    }
    if (validCoordinates(point.lat, point.lon)) { resolved.push({ ...point }); continue; }
    if (isTechnicalWaypoint(point)) { unresolved.push(`${point.name} (punto técnico sin coordenadas)`); continue; }
    if (cache[key] && validCoordinates(cache[key].lat, cache[key].lon)) {
      Object.assign(point, { lat: cache[key].lat, lon: cache[key].lon, locationSource: "cache", resolvedName: cache[key].displayName || point.name });
      resolved.push({ ...point }); continue;
    }
    try {
      const result = await searchNominatim(point.name);
      if (!result) { unresolved.push(point.name); continue; }
      Object.assign(point, { lat: Number(result.lat), lon: Number(result.lon), locationSource: "geocoded", resolvedName: result.display_name });
      cache[key] = { lat: point.lat, lon: point.lon, displayName: result.display_name, savedAt: new Date().toISOString() };
      saveCache(cache); resolved.push({ ...point });
    } catch (error) {
      if (error.status === 429) throw new Error("El geocodificador gratuito ha alcanzado su límite temporal. Espera un poco y vuelve a intentarlo; las ubicaciones ya resueltas están en caché.");
      throw error;
    }
  }
  if (unresolved.length) throw new Error(`No se pudieron localizar estos puntos: ${unresolved.join(", ")}. Usa “Corregir ubicación” para indicar sus coordenadas.`);
  return resolved;
}

export function cacheManualCoordinate(name, lat, lon) {
  if (!validCoordinates(lat, lon)) throw new Error("La latitud debe estar entre -90 y 90 y la longitud entre -180 y 180.");
  const cache = loadManualCache();
  cache[normalizeKey(name)] = { name: String(name).trim(), lat: Number(lat), lon: Number(lon), savedAt: new Date().toISOString() };
  saveManualCache(cache);
}

export function clearManualCoordinate(name) { const cache = loadManualCache(); delete cache[normalizeKey(name)]; saveManualCache(cache); }
export function clearAllManualCoordinates() {
  try {
    localStorage.removeItem(MANUAL_CACHE_KEY);
    const cache = loadCache(); for (const [key, value] of Object.entries(cache)) if (value?.manual === true) delete cache[key]; saveCache(cache);
  } catch (error) { console.warn("No se pudieron borrar las ubicaciones manuales", error); }
}
export function getManualCoordinates() { return Object.values(loadManualCache()).filter((point) => validCoordinates(point.lat, point.lon)); }

export function clearCachedName(name) {
  const cache = loadCache(); delete cache[normalizeKey(name)]; saveCache(cache);
}

export function validCoordinates(lat, lon) {
  if (lat === null || lat === "" || lon === null || lon === "") return false;
  return Number.isFinite(Number(lat)) && Number(lat) >= -90 && Number(lat) <= 90 && Number.isFinite(Number(lon)) && Number(lon) >= -180 && Number(lon) <= 180;
}

async function searchNominatim(query) {
  const attempts = [String(query).trim()];
  const normalized = attempts[0].normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (normalized && normalized !== attempts[0]) attempts.push(normalized);
  for (const attempt of attempts) { const result = await requestNominatim(attempt); if (result) return result; }
  return null;
}

async function requestNominatim(query) {
  const wait = Math.max(0, REQUEST_INTERVAL_MS - (Date.now() - lastRequestAt));
  if (wait) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt = Date.now();
  const params = new URLSearchParams({ q: query, format: "jsonv2", limit: "1", "accept-language": "es" });
  let response;
  try { response = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { Accept: "application/json" } }); }
  catch (error) { console.error("Nominatim network error", error); throw new Error("No se pudo conectar con el geocodificador gratuito. Revisa tu conexión."); }
  if (!response.ok) { const error = new Error(`El geocodificador respondió con estado ${response.status}.`); error.status = response.status; throw error; }
  return (await response.json())[0] || null;
}

function normalizeKey(name) { return String(name).trim().toLocaleLowerCase("es").normalize("NFKC"); }
function loadCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY)) || {}; } catch { return {}; } }
function saveCache(cache) { try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch (error) { console.warn("No se pudo guardar la caché geográfica", error); } }
function loadManualCache() {
  try {
    const manual = JSON.parse(localStorage.getItem(MANUAL_CACHE_KEY)) || {};
    const legacy = loadCache(); let migrated = false;
    for (const [key, value] of Object.entries(legacy)) if (value?.manual === true && validCoordinates(value.lat, value.lon) && !manual[key]) { manual[key] = { name: key, lat: Number(value.lat), lon: Number(value.lon), savedAt: value.savedAt || new Date().toISOString() }; migrated = true; }
    if (migrated) saveManualCache(manual); return manual;
  } catch { return {}; }
}
function saveManualCache(cache) { try { localStorage.setItem(MANUAL_CACHE_KEY, JSON.stringify(cache)); } catch (error) { console.warn("No se pudieron guardar las ubicaciones manuales", error); } }
import { isTechnicalWaypoint } from "./parser.js";
