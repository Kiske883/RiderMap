export const WAYPOINT_TYPES = [
  { value: "normal", label: "• Punto" },
  { value: "pass", label: "⛰ Puerto" },
  { value: "stop", label: "☕ Parada" },
  { value: "fuel", label: "⛽ Gasolina" },
  { value: "food", label: "🍴 Comida" },
  { value: "hotel", label: "🏨 Fin de etapa" },
  { value: "interest", label: "★ Punto de interés" },
  { value: "technical", label: "🔧 Punto técnico" }
];

export function isTechnicalWaypoint(point) { return point?.type === "technical" || point?.type === "via"; }
export function isRideTarget(point) { return !isTechnicalWaypoint(point); }

export function parseLines(text) {
  return String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

export function pointsToText(waypoints) {
  return waypoints.map((point) => point.name.trim()).filter(Boolean).join("\n");
}

export function reconcileWaypoints(text, existing = []) {
  const names = parseLines(text);
  return names.map((name, index) => {
    const samePosition = existing[index];
    if (samePosition?.name === name) return { ...samePosition };
    const unusedMatch = existing.find((point, oldIndex) => point.name === name && oldIndex >= index);
    return unusedMatch ? { ...unusedMatch, name } : { id: createId(), name, type: "normal", lat: null, lon: null, locationSource: null, resolvedName: "" };
  });
}

export function validateRoute(waypoints) {
  const clean = waypoints.filter((point) => point.name.trim());
  if (!clean.length) throw new Error("Introduce al menos dos puntos para calcular la ruta.");
  if (clean.length === 1) throw new Error("La ruta necesita un origen y un destino como mínimo.");
  return clean;
}

export function createWaypoint(name = "", type = "normal") {
  return { id: createId(), name, type, lat: null, lon: null, locationSource: null, resolvedName: "" };
}

export function createViaPoint(name, lat, lon) {
  return { id: createId(), name: name || "Punto de paso", type: "technical", lat: Number(lat), lon: Number(lon), locationSource: "manual", manualCoordinates: true, resolvedName: "Punto de paso elegido en el mapa" };
}

function createId() {
  return globalThis.crypto?.randomUUID?.() || `wp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
