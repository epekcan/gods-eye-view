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

      const age = finite(header(response, 'x-ads-b-cache-age-ms'));
      return {
        ...readsbSnapshot(payload, {
          source: 'Canlı Uçuşlar',
          coverage: 'regional live snapshot',
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
      // AIS verisi backend olmadan çalışmayacağı için çökmemesi adına boş liste döndürülür
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