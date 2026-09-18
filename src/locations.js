import { applicationServices } from './services/application.js';
import * as Cesium from 'cesium';
import {
  viewportBias,
  placesNearViewRecovery,
} from './annotations/annotationResolver.js';
import { unavailablePlaceSearch } from './search/placeSearch.js';

/**
 * Points of Interest per city.
 * Each city has 5 POIs; the first is the default fly-to landmark.
 *
 * Field reference:
 *   alt            — RANGE (distance from target in meters), NOT absolute altitude
 *   heading        — optimal camera heading in degrees (0=N, 90=E, 180=S, 270=W)
 *   pitch          — camera tilt in degrees (negative = looking down)
 *   buildingHeight — estimated height of landmark center above ground (meters)
 */
export const CITY_POIS = {
  ankara: {
    name: 'Ankara',
    groundElevation: 938,
    viewBounds: {
      southwest: { lat: 39.75, lng: 32.65 },
      northeast: { lat: 40.08, lng: 33.05 },
    },
    pois: [
      {
        name: 'Anıtkabir',
        lat: 39.925055,
        lon: 32.836954,
        alt: 650,
        pitch: -25,
        heading: 45,
        buildingHeight: 25,
      },
      {
        name: 'Atakule',
        lat: 39.886389,
        lon: 32.855833,
        alt: 550,
        pitch: -20,
        heading: 30,
        buildingHeight: 125,
      },
      {
        name: 'Kızılay Meydanı',
        lat: 39.92077,
        lon: 32.85411,
        alt: 750,
        pitch: -28,
        heading: 0,
        buildingHeight: 35,
      },
      {
        name: 'Ankara Kalesi',
        lat: 39.941944,
        lon: 32.864444,
        alt: 600,
        pitch: -25,
        heading: 270,
        buildingHeight: 40,
      },
      {
        name: 'Cumhurbaşkanlığı Külliyesi',
        lat: 39.9311,
        lon: 32.7997,
        alt: 700,
        pitch: -25,
        heading: 180,
        buildingHeight: 30,
      },
    ],
  },
  istanbul: {
    name: 'İstanbul',
    groundElevation: 40,
    viewBounds: {
      southwest: { lat: 40.85, lng: 28.65 },
      northeast: { lat: 41.25, lng: 29.35 },
    },
    pois: [
      {
        name: 'Ayasofya-i Kebir Cami-i Şerifi',
        lat: 41.0086,
        lon: 28.9802,
        alt: 600,
        pitch: -25,
        heading: 225,
        buildingHeight: 55,
      },
      {
        name: 'Galata Kulesi',
        lat: 41.0256,
        lon: 28.9741,
        alt: 450,
        pitch: -20,
        heading: 45,
        buildingHeight: 67,
      },
      {
        name: '15 Temmuz Şehitler Köprüsü',
        lat: 41.0456,
        lon: 29.0343,
        alt: 1100,
        pitch: -22,
        heading: 60,
        buildingHeight: 64,
      },
      {
        name: 'Topkapı Sarayı',
        lat: 41.0115,
        lon: 28.9833,
        alt: 650,
        pitch: -30,
        heading: 0,
        buildingHeight: 25,
      },
      {
        name: 'Çamlıca Kulesi',
        lat: 41.0164,
        lon: 29.0664,
        alt: 850,
        pitch: -18,
        heading: 30,
        buildingHeight: 369,
      },
    ],
  },
  izmir: {
    name: 'İzmir',
    groundElevation: 10,
    viewBounds: {
      southwest: { lat: 38.32, lng: 27.02 },
      northeast: { lat: 38.52, lng: 27.28 },
    },
    pois: [
      {
        name: 'İzmir Saat Kulesi',
        lat: 38.4189,
        lon: 27.1287,
        alt: 400,
        pitch: -22,
        heading: 90,
        buildingHeight: 25,
      },
      {
        name: 'Kordon Boyu',
        lat: 38.4322,
        lon: 27.1372,
        alt: 700,
        pitch: -25,
        heading: 340,
        buildingHeight: 20,
      },
      {
        name: 'Tarihi Asansör',
        lat: 38.4086,
        lon: 27.1172,
        alt: 450,
        pitch: -20,
        heading: 180,
        buildingHeight: 58,
      },
      {
        name: 'Kadifekale',
        lat: 38.4136,
        lon: 27.1472,
        alt: 650,
        pitch: -30,
        heading: 315,
        buildingHeight: 30,
      },
      {
        name: 'Foça Kalesi',
        lat: 38.6711,
        lon: 26.7553,
        alt: 550,
        pitch: -25,
        heading: 45,
        buildingHeight: 20,
      },
    ],
  },
  mersin: {
    name: 'Mersin',
    groundElevation: 12,
    viewBounds: {
      southwest: { lat: 36.65, lng: 34.45 },
      northeast: { lat: 36.90, lng: 34.75 },
    },
    pois: [
      {
        name: 'Mersin Uluslararası Limanı',
        lat: 36.7950,
        lon: 34.6400,
        alt: 1200,
        pitch: -28,
        heading: 330,
        buildingHeight: 45,
      },
      {
        name: 'Kızkalesi (Deniz Kalesi)',
        lat: 36.4633,
        lon: 34.1461,
        alt: 600,
        pitch: -22,
        heading: 15,
        buildingHeight: 20,
      },
      {
        name: 'Mersin Atatürk Parkı & Sahil',
        lat: 36.7972,
        lon: 34.6306,
        alt: 650,
        pitch: -25,
        heading: 0,
        buildingHeight: 15,
      },
      {
        name: 'Hazreti Mikdat (Muğdat) Camii',
        lat: 36.7869,
        lon: 34.6042,
        alt: 500,
        pitch: -20,
        heading: 45,
        buildingHeight: 60,
      },
      {
        name: 'Cennet-Cehennem Obrukları',
        lat: 36.5236,
        lon: 34.1064,
        alt: 750,
        pitch: -35,
        heading: 180,
        buildingHeight: 70,
      },
    ],
  },
};

/**
 * Absolute full-earth camera preset for the zoom_to_globe voice tool.
 */
export const GLOBE_VIEW = Object.freeze({
  heightM: 18000000,
  pitchDeg: -90,
  durationS: 2.8,
});

/**
 * Fly straight out to the full-earth globe view.
 */
export function flyToGlobeView(viewer, options = {}) {
  const carto = viewer.camera.positionCartographic;
  const longitude = Cesium.Math.toDegrees(carto.longitude);
  const latitude = Cesium.Math.toDegrees(carto.latitude);
  viewer.camera.cancelFlight();
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(
      longitude,
      latitude,
      GLOBE_VIEW.heightM,
    ),
    orientation: {
      heading: 0,
      pitch: Cesium.Math.toRadians(GLOBE_VIEW.pitchDeg),
      roll: 0,
    },
    duration: finitePositive(options.duration) || GLOBE_VIEW.durationS,
    endTransform: Cesium.Matrix4.IDENTITY,
    complete: options.onComplete,
    cancel: options.onCancel,
  });
  return { latitude, longitude, heightM: GLOBE_VIEW.heightM };
}

/**
 * Flat list of locations for backward compatibility.
 */
export const LOCATIONS = Object.entries(CITY_POIS).map(([id, city]) => ({
  id,
  name: city.name,
  lat: city.pois[0].lat,
  lon: city.pois[0].lon,
}));

/**
 * Fly the camera to a landmark using lookAt-based targeting.
 */
export function flyToLandmark(viewer, lat, lon, options = {}) {
  const {
    range = 500,
    pitch = -30,
    heading = 0,
    buildingHeight = 30,
    groundElevation = 0,
    duration = 3.0,
    onStart = null,
    onComplete = null,
    onCancel = null,
    buildingBounds = null,
  } = options;

  const targetCartographic = Cesium.Cartographic.fromDegrees(lon, lat);
  const sampledHeight = viewer.scene.globe?.getHeight(targetCartographic);

  const terrainHeight =
    sampledHeight != null && sampledHeight > 0
      ? sampledHeight
      : groundElevation;

  const bounds = normalizeBuildingBounds(buildingBounds);
  const targetHeight = bounds
    ? terrainHeight + bounds.height / 2
    : terrainHeight + buildingHeight;
  const targetPosition = Cesium.Cartesian3.fromDegrees(lon, lat, targetHeight);
  const boundingRadius = bounds ? buildingBoundingRadius(bounds) : 0;
  const framingRange = bounds
    ? Math.max(
        rangeForBoundingSphere(viewer, boundingRadius),
        boundingRadius * 1.35,
      )
    : range;

  const hpr = new Cesium.HeadingPitchRange(
    Cesium.Math.toRadians(heading),
    Cesium.Math.toRadians(pitch),
    framingRange,
  );

  if (typeof onStart === 'function') {
    try {
      onStart();
    } catch {
      /* no-op */
    }
  }

  viewer.camera.flyToBoundingSphere(
    new Cesium.BoundingSphere(targetPosition, boundingRadius),
    {
      offset: hpr,
      duration,
      complete: () => {
        viewer.camera.lookAt(targetPosition, hpr);
        viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
        if (typeof onComplete === 'function') {
          try {
            onComplete();
          } catch {
            /* no-op */
          }
        }
      },
      cancel: () => {
        if (typeof onCancel === 'function') {
          try {
            onCancel();
          } catch {
            /* no-op */
          }
        }
      },
    },
  );

  return {
    targetPosition,
    boundingRadius,
    range: framingRange,
    buildingBounds: bounds,
  };
}

export function flyToPresetLocation(viewer, locationId, options = {}) {
  const city = CITY_POIS[locationId];
  if (!city) return null;
  if (
    options.viewMode === 'overview' &&
    !finitePositive(options.range) &&
    city.viewBounds
  ) {
    return flyToViewportBounds(viewer, city.viewBounds, {
      duration: options.duration,
      onStart: options.onStart,
      onComplete: options.onComplete,
      onCancel: options.onCancel,
      navigationMode: 'city-overview',
    });
  }
  const poi = city.pois[0];
  return flyToLandmark(viewer, poi.lat, poi.lon, {
    range: poi.alt,
    pitch: poi.pitch,
    heading: poi.heading || 0,
    buildingHeight: poi.buildingHeight || 30,
    buildingBounds: poi.buildingBounds || null,
    groundElevation: city.groundElevation || 0,
    ...options,
  });
}

export function flyToPOI(viewer, cityId, poiIndex, options = {}) {
  const city = CITY_POIS[cityId];
  if (!city || !city.pois[poiIndex]) return null;
  const poi = city.pois[poiIndex];
  return flyToLandmark(viewer, poi.lat, poi.lon, {
    range: poi.alt,
    pitch: poi.pitch,
    heading: poi.heading || 0,
    buildingHeight: poi.buildingHeight || 30,
    buildingBounds: poi.buildingBounds || null,
    groundElevation: city.groundElevation || 0,
    ...options,
  });
}

const POI_STOPWORDS = new Set(['the', 'a', 'an', 'at', 'of', 'in', 'on', 'to', 've', 'ile', 'veya', 'cami', 'camii']);
function poiNameTokens(s) {
  return new Set(
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9ğüşıöç\s]/g, ' ')
      .split(/\s+/)
      .filter((w) => w && !POI_STOPWORDS.has(w)),
  );
}

export function findPoiByName(query) {
  const q = poiNameTokens(query);
  if (q.size === 0) return null;
  let best = null;
  for (const [cityId, city] of Object.entries(CITY_POIS)) {
    city.pois.forEach((poi, index) => {
      const name = poiNameTokens(poi.name);
      if (name.size < 2) return;
      const fullyNamed = [...name].every((w) => q.has(w));
      if (fullyNamed && (!best || name.size > best.size))
        best = { cityId, index, size: name.size };
    });
  }
  return best ? { cityId: best.cityId, index: best.index } : null;
}

export const CANCELLED_SEARCH = Object.freeze({ cancelled: true });

export async function searchAndFlyTo(viewer, query, options = {}) {
  const { placeSearch = unavailablePlaceSearch, signal } = options;
  signal?.throwIfAborted();
  const beforeFly =
    typeof options.beforeFly === 'function' ? options.beforeFly : null;
  const mayFly = () =>
    !signal?.aborted && (beforeFly === null || beforeFly() !== false);
  const outcome = await placeSearch.geocode(query, {
    bias: viewportBias(viewer),
    signal,
  });
  signal?.throwIfAborted();
  const result = outcome.place;
  let lat = result?.lat;
  let lng = result?.lng;
  let label = result?.label || query;
  let types = result?.types || [];
  let viewport = result?.viewport || null;

  const recovered = await placesNearViewRecovery(
    viewer,
    query,
    result && !outcome.fallbackUsed ? { lat, lon: lng } : null,
    signal,
  );
  signal?.throwIfAborted();
  if (recovered) {
    lat = recovered.lat;
    lng = recovered.lon;
    label = recovered.label || label;
    types = recovered.types || [];
    viewport = placesViewportToBounds(recovered.viewport) || viewport;
  } else if (!result) return null;

  const requestedRange = finitePositive(options.range);
  const duration = finitePositive(options.duration) || 3.0;
  const navigationMode = geocodeNavigationMode(types);
  const explicitOverview = options.viewMode === 'overview';

  if (
    !requestedRange &&
    !options.forceClose &&
    (shouldFrameGeocodeViewport(navigationMode) || explicitOverview)
  ) {
    const swath =
      navigationMode === 'area-overview' ? regionFramingPlan(viewport) : null;
    if (swath?.mode === 'swath') {
      if (!mayFly()) return CANCELLED_SEARCH;
      flyToLandmark(viewer, swath.centerLat, swath.centerLng, {
        range: swath.rangeM,
        pitch: swath.pitchDeg,
        heading: swath.headingDeg,
        buildingHeight: 0,
        duration,
        onStart: options.onStart,
        onComplete: options.onComplete,
        onCancel: options.onCancel,
      });
      return {
        label,
        navigationMode: 'natural-region-swath',
        rangeM: swath.rangeM,
      };
    }
    const gateFraming =
      !explicitOverview &&
      (navigationMode === 'city-overview' ||
        navigationMode === 'region-overview');
    const framedViewport = gateFraming
      ? placeFramingViewport(viewport, lat, lng, types)
      : viewport;
    const flight = flyToViewportBounds(viewer, framedViewport, {
      duration,
      navigationMode,
      beforeFly: mayFly,
      onStart: options.onStart,
      onComplete: options.onComplete,
      onCancel: options.onCancel,
    });
    if (flight === CANCELLED_SEARCH) return CANCELLED_SEARCH;
    if (flight) {
      return {
        label,
        navigationMode,
        rangeM: null,
      };
    }
  }

  const shouldResolveBuilding = navigationMode === 'precise-place';
  const buildingBounds = shouldResolveBuilding
    ? await resolveBuildingBounds(lat, lon, query)
    : null;
  const range = requestedRange || defaultRangeForNavigationMode(navigationMode);
  if (!mayFly()) return CANCELLED_SEARCH;
  const flight = flyToLandmark(
    viewer,
    buildingBounds?.lat ?? lat,
    buildingBounds?.lon ?? lng,
    {
      range,
      pitch: buildingPitch(buildingBounds),
      heading: 30,
      buildingHeight: 30,
      buildingBounds,
      duration,
      onStart: options.onStart,
      onComplete: options.onComplete,
      onCancel: options.onCancel,
    },
  );
  return {
    label,
    navigationMode: requestedRange
      ? 'explicit-range'
      : options.forceClose
        ? navigationMode.replace('-overview', '-close')
        : navigationMode,
    rangeM: Math.round(flight.range),
  };
}

function placesViewportToBounds(vp) {
  const low = vp?.low;
  const high = vp?.high;
  if (
    ![low?.latitude, low?.longitude, high?.latitude, high?.longitude].every(
      Number.isFinite,
    )
  )
    return null;
  return {
    southwest: { lat: low.latitude, lng: low.longitude },
    northeast: { lat: high.latitude, lng: high.longitude },
  };
}

export function geocodeNavigationMode(types) {
  const values = new Set(types);
  if (
    values.has('country') ||
    values.has('administrative_area_level_1') ||
    values.has('administrative_area_level_2')
  ) {
    return 'region-overview';
  }
  if (values.has('locality') || values.has('postal_town'))
    return 'city-overview';
  if (
    values.has('sublocality') ||
    values.has('sublocality_level_1') ||
    values.has('neighborhood') ||
    values.has('postal_code')
  ) {
    return 'neighborhood-close';
  }
  if (values.has('route') || values.has('intersection'))
    return 'street-corridor';
  if (
    values.has('park') ||
    values.has('natural_feature') ||
    values.has('campus') ||
    values.has('university') ||
    values.has('airport') ||
    values.has('stadium') ||
    values.has('amusement_park') ||
    values.has('zoo') ||
    values.has('cemetery') ||
    values.has('shopping_mall')
  ) {
    return 'area-overview';
  }
  return 'precise-place';
}

export const REGION_SWATH_SPAN_KM = 400;
const REGION_SWATH_RANGE_M = 280000;
const REGION_SWATH_PITCH_DEG = -35;
const KM_PER_DEGREE = 111.32;

export function viewportMetrics(viewport) {
  const southwest = viewport?.southwest;
  const northeast = viewport?.northeast;
  if (
    !Number.isFinite(southwest?.lat) ||
    !Number.isFinite(southwest?.lng) ||
    !Number.isFinite(northeast?.lat) ||
    !Number.isFinite(northeast?.lng)
  ) {
    return null;
  }

  const latSpanDeg = northeast.lat - southwest.lat;
  const lonSpanDeg = (((northeast.lng - southwest.lng) % 360) + 360) % 360;
  const centerLat = (southwest.lat + northeast.lat) / 2;
  let centerLng = southwest.lng + lonSpanDeg / 2;
  if (centerLng > 180) centerLng -= 360;

  const latSpanKm = Math.abs(latSpanDeg) * KM_PER_DEGREE;
  const lonSpanKm =
    lonSpanDeg * KM_PER_DEGREE * Math.cos(Cesium.Math.toRadians(centerLat));
  return {
    latSpanDeg,
    lonSpanDeg,
    latSpanKm,
    lonSpanKm,
    spanKm: Math.hypot(latSpanKm, lonSpanKm),
    centerLat,
    centerLng,
  };
}

function wrapLongitude(lng) {
  return ((((lng + 180) % 360) + 360) % 360) - 180;
}

export const PLACE_VIEWPORT_MAX_SPAN_KM = 300;
export const PLACE_ANCHOR_OFFSET_RATIO = 0.15;
const PLACE_FALLBACK_HALF_SPAN_KM = 20;

function greatCircleKm(lat1, lng1, lat2, lng2) {
  const dLat = Cesium.Math.toRadians(lat2 - lat1);
  const dLng = Cesium.Math.toRadians(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(Cesium.Math.toRadians(lat1)) *
      Math.cos(Cesium.Math.toRadians(lat2)) *
      Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function placeFramingViewport(
  viewport,
  anchorLat,
  anchorLng,
  types = [],
) {
  if (Array.isArray(types) && types.includes('country')) return viewport;
  const metrics = viewportMetrics(viewport);
  if (!metrics || metrics.spanKm <= PLACE_VIEWPORT_MAX_SPAN_KM) return viewport;
  if (!Number.isFinite(anchorLat) || !Number.isFinite(anchorLng))
    return viewport;

  const offsetKm = greatCircleKm(
    anchorLat,
    anchorLng,
    metrics.centerLat,
    metrics.centerLng,
  );
  if (offsetKm <= metrics.spanKm * PLACE_ANCHOR_OFFSET_RATIO) return viewport;

  const latHalfDeg = PLACE_FALLBACK_HALF_SPAN_KM / KM_PER_DEGREE;
  const cosLat = Math.max(0.05, Math.cos(Cesium.Math.toRadians(anchorLat)));
  const lngHalfDeg = PLACE_FALLBACK_HALF_SPAN_KM / (KM_PER_DEGREE * cosLat);
  const wrapLng = (lng) => ((((lng + 180) % 360) + 360) % 360) - 180;
  return {
    southwest: {
      lat: Math.max(-89.9, anchorLat - latHalfDeg),
      lng: wrapLng(anchorLng - lngHalfDeg),
    },
    northeast: {
      lat: Math.min(89.9, anchorLat + latHalfDeg),
      lng: wrapLng(anchorLng + lngHalfDeg),
    },
  };
}

export function regionFramingPlan(viewport) {
  const metrics = viewportMetrics(viewport);
  if (!metrics) return null;
  const { latSpanKm, lonSpanKm, spanKm, centerLat, centerLng } = metrics;

  if (spanKm <= REGION_SWATH_SPAN_KM) return { mode: 'full', spanKm };

  return {
    mode: 'swath',
    spanKm,
    centerLat,
    centerLng,
    rangeM: REGION_SWATH_RANGE_M,
    pitchDeg: REGION_SWATH_PITCH_DEG,
    headingDeg: latSpanKm >= lonSpanKm ? 0 : 90,
  };
}

function defaultRangeForNavigationMode(mode) {
  if (mode === 'area-overview') return 1400;
  if (mode === 'street-corridor') return 900;
  return 250;
}

function shouldFrameGeocodeViewport(mode) {
  return (
    mode === 'region-overview' ||
    mode === 'city-overview' ||
    mode === 'area-overview' ||
    mode === 'street-corridor'
  );
}

function flyToViewportBounds(viewer, viewport, options = {}) {
  const {
    duration = 3.0,
    beforeFly = null,
    onStart = null,
    onComplete = null,
    onCancel = null,
    navigationMode = 'overview',
  } = options;
  const southwest = viewport?.southwest;
  const northeast = viewport?.northeast;
  if (
    !Number.isFinite(southwest?.lat) ||
    !Number.isFinite(southwest?.lng) ||
    !Number.isFinite(northeast?.lat) ||
    !Number.isFinite(northeast?.lng)
  ) {
    return false;
  }

  const metrics = viewportMetrics(viewport);
  const latitudePadding = Math.max(0.05, Math.abs(metrics.latSpanDeg) * 0.12);
  const longitudePadding = Math.max(0.05, metrics.lonSpanDeg * 0.12);
  const paddedLonSpan = metrics.lonSpanDeg + longitudePadding * 2;
  const south = Math.max(-89.9, southwest.lat - latitudePadding);
  const north = Math.min(89.9, northeast.lat + latitudePadding);
  const rectangle =
    paddedLonSpan >= 360
      ? Cesium.Rectangle.fromDegrees(-180, south, 180, north)
      : Cesium.Rectangle.fromDegrees(
          wrapLongitude(southwest.lng - longitudePadding),
          south,
          wrapLongitude(southwest.lng + metrics.lonSpanDeg + longitudePadding),
          north,
        );
  if (typeof beforeFly === 'function' && beforeFly() === false)
    return CANCELLED_SEARCH;
  if (typeof onStart === 'function') {
    try {
      onStart();
    } catch {
      /* no-op */
    }
  }
  viewer.camera.flyTo({
    destination: rectangle,
    duration,
    endTransform: Cesium.Matrix4.IDENTITY,
    complete: () => {
      if (typeof onComplete === 'function') {
        try {
          onComplete();
        } catch {
          /* no-op */
        }
      }
    },
    cancel: () => {
      if (typeof onCancel === 'function') {
        try {
          onCancel();
        } catch {
          /* no-op */
        }
      }
    },
  });
  return {
    targetPosition: Cesium.Cartesian3.fromDegrees(
      metrics.centerLng,
      metrics.centerLat,
      0,
    ),
    boundingRadius: 0,
    range: null,
    viewBounds: viewport,
    navigationMode,
  };
}

function normalizeBuildingBounds(bounds) {
  if (!bounds) return null;
  const height = finitePositive(bounds.height);
  const width = finitePositive(bounds.width);
  const depth = finitePositive(bounds.depth);
  if (!height || !width || !depth) return null;
  return { ...bounds, height, width, depth };
}

function buildingBoundingRadius(bounds) {
  const halfHeight = bounds.height / 2;
  const halfWidth = bounds.width / 2;
  const halfDepth = bounds.depth / 2;
  return Math.hypot(halfHeight, halfWidth, halfDepth) * 1.18;
}

function rangeForBoundingSphere(viewer, radius) {
  const frustum = viewer.camera.frustum;
  const verticalFov = Number(frustum?.fov) || Cesium.Math.toRadians(60);
  const aspectRatio = Math.max(0.5, Number(frustum?.aspectRatio) || 1);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * aspectRatio);
  const limitingFov = Math.min(verticalFov, horizontalFov);
  const occupiedViewportFraction = 0.57;
  const desiredAngularRadius = (limitingFov * occupiedViewportFraction) / 2;
  return (radius / Math.sin(desiredAngularRadius)) * 1.05;
}

function buildingPitch(bounds) {
  if (!bounds) return -25;
  const footprint = Math.max(bounds.width, bounds.depth);
  const ratio = bounds.height / Math.max(footprint, 1);
  if (ratio >= 2.5) return -12;
  if (ratio >= 1.2) return -22;
  if (ratio <= 0.35) return -45;
  return -32;
}

async function resolveBuildingBounds(lat, lon, query) {
  const overpassQuery = `
    [out:json][timeout:10];
    (
      way(around:180,${lat},${lon})["building"];
      relation(around:180,${lat},${lon})["building"];
      way(around:180,${lat},${lon})["man_made"];
      relation(around:180,${lat},${lon})["man_made"];
      way(around:180,${lat},${lon})["tourism"="attraction"];
      relation(around:180,${lat},${lon})["tourism"="attraction"];
    );
    out tags center geom;
  `;
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 6000);
  try {
    const elements = await applicationServices.boundaries.query(overpassQuery, { signal: controller.signal });
    return selectBuildingBounds(Array.isArray(elements) ? elements : [], lat, lon, query);
  } catch {
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

function selectBuildingBounds(elements, targetLat, targetLon, query) {
  const queryWords = normalizedWords(query);
  const candidates = [];
  for (const element of elements) {
    const coordinates = elementCoordinates(element);
    if (coordinates.length < 3) continue;
    const bounds = coordinateBounds(coordinates, targetLat);
    if (!bounds || bounds.width < 2 || bounds.depth < 2) continue;
    const tags = element.tags || {};
    const center = element.center || averageCoordinate(coordinates);
    const distanceM = approximateDistanceM(
      targetLat,
      targetLon,
      center.lat,
      center.lon,
    );
    const nameWords = normalizedWords(
      [tags.name, tags['name:en'], tags['name:tr'], tags.official_name, tags.alt_name]
        .filter(Boolean)
        .join(' '),
    );
    const nameScore = wordOverlap(queryWords, nameWords);
    const containsTarget = pointInPolygon(targetLon, targetLat, coordinates);
    const height = buildingHeightFromTags(tags, bounds);
    candidates.push({
      lat: center.lat,
      lon: center.lon,
      height,
      width: bounds.width,
      depth: bounds.depth,
      osmName: tags.name || tags['name:en'] || null,
      osmType: element.type,
      osmId: element.id,
      score: nameScore * 1000 + (containsTarget ? 500 : 0) - distanceM,
    });
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.score - a.score);
  const { score, ...best } = candidates[0];
  return best;
}

function elementCoordinates(element) {
  if (Array.isArray(element.geometry)) {
    return element.geometry.filter(
      (point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lon),
    );
  }
  if (!Array.isArray(element.members)) return [];
  return element.members.flatMap((member) =>
    Array.isArray(member.geometry)
      ? member.geometry.filter(
          (point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lon),
        )
      : [],
  );
}

function coordinateBounds(coordinates, latitude) {
  const latitudes = coordinates.map((point) => point.lat);
  const longitudes = coordinates.map((point) => point.lon);
  const south = Math.min(...latitudes);
  const north = Math.max(...latitudes);
  const west = Math.min(...longitudes);
  const east = Math.max(...longitudes);
  return {
    width: approximateDistanceM(latitude, west, latitude, east),
    depth: approximateDistanceM(south, west, north, west),
  };
}

function buildingHeightFromTags(tags, bounds) {
  const explicitHeight = parseMeters(tags.height || tags['building:height']);
  if (explicitHeight) return explicitHeight;
  const levels = Number.parseFloat(tags['building:levels']);
  const roofHeight = parseMeters(tags['roof:height']) || 0;
  if (Number.isFinite(levels) && levels > 0) return levels * 3.3 + roofHeight;
  return Math.max(12, Math.min(80, Math.max(bounds.width, bounds.depth) * 0.8));
}

function parseMeters(value) {
  if (value == null) return 0;
  const number = Number.parseFloat(String(value).replace(',', '.'));
  if (!Number.isFinite(number) || number <= 0) return 0;
  return /\b(ft|feet|foot)\b/i.test(String(value)) ? number * 0.3048 : number;
}

function averageCoordinate(coordinates) {
  const total = coordinates.reduce(
    (sum, point) => ({
      lat: sum.lat + point.lat,
      lon: sum.lon + point.lon,
    }),
    { lat: 0, lon: 0 },
  );
  return {
    lat: total.lat / coordinates.length,
    lon: total.lon / coordinates.length,
  };
}

function normalizedWords(value) {
  return new Set(
    String(value || '')
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9ğüşıöç]+/g, ' ')
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 2),
  );
}

function wordOverlap(left, right) {
  let matches = 0;
  for (const word of left) {
    if (right.has(word)) matches++;
  }
  return matches;
}

function pointInPolygon(lon, lat, coordinates) {
  let inside = false;
  for (
    let index = 0, previous = coordinates.length - 1;
    index < coordinates.length;
    previous = index++
  ) {
    const a = coordinates[index];
    const b = coordinates[previous];
    const intersects =
      a.lat > lat !== b.lat > lat &&
      lon <
        ((b.lon - a.lon) * (lat - a.lat)) / (b.lat - a.lat || Number.EPSILON) +
          a.lon;
    if (intersects) inside = !inside;
  }
  return inside;
}

function approximateDistanceM(latA, lonA, latB, lonB) {
  const latitudeScale = 111320;
  const longitudeScale =
    latitudeScale * Math.cos(Cesium.Math.toRadians((latA + latB) / 2));
  return Math.hypot(
    (latB - latA) * latitudeScale,
    (lonB - lonA) * longitudeScale,
  );
}

function finitePositive(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}