import * as Cesium from 'cesium';
import { MAP_STACKS } from './catalog.js';
import { photorealUnavailableReason } from './availability.js';
import { keySetupRequirement } from '../keySetupCore.mjs';
import {
  createOsmImagery,
  createEsriImagery,
  createIonImagery,
  ESRI_ATTRIBUTION_HTML,
} from './imagery.js';
import { createWorldTerrain, createKeylessTerrain } from './terrain.js';

const HGM_API_KEY = 'rXKdDZxXgj2hgFspEC4BKG4HMittQ0Y6';

/** HGM Hibrit Uydu: Açık Kaynak OSM Tabanı + HGM Resmi Yol/Cadde Çizgileri */
class HgmHybridImageryProvider extends Cesium.UrlTemplateImageryProvider {
  constructor() {
    super({
      url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      maximumLevel: 18,
      credit: 'OpenStreetMap contributors + Harita Genel Müdürlüğü (HGM) Yol Ağı',
    });

    this._hgmPattern = `/hgm-servis/harita/yolorta_uydu/{z}/{x}/{y}.png?apikey=${HGM_API_KEY}`;
    this._turkeyRect = Cesium.Rectangle.fromDegrees(25.5, 35.8, 44.8, 42.2);
  }

  requestImage(x, y, level) {
    const tileRect = this.tilingScheme.tileXYToRectangle(x, y, level);
    const inTurkey = Cesium.Rectangle.intersection(tileRect, this._turkeyRect);

    // Türkiye dışı veya düşük zoom ise standart OSM karesini al
    if (!inTurkey || level < 6 || level > 18) {
      return super.requestImage(x, y, level);
    }

    const osmUrl = `https://tile.openstreetmap.org/${level}/${x}/${y}.png`;
    const hgmUrl = this._hgmPattern
      .replace('{z}', String(level))
      .replace('{x}', String(x))
      .replace('{y}', String(y));

    const loadImg = (url) =>
      new Promise((resolve) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = url;
      });

    return Promise.all([loadImg(osmUrl), loadImg(hgmUrl)]).then(([baseImg, hgmImg]) => {
      if (!baseImg) return undefined;
      if (!hgmImg) return baseImg;

      const canvas = document.createElement('canvas');
      canvas.width = baseImg.width || 256;
      canvas.height = baseImg.height || 256;
      const ctx = canvas.getContext('2d');

      ctx.drawImage(baseImg, 0, 0, canvas.width, canvas.height);
      ctx.drawImage(hgmImg, 0, 0, canvas.width, canvas.height);

      return canvas;
    });
  }
}

function createHgmUyduImagery() {
  return new HgmHybridImageryProvider();
}

function createHgmFizikiImagery() {
  return new Cesium.UrlTemplateImageryProvider({
    url: `/hgm-servis/hgmrasterhrt//fiziki/{z}/{x}/{y}.png?apikey=${HGM_API_KEY}`,
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    rectangle: Cesium.Rectangle.fromDegrees(25.5, 35.8, 44.8, 42.2),
    minimumLevel: 5,
    maximumLevel: 18,
    credit: 'Harita Genel Müdürlüğü (HGM) Fiziki',
  });
}

/** İBB Harita İstanbul Resmi Ortofoto / Uydu Sağlayıcısı */
function createIbbImagery() {
  return new Cesium.UrlTemplateImageryProvider({
    url: '/ibb-ortofoto/cbsc2/UYDU/Layers/_alllayers/L{arcLevel}/R{arcRow}/C{arcCol}.jpg',
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    rectangle: Cesium.Rectangle.fromDegrees(27.8, 40.7, 29.9, 41.6),
    minimumLevel: 10,
    maximumLevel: 19,
    credit: 'İBB İstanbul Ortofoto',
  });
}

/** Select sources and setup guidance without putting provider branches in the controller. */
export function createDefaultMapSources({
  googleTileset = null,
  cesiumToken = '',
  googleApiKey = '',
} = {}) {
  const ionToken = String(cesiumToken || '').trim();
  const hasIon = Boolean(ionToken);
  const hasGoogle = Boolean(String(googleApiKey || '').trim());
  const terrain = {
    id: hasIon ? 'world' : 'keyless',
    create: hasIon
      ? (request) => createWorldTerrain(ionToken, request)
      : createKeylessTerrain,
  };
  return {
    defaultId: googleTileset ? 'photoreal' : 'esri-imagery',
    unknownId: 'photoreal',
    recoveryId: googleTileset ? 'photoreal' : null,
    state: { hasCesiumIonToken: hasIon },
    sources: MAP_STACKS.map((descriptor) => {
      const common = {
        descriptor,
        available: !descriptor.requiresIon || hasIon,
        unavailableReason: descriptor.requiresIon
          ? keySetupRequirement('cesium-ion')
          : null,
      };
      if (descriptor.kind === 'photoreal')
        return {
          ...common,
          available: Boolean(googleTileset),
          unavailableReason: photorealUnavailableReason(hasIon || hasGoogle),
          tileset: googleTileset,
        };

      const imagery =
        descriptor.kind === 'ion'
          ? () => createIonImagery(descriptor.style, ionToken)
          : descriptor.id === 'osm'
            ? createOsmImagery
            : descriptor.id === 'ibb'
              ? createIbbImagery
              : descriptor.id === 'hgm-uydu'
                ? createHgmUyduImagery
                : descriptor.id === 'hgm-fiziki'
                  ? createHgmFizikiImagery
                  : createEsriImagery;

      return {
        ...common,
        imagery,
        terrain,
        ...(descriptor.id === 'esri-imagery'
          ? {
              credit: ESRI_ATTRIBUTION_HTML,
              constructionFallback: {
                id: 'osm',
                message: 'Esri Satellite is unavailable; using OSM',
              },
              tileFailureFallback: {
                id: 'osm',
                threshold: 2,
                message: 'Esri Satellite tile requests failed; using OSM',
              },
            }
          : {}),
      };
    }),
  };
}