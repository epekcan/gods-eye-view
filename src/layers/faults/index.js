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
        // MTA Resmi GeoWebCache WMS Servisi (DRYGEO2)
        const provider = new Cesium.WebMapServiceImageryProvider({
          url: 'https://mtayenicbs-geoserver.mta.gov.tr/geoserver/gwc/service/wms',
          layers: 'mta:DRYGEO2',
          parameters: {
            service: 'WMS',
            version: '1.1.1',
            request: 'GetMap',
            transparent: 'true',
            format: 'image/png',
            styles: '',
          },
        });

        _imageryLayer = viewer.imageryLayers.addImageryProvider(provider);
        _imageryLayer.show = false;
        _imageryLayer.alpha = 0.95;
      } catch (err) {
        console.warn('[Data:Faults] MTA WMS servisi başlatılamadı:', err);
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
        countLabel: 'MTA WMS',
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