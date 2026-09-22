import * as Cesium from 'cesium';

export function createMtaFaultsLayer() {
  let _viewer = null;
  let _dataSource = null;
  let _enabled = false;

  return {
    id: 'mta-faults',
    name: 'Diri Fay Hatları',
    icon: '⚡',
    source: 'Açık Jeoloji',
    showInTogglePanel: true,
    updateInterval: 0,

    async init(viewer) {
      _viewer = viewer;
      try {
        _dataSource = await Cesium.GeoJsonDataSource.load(
          'https://raw.githubusercontent.com/fraxen/tectonicplates/master/GeoJSON/PB2002_boundaries.json',
          {
            clampToGround: true,
            stroke: Cesium.Color.RED.withAlpha(0.85),
            strokeWidth: 2.5,
          }
        );
        _dataSource.show = false;
        await viewer.dataSources.add(_dataSource);
      } catch (err) {
        console.warn('Fay hatları yüklenemedi:', err);
      }
      return true;
    },

    async enable(viewer) {
      _enabled = true;
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

    async destroy(viewer = _viewer) {
      _enabled = false;
      if (_dataSource && viewer) {
        viewer.dataSources.remove(_dataSource, true);
        _dataSource = null;
      }
      _viewer = null;
      return true;
    },

    getStats() {
      return {
        count: _dataSource ? _dataSource.entities.values.length : null,
        countLabel: 'AKTİF',
        status: _enabled ? 'nominal' : 'offline',
        source: 'Açık Jeoloji',
        lastUpdate: _enabled ? Date.now() : null,
      };
    },
  };
}