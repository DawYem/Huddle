import { Router } from 'express';
import { geolocate, type GeolocateRequest } from '../google/geolocation.js';

// POST /api/location
// For devices that can't get a GPS fix but can report nearby Wi-Fi access points
// or cell towers. Clients with GPS (browser navigator.geolocation, iOS/Android
// location services) should skip this and send lat/lng straight to /api/spots.
export function locationRouter(apiKey: string, fetchFn: typeof fetch): Router {
  const router = Router();

  router.post('/', async (req, res, next) => {
    const body = (req.body ?? {}) as GeolocateRequest;
    const hasSignals = Boolean(body.wifiAccessPoints?.length || body.cellTowers?.length);
    if (!hasSignals) {
      // considerIp would locate this server rather than the user, so require real signals.
      res.status(400).json({
        error: 'Send wifiAccessPoints or cellTowers, or use the device GPS and call /api/spots directly.',
      });
      return;
    }
    try {
      res.json(await geolocate(apiKey, { ...body, considerIp: false }, fetchFn));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
