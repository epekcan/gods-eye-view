import {
  epoch,
  finite,
  httpError,
  LiveSourceError,
  readResponse,
} from './contract.js';
import {
  normalizeAircraftTrack,
  readsbSnapshot,
  readsbIdentities,
} from './aircraft.js';
import { normalizeVesselTrack, vesselSnapshot } from './vessels.js';

const defaultFetch = (...args) => globalThis.fetch(...args);
const header = (response, name) => response.headers?.get?.(name);

function flightError(response, provider) {
  const error = httpError(response, provider);
  if (response.status === 429) {
    error.message = `${provider} hız sınırı (rate limit)`;
  } else {
    error.message = `${provider} HTTP ${response.status}`;
  }
  return error;
}

export function createOpenSkySource({
  fetchImpl = defaultFetch,
  now = () => Date.now(),
} = {}) {
  return {
    label: 'Canlı Uçuşlar',
    async getSnapshot(_query = {}, { signal } = {}) {
      const { response, payload } = await readResponse(
        fetchImpl,
        '/api/adsb-live', // PROXY KLASÖRÜ KALDIRILDI
        { signal },
        'Canlı Uçuşlar',
      );
      if (!response.ok) throw flightError(response, 'Canlı Uçuşlar');

      let normalizedPayload = payload;

      // 1. OpenSky formatı (states dizisi)
      if (payload && Array.isArray(payload.states)) {
        const acList = payload.states
          .map((st) => ({
            hex: String(st[0] || '').trim().toLowerCase(),
            flight: String(st[1] || '').trim(),
            lat: st[6],
            lon: st[5],
            alt_baro: Number.isFinite(st[7]) ? Math.round(st[7] * 3.28084) : 0,
            alt_geom: Number.isFinite(st[13]) ? Math.round(st[13] * 3.28084) : undefined,
            track: Number.isFinite(st[10]) ? st[10] : 0,
            gs: Number.isFinite(st[9]) ? Math.round(st[9] * 1.94384) : 0,
            seen: Number.isFinite(st[4]) ? Math.max(0, Math.round(Date.now() / 1000 - st[4])) : 0,
            category: 'A0',
          }))
          .filter((ac) => ac.lat != null && ac.lon != null && ac.hex);

        normalizedPayload = {
          ac: acList,
          total: acList.length,
          now: payload.time ? payload.time * 1000 : now(),
        };
      } 
      // 2. adsb.fi / readsb formatı (aircraft veya ac dizisi)
      else if (payload && (Array.isArray(payload.aircraft) || Array.isArray(payload.ac) || Array.isArray(payload))) {
        const rawList = payload.aircraft || payload.ac || payload;
        const acList = rawList
          .map((st) => ({
            hex: String(st.hex || '').trim().toLowerCase(),
            flight: String(st.flight || st.callsign || st.r || '').trim(),
            lat: st.lat,
            lon: st.lon,
            alt_baro: st.alt_baro === 'ground' ? 0 : (Number(st.alt_baro) || Number(st.alt_geom) || 0),
            track: Number(st.track || st.mag_heading || st.true_heading || 0),
            gs: Number(st.gs || st.tas || 0),
            seen: Number(st.seen || 0),
            category: st.category || 'A0',
          }))
          .filter((ac) => ac.lat != null && ac.lon != null && ac.hex);

        normalizedPayload = {
          ac: acList,
          total: acList.length,
          now: payload?.now ? payload.now * 1000 : now(),
        };
      }

      const age = finite(header(response, 'x-ads-b-cache-age-ms'));
      return {
        ...readsbSnapshot(normalizedPayload, {
          source: 'Canlı Uçuşlar',
          coverage: 'Türkiye Hava Sahası',
          observedAtMs: now() - (age != null && age > 0 ? age : 0),
          now: now(),
          stale: false,
        }),
        status: response.status,
      };
    },
    async getTrack(reference, { signal } = {}) {
      const targetUrl = `/api/adsb-hex/${encodeURIComponent(reference)}`; // PROXY KLASÖRÜ KALDIRILDI
      const { response, payload } = await readResponse(
        fetchImpl,
        targetUrl,
        { signal },
        'Canlı Uçuşlar',
      );
      if (!response.ok) throw httpError(response, 'Canlı Uçuşlar');
      const baseTimeMs = epoch(payload?.timestamp, 1000);
      return {
        records:
          baseTimeMs == null
            ? []
            : normalizeAircraftTrack(payload?.trace, {
                baseTimeMs,
                readsb: true,
              }),
        complete: false,
      };
    },
    async getEnrichment(query, { signal } = {}) {
      if (!['type', 'route'].includes(query.kind))
        throw new LiveSourceError('unsupported', 'Enrichment unavailable');
      const { response, payload } = await readResponse(
        fetchImpl,
        `https://api.adsbdb.com/v0/${query.kind}/${encodeURIComponent(query.id)}`,
        { signal },
        'adsbdb',
      );
      if (!response.ok) throw httpError(response, 'adsbdb');
      return payload;
    },
  };
}

export function createAdsbLolSource({
  fetchImpl = defaultFetch,
  now = () => Date.now(),
} = {}) {
  return {
    label: 'Askeri Uçuşlar',
    async getIdentities(_query = {}, { signal } = {}) {
      const { response, payload } = await readResponse(
        fetchImpl,
        '/api/adsb-mil', // PROXY KLASÖRÜ KALDIRILDI
        { signal },
        'Askeri Uçuşlar',
      );
      if (!response.ok) throw httpError(response, 'Askeri Uçuşlar');
      return readsbIdentities(payload);
    },
    async getSnapshot(_query = {}, { signal } = {}) {
      const { response, payload } = await readResponse(
        fetchImpl,
        '/api/adsb-mil', // PROXY KLASÖRÜ KALDIRILDI
        { signal },
        'Askeri Uçuşlar',
      );
      if (!response.ok) throw httpError(response, 'Askeri Uçuşlar');
      const age = finite(header(response, 'x-ads-b-cache-age-ms'));
      return {
        ...readsbSnapshot(payload, {
          observedAtMs: now() - (age != null && age > 0 ? age : 0),
          now: now(),
          stale: false,
        }),
        status: response.status,
      };
    },
    async getTrack(reference, { signal } = {}) {
      const { response, payload } = await readResponse(
        fetchImpl,
        `/api/adsb-hex/${encodeURIComponent(reference)}`, // PROXY KLASÖRÜ KALDIRILDI
        { signal },
        'Askeri Uçuşlar',
      );
      if (!response.ok) throw httpError(response, 'Askeri Uçuşlar');
      const baseTimeMs = epoch(payload?.timestamp, 1000);
      return {
        records:
          baseTimeMs == null
            ? []
            : normalizeAircraftTrack(payload?.trace, {
                baseTimeMs,
                readsb: true,
              }),
        complete: false,
      };
    },
  };
}

export function createAisStreamSource({
  fetchImpl = defaultFetch,
  apiUrl = '/api/ais-live',
  origin = () => globalThis.location?.origin || '',
} = {}) {
  return {
    label: 'AISStream',
    async getSnapshot({ maxRows = 12000 } = {}, { signal } = {}) {
      const url = `${origin()}${apiUrl}`;
      const { response, payload } = await readResponse(
        fetchImpl,
        url,
        { signal },
        'AISStream',
      );

      if (!response.ok) throw httpError(response, 'AISStream');

      const rawRecords = Array.isArray(payload?.records) ? payload.records : [];
      const normalizedRecords = rawRecords.map((v) => ({
        mmsi: String(v.mmsi || ''),
        name: String(v.name || `VESSEL-${v.mmsi}`).trim(),
        latitude: Number(v.lat),
        longitude: Number(v.lon),
        speedKnots: Number(v.sog || 0),
        headingDeg: Number(v.hdg || v.cog || 0),
        courseDeg: Number(v.cog || 0),
        timestampMs: v.timestamp || Date.now(),
      })).filter((v) => Number.isFinite(v.latitude) && Number.isFinite(v.longitude));

      return {
        records: normalizedRecords,
        timestamp: payload?.timestamp || Date.now(),
        status: response.status,
      };
    },
    async getTrack(reference, { signal } = {}) {
      return {
        records: [],
        complete: false,
      };
    },
  };
}