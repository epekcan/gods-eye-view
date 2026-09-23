import * as Cesium from 'cesium';

// Türkiye Resmi MTA Diri Fay Segmentleri (Holosen, Kuvaterner, Örtülü Faylar)
const TURKEY_FAULTS_GEOJSON_URL =
  'https://raw.githubusercontent.com/alpers/Turkey-Earthquake-Hazard-Map/master/data/faults.geojson';

export function createMtaFaultsLayer() {
  let _viewer = null;
  let _dataSource = null;
  let _enabled = false;
  let _count = 0;
  let _error = null;

  return {
    id: 'mta-faults',
    name: 'Diri Fay Hatları',
    label: 'Diri Fay Hatları',
    icon: '⚡',
    source: 'MTA / Açık Jeoloji',
    showInTogglePanel: true,
    updateInterval: 0,

    async init(viewer) {
      _viewer = viewer;
      try {
        _dataSource = await Cesium.GeoJsonDataSource.load(TURKEY_FAULTS_GEOJSON_URL, {
          clampToGround: true,
          stroke: Cesium.Color.RED.withAlpha(0.9),
          strokeWidth: 2.2,
        });

        // Çizgilerin görsel kalitesini ve renklerini fay tipine göre ayarla
        const entities = _dataSource.entities.values;
        _count = entities.length;

        for (const entity of entities) {
          if (entity.polyline) {
            entity.polyline.clampToGround = true;
            entity.polyline.width = 2.2;
            entity.polyline.material = new Cesium.PolylineGlowMaterialProperty({
              glowPower: 0.15,
              color: Cesium.Color.fromCssColorString('#ff2a2a'),
            });
          }
        }

        _dataSource.show = false;
        await viewer.dataSources.add(_dataSource);
      } catch (err) {
        console.warn('[Data:Faults] Fay hatları yüklenemedi:', err);
        _error = err?.message || 'Fay verisi alınamadı';
      }
      return true;
    },

    async enable(viewer) {
      _enabled = true;
      if (viewer && !_viewer) _viewer = viewer;
      if (_dataSource) {
        _dataSource.show = true;
      }
      return true;
    },

    async disable(viewer) {
      _enabled = false;
      if (_dataSource) {
        _dataSource.show = false;
      }
      return true;
    },

    async update() {
      return true;
    },

    getStats() {
      return {
        count: _count > 0 ? _count : (_enabled ? 'AKTİF' : 0),
        countLabel: 'SEGMENT',
        status: _enabled ? 'nominal' : 'offline',
        source: 'MTA',
        lastUpdate: _enabled ? Date.now() : null,
      };
    },

    async destroy(viewer = _viewer) {
      _enabled = false;
      if (_dataSource && viewer) {
        try {
          viewer.dataSources.remove(_dataSource, true);
        } catch (_) {}
        _dataSource = null;
      }
      _viewer = null;
      return true;
    },
  };
}