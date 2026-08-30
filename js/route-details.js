const IGNORED_ROADS = new Set(["", "unnamed road", "road", "path", "continue", "destination", "carretera sin nombre", "camino"]);

export function buildRouteSegments(route, waypoints) {
  if (!route?.legs?.length) return [];
  return route.legs.map((leg, index) => {
    const origin = leg.origin || waypoints[index]; const destination = leg.destination || waypoints[index + 1];
    const straightLineMeters = origin && destination ? haversine([origin.lon, origin.lat], [destination.lon, destination.lat]) : 0;
    const detourRatio = calculateDetourRatio(leg.distanceMeters, straightLineMeters);
    return {
      index, origin, destination,
      distanceMeters: leg.distanceMeters || 0,
      durationSeconds: leg.durationSeconds || 0,
      geometry: leg.geometry || { type: "LineString", coordinates: [] },
      instructions: Array.isArray(leg.instructions) ? leg.instructions : [],
      roads: extractRoadNames(leg.instructions),
      places: extractSignificantPlaces(leg.instructions),
      straightLineMeters, detourRatio,
      suspicious: Number.isFinite(detourRatio) && detourRatio > 2.5
    };
  });
}

export function extractRoadNames(instructions = []) {
  const roads = []; const seen = new Set();
  for (const instruction of instructions) {
    const street = normalizeRoadName(instruction.streetName || instruction.roadName || "");
    const references = extractRoadReferences(`${instruction.text || ""} ${street}`);
    const candidate = references.length && street && !references.some((reference) => street.toUpperCase().includes(reference)) ? `${references.join(" / ")} - ${street}` : references.length ? references.join(" / ") : street;
    addUniqueRoad(roads, seen, candidate);
  }
  return roads;
}

export function calculateDetourRatio(routedDistance, straightLineDistance) {
  if (!Number.isFinite(routedDistance) || !Number.isFinite(straightLineDistance) || straightLineDistance < 20) return null;
  return routedDistance / straightLineDistance;
}

export function createRoutingDebugData(route, segments) {
  return {
    provider: route.provider,
    distanceMeters: route.distanceMeters,
    durationSeconds: route.durationSeconds,
    geometryCoordinateCount: route.geometry?.coordinates?.length || 0,
    segments: segments.map((segment) => ({
      index: segment.index + 1,
      origin: segment.origin?.name,
      destination: segment.destination?.name,
      distanceMeters: segment.distanceMeters,
      durationSeconds: segment.durationSeconds,
      straightLineMeters: Math.round(segment.straightLineMeters),
      detourRatio: segment.detourRatio ? Number(segment.detourRatio.toFixed(2)) : null,
      geometryCoordinateCount: segment.geometry.coordinates.length,
      roads: segment.roads,
      instructions: segment.instructions
    }))
  };
}

function normalizeRoadName(value) {
  return String(value).replace(/\s+/g, " ").replace(/^[-–—\s]+|[-–—\s]+$/g, "").trim();
}

function extractRoadReferences(value) { return [...new Set(String(value).toUpperCase().match(/\b[A-Z]{1,3}-?\d{1,4}(?:-[A-Z])?\b/g) || [])]; }
function addUniqueRoad(roads, seen, candidate) { const key = candidate.toLocaleLowerCase("es"); if (!candidate || IGNORED_ROADS.has(key) || seen.has(key)) return; seen.add(key); roads.push(candidate); }

function extractSignificantPlaces(instructions = []) {
  const places = []; const seen = new Set();
  for (const instruction of instructions) {
    const place = String(instruction.placeName || "").trim(); const key = place.toLocaleLowerCase("es");
    if (place && !seen.has(key)) { seen.add(key); places.push(place); }
  }
  return places;
}

function haversine(a, b) {
  if (!a.every(Number.isFinite) || !b.every(Number.isFinite)) return 0;
  const rad = Math.PI / 180; const dLat = (b[1] - a[1]) * rad; const dLon = (b[0] - a[0]) * rad;
  const value = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 12742000 * Math.asin(Math.sqrt(value));
}
