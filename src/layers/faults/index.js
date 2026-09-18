import * as Cesium from 'cesium';

/**
 * MTA Diri Fay Hatları Katmanı
 * MTA GeoWebCache (EPSG:3857) karo şablonu üzerinden doğrudan render eder.
 */
export function createMtaFaultsLayer() {
  let _viewer = null;
  let _imageryLayer = null;
  let _enabled = false;

  return {
    id: 'mta-faults',
    name: 'Diri Fay Hatları',
    icon: '⚡',
    source: 'MTA Yerbilimleri',
    showInTogglePanel: true,
    updateInterval: 0,

    async init(viewer) {
      _viewer = viewer;

      // GeoWebCache ve EPSG:3857 standart tile grid sağlayıcısı
      const provider = new Cesium.UrlTemplateImageryProvider({
        url: '/mta-wms?service=WMS&request=GetMap&layers=mta:DRYGEO2&styles=&format=image/png&transparent=true&version=1.1.1&srs=EPSG:3857&width=256&height=256&bbox={westProjected},{southProjected},{eastProjected},{northProjected}',
        tilingScheme: new Cesium.WebMercatorTilingScheme(),
        maximumLevel: 18,
        enablePickFeatures: false,
      });

      _imageryLayer = viewer.imageryLayers.addImageryProvider(provider);
      _imageryLayer.show = false;
      _imageryLayer.alpha = 1.0;
      viewer.imageryLayers.raiseToTop(_imageryLayer);

      return true;
    },

    async enable(viewer) {
      _enabled = true;
      if (_imageryLayer) {
        _imageryLayer.show = true;
        viewer.imageryLayers.raiseToTop(_imageryLayer);
      }
      return true;
    },

    async disable(viewer) {
      _enabled = false;
      if (_imageryLayer) _imageryLayer.show = false;
      return true;
    },

    async update() {
      return true;
    },

    async destroy(viewer = _viewer) {
      _enabled = false;
      if (_imageryLayer && viewer) {
        viewer.imageryLayers.remove(_imageryLayer, true);
        _imageryLayer = null;
      }
      _viewer = null;
      return true;
    },

    getStats() {
      return {
        count: null,
        countLabel: 'AKTİF',
        status: _enabled ? 'nominal' : 'offline',
        source: 'MTA Yerbilimleri',
        lastUpdate: _enabled ? Date.now() : null,
      };
    },
  };
}