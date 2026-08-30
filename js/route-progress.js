const EARTH_RADIUS = 6371000;

export function prepareRouteProgress(route, waypoints = []) {
  const coordinates = route?.geometry?.coordinates || [];
  if (coordinates.length < 2) throw new Error("La ruta no contiene una geometría utilizable.");
  const cumulative = [0];
  for (let i = 1; i < coordinates.length; i += 1) cumulative.push(cumulative[i - 1] + distance(coordinates[i - 1], coordinates[i]));
  const waypointProgress = waypoints.map((point) => {
    const match = closestPoint([point.lon, point.lat], coordinates, cumulative);
    return { ...point, routeDistance: match.distanceAlong };
  });
  return { coordinates, cumulative, totalDistance: cumulative.at(-1), waypointProgress };
}

export function locateOnRoute(position, prepared) {
  const match = closestPoint([position.longitude, position.latitude], prepared.coordinates, prepared.cumulative);
  return { ...match, progress: prepared.totalDistance ? match.distanceAlong / prepared.totalDistance : 0, remainingDistance: Math.max(0, prepared.totalDistance - match.distanceAlong) };
}

export function createProgressTracker(prepared, initialDistance = 0) {
  let acceptedDistance = Math.max(0, Math.min(prepared.totalDistance, Number(initialDistance) || 0)); let offRouteReadings = 0;
  return {
    update(position) {
      const match = locateOnRoute(position, prepared); const accuracy = Number(position.accuracy) || 0; const reliable = accuracy <= 100;
      if (reliable) {
        const backwards = acceptedDistance - match.distanceAlong;
        if (backwards <= Math.max(120, accuracy * 2)) acceptedDistance = Math.max(0, match.distanceAlong);
        const threshold = Math.max(250, accuracy * 2.5); offRouteReadings = match.distanceToRoute > threshold ? offRouteReadings + 1 : 0;
      }
      const completionTolerance = Math.max(150, accuracy * 2);
      const nextIndex = prepared.waypointProgress.findIndex((point, index) => index > 0 && point.routeDistance > acceptedDistance + completionTolerance);
      const completed = acceptedDistance >= prepared.totalDistance - completionTolerance;
      return { ...match, distanceAlong: acceptedDistance, progress: prepared.totalDistance ? acceptedDistance / prepared.totalDistance : 0, remainingDistance: Math.max(0, prepared.totalDistance - acceptedDistance), nextIndex: completed ? -1 : nextIndex < 0 ? prepared.waypointProgress.length - 1 : nextIndex, completed, offRoute: reliable && offRouteReadings >= 3, lowConfidence: !reliable };
    },
    reset() { acceptedDistance = 0; offRouteReadings = 0; },
    restore(distanceAlong) { acceptedDistance = Math.max(0, Math.min(prepared.totalDistance, Number(distanceAlong) || 0)); offRouteReadings = 0; }
  };
}

function closestPoint(point, coordinates, cumulative) {
  let best = { distanceToRoute: Infinity, distanceAlong: 0, coordinate: coordinates[0], segmentIndex: 0 };
  for (let i = 0; i < coordinates.length - 1; i += 1) {
    const projected = project(point, coordinates[i], coordinates[i + 1]);
    const meters = distance(point, projected.coordinate);
    if (meters < best.distanceToRoute) best = { distanceToRoute: meters, distanceAlong: cumulative[i] + distance(coordinates[i], projected.coordinate), coordinate: projected.coordinate, segmentIndex: i };
  }
  return best;
}

function project(point, start, end) {
  const latitude = (start[1] + end[1] + point[1]) / 3 * Math.PI / 180;
  const scale = Math.cos(latitude); const ax = start[0] * scale; const ay = start[1]; const bx = end[0] * scale; const by = end[1]; const px = point[0] * scale; const py = point[1];
  const dx = bx - ax; const dy = by - ay; const length2 = dx * dx + dy * dy; const t = length2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length2)) : 0;
  return { coordinate: [(ax + dx * t) / scale, ay + dy * t] };
}

function distance(a, b) { const rad = Math.PI / 180; const dLat = (b[1] - a[1]) * rad; const dLon = (b[0] - a[0]) * rad; const x = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2; return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(x))); }
