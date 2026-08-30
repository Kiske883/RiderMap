const PROVIDERS = {
  graphhopper: { maxPoints: 5, calculate: calculateGraphHopperChunk }
};

export function getRoutingConfiguration() {
  const providerName = window.APP_CONFIG?.ROUTING_PROVIDER;
  const provider = PROVIDERS[providerName];
  if (!provider) throw new Error("No hay ningún motor de rutas configurado.");
  if (providerName === "graphhopper" && !window.APP_CONFIG?.GRAPHHOPPER_API_KEY) throw new Error("No hay ningún motor de rutas configurado. Añade una clave gratuita de GraphHopper en config.js.");
  return { name: providerName, provider };
}

export function segmentPoints(points, maxPoints) {
  if (maxPoints < 2) throw new Error("El proveedor debe admitir al menos dos puntos por petición.");
  const chunks = [];
  for (let start = 0; start < points.length - 1; start += maxPoints - 1) chunks.push(points.slice(start, start + maxPoints));
  return chunks;
}

export async function calculateRoute(points, onProgress = () => {}) {
  const { name, provider } = getRoutingConfiguration();
  const chunks = segmentPoints(points, provider.maxPoints);
  const results = [];
  debugLog("Routing provider: GraphHopper");
  debugLog("Number of waypoints:", points.length);
  debugLog("Coordinates sent:", points.map((point) => ({ name: point.name, lat: point.lat, lon: point.lon })));
  for (let index = 0; index < chunks.length; index += 1) {
    onProgress(index + 1, chunks.length);
    const chunk = chunks[index];
    debugLog(`Routing chunk ${index + 1}/${chunks.length}:`, chunk.map((point) => `${point.name} (${point.lat}, ${point.lon})`));
    try {
      results.push(await provider.calculate(chunk));
    } catch (error) {
      if (error.status === 429 || error.status === 401 || error.status === 403) throw markRoutingFailure(error);
      const segment = await diagnoseFailingSegment(chunk, provider.calculate);
      const range = segment || `${chunk[0].name} → ${chunk.at(-1).name}`;
      const detail = error.providerMessage || error.message;
      throw markRoutingFailure(new Error(`No se ha podido calcular el tramo: ${range}. ${detail}`));
    }
  }
  const route = combineRoutes(results, points, name);
  debugLog("GraphHopper route:", route);
  debugLog("Distance:", route.distanceMeters);
  debugLog("Duration:", route.durationSeconds);
  debugLog("Route geometry points:", route.geometry.coordinates.length);
  return route;
}

export function combineRoutes(routes, points, provider = "unknown") {
  const coordinates = [];
  const legs = [];
  routes.forEach((route, routeIndex) => {
    const chunkCoordinates = route.geometry.coordinates;
    const hasDuplicateJoin = routeIndex > 0 && sameCoordinate(coordinates.at(-1), chunkCoordinates[0]);
    coordinates.push(...(hasDuplicateJoin ? chunkCoordinates.slice(1) : chunkCoordinates));
    legs.push(...route.legs);
  });
  return {
    provider,
    distanceMeters: routes.reduce((sum, route) => sum + route.distanceMeters, 0),
    durationSeconds: routes.reduce((sum, route) => sum + route.durationSeconds, 0),
    pointCount: points.length,
    geometry: { type: "LineString", coordinates }, legs,
    calculatedAt: new Date().toISOString()
  };
}

function sameCoordinate(a, b) { return Boolean(a && b && Math.abs(a[0] - b[0]) < 1e-7 && Math.abs(a[1] - b[1]) < 1e-7); }

async function calculateGraphHopperChunk(points) {
  const params = new URLSearchParams({ key: window.APP_CONFIG.GRAPHHOPPER_API_KEY, profile: "car", locale: "es", points_encoded: "false", instructions: "false", calc_points: "true" });
  points.forEach((point) => params.append("point", `${point.lat},${point.lon}`));
  let response;
  try { response = await fetch(`https://graphhopper.com/api/1/route?${params}`, { headers: { Accept: "application/json" } }); }
  catch (error) { console.error("GraphHopper network error", error); throw new Error("No se pudo conectar con el motor de rutas. Revisa tu conexión."); }
  debugLog("GraphHopper HTTP status:", response.status);
  const body = await response.json().catch(() => ({}));
  debugLog("GraphHopper response:", body);
  if (!response.ok) throw graphHopperError(response.status, body);
  const path = body.paths?.[0];
  if (!path?.points?.coordinates?.length) throw new Error("El motor de rutas no devolvió una geometría válida.");
  const coordinates = normalizeRoadCoordinates(path.points.coordinates);
  if (coordinates.length <= points.length && path.distance > 100) throw new Error("GraphHopper no devolvió una geometría detallada de carretera.");
  const route = { distanceMeters: path.distance, durationSeconds: path.time / 1000, geometry: { type: "LineString", coordinates }, legs: deriveLegs({ ...path, points: { type: "LineString", coordinates } }, points) };
  debugLog("Chunk distance:", route.distanceMeters, "duration:", route.durationSeconds, "geometry points:", coordinates.length);
  return route;
}

function normalizeRoadCoordinates(coordinates) {
  return coordinates.map((coordinate, index) => {
    if (!Array.isArray(coordinate) || coordinate.length < 2) throw new Error(`Coordenada de ruta inválida en la posición ${index}.`);
    const lon = Number(coordinate[0]); const lat = Number(coordinate[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lon < -180 || lon > 180 || lat < -90 || lat > 90) throw new Error(`GraphHopper devolvió una coordenada [longitud, latitud] inválida en la posición ${index}.`);
    return [lon, lat];
  });
}

async function diagnoseFailingSegment(points, calculateChunk) {
  for (let index = 0; index < points.length - 1; index += 1) {
    try { await calculateChunk(points.slice(index, index + 2)); }
    catch (error) {
      debugLog("Problematic road segment:", points[index].name, "→", points[index + 1].name, error);
      return `${points[index].name} → ${points[index + 1].name}`;
    }
  }
  return null;
}

function deriveLegs(path, points) {
  const geometry = path.points.coordinates;
  const cuts = [0];
  for (let i = 1; i < points.length - 1; i += 1) cuts.push(nearestForwardIndex(geometry, points[i], cuts.at(-1)));
  cuts.push(geometry.length - 1);
  const rawDistances = cuts.slice(0, -1).map((start, i) => lineDistance(geometry.slice(start, cuts[i + 1] + 1)));
  const rawTotal = rawDistances.reduce((sum, distance) => sum + distance, 0) || 1;
  return rawDistances.map((rawDistance, index) => ({
    from: points[index].name, to: points[index + 1].name,
    distanceMeters: path.distance * rawDistance / rawTotal,
    durationSeconds: (path.time / 1000) * rawDistance / rawTotal
  }));
}

function nearestForwardIndex(coordinates, point, start) {
  let best = Math.min(start + 1, coordinates.length - 1); let bestDistance = Infinity;
  for (let i = best; i < coordinates.length; i += 1) { const distance = squaredDistance(coordinates[i], [point.lon, point.lat]); if (distance < bestDistance) { best = i; bestDistance = distance; } }
  return best;
}

function lineDistance(coordinates) { let total = 0; for (let i = 1; i < coordinates.length; i += 1) total += haversine(coordinates[i - 1], coordinates[i]); return total; }
function squaredDistance(a, b) { return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2; }
function haversine(a, b) { const rad = Math.PI / 180; const dLat = (b[1] - a[1]) * rad; const dLon = (b[0] - a[0]) * rad; const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2; return 12742000 * Math.asin(Math.sqrt(x)); }
function graphHopperError(status, body) {
  console.error("GraphHopper error", status, body);
  let message;
  if (status === 401 || status === 403) message = "GraphHopper ha rechazado la clave. Revisa config.js y los límites de tu cuenta gratuita.";
  else if (status === 429) message = "Se ha agotado temporalmente la cuota gratuita del motor de rutas. Espera o revisa el límite diario de GraphHopper.";
  else if (status >= 500) message = "El motor de rutas está temporalmente fuera de servicio. Inténtalo más tarde.";
  else message = body.message || "No se pudo calcular una carretera que pase por todos los puntos en ese orden.";
  const error = new Error(message); error.status = status; error.providerMessage = body.message || message; return error;
}

function markRoutingFailure(error) { error.routingFailure = true; return error; }
function debugLog(...values) { if (window.APP_CONFIG?.DEBUG_ROUTING || ["localhost", "127.0.0.1"].includes(window.location?.hostname)) console.log(...values); }
