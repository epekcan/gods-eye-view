import * as Cesium from 'cesium';
import {
  EARTHQUAKE_OVERLAY_SOURCE_ID,
  EARTHQUAKE_OVERLAY_COHORT_LIMIT,
  EARTHQUAKE_OVERLAY_COLLISION_CAPACITY,
  depthColor,
  createEarthquakeOverlayEntry,
  selectEarthquakeOverlayCohort,
  mapAnalystRecord,
} from './model.js';

export { createUsgsEarthquakeSource } from './source.js';

export function createEarthquakesLayer({ source, overlayHost } = {}) {
  if (!source || typeof source.getSnapshot !== 'function')
    throw new TypeError('Earthquakes require a snapshot source');
  if (!overlayHost) throw new TypeError('Earthquakes require an overlay host');

  let _viewer = null;
  let _dataSource = null;
  let _count = 0;
  let _lastError = null;
  let _records = [];
  let _lastUpdatedMs = Date.now();

  return {
    id: 'earthquakes',
    label: 'Depremler',

    async init(viewer) {
      if (_viewer) throw new Error('Earthquake layer is already initialized');
      _viewer = viewer;
      _dataSource = new Cesium.CustomDataSource('earthquakes');
      await viewer.dataSources.add(_dataSource);
      _dataSource.show = false;
      overlayHost.setVisible(EARTHQUAKE_OVERLAY_SOURCE_ID, false);
      console.log('[Data:Earthquakes] Initialized');
    },

    show() {
      if (_dataSource) _dataSource.show = true;
      overlayHost.setVisible(EARTHQUAKE_OVERLAY_SOURCE_ID, true);
    },

    hide() {
      if (_dataSource) _dataSource.show = false;
      overlayHost.clearSource(EARTHQUAKE_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(EARTHQUAKE_OVERLAY_SOURCE_ID, false);
    },

    async update({ signal } = {}) {
      try {
        const rows = await source.getSnapshot({ signal });
        _records = rows;
        _count = rows.length;
        _lastError = null;
        _lastUpdatedMs = Date.now();

        if (_dataSource) {
          _dataSource.entities.removeAll();
          const overlayEntries = [];

          for (const [index, row] of rows.entries()) {
            const { stableId, lon, lat, depthKm, mag, place } = row;
            const groundPos = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
            const calloutHeight = Math.max(25000, (mag || 2.0) * 35000); // Büyüklüğe göre yükselen dikey hat
            const elevatedPos = Cesium.Cartesian3.fromDegrees(lon, lat, calloutHeight);
            const color = depthColor(depthKm || 10);

            // 1. Zemin Çemberi / Dalga Halkası
            _dataSource.entities.add({
              id: `earthquake:${stableId}`,
              position: groundPos,
              ellipse: {
                semiMajorAxis: Math.max(12000, (mag || 2.0) * 16000),
                semiMinorAxis: Math.max(12000, (mag || 2.0) * 16000),
                material: color.withAlpha(0.35),
                outline: true,
                outlineColor: color.withAlpha(0.85),
                outlineWidth: 2,
                height: 0,
              },
            });

            // 2. Dikey Callout Çizgisi (Deprem derinlik/şiddet sütunu)
            _dataSource.entities.add({
              id: `earthquake-stem:${stableId}`,
              polyline: {
                positions: [groundPos, elevatedPos],
                width: 2,
                material: new Cesium.PolylineGlowMaterialProperty({
                  glowPower: 0.25,
                  color: color.withAlpha(0.9),
                }),
              },
            });

            // 3. Tepe Noktası & Etiket
            _dataSource.entities.add({
              id: `earthquake-label:${stableId}`,
              position: elevatedPos,
              point: {
                pixelSize: Math.max(6, Math.min(14, (mag || 2) * 2.2)),
                color: color,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 1,
              },
              label: {
                text: `M${mag?.toFixed(1)} ${place ? '· ' + place.split('(')[0].trim() : ''}`,
                font: '11px monospace',
                style: Cesium.LabelStyle.FILL_AND_OUTLINE,
                fillColor: Cesium.Color.WHITE,
                outlineColor: Cesium.Color.BLACK,
                outlineWidth: 2,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
                pixelOffset: new Cesium.Cartesian2(0, -9),
                distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 4500000),
              },
            });

            overlayEntries.push(
              createEarthquakeOverlayEntry({
                id: stableId,
                position: groundPos,
                magnitude: mag,
                accent: color.toCssColorString(),
                place,
              })
            );
          }

          overlayHost.setEntries(
            EARTHQUAKE_OVERLAY_SOURCE_ID,
            selectEarthquakeOverlayCohort(overlayEntries),
            {
              cohortLimit: EARTHQUAKE_OVERLAY_COHORT_LIMIT,
              collisionCapacity: EARTHQUAKE_OVERLAY_COLLISION_CAPACITY,
            }
          );
        }

        console.log(`[Data:Earthquakes] Updated: ${_count} events`);
      } catch (e) {
        console.warn('[Data:Earthquakes] Fetch error:', e);
        _lastError = e?.message || 'Earthquake source unavailable';
      }
    },

    destroy() {
      if (_viewer && _dataSource) {
        _viewer.dataSources.remove(_dataSource, true);
      }
      _dataSource = null;
      _viewer = null;
      overlayHost.clearSource(EARTHQUAKE_OVERLAY_SOURCE_ID);
      overlayHost.setVisible(EARTHQUAKE_OVERLAY_SOURCE_ID, false);
    },

    getRecords() {
      return _records.map((r, i) => mapAnalystRecord(r, i));
    },

    getStatus() {
      return {
        status: _lastError ? 'error' : 'ready',
        disposition: _lastError ? 'error' : 'ready',
        count: _count,
        error: _lastError,
        observedAtMs: _lastUpdatedMs,
        source: 'Kandilli / AFAD',
      };
    },
  };
}