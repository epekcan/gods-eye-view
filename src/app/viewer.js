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
        preserveDrawingBuffer: true
      } 
    },
  });

  try {
    viewer.targetFrameRate = 60;

    const { scene } = viewer;

    // Yerküre ve arazi derinlik testlerini devre dışı bırakır;
    // uçak ikonlarının arazinin/3D modellerin altına gömülmesini engeller
    scene.globe.show = true;
    scene.globe.depthTestAgainstTerrain = false;

    // Atmosfer ve ışıklandırma
    scene.skyAtmosphere.show = true;
    scene.skyAtmosphere.atmosphereLightIntensity = 18.0;
    scene.skyAtmosphere.saturationShift = -0.12;
    scene.skyAtmosphere.brightnessShift = -0.08;

    // Türkiye odaklı kuşbakışı başlangıç açısı
    const targetDestination = Cesium.Cartesian3.fromDegrees(35.2433, 39.0000, 1100000.0);
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