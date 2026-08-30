const KEY = "ridermap-active-ride-session-v1";
const VERSION = 1;

export function loadRideSession() {
  try { const raw = localStorage.getItem(KEY); if (!raw) return null; const value = JSON.parse(raw); if (!validSession(value)) throw new Error("Esquema de sesión incompatible"); return value.completed ? null : value; }
  catch (error) { console.warn("Sesión En ruta descartada por ser inválida", error); try { localStorage.removeItem(KEY); } catch {} return null; }
}
export function saveRideSession(session) { try { localStorage.setItem(KEY, JSON.stringify({ ...session, version: VERSION, updatedAt: new Date().toISOString() })); return true; } catch (error) { console.warn("No se pudo guardar la sesión En ruta", error); return false; } }
export function discardRideSession() { try { localStorage.removeItem(KEY); } catch (error) { console.warn("No se pudo descartar la sesión En ruta", error); } }
export function createRideSession({ tripName, dayIndex, day, progress = 0, statuses = {}, lastKnownPosition = null }) { const now = new Date().toISOString(); return { version: VERSION, routeId: `${dayIndex}:${day.route.calculatedAt || now}`, routeName: `${tripName} · ${day.name || `Día ${dayIndex + 1}`}`, dayIndex, day: structuredClone({ ...day, routeDirty: false }), statuses, distanceCompleted: Number(progress) || 0, lastKnownPosition: sanitizePosition(lastKnownPosition), completed: false, createdAt: now, updatedAt: now }; }
export function updateRideSession(session, { progress, statuses, lastKnownPosition, completed = false }) { return { ...session, distanceCompleted: Number(progress) || 0, statuses: { ...statuses }, lastKnownPosition: sanitizePosition(lastKnownPosition), completed }; }

function validSession(value) { return value?.version === VERSION && Number.isInteger(value.dayIndex) && value.dayIndex >= 0 && value.dayIndex < 5 && value.day?.route?.geometry?.type === "LineString" && Array.isArray(value.day.route.geometry.coordinates) && Array.isArray(value.day.waypoints) && value.day.waypoints.length >= 2 && Number.isFinite(Number(value.distanceCompleted)) && value.statuses && typeof value.statuses === "object"; }
function sanitizePosition(position) { if (!position || !Number.isFinite(position.latitude) || !Number.isFinite(position.longitude)) return null; return { latitude: position.latitude, longitude: position.longitude, accuracy: Number(position.accuracy) || 0, speed: Number.isFinite(position.speed) ? position.speed : null, heading: Number.isFinite(position.heading) ? position.heading : null, timestamp: Number(position.timestamp) || Date.now() }; }
