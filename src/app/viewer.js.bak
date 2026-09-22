import * as Cesium from 'cesium';

/**
 * Creates and configures the base Cesium viewer.
 * @param {Object} options
 * @param {HTMLElement|string} options.container Target DOM element or ID.
 * @param {HTMLElement|string} options.creditContainer Attribution container.
 * @param {boolean} [options.enableFlyIn=false] Whether to animate the camera on load.
 * @returns {Cesium.Viewer}
 */
export function createApplicationViewer({ container, creditContainer, enableFlyIn = false }) {
  if (!container || !creditContainer) {
    throw new TypeError('Viewer and credit containers are required');
  }

  const viewer = new Cesium.Viewer(container, {
    timeline: false,
    animation: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    fullscreenButton: false,
    vrButton: false,
    selectionIndicator: false,
    infoBox: false,
    baseLayer: false,
    creditContainer,
    msaaSamples: 4,
    contextOptions: { 
      webgl: { 
        preserveDrawingBuffer: true // Retained for canvas capture/export
      } 
    },
  });

  try {
    viewer.targetFrameRate = 60;

    // Atmospheric styling & globe configuration
    const { scene } = viewer;
    scene.globe.show = false; // Intended for standalone 3D Tilesets
    scene.skyAtmosphere.show = true;
    scene.skyAtmosphere.atmosphereLightIntensity = 18.0;
    scene.skyAtmosphere.saturationShift = -0.12;
    scene.skyAtmosphere.brightnessShift = -0.08;

    const targetDestination = Cesium.Cartesian3.fromDegrees(32.8597, 39.9334, 1800000.0);
    const targetOrientation = {
      heading: Cesium.Math.toRadians(0.0),
      pitch: Cesium.Math.toRadians(-89.0),
      roll: 0.0,
    };

    if (enableFlyIn) {
      viewer.camera.flyTo({
        destination: targetDestination,
        orientation: targetOrientation,
        duration: 2.0,
        easingFunction: Cesium.EasingFunction.QUADRATIC_OUT,
      });
    } else {
      viewer.camera.setView({
        destination: targetDestination,
        orientation: targetOrientation,
      });
    }

    return viewer;
  } catch (error) {
    viewer.destroy();
    throw error;
  }
}