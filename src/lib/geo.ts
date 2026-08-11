import type { Customer, GeoPoint } from './types';

/**
 * Locations are captured from the device's GPS while standing at the property,
 * not derived from the address. Turning an address into coordinates needs a
 * geocoding service, which this app deliberately does not depend on — it would
 * be a network call in exactly the places where there is no signal.
 *
 * The trade-off: a customer only appears in "Near me" once someone has been
 * there with the app open and tapped "Use my location".
 */
export function capturePosition(): Promise<GeoPoint> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) {
      reject(new Error('This device cannot report its location.'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) =>
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt: new Date().toISOString(),
        }),
      (error) => reject(new Error(geolocationMessage(error))),
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  });
}

function geolocationMessage(error: GeolocationPositionError): string {
  if (error.code === error.PERMISSION_DENIED) {
    return 'Location permission was denied. Allow location access for this site and try again.';
  }
  if (error.code === error.POSITION_UNAVAILABLE) {
    return 'No position available — GPS may be blocked indoors or in a basement.';
  }
  if (error.code === error.TIMEOUT) {
    return 'Timed out waiting for a GPS fix. Step outside and try again.';
  }
  return 'Could not read this device location.';
}

const EARTH_RADIUS_MILES = 3958.8;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Great-circle distance in miles. */
export function distanceMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(h));
}

export function formatDistance(miles: number): string {
  if (miles < 0.1) return 'here';
  if (miles < 10) return `${miles.toFixed(1)} mi`;
  return `${Math.round(miles)} mi`;
}

export interface NearbyCustomer {
  customer: Customer;
  miles: number;
}

/** Customers with a captured location, nearest first, within `radiusMiles`. */
export function customersNear(
  customers: Customer[],
  origin: { lat: number; lng: number },
  radiusMiles = 25,
): NearbyCustomer[] {
  return customers
    .filter((customer) => customer.location)
    .map((customer) => ({
      customer,
      miles: distanceMiles(origin, customer.location!),
    }))
    .filter((entry) => entry.miles <= radiusMiles)
    .sort((a, b) => a.miles - b.miles);
}
