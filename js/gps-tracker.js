export function createGpsTracker({ onPosition, onError }) {
  let watchId = null;
  return {
    start() {
      if (!navigator.geolocation) { onError(new Error("Este navegador no ofrece acceso a la ubicación GPS.")); return false; }
      if (watchId !== null) return true;
      watchId = navigator.geolocation.watchPosition(
        ({ coords, timestamp }) => onPosition(normalizePosition(coords, timestamp)),
        (error) => onError(new Error(geolocationMessage(error))),
        { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
      ); return true;
    },
    stop() { if (watchId !== null) navigator.geolocation.clearWatch(watchId); watchId = null; },
    active() { return watchId !== null; }
  };
}

export function normalizePosition(coords, timestamp = Date.now()) { return { latitude: Number(coords.latitude), longitude: Number(coords.longitude), accuracy: Number(coords.accuracy) || 0, speed: Number.isFinite(coords.speed) ? Number(coords.speed) : null, heading: Number.isFinite(coords.heading) ? Number(coords.heading) : null, timestamp: Number(timestamp) || Date.now() }; }

function geolocationMessage(error) { if (error?.code === 1) return "Permiso GPS denegado. Puedes seguir usando RiderMap en modo Diseño."; if (error?.code === 2) return "No se pudo determinar la posición GPS."; if (error?.code === 3) return "El GPS tardó demasiado en responder. Vuelve a intentarlo."; return "No se pudo iniciar el seguimiento GPS."; }
