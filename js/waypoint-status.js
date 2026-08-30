import { isRideTarget } from "./parser.js";

export const WAYPOINT_STATUSES = Object.freeze({ PENDING: "pending", COMPLETED: "completed", SKIPPED: "skipped" });
export function createWaypointStatuses(waypoints, saved = {}) { return Object.fromEntries(waypoints.map((point) => [point.id, validStatus(saved[point.id]) ? saved[point.id] : WAYPOINT_STATUSES.PENDING])); }
export function advanceWaypointStatuses(waypoints, statuses, distanceAlong, tolerance = 150) { for (const point of waypoints) if (statuses[point.id] === WAYPOINT_STATUSES.PENDING && point.routeDistance <= distanceAlong + tolerance) statuses[point.id] = WAYPOINT_STATUSES.COMPLETED; return statuses; }
export function nextMeaningfulWaypoint(waypoints, statuses) { return waypoints.find((point) => isRideTarget(point) && statuses[point.id] === WAYPOINT_STATUSES.PENDING) || null; }
export function skipWaypoint(statuses, id) { if (statuses[id] === WAYPOINT_STATUSES.PENDING) statuses[id] = WAYPOINT_STATUSES.SKIPPED; return statuses; }
export function undoSkippedWaypoint(statuses, id) { if (statuses[id] === WAYPOINT_STATUSES.SKIPPED) statuses[id] = WAYPOINT_STATUSES.PENDING; return statuses; }
function validStatus(status) { return Object.values(WAYPOINT_STATUSES).includes(status); }
