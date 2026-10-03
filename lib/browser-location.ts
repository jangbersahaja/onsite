import type { LocationFix } from "./geofence";

export function requestCurrentLocation(
  geolocation: Pick<Geolocation, "getCurrentPosition">,
  timeoutMilliseconds = 30_000,
): Promise<LocationFix> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(
        new Error(
          "Location check timed out after 30 seconds. Check your browser's location permission, move near a window, then try again.",
        ),
      );
    }, timeoutMilliseconds);

    try {
      geolocation.getCurrentPosition(
        (position) => {
          clearTimeout(timer);
          resolve({
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
          });
        },
        (error) => {
          clearTimeout(timer);
          reject(
            new Error(
              error.code === error.PERMISSION_DENIED
                ? "Location permission was denied. Enable location access in your browser settings, then try again."
                : "We could not get a reliable location. Move near a window and try again, or request a time correction.",
            ),
          );
        },
        {
          enableHighAccuracy: true,
          maximumAge: 0,
          timeout: timeoutMilliseconds,
        },
      );
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}
