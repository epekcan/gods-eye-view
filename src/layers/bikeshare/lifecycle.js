import { BIKESHARE_SELECTED_OVERLAY_SOURCE_ID } from './policy.js';

export function createLifecycle({
  state: layerState,
  services,
  parts,
  source,
}) {
  const methods = {
    /**
     * İBB katman durumunu ilklendirir.
     * @param {Cesium.Viewer} viewer - Cesium viewer örneği.
     */
    init(viewer) {
      layerState._viewer = viewer;
      layerState._enabled = false;
      layerState._count = 0;
      layerState._lastUpdate = null;
      layerState._loading = false;
      layerState._error = null;

      layerState._overlayHost?.setVisible?.(
        BIKESHARE_SELECTED_OVERLAY_SOURCE_ID,
        false,
      );

      console.log('[Data:IBB] İBB Şehir Haritası katmanı hazırlandı.');
    },

    /**
     * Katmanı aktif eder. Harita altlığı doğrudan Map Stack üzerinden yönetilir.
     * @param {Cesium.Viewer} viewer - Cesium viewer örneği.
     */
    enable(viewer) {
      layerState._viewer = viewer;
      layerState._enabled = true;
      layerState._error = null;
      layerState._count = 1;
      layerState._lastUpdate = Date.now();
    },

    /**
     * Katmanı pasif yapar.
     * @param {Cesium.Viewer} viewer - Cesium viewer örneği.
     */
    disable(viewer) {
      layerState._enabled = false;
      layerState._count = 0;
      layerState._loading = false;
    },

    /**
     * Kaynakları temizler.
     * @param {Cesium.Viewer} viewer - Cesium viewer örneği.
     */
    destroy(viewer) {
      this.disable(viewer);
      layerState._viewer = null;
    },
  };

  return { methods };
}