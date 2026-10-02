export type GeoPoint = {
  latitude: number;
  longitude: number;
};

export type LocationFix = GeoPoint & {
  accuracy: number;
};

export type GeofenceResult =
  | { allowed: true; distanceMeters: number }
  | {
      allowed: false;
      reason: "poor_accuracy" | "outside_radius";
      distanceMeters: number;
    };

export function distanceInMeters(first: GeoPoint, second: GeoPoint) {
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = radians(second.latitude - first.latitude);
  const longitudeDelta = radians(second.longitude - first.longitude);
  const value =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(radians(first.latitude)) *
      Math.cos(radians(second.latitude)) *
      Math.sin(longitudeDelta / 2) ** 2;

  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

export function verifyGeofence(
  fix: LocationFix,
  outlet: GeoPoint,
  radiusMeters = 100,
  maximumAccuracyMeters = 50,
): GeofenceResult {
  const distanceMeters = distanceInMeters(fix, outlet);

  if (
    !Number.isFinite(fix.accuracy) ||
    fix.accuracy < 0 ||
    fix.accuracy > maximumAccuracyMeters
  ) {
    return { allowed: false, reason: "poor_accuracy", distanceMeters };
  }

  if (distanceMeters + fix.accuracy > radiusMeters) {
    return { allowed: false, reason: "outside_radius", distanceMeters };
  }

  return { allowed: true, distanceMeters };
}
