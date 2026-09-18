import {
  epoch,
  finite,
  httpError,
  LiveSourceError,
  readResponse,
} from './contract.js';
import {
  normalizeAircraftTrack,
  openSkySnapshot,
  readsbSnapshot,
  readsbIdentities,
} from './aircraft.js';
import { normalizeVesselTrack, vesselSnapshot } from './vessels.js';

const defaultFetch = (...args) => globalThis.fetch(...args);
const header = (response, name) => response.headers?.get?.(name);

function openSkyError(response) {
  const error = httpError(response, 'OpenSky');
  if (response.status === 429) {
    error.message = 'OpenSky hız sınırı (rate limit)';
  } else {
    error.message = `OpenSky HTTP ${response.status}`;
  }
  return error;
}

export function createOpenSkySource({
  fetchImpl = defaultFetch,
  now = () => Date.now(),
} = {}) {
  return {
    label: 'OpenSky Network',
    async getSnapshot(query = {}, { signal } = {}) {
      const params = new URLSearchParams();
      if (Number.isFinite(query.latitude) && Number.isFinite(query.longitude)) {
        const delta = 3.0;
        params.set('lamin', (query.latitude - delta).toFixed(4));
        params.set('lomin', (query.longitude - delta).toFixed(4));
        params.set('lamax', (query.latitude + delta).toFixed(4));
        params.set('lomax', (query.longitude + delta).toFixed(4));
      }
      
      // Güvenilir hızlı CORS tüneli
      const targetUrl = `https://opensky-network.org/api/states/all${params.size ? '?' + params : ''}`;
      const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;

      const { response, payload } = await readResponse(
        fetchImpl,
        proxyUrl,
        { signal },
        'OpenSky',
      );
      if (!response.ok) throw openSkyError(response);
      return {
        ...openSkySnapshot(payload, {
          source: 'OpenSky Network',
          coverage: 'worldwide upstream snapshot',
          now: now(),
        }),
        status: response.status,
      };
    },
    async getTrack(reference, { signal } = {}) {
      const targetUrl = `https://opensky-network.org/api/tracks/all?icao24=${reference}`;
      const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;
      const { response, payload } = await readResponse(
        fetchImpl,
        proxyUrl,
        { signal },
        'OpenSky',
      );
      if (!response.ok) throw httpError(response, 'OpenSky');
      return {
        records: normalizeAircraftTrack(payload?.path),
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
    label: 'adsb.lol',
    async getIdentities(_query = {}, { signal } = {}) {
      // adsb.lol doğrudan tarayıcı CORS isteklerine açıktır
      const { response, payload } = await readResponse(
        fetchImpl,
        'https://api.adsb.lol/v2/mil',
        { signal },
        'adsb.lol',
      );
      if (!response.ok) throw httpError(response, 'adsb.lol');
      return readsbIdentities(payload);
    },
    async getSnapshot(_query = {}, { signal } = {}) {
      const { response, payload } = await readResponse(
        fetchImpl,
        'https://api.adsb.lol/v2/mil',
        { signal },
        'adsb.lol',
      );
      if (!response.ok) throw httpError(response, 'adsb.lol');
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
        `https://api.adsb.lol/v2/point/trace/${encodeURIComponent(reference)}`,
        { signal },
        'adsb.lol',
      );
      if (!response.ok) throw httpError(response, 'adsb.lol');
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
      const url = new URL(apiUrl, origin());
      url.searchParams.set('maxRows', String(maxRows));
      const { response, payload } = await readResponse(
        fetchImpl,
        url.toString(),
        { signal, cache: 'no-store' },
        'AIS live',
      );
      if (!response.ok) {
        const error = httpError(response, 'AIS live');
        error.message = 'AIS live down';
        throw error;
      }
      return { ...vesselSnapshot(payload), status: response.status };
    },
    async getTrack(reference, { signal } = {}) {
      const { response, payload } = await readResponse(
        fetchImpl,
        '/api/ais-live/track?mmsi=' + encodeURIComponent(reference),
        { signal },
        'AIS live',
      );
      if (!response.ok) throw httpError(response, 'AIS live');
      return {
        records: normalizeVesselTrack(payload?.samples),
        complete: false,
      };
    },
  };
}