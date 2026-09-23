import * as Cesium from 'cesium';

export function createMtaFaultsLayer() {
  let _viewer = null;
  let _imageryLayer = null;
  let _enabled = false;

  return {
    id: 'mta-faults',
    name: 'Diri Fay Hatları',
    label: 'Diri Fay Hatları',
    icon: '⚡',
    source: 'MTA Yerbilimleri',
    showInTogglePanel: true,
    updateInterval: 0,

    async init(viewer) {
      _viewer = viewer;
      try {
        // MTA Resmi WMS / Yerbilimleri Diri Fay Servisi
        const provider = new Cesium.WebMapServiceImageryProvider({
          url: 'https://yerbilimleri.mta.gov.tr/geoserver/mta/wms',
          layers: 'mta:dirifay',
          parameters: {
            transparent: 'true',
            format: 'image/png',
          },
        });

        _imageryLayer = viewer.imageryLayers.addImageryProvider(provider);
        _imageryLayer.show = false;
        _imageryLayer.alpha = 0.95;
      } catch (err) {
        console.warn('MTA Diri Fay katmanı başlatılamadı:', err);
      }
      return true;
    },

    async enable(viewer) {
      _enabled = true;
      if (viewer && !_viewer) _viewer = viewer;
      if (_imageryLayer) {
        _imageryLayer.show = true;
      }
      return true;
    },

    async disable(viewer) {
      _enabled = false;
      if (_imageryLayer) {
        _imageryLayer.show = false;
      }
      return true;
    },

    async update() {
      return true;
    },

    getStats() {
      return {
        count: _enabled ? 'AKTİF' : 0,
        countLabel: 'MTA',
        status: _enabled ? 'nominal' : 'offline',
        source: 'MTA Yerbilimleri',
        lastUpdate: _enabled ? Date.now() : null,
      };
    },

    async destroy(viewer = _viewer) {
      _enabled = false;
      if (_imageryLayer && viewer) {
        try {
          viewer.imageryLayers.remove(_imageryLayer, true);
        } catch (_) {}
        _imageryLayer = null;
      }
      _viewer = null;
      return true;
    },
  };
}