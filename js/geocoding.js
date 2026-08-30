const CACHE_KEY = "transpirenaica-geocoding-cache-v1";
const REQUEST_INTERVAL_MS = 1100;
let lastRequestAt = 0;

export async function resolveWaypoints(waypoints, onProgress = () => {}) {
  const cache = loadCache();
  const resolved = [];
  const unresolved = [];
  for (let index = 0; index < waypoints.length; index += 1) {
    const point = waypoints[index]; onProgress(index + 1, waypoints.length, point.name);
    if (validCoordinates(point.lat, point.lon)) { resolved.push({ ...point }); continue; }
    if (point.type === "via") { unresolved.push(`${point.name} (punto de paso sin coordenadas)`); continue; }
    const key = normalizeKey(point.name);
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
  const cache = loadCache();
  cache[normalizeKey(name)] = { lat: Number(lat), lon: Number(lon), displayName: "Ubicación corregida manualmente", manual: true, savedAt: new Date().toISOString() };
  saveCache(cache);
}

export function clearCachedName(name) {
  const cache = loadCache(); delete cache[normalizeKey(name)]; saveCache(cache);
}

export function validCoordinates(lat, lon) {
  if (lat === null || lat === "" || lon === null || lon === "") return false;
  return Number.isFinite(Number(lat)) && Number(lat) >= -90 && Number(lat) <= 90 && Number.isFinite(Number(lon)) && Number(lon) >= -180 && Number(lon) <= 180;
}

async function searchNominatim(query) {
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
