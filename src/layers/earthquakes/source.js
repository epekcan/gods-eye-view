import { normalizeEarthquakeSnapshot } from './model.js';

const USGS_API_URL =
  'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';
const KANDILLI_API_URL = '/kandilli-api/deprem/kandilli/live?limit=100';

export function createUsgsEarthquakeSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      signal?.throwIfAborted();

      // Kandilli ve USGS akışlarını paralel sorgula
      const [kandilliRes, usgsRes] = await Promise.allSettled([
        fetchImpl(KANDILLI_API_URL, { signal }).then((r) => (r.ok ? r.json() : null)),
        fetchImpl(USGS_API_URL, { signal }).then((r) => (r.ok ? r.json() : null)),
      ]);

      const rows = [];
      const seenIds = new Set();

      // 1. Kandilli Canlı Depremleri (Öncelikli Türkiye Kaynağı)
      const kandilliPayload = kandilliRes.status === 'fulfilled' ? kandilliRes.value : null;
      if (Array.isArray(kandilliPayload?.result)) {
        for (const item of kandilliPayload.result) {
          const stableId = `kandilli-${item._id || item.earthquake_id}`;
          const [lon, lat] = item.geojson?.coordinates || [item.lng, item.lat];
          const mag = Number(item.mag);
          const depthKm = Number(item.depth);

          if (!seenIds.has(stableId) && Number.isFinite(lon) && Number.isFinite(lat) && Number.isFinite(mag)) {
            seenIds.add(stableId);
            rows.push({
              stableId,
              usgsId: stableId,
              lon,
              lat,
              depthKm: Number.isFinite(depthKm) ? depthKm : 10,
              mag,
              place: item.title || item.location_properties?.closestCity?.name || 'Türkiye',
              time: item.date_stamp ? new Date(item.date_stamp).getTime() : Date.now(),
            });
          }
        }
      }

      // 2. USGS Depremleri (Küresel Kaynak)
      const usgsPayload = usgsRes.status === 'fulfilled' ? usgsRes.value : null;
      if (usgsPayload) {
        const usgsRows = normalizeEarthquakeSnapshot(usgsPayload);
        if (Array.isArray(usgsRows)) {
          for (const row of usgsRows) {
            if (!seenIds.has(row.stableId)) {
              seenIds.add(row.stableId);
              rows.push(row);
            }
          }
        }
      }

      if (rows.length === 0) {
        throw new Error('Deprem verisi alınamadı');
      }

      return rows;
    },
  };
}