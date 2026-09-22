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
        '/api/proxy/adsb-live',
        { signal },
        'Canlı Uçuşlar',
      );
      if (!response.ok) throw flightError(response, 'Canlı Uçuşlar');

      let normalizedPayload = payload;

      // OpenSky Network formatı (states dizisi) geldiyse readsb/adsb formatına uyarla
      if (payload && Array.isArray(payload.states)) {
        const acList = payload.states
          .map((st) => ({
            hex: String(st[0] || '').trim().toLowerCase(),
            flight: String(st[1] || '').trim(),
            lat: st[6],
            lon: st[5],
            alt_baro: Number.isFinite(st[7]) ? Math.round(st[7] * 3.28084) : 0, // metre -> feet
            alt_geom: Number.isFinite(st[13]) ? Math.round(st[13] * 3.28084) : undefined,
            track: Number.isFinite(st[10]) ? st[10] : 0,
            gs: Number.isFinite(st[9]) ? Math.round(st[9] * 1.94384) : 0, // m/s -> knot
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
      const targetUrl = `/api/proxy/adsb-hex/${encodeURIComponent(reference)}`;
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
        '/api/proxy/adsb-mil',
        { signal },
        'Askeri Uçuşlar',
      );
      if (!response.ok) throw httpError(response, 'Askeri Uçuşlar');
      return readsbIdentities(payload);
    },
    async getSnapshot(_query = {}, { signal } = {}) {
      const { response, payload } = await readResponse(
        fetchImpl,
        '/api/proxy/adsb-mil',
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
        `/api/proxy/adsb-hex/${encodeURIComponent(reference)}`,
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
  origin = () => globalThis.location?.origin || 'http://localhost',
} = {}) {
  return {
    label: 'AISStream',
    async getSnapshot({ maxRows = 12000 } = {}, { signal } = {}) {
      return {
        records: [],
        timestamp: Date.now(),
        status: 200,
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