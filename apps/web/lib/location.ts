import type { LatLng } from '@arbiter/shared';

export type LocationResult = { ok: true; center: LatLng } | { ok: false; reason: string };

// Chrome only starts getCurrentPosition's own timeout once permission is
// granted, so a location prompt nobody answers would otherwise wait forever.
const LOCATION_WAIT_MS = 10_000;

/**
 * This device's location, from the browser (free: no lookup service). On
 * failure, a reason people can act on; there is never a silent fallback to
 * some default city.
 */
export function currentLocation(): Promise<LocationResult> {
  return new Promise((resolve) => {
    if (!('geolocation' in navigator)) {
      return resolve({ ok: false, reason: "This browser can't share a location. Type a place instead." });
    }
    const giveUp = setTimeout(
      () => resolve({ ok: false, reason: 'No answer to the location prompt. Allow it, or type a place instead.' }),
      LOCATION_WAIT_MS
    );
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        clearTimeout(giveUp);
        resolve({ ok: true, center: { lat: coords.latitude, lng: coords.longitude } });
      },
      (error) => {
        clearTimeout(giveUp);
        resolve({
          ok: false,
          reason:
            error.code === error.PERMISSION_DENIED
              ? 'Location is blocked for this site. Type a place instead, or allow location in your browser settings.'
              : "Couldn't get your location. Type a place instead."
        });
      },
      { timeout: 8000, maximumAge: 5 * 60_000 }
    );
  });
}
