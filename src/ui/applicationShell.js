import { createFrameRateMonitor } from './frameRateMonitor.js';
import { createStateChannel } from '../app/stateChannel.js';
import { setSplitFlapText } from '../splitFlap.js';
import { UiLifetime } from './uiLifetime.js';
import { RecordingControls } from './recordingControls.js';
import { readShellElements } from './shellElements.js';
import { CockpitViewController, CockpitDisplayPortal } from './cockpit.js';
import { ContextControls } from './context.js';
import { CctvControls } from './cctv.js';
import { RadioControls } from './radio.js';
import { LocationControls } from './location.js';
import { bindClearLayersControl } from './layers.js';
import { createMapSourceControls } from './mapSource.js';
import {
  VisualEffects,
  STYLES,
  GLOBAL_POST_DEFAULTS,
  STYLE_PRESET_DEFAULTS,
  MILITARY_DETECTION_PRESET,
} from './effects.js';
import { bindDisplayControls } from './displayControls.js';
import {
  bindApplicationShortcuts,
  createStyleParameters,
} from './visualInput.js';
import { PanelLayoutController } from './panelLayoutController.js';
import {
  bindPanelDisclosure,
  collapsePanelOnEscape,
  createHoverDisclosure,
} from './panelDisclosure.js';
import * as Cesium from 'cesium';
import {
  BLOOM_SCALE_VERSION,
  clampBloomIntensity,
  decodeBloomIntensity,
} from '../bloom.js';

import {
  aircraftTrackingTarget,
  enterCockpitWithTracking,
} from '../cockpitTracking.js';

import {
  isExplicitLayerStateOrigin,
  LayerStateCoordinator,
} from '../data/layerState.js';

import {
  ALLOCATION_STRATEGIES,
  canonicalizeDensity,
  defaultDensityForProfile,
  normalizeAllocationStrategy,
  normalizeProfile,
  profileForDensity,
} from '../data/detectionPolicy.js';

import { canPresentDeferredStatusNotice } from '../loadingFeedback.js';
import { ShellFeedback } from './shellFeedback.js';
import { PanelPositionControls } from './panelPositionControls.js';
import { cockpitEntryAllowed } from '../contextModePolicy.js';

import {
  applyCockpitVisionStageIntensities,
  captureCockpitVisionBaseline,
  normalizeCockpitVisionMode,
} from '../cockpitVisionPolicy.js';
import {
  applyContactsDetection,
  shareCacheNeedsHeal,
  shareableDetectionState,
} from '../contactsDetectionPolicy.js';
import { formatAwarenessLabel } from '../data/militaryAwarenessEngine.js';
import { runCctvLayerEnableTransition } from '../cctvFocusPolicy.js';
import {
  registerCctvFocusRequestListener,
  routeCctvFocusRequest,
} from '../cctvFocusRequest.js';
import {
  flyToWorldTarget,
  registerWorldFocusRequestListener,
  routeWorldFocusRequest,
} from '../worldFocus.js';
import {
  beginDeferredNavigation,
  reassertNavigationHandoff,
  registerNavigationAuthorityListener,
  runExplicitNavigation,
  stampInitialShareGesture,
} from '../navigationPolicy.js';

const SHARE_PANEL_STATE_SPECS = Object.freeze([
  { id: 'control-panel', pinnable: true },
  { id: 'location-bar', pinnable: true },
  { id: 'data-panel' },
  { id: 'cctv-panel' },
  { id: 'radio-panel' },
  { id: 'scene-panel' },
  { id: 'global-context-panel' },
  { id: 'pp-toggles' },
  { id: 'param-slider-panel' },
]);

const COCKPIT_ENTRY_COLLAPSE_PANEL_IDS = Object.freeze([
  'data-panel',
  'cctv-panel',
  'scene-panel',
  'pp-toggles',
  'global-context-panel',
  'radio-panel',
]);
const DETECTION_ALLOCATION_STORAGE_KEY = 'gev:detection-allocation:v1';

const STYLE_STATUS_LABELS = {
  normal: 'STANDART',
  retro: 'CRT',
  surveillance: 'NVG',
  thermal: 'FLIR',
  anime: 'ANIME',
  noir: 'NOIR',
  snow: 'KAR',
};

export class StyleManager {
  constructor(
    viewer,
    { mapStackController = null, placeSearch, services } = {},
  ) {
    const {
      IntelHUD,
      ShareLinkManager,
      OrbitController,
      CelestialRing,
      initTrackedReadout,
      initWorldOverlay,
      initDetection,
      setDetectionStyle,
      trafficLayer,
      flightsLayer,
      militaryFlightsLayer,
      isTr3b,
      toggleTr3b,
      satellitesLayer,
      cctvLayer,
      bikeshareLayer,
      aisLiveVesselsLayer,
      militaryAwarenessLayer,
      cachedGroundFloor,
      cachedMeshFloor,
      GROUND_FLOOR_LIFT_M,
      meshFloorPreferred,
      warmGroundFloor,
      sampleMeshFloorCells,
      holdContinuousRender,
      releaseContinuousRender,
      governorRequestRender,
      setScopeMaskEnabled,
      setScopeMaskFeather,
      setScopeTerminusOverride,
      clampScopeTerminusPct,
      fetchRegionalBrief,
      regionalDistanceM,
      weatherCodeLabel,
    } = services;
    this.services = services;
    this._lifetime = new UiLifetime();
    this._recording = new RecordingControls({
      syncShareState: () => this._syncShareState(),
    });
    Object.assign(this, readShellElements());
    this._panelPosition = new PanelPositionControls({
      syncPanelCollapseButton: (panel) => this._syncPanelCollapseButton(panel),
      layoutRightPanels: () => this._layoutRightPanels(),
      syncCctvPanelViewport: () => this._syncCctvPanelViewport(),
      showToast: (message) => this._showToast(message),
    });
    this._feedback = new ShellFeedback({
      readLayers: () => this._dataManager?.getAll?.() || [],
    });
    this._panelLayout = new PanelLayoutController({
      readHud: () => ({
        visible: this.hud.visible,
        variant: this.hud.getVariant(),
      }),
      scheduleCockpitLayout: () => this.cockpitView?.scheduleContextLayout(),
      syncPanelCollapseButton: (panel) => this._syncPanelCollapseButton(panel),
      readDisplayScrollTop: () =>
        this._displayPortalScrollRestoreOwner === 'standard'
          ? this._standardDisplayScrollTop
          : this._ppToggles?.scrollTop || 0,
    });
    this.viewer = viewer;
    this.mapStackController = mapStackController;
    this.placeSearch = placeSearch;
    this._visualEffects = new VisualEffects({
      viewer,
      requestRender: governorRequestRender,
      holdRender: holdContinuousRender,
      releaseRender: releaseContinuousRender,
    });
    this.activeStyle = 'normal';
    document.documentElement.dataset.gevStyle = this.activeStyle;

    this._detectionUserOverridden = false;

    this._shareTrackingAcquiringKey = null;
    this._shareTrackingNoticeGeneration = 0;
    this._globeResetPromise = null;
    this._dataManager = null;

    this._windowResizeHandler = null;
    this._cctvRequestFocusHandler = null;
    this._removeCctvRequestFocusListener = null;
    this._worldRequestFocusHandler = null;
    this._removeWorldRequestFocusListener = null;
    this._removeNavigationAuthorityListener = null;
    this._navigationOwnerChangedRemover = null;
    this._navigationGeneration = 0;
    this._activeLocationSearchGeneration = null;
    this._initialShareState = null;
    this._initialShareNavigationGeneration = null;
    this._initialShareRestoreTimeout = null;
    this._layerStateCoordinator = null;
    this._layerStateRestorePromise = null;
    this._awarenessSelectedHandler = null;
    this._awarenessClearedHandler = null;
    this._disposed = false;

    this._detectionAllocationBtns = [
      document.getElementById('detection-allocation-elastic'),
      document.getElementById('detection-allocation-weighted'),
    ].filter(Boolean);

    let storedDetectionAllocation = 'ELASTIC';
    try {
      storedDetectionAllocation =
        localStorage.getItem(DETECTION_ALLOCATION_STORAGE_KEY) || 'ELASTIC';
    } catch {
      /* storage can be unavailable in privacy/test contexts */
    }
    this._detectionAllocationPreference = normalizeAllocationStrategy(
      storedDetectionAllocation,
    );

    this._mapStackChangeHandler = null;

    this._cockpitDisplayPortal = null;
    this._cockpitDisplayModeHandler = null;

    this._activeLocationId = null;
    this._expandedCityId = null;
    this._activePoiIndex = null;
    this._currentTarget = null;
    this._currentPoi = null;
    this._searchedLocationLabel = null;
    this._trafficTransitionTimer = null;
    this._lastTrafficChipUpdateAt = 0;

    this.orbitController = new OrbitController(viewer);
    this._orbitIndicator = null;

    this.hud = new IntelHUD(viewer, { placeSearch });
    this._recording.hud = this.hud;
    this._cockpitVisionMode = 'optical';
    this._cockpitVisionRestore = null;
    this._cockpitPanelRestore = null;
    this._cockpitContextCollapsedForDataPanel = false;
    this._contactsDetectionRestore = null;
    this.cockpitView = new CockpitViewController(viewer, {
      services: {
        flightsLayer,
        militaryFlightsLayer,
        isTr3b,
        toggleTr3b,
        militaryAwarenessLayer,
        formatAwarenessLabel,
        cachedGroundFloor,
        cachedMeshFloor,
        GROUND_FLOOR_LIFT_M,
        meshFloorPreferred,
        warmGroundFloor,
        sampleMeshFloorCells,
        holdContinuousRender,
        releaseContinuousRender,
        fetchRegionalBrief,
        regionalDistanceM,
        weatherCodeLabel,
      },
      onVisionChange: (mode, active, options) =>
        this._setCockpitVision(mode, active, options),
      onCameraTakeover: () =>
        this._stampNavigation({ cancelPendingSelection: false }),
      getInheritedVisionLabel: () =>
        STYLE_STATUS_LABELS[this.activeStyle] ||
        String(this.activeStyle || 'normal').toUpperCase(),
      isEntryAllowed: () =>
        cockpitEntryAllowed({
          contextMode: this._contextMode,
          contextModeChanging: this._contextModeChanging,
          flightsEnabled: !!this._dataManager?.isEnabled('flights'),
          militaryEnabled: !!this._dataManager?.isEnabled('military'),
        }),
      onEntered: () => {
        this._cockpitPanelRestore = new Map();
        this._cockpitContextCollapsedForDataPanel = false;
        for (const panelId of COCKPIT_ENTRY_COLLAPSE_PANEL_IDS) {
          const panel = document.getElementById(panelId);
          if (panel) {
            this._cockpitPanelRestore.set(
              panelId,
              panel.classList.contains('collapsed'),
            );
          }
          this.setPanelCollapsed(panelId, true, {
            persist: false,
            syncShare: false,
          });
        }
        this.cockpitView?.setContextCollapsed(false);
        this.cockpitView?.setSignalCollapsed(false, { user: true });
      },
      onExited: () => {
        const restore = this._cockpitPanelRestore;
        this._cockpitPanelRestore = null;
        this._cockpitContextCollapsedForDataPanel = false;
        if (!restore) return;
        for (const [panelId, wasCollapsed] of restore) {
          this.setPanelCollapsed(panelId, wasCollapsed, {
            persist: false,
            syncShare: false,
          });
        }
      },
      restoreTrackingFrame: (entity) => {
        const [layerId, ...idParts] = String(entity?.gevTrackedId || '').split(
          ':',
        );
        const trackedId = idParts.join(':');
        if (!trackedId) return false;
        if (layerId === 'flights')
          return flightsLayer.refocusTrackedById?.(trackedId) === true;
        if (layerId === 'military')
          return militaryFlightsLayer.refocusTrackedById?.(trackedId) === true;
        return false;
      },
    });

    this.celestialRing = new CelestialRing(viewer, {
      enabled: false,
      onAutoDisable: () =>
        this.setCelestialRingEnabled(false, {
          syncShare: !!this.shareLinkManager,
          focus: false,
        }),
    });

    this.shareLinkManager = new ShareLinkManager(viewer, {
      onRestore: async (state) => {
        const {
          style,
          bloom,
          sharpen,
          bloomIntensity,
          bloomVersion,
          sharpenIntensity,
          hudVariant,
          hudVisible,
          detectionMode,
          detectionDensity,
          detectionAllocation,
          detectionFadePct,
          detectionOutsideOpacityPct,
          celestialRing,
          scopeEnabled,
          scopeFeatherPct,
          scopeTerminusPct,
          mapStack,
          panelState,
          styleParams,
        } = state || {};
        if (style && style !== 'normal' && style !== 'ai-edit') {
          this.setStyle(style, {
            applyPreset: true,
            revealParameters: false,
            restore: true,
          });
        }
        if (
          styleParams &&
          style &&
          this.stages[style] &&
          STYLES[style]?.uniforms
        ) {
          for (const [uniformName, uniformValue] of Object.entries(
            styleParams,
          )) {
            if (!Object.hasOwn(STYLES[style].uniforms, uniformName)) continue;
            this.stages[style].uniforms[uniformName] = uniformValue;
          }
          this._updateSliderPanel(style, { reveal: false });
        }
        if (typeof bloomIntensity === 'number' && this._bloomSlider) {
          const intensity = decodeBloomIntensity(bloomIntensity, bloomVersion);
          this._setBloomIntensity(intensity, { syncShare: false });
        }
        if (typeof sharpenIntensity === 'number' && this._sharpenSlider) {
          const pct = Math.max(0, Math.min(100, Math.round(sharpenIntensity)));
          this._sharpenSlider.value = String(pct);
          this._sharpenSliderValue.textContent = `${pct}%`;
          this._applySharpenIntensity(pct / 100);
        }
        if (typeof bloom === 'boolean') this._setBloomEnabled(bloom);
        if (typeof sharpen === 'boolean') this._setSharpenEnabled(sharpen);
        if (hudVariant) this._setHudVariant(hudVariant);
        if (typeof hudVisible === 'boolean') {
          this.hud.setMode(hudVisible ? 'on' : 'off');
          this._updateHudButtonState();
        }
        if (
          typeof detectionDensity === 'number' &&
          this._detectionDensitySlider
        ) {
          const pct = canonicalizeDensity(detectionDensity);
          this._detectionDensitySlider.value = String(pct);
          this._detectionDensityValue.textContent = `${pct}%`;
          this._applyDetectionDensityFromUi();
        }
        if (detectionAllocation) {
          this._setDetectionAllocation(detectionAllocation, {
            syncShare: false,
            persist: false,
          });
        }
        if (typeof detectionFadePct === 'number' && this._detectionFadeSlider) {
          this._detectionFadeSlider.value = String(detectionFadePct);
        }
        if (
          typeof detectionOutsideOpacityPct === 'number' &&
          this._detectionOpacitySlider
        ) {
          this._detectionOpacitySlider.value = String(
            detectionOutsideOpacityPct,
          );
        }
        this._applyDetectionFadeFromUi();
        if (detectionMode) this._setDetectionMode(detectionMode);
        if (typeof celestialRing === 'boolean') {
          this.setCelestialRingEnabled(celestialRing, {
            syncShare: false,
            focus: false,
          });
        }
        if (typeof scopeEnabled === 'boolean') {
          setScopeMaskEnabled(scopeEnabled);
          this._scopeBtn?.classList.toggle('active', scopeEnabled);
          this._scopeBtn?.setAttribute('aria-pressed', String(scopeEnabled));
        }
        if (typeof scopeFeatherPct === 'number' && this._scopeFeatherSlider) {
          const pct = Math.max(0, Math.min(100, Math.round(scopeFeatherPct)));
          this._scopeFeatherSlider.value = String(pct);
          if (this._scopeFeatherValue)
            this._scopeFeatherValue.textContent = `${pct}%`;
          setScopeMaskFeather(pct / 100);
        }
        if (scopeTerminusPct === null) setScopeTerminusOverride(null);
        else if (typeof scopeTerminusPct === 'number') {
          const pinned = clampScopeTerminusPct(scopeTerminusPct);
          setScopeTerminusOverride(pinned == null ? null : pinned / 100);
        }
        const mapStackRestore = mapStack
          ? this._setMapStack(mapStack, { syncShare: false })
          : Promise.resolve();
        if (panelState) this._restorePanelState(panelState);
        await mapStackRestore;
        this._syncShareState();
      },
      isNavigationCurrent: (generation) =>
        generation === this._navigationGeneration,
      cancelOwnedNavigation: () => this.viewer.camera.cancelFlight(),
    });
    this.shareLinkManager.setPanelStateProvider(() =>
      this._buildSharePanelState(),
    );
    this.shareLinkManager.setStyleParamStateProvider((styleName) => {
      const shader = STYLES[styleName];
      const stage = this.stages[styleName];
      if (!shader?.uniforms || !stage) return null;
      return Object.fromEntries(
        Object.keys(shader.uniforms).map((uniformName) => [
          uniformName,
          stage.uniforms[uniformName],
        ]),
      );
    });
    this._shareState = createStateChannel(() => this._readShareState());
    this._shareState.subscribe(
      ({ state }) => {
        this.shareLinkManager.onToggleChange(
          state.bloomEnabled,
          state.sharpenEnabled,
          state.options,
        );
      },
      { emitCurrent: false },
    );
    this._locationState = createStateChannel(
      () => this._locationLookup?.getState() || null,
    );
    this._locationState.subscribe(
      ({ state, change }) => {
        this._handleLocationSearchState(state, change);
      },
      { emitCurrent: false },
    );
    this._initialShareState = this.shareLinkManager.parseInitialHash();

    this._models3dModeBtns = [
      document.getElementById('models3d-mode-proximity'),
      document.getElementById('models3d-mode-all'),
    ];
    this._models3dEnabled = true;
    this._models3dMode = 'proximity';

    initWorldOverlay(viewer);

    initDetection(
      viewer,
      [
        trafficLayer,
        flightsLayer,
        militaryFlightsLayer,
        satellitesLayer,
        cctvLayer,
        bikeshareLayer,
        aisLiveVesselsLayer,
      ],
      (modeLabel) => {
        this._updateDetectionButton(modeLabel);
      },
    );
    initTrackedReadout(viewer);
    setDetectionStyle(this.activeStyle);
    this._applyDetectionDensityFromUi();

    this._initStages();
    this._initBloomSharpen();
    this._initUI();
    this._initMapStackControl();
    this._initPanelChrome();
    this._initLeftPanelAdaptiveLayout();
    this._initRightPanelAdaptiveLayout();
    this._initRadioPanel();
    this._initCctvPanel();
    this._initGlobalContextPanel();
    this._initLocationBar();
    this._initShareButton();
    this._initClearSelectedLayersButton();
    this._initHUDToggle();
    this._initModels3dToggle();
    this._applyGlobalPostDefaults();
    this._initOrbit();
    this._initRecordingOverlay();
    this._startAnimationLoop();
    this._startTrafficChipTicker();
    this._updateStyleMiniStatus();
    this._updateLocationMiniStatus();

    const savedState = this._initialShareState;
    this._initialShareRestorePromise = savedState
      ? new Promise((resolve) => {
          this._resolveInitialShareRestore = resolve;
        })
      : Promise.resolve({ status: 'not-requested', share: null, layers: [] });
    if (savedState) {
      this._hasShareState = true;
      this._initialShareNavigationGeneration = this._beginDeferredNavigation(
        'shared view',
        { cancelPendingSelection: false },
      );
      this._initialShareRestoreTimeout = setTimeout(() => {
        this._initialShareRestoreTimeout = null;
        if (this._disposed) return;
        const generation = this._initialShareNavigationGeneration;
        const applyCamera =
          Number.isInteger(generation) &&
          this._reassertNavigationHandoff(generation);
        void (async () => {
          try {
            const share = await this.shareLinkManager.applyState(savedState, {
              applyCamera,
              navigationToken: generation,
            });
            const layers = await (this._layerStateRestorePromise ||
              Promise.resolve([]));
            const tracking =
              share.camera === 'applied'
                ? await this._layerStateCoordinator?.restoreShareTrackingSelection?.()
                : {
                    status: 'superseded',
                    cleared:
                      this._layerStateCoordinator?.cancelPendingShareTracking?.(
                        'shared-camera-superseded',
                        { clearSelection: true },
                      ) === true,
                  };
            this.shareLinkManager.completeInitialRestore();
            this._settleInitialShareRestore({
              status: 'settled',
              share,
              layers,
              tracking,
            });
          } catch (error) {
            this.shareLinkManager.completeInitialRestore();
            this._settleInitialShareRestore({
              status: 'failed',
              error: String(error?.message || error),
              share: null,
              layers: [],
            });
          }
        })();
      }, 1500);
    } else {
      this._syncShareState();
    }
    this._initialShareGestureHandler = () => {
      if (
        this._disposed ||
        !this._hasShareState ||
        !this._resolveInitialShareRestore
      )
        return;
      stampInitialShareGesture((options) => this._stampNavigation(options));
    };
    this.viewer?.canvas?.addEventListener(
      'pointerdown',
      this._initialShareGestureHandler,
      {
        passive: true,
      },
    );
    this.viewer?.canvas?.addEventListener(
      'wheel',
      this._initialShareGestureHandler,
      {
        passive: true,
      },
    );

    this._layoutRightPanels();
    this._syncCctvPanelViewport();
    this._windowResizeHandler = () => {
      this._scheduleRightPanelLayout({ reconsiderAutoCollapse: true });
      this._syncCctvPanelViewport();
      this._scheduleLeftPanelLayout({ reconsiderAutoCollapse: true });
    };
    window.addEventListener('resize', this._windowResizeHandler);
    this._feedback.observeVisibility();
    this._cctvRequestFocusHandler = (event) =>
      routeCctvFocusRequest(
        event,
        (activate, focus) => this._runExplicitCctvFocus(activate, focus),
        (cameraId, durationSec) => cctvLayer.focusCamera(cameraId, durationSec),
      );
    this._removeCctvRequestFocusListener = registerCctvFocusRequestListener(
      window,
      this._cctvRequestFocusHandler,
    );
    this._worldRequestFocusHandler = (event) =>
      routeWorldFocusRequest(
        event,
        (detail, fly) => this._runExplicitWorldFocus(detail, fly),
        (detail) => flyToWorldTarget(this.viewer, detail),
      );
    this._removeWorldRequestFocusListener = registerWorldFocusRequestListener(
      window,
      this._worldRequestFocusHandler,
    );
    this._navigationOwnerChangedRemover =
      viewer.trackedEntityChanged.addEventListener((entity) => {
        if (entity && !this._disposed)
          this._stampNavigation({ cancelPendingSelection: false });
      });
    this._removeNavigationAuthorityListener =
      registerNavigationAuthorityListener(window, (event) => {
        if (this._disposed) return;
        this._stampNavigation({
          cancelPendingSelection:
            event?.detail?.cancelPendingSelection !== false,
        });
      });
  }

  get stages() {
    return this._visualEffects.stages;
  }
  get transitions() {
    return this._visualEffects.transitions;
  }
  get bloomEnabled() {
    return this._visualEffects.bloomEnabled;
  }
  get sharpenEnabled() {
    return this._visualEffects.sharpenEnabled;
  }
  get _bloomStage() {
    return this._visualEffects.bloomStage;
  }
  get _sharpenStage() {
    return this._visualEffects.sharpenStage;
  }

  _stampNavigation({
    cancelPendingSelection = true,
    clearSearchedLocation = true,
  } = {}) {
    const { flightsLayer, militaryFlightsLayer, satellitesLayer } =
      this.services;
    this._navigationGeneration += 1;
    if (clearSearchedLocation) this.clearSearchedLocation();
    if (cancelPendingSelection) {
      if (
        this._hasShareState &&
        this._resolveInitialShareRestore &&
        !this._layerStateCoordinator
      ) {
        this._initialShareSelectionSuperseded = true;
      }
      const passivelyClearedShareSelection =
        this._layerStateCoordinator?.cancelPendingShareTracking?.(
          'superseded-by-explicit-navigation',
          { clearSelection: true },
        ) === true;
      try {
        flightsLayer.cancelPendingTrackingRestore?.();
      } catch {
        /* best effort */
      }
      try {
        militaryFlightsLayer.cancelPendingTrackingRestore?.();
      } catch {
        /* best effort */
      }
      try {
        satellitesLayer.cancelPendingTrackingRestore?.();
      } catch {
        /* best effort */
      }
      if (!passivelyClearedShareSelection && !flightsLayer.getTrackedInfo?.()) {
        this._dataManager?.setLayerParams(
          'flights',
          {
            selectedFlightsTrackingId: null,
          },
          { origin: 'tool' },
        );
      }
      if (
        !passivelyClearedShareSelection &&
        !militaryFlightsLayer.getTrackedInfo?.()
      ) {
        this._dataManager?.setLayerParams(
          'military',
          {
            selectedMilitaryTrackingId: null,
          },
          { origin: 'tool' },
        );
      }
      if (
        !passivelyClearedShareSelection &&
        !satellitesLayer.getTrackedInfo?.()
      ) {
        this._dataManager?.setLayerParams(
          'satellites',
          {
            selectedSatTrackingId: null,
          },
          { origin: 'tool' },
        );
      }
    }
    if (this._activeLocationSearchGeneration !== null) {
      this._settleLocationSearchUi(this._activeLocationSearchGeneration);
    }
    return this._navigationGeneration;
  }

  _settleLocationSearchUi(generation) {
    if (this._activeLocationSearchGeneration !== generation) return;
    this._activeLocationSearchGeneration = null;
    this._locationSearch?.classList.remove('searching', 'expanded');
    if (this._locationSearch) this._locationSearch.value = '';
    this._locationSearch?.blur();
  }

  _releaseFollowCamera({
    preserveVesselSelection = true,
    preserveCameraFlight = false,
    trackingOrigin = 'tool',
  } = {}) {
    const {
      interruptCameraMotion,
      flightsLayer,
      militaryFlightsLayer,
      satellitesLayer,
      aisLiveVesselsLayer,
      militaryAwarenessLayer,
      rocketLaunchesLayer,
    } = this.services;
    let contactSelected = false;
    try {
      contactSelected = Boolean(
        militaryAwarenessLayer.releaseCameraOwnership?.({
          preserveVesselSelection,
          origin: trackingOrigin,
        }),
      );
    } catch {
      try {
        flightsLayer.stopTracking?.({ origin: trackingOrigin });
      } catch {
        /* best-effort release */
      }
      try {
        militaryFlightsLayer.stopTracking?.({ origin: trackingOrigin });
      } catch {
        /* best-effort release */
      }
      if (!preserveVesselSelection) {
        try {
          aisLiveVesselsLayer.clearSelection?.();
        } catch {
          /* best-effort release */
        }
      }
    }
    try {
      satellitesLayer.stopTracking?.({ origin: trackingOrigin });
    } catch {
      /* best-effort release */
    }
    try {
      rocketLaunchesLayer.releaseCameraOwnership?.();
    } catch {
      /* best-effort release */
    }
    this.viewer.trackedEntity = undefined;
    interruptCameraMotion('explicit-navigation');
    this._stopOrbit();
    if (!preserveCameraFlight) this.viewer.camera.cancelFlight();
    try {
      this.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    } catch {
      /* teardown race */
    }
    return contactSelected;
  }

  _runExplicitNavigation(noun, navigate, releaseOptions = undefined) {
    return runExplicitNavigation({
      disposed: this._disposed,
      cockpitActive: !!this.cockpitView?.active,
      noun,
      showToast: (text) => this._showToast(text),
      stamp: () => this._stampNavigation(),
      release: () => this._releaseFollowCamera(releaseOptions),
      navigate,
    });
  }

  _beginDeferredNavigation(
    noun = 'location',
    { cancelPendingSelection = true } = {},
  ) {
    return beginDeferredNavigation({
      disposed: this._disposed,
      cockpitActive: !!this.cockpitView?.active,
      noun,
      showToast: (text) => this._showToast(text),
      stamp: () =>
        this._stampNavigation({
          cancelPendingSelection,
          clearSearchedLocation: false,
        }),
    });
  }

  _reassertNavigationHandoff(generation) {
    return reassertNavigationHandoff({
      generation,
      currentGeneration: this._navigationGeneration,
      cockpitActive: !!this.cockpitView?.active,
      disposed: this._disposed,
      showToast: (text) => this._showToast(text),
      release: () => {
        this.clearSearchedLocation();
        return this._releaseFollowCamera();
      },
    });
  }

  beginDeferredLocationNavigation() {
    return this._beginDeferredNavigation('location');
  }

  reassertDeferredLocationNavigation(generation) {
    return this._reassertNavigationHandoff(generation);
  }

  runImmediateLocationNavigation(navigate) {
    return this.runImmediateNavigation('location', navigate);
  }

  runImmediateNavigation(noun, navigate, releaseOptions = undefined) {
    return this._runExplicitNavigation(noun, navigate, releaseOptions);
  }

  supersedeDeferredNavigation() {
    return this._stampNavigation();
  }

  _runExplicitWorldFocus(detail, fly) {
    return this._runExplicitNavigation(detail?.kind || 'target', fly);
  }

  getAircraftTrackingTarget() {
    return aircraftTrackingTarget(this.cockpitView?.readAircraftInfo?.());
  }

  _reclampDraggablePanels() {
    return this._panelPosition._reclampDraggablePanels();
  }

  _initStages() {
    this._visualEffects.initStyles();
  }

  _setStageIntensity(stage, value) {
    this._visualEffects.setStageIntensity(stage, value);
  }

  _syncStagesEnabledFromIntensity() {
    this._visualEffects.syncStagesEnabledFromIntensity();
  }

  _syncContactsDetection() {
    if (this._contextModeChanging) return;
    const result = applyContactsDetection({
      active: this._contextMode === 'flights',
      restore: this._contactsDetectionRestore,
      styleOwnsDetection:
        !this._detectionUserOverridden &&
        Boolean(STYLE_PRESET_DEFAULTS[this.activeStyle]?.detection),
      getState: () => {
        const state = this.getDetectionState();
        return { mode: state.detectionMode, densityPct: state.densityPct };
      },
      applyPreset: () => this._applyDetectionPreset(MILITARY_DETECTION_PRESET),
      restoreState: (state) => this._applyDetectionPreset(state),
    });
    const hadOwnership = Boolean(this._contactsDetectionRestore);
    this._contactsDetectionRestore = result.restore;
    if (
      !shareCacheNeedsHeal({
        changed: result.changed,
        hadOwnership,
        hasOwnership: Boolean(result.restore),
      })
    )
      return;
    if (result.changed) this._syncDetectionUiFromEngine();
    this._syncShareState();
  }

  _setCockpitVision(mode, active, { revealParameters = false } = {}) {
    const next = active ? normalizeCockpitVisionMode(mode) : 'optical';
    if (!this.stages) return;
    if (!active) {
      if (this._cockpitVisionRestore) {
        for (const [name, intensity] of Object.entries(
          this._cockpitVisionRestore,
        )) {
          if (this.stages[name])
            this._setStageIntensity(this.stages[name], intensity);
        }
      }
      this._cockpitVisionRestore = null;
      this._cockpitVisionMode = 'optical';
      this._syncIrBoost();
      this._updateSliderPanel(this.activeStyle, { reveal: false });
      this._revealCockpitStyleParameters({ openDisplay: revealParameters });
      return;
    }
    if (!this._cockpitVisionRestore) {
      this._cockpitVisionRestore = captureCockpitVisionBaseline(
        this.stages,
        this.transitions,
      );
    }
    if (next === 'optical') {
      applyCockpitVisionStageIntensities(
        this.stages,
        next,
        this._cockpitVisionRestore,
      );
      this._syncStagesEnabledFromIntensity();
      this._cockpitVisionMode = next;
      this._syncIrBoost();
      this._updateSliderPanel(this.activeStyle, { reveal: false });
      this._revealCockpitStyleParameters({ openDisplay: revealParameters });
      return;
    }
    const target = applyCockpitVisionStageIntensities(
      this.stages,
      next,
      this._cockpitVisionRestore,
    );
    this._syncStagesEnabledFromIntensity();
    this._cockpitVisionMode = next;
    this._syncIrBoost();
    this._updateSliderPanel(target || null, { reveal: false });
    this._revealCockpitStyleParameters({ openDisplay: revealParameters });
  }

  _syncIrBoost() {
    const cockpitMode = this.cockpitView?.active
      ? this._cockpitVisionMode
      : null;
    const effective =
      cockpitMode && cockpitMode !== 'optical' ? cockpitMode : this.activeStyle;
    const irBoost =
      effective === 'surveillance' ||
      effective === 'thermal' ||
      effective === 'nvg';
    this._dataManager?.setLayerParams('flights', { irBoost });
    this._dataManager?.setLayerParams('military', { irBoost });
    const scene = this.viewer?.scene;
    if (scene?.fog && irBoost !== this._irBoostActive) {
      this._irBoostActive = irBoost;
      if (irBoost) {
        this._irFogWasEnabled = scene.fog.enabled;
        scene.fog.enabled = false;
      } else if (this._irFogWasEnabled != null) {
        scene.fog.enabled = this._irFogWasEnabled;
        this._irFogWasEnabled = null;
      }
      scene.requestRender?.();
    }
  }

  _syncCockpitInheritedStyle() {
    if (!this.cockpitView?.active || !this.stages) return;
    this._cockpitVisionRestore = Object.fromEntries(
      Object.keys(this.stages).map((name) => [
        name,
        name === this.activeStyle ? 1 : 0,
      ]),
    );
    for (const name of Object.keys(this.stages)) this.transitions.delete(name);
    this.cockpitView.setVisionMode(this.cockpitView.visionMode);
  }

  _revealCockpitStyleParameters({ openDisplay = false } = {}) {
    if (
      !this.cockpitView?.active ||
      !this._sliderPanel?.classList.contains('active')
    )
      return;
    if (
      openDisplay &&
      this._cockpitDisplayToggleBtn?.getAttribute('aria-expanded') !== 'true'
    ) {
      this._setCockpitDisclosure?.('display', true);
      return;
    }
    if (this._cockpitDisplayToggleBtn?.getAttribute('aria-expanded') !== 'true')
      return;
    this._sliderPanel.classList.remove('collapsed');
    this._syncPanelCollapseButton(this._sliderPanel);
    this._lifetime.frame(() =>
      this._lifetime.frame(() => {
        this._sliderPanel?.scrollIntoView?.({ block: 'nearest' });
      }),
    );
  }

  _initBloomSharpen() {
    this._visualEffects.initPostProcess(
      this._sharpenSlider ? parseInt(this._sharpenSlider.value, 10) / 100 : 0.6,
    );
  }

  _getBloomIntensity() {
    return this._visualEffects.bloomIntensity;
  }

  _syncBloomStageEnabled() {
    this._visualEffects.syncBloomEnabled();
  }

  _setBloomIntensity(intensity, { syncShare = true } = {}) {
    const { governorRequestRender } = this.services;
    governorRequestRender('bloom');
    const clamped = clampBloomIntensity(intensity);
    if (this._bloomSlider) this._bloomSlider.value = String(clamped);
    if (this._bloomSliderValue)
      this._bloomSliderValue.textContent = `${clamped}%`;
    this._applyBloomIntensity(clamped);
    if (syncShare) this._syncShareState();
  }

  _applyBloomIntensity(intensity) {
    this._visualEffects.applyBloomIntensity(intensity);
  }

  _setBloomEnabled(enabled) {
    const { governorRequestRender } = this.services;
    governorRequestRender('bloom');
    this._visualEffects.setBloomEnabled(enabled);
    this._syncBloomStageEnabled();
    this._bloomBtn.classList.toggle('active', this.bloomEnabled);
    this._bloomSliderRow.classList.toggle('visible', this.bloomEnabled);
    if (this.bloomEnabled) {
      this._applyBloomIntensity(this._getBloomIntensity());
    }
    this._syncShareState();
    this._layoutRightPanels();
  }

  _applySharpenIntensity(val) {
    this._visualEffects.applySharpenIntensity(val);
  }

  _setSharpenEnabled(enabled) {
    const { governorRequestRender } = this.services;
    governorRequestRender('sharpen');
    this._visualEffects.setSharpenEnabled(enabled);
    this._sharpenBtn.classList.toggle('active', this.sharpenEnabled);
    if (this._sharpenSliderRow) {
      this._sharpenSliderRow.classList.toggle('visible', this.sharpenEnabled);
    }
    if (this.sharpenEnabled && this._sharpenSlider) {
      this._applySharpenIntensity(
        parseInt(this._sharpenSlider.value, 10) / 100,
      );
    }
    this._syncShareState();
    this._layoutRightPanels();
  }

  _initUI() {
    const {
      cycleDetectionMode,
      setScopeMaskEnabled,
      isScopeMaskEnabled,
      setScopeMaskFeather,
    } = this.services;
    this._applicationShortcuts?.destroy();
    this._frameRateMonitor?.destroy();
    this._frameRateMonitor = createFrameRateMonitor({
      viewer: this.viewer,
      documentRef: document,
    });
    this._applicationShortcuts = bindApplicationShortcuts({
      documentRef: document,
      searchInput: this._locationSearch,
      actions: {
        setStyle: (style) => this.setStyle(style),
        dismissSearch: () => {
          if (this._locationSearch.classList.contains('expanded')) {
            this._locationSearch.classList.remove('expanded');
            this._locationSearch.value = '';
            this._locationSearch.blur();
          }
        },
        toggleHud: () => {
          this.shareLinkManager?.claimRestoreLane?.('visual');
          this.hud.toggle();
          this._updateHudButtonState();
          this._syncShareState();
        },
        toggleOrbit: () => this._toggleOrbit(),
        toggleCleanView: () => this.toggleCleanView(),
        toggleLayers: () =>
          document.getElementById('data-panel').classList.toggle('active'),
        cycleDetection: () => {
          this.shareLinkManager?.claimRestoreLane?.('visual');
          this._detectionUserOverridden = true;
          cycleDetectionMode();
          this._syncShareState();
        },
        toggleCctv: () => this._toggleCctvEnabled(),
      },
    });

    this._displayControls?.destroy();
    this._displayControls = bindDisplayControls({
      elements: {
        styleButtons: document.querySelectorAll('.style-btn'),
        bloomButton: this._bloomBtn,
        bloomSlider: this._bloomSlider,
        sharpenButton: this._sharpenBtn,
        sharpenSlider: this._sharpenSlider,
        scopeButton: this._scopeBtn,
        scopeFeatherSlider: this._scopeFeatherSlider,
        hudLayout: this._hudLayoutSelect,
        hudButton: this._hudBtn,
        cleanViewButton: this._cleanViewBtn,
        cleanViewExitButton: this._cleanViewExitBtn,
        densitySlider: this._detectionDensitySlider,
        detectionButton: this._detectionBtn,
        allocationButtons: this._detectionAllocationBtns,
        fadeSliders: [this._detectionFadeSlider, this._detectionOpacitySlider],
        celestialButton: this._celestialBtn,
        modelsButton: this._models3dBtn,
        modelModeButtons: this._models3dBtn ? this._models3dModeBtns : [],
      },
      actions: {
        setStyle: (style) => this.setStyle(style),
        toggleBloom: () => {
          this.shareLinkManager?.claimRestoreLane?.('visual');
          this._setBloomEnabled(!this.bloomEnabled);
        },
        setBloomIntensity: (value) => {
          this.shareLinkManager?.claimRestoreLane?.('visual');
          this._setBloomIntensity(value);
        },
        toggleSharpen: () => {
          this.shareLinkManager?.claimRestoreLane?.('visual');
          this._setSharpenEnabled(!this.sharpenEnabled);
        },
        toggleScope: () => {
          this.shareLinkManager?.claimRestoreLane?.('visual');
          const next = !isScopeMaskEnabled();
          setScopeMaskEnabled(next);
          this._scopeBtn.classList.toggle('active', next);
          this._scopeBtn.setAttribute('aria-pressed', String(next));
          this._syncShareState();
        },
        setScopeFeather: (value) => {
          this.shareLinkManager?.claimRestoreLane?.('visual');
          const pct = Math.max(0, Math.min(100, value || 0));
          if (this._scopeFeatherValue)
            this._scopeFeatherValue.textContent = `${pct}%`;
          setScopeMaskFeather(pct / 100);
          this._syncShareState();
        },
        setSharpenIntensity: (pct) => {
          this.shareLinkManager?.claimRestoreLane?.('visual');
          if (this._sharpenSliderValue)
            this._sharpenSliderValue.textContent = `${pct}%`;
          this._applySharpenIntensity(pct / 100);
          this._syncShareState();
        },
        setHudLayout: (value) => {
          this.shareLinkManager?.claimRestoreLane?.('visual');
          this._setHudVariant(value);
        },
        toggleCleanView: () => this.toggleCleanView(),
        exitCleanView: () => this.toggleCleanView(false),
        setDensity: (value) => {
          this.shareLinkManager?.claimRestoreLane?.('visual');
          this._detectionUserOverridden = true;
          const pct = canonicalizeDensity(value);
          this._detectionDensitySlider.value = String(pct);
          if (this._detectionDensityValue)
            this._detectionDensityValue.textContent = `${pct}%`;
          this._applyDetectionDensityFromUi();
          this._syncShareState();
        },
        setAllocation: (value) => {
          this.shareLinkManager?.claimRestoreLane?.('visual');
          this._detectionUserOverridden = true;
          this._setDetectionAllocation(value);
        },
        setFade: () => {
          this.shareLinkManager?.claimRestoreLane?.('visual');
          this._applyDetectionFadeFromUi();
          this._syncShareState();
        },
        toggleCelestial: () => {
          const ringIsVisible = !!this.celestialRing?.visible;
          if (!this.celestialRingEnabled || !ringIsVisible) {
            this.setCelestialRingEnabled(true, { focus: true });
          } else {
            this.setCelestialRingEnabled(false);
          }
        },
        toggleHud: () => {
          this.shareLinkManager?.claimRestoreLane?.('visual');
          this.hud.toggle();
          this._updateHudButtonState();
          this._syncShareState();
        },
        cycleDetection: () => {
          this.shareLinkManager?.claimRestoreLane?.('visual');
          this._detectionUserOverridden = true;
          cycleDetectionMode();
          this._syncShareState();
        },
        toggleModels: () => {
          this._setModels3dEnabled(!this._models3dEnabled);
          this._syncModels3dModeRow();
        },
        setModelsMode: (mode) => this._setModels3dMode(mode),
      },
    });
  }

  _initMapStackControl() {
    if (!this.mapStackController) return;
    this._mapSourceControls?.destroy();
    this._mapSourceControls = createMapSourceControls({
      container: this._mapStackChips,
      statusElement: this._mapStackStatus,
      controller: this.mapStackController,
      subscribe: (onChange) => {
        window.addEventListener('gev:map-stack-changed', onChange);
        return () =>
          window.removeEventListener('gev:map-stack-changed', onChange);
      },
      claimSelection: () => this.shareLinkManager?.claimRestoreLane?.('map'),
      onStateChanged: () => this._syncShareState(),
      onError: (message) => this._showToast(message),
    });
  }

  async _setMapStack(stackId, { syncShare = true } = {}) {
    if (!this.mapStackController) return;
    return this._mapSourceControls.select(stackId, { syncShare });
  }

  _renderMapStackState(state) {
    this._mapSourceControls?.render(state);
  }

  _applyDetectionDensityFromUi() {
    const { getDetectionMode, setDetectionTuning } = this.services;
    if (!this._detectionDensitySlider) return;
    const pct = canonicalizeDensity(this._detectionDensitySlider.value);
    this._detectionDensitySlider.value = String(pct);
    if (this._detectionDensityValue)
      this._detectionDensityValue.textContent = `${pct}%`;
    setDetectionTuning({ densityPct: pct });
    this._updateDetectionButton(getDetectionMode());
  }

  _applyDetectionFadeFromUi() {
    const { setKeyholeFadeTuning } = this.services;
    const fadePct = Math.max(
      0,
      Math.min(40, Math.round(Number(this._detectionFadeSlider?.value) || 0)),
    );
    const outsideOpacityValue = this._detectionOpacitySlider?.value;
    const outsideOpacityPct = Math.max(
      0,
      Math.min(
        100,
        Math.round(
          outsideOpacityValue == null ? 3 : Number(outsideOpacityValue) || 0,
        ),
      ),
    );
    if (this._detectionFadeSlider)
      this._detectionFadeSlider.value = String(fadePct);
    if (this._detectionFadeValue)
      this._detectionFadeValue.textContent = `${fadePct}%`;
    if (this._detectionOpacitySlider)
      this._detectionOpacitySlider.value = String(outsideOpacityPct);
    if (this._detectionOpacityValue)
      this._detectionOpacityValue.textContent = `${outsideOpacityPct}%`;
    setKeyholeFadeTuning({
      fadeRatio: fadePct / 100,
      outsideOpacity: outsideOpacityPct / 100,
    });
    this.viewer.scene.requestRender?.();
  }

  _setDetectionAllocation(strategy, { syncShare = true, persist = true } = {}) {
    const { setDetectionTuning } = this.services;
    const raw = String(strategy || '')
      .trim()
      .toUpperCase();
    if (!ALLOCATION_STRATEGIES.includes(raw)) return false;
    const normalized = normalizeAllocationStrategy(raw);
    this._detectionAllocationPreference = normalized;
    setDetectionTuning({ allocationStrategy: normalized });
    for (const button of this._detectionAllocationBtns) {
      const active = button.dataset.allocation === normalized;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', String(active));
    }
    if (persist) {
      try {
        localStorage.setItem(DETECTION_ALLOCATION_STORAGE_KEY, normalized);
      } catch {
        /* best effort */
      }
    }
    if (syncShare) this._syncShareState();
    return true;
  }

  _syncDetectionUiFromEngine() {
    const { getKeyholeFadeTuning, getDetectionTuning, getDetectionMode } =
      this.services;
    const tuning = getDetectionTuning();
    if (this._detectionDensitySlider)
      this._detectionDensitySlider.value = String(tuning.densityPct);
    if (this._detectionDensityValue)
      this._detectionDensityValue.textContent = `${tuning.densityPct}%`;
    this._setDetectionAllocation(tuning.allocationStrategy, {
      syncShare: false,
      persist: false,
    });
    const fadeTuning = getKeyholeFadeTuning();
    if (this._detectionFadeSlider)
      this._detectionFadeSlider.value = String(
        Math.round(fadeTuning.fadeRatio * 100),
      );
    if (this._detectionOpacitySlider) {
      this._detectionOpacitySlider.value = String(
        Math.round(fadeTuning.outsideOpacity * 100),
      );
    }
    this._applyDetectionFadeFromUi();
    this._updateDetectionButton(getDetectionMode());
  }

  _setDetectionMode(modeLabel) {
    const { setDetectionModeByLabel } = this.services;
    if (!modeLabel) return;
    setDetectionModeByLabel(modeLabel);
    this._syncDetectionUiFromEngine();
    this._syncShareState();
  }

  _setHudVariant(variantName) {
    if (!variantName) return;
    this.hud.setVariant(variantName);
    if (
      this._hudLayoutSelect &&
      this._hudLayoutSelect.value !== this.hud.getVariant()
    ) {
      this._hudLayoutSelect.value = this.hud.getVariant();
    }
    this._syncShareState();
    this._scheduleAdaptivePanelLayout({ settle: true });
  }

  _scheduleAdaptivePanelLayout(options0) {
    return this._panelLayout._scheduleAdaptivePanelLayout(options0);
  }

  _applyStylePresetDefaults(styleName) {
    const { governorRequestRender } = this.services;
    const preset = STYLE_PRESET_DEFAULTS[styleName];
    if (!preset) return;

    if (preset.styleParams && typeof preset.styleParams === 'object') {
      for (const [targetStyle, params] of Object.entries(preset.styleParams)) {
        const stage = this.stages[targetStyle];
        if (!stage || !params || typeof params !== 'object') continue;
        for (const [uniformName, uniformValue] of Object.entries(params)) {
          if (stage.uniforms[uniformName] === undefined) continue;
          stage.uniforms[uniformName] = uniformValue;
          governorRequestRender('style-param');
        }
      }
    }

    const bloomInput = preset.bloom || {};
    if (typeof bloomInput.intensity === 'number' && this._bloomSlider) {
      this._setBloomIntensity(clampBloomIntensity(bloomInput.intensity), {
        syncShare: false,
      });
    }
    if (typeof bloomInput.enabled === 'boolean') {
      this._setBloomEnabled(bloomInput.enabled);
    }

    const sharpenInput = preset.sharpen || {};
    if (typeof sharpenInput.intensity === 'number' && this._sharpenSlider) {
      const sharpenPct = Math.max(
        0,
        Math.min(100, Math.round(sharpenInput.intensity)),
      );
      this._sharpenSlider.value = String(sharpenPct);
      this._sharpenSliderValue.textContent = `${sharpenPct}%`;
      this._applySharpenIntensity(sharpenPct / 100);
    }
    if (typeof sharpenInput.enabled === 'boolean') {
      this._setSharpenEnabled(sharpenInput.enabled);
    }

    if (preset.hudVariant) {
      this._setHudVariant(preset.hudVariant);
    }
    if (typeof preset.hudVisible === 'boolean') {
      this.hud.setMode(preset.hudVisible ? 'on' : 'off');
      this._updateHudButtonState();
    }

    if (preset.detection && !this._detectionUserOverridden) {
      this._applyDetectionPreset(preset.detection);
    }
  }

  _applyDetectionPreset(det) {
    if (!det) return;
    if (typeof det.densityPct === 'number' && this._detectionDensitySlider) {
      const pct = canonicalizeDensity(det.densityPct);
      this._detectionDensitySlider.value = String(pct);
      if (this._detectionDensityValue)
        this._detectionDensityValue.textContent = `${pct}%`;
      this._applyDetectionDensityFromUi();
    }
    if (det.mode) this._setDetectionMode(String(det.mode).toUpperCase());
  }

  _applyGlobalPostDefaults() {
    const defaults = GLOBAL_POST_DEFAULTS;
    if (typeof defaults.bloom?.intensity === 'number' && this._bloomSlider) {
      this._setBloomIntensity(clampBloomIntensity(defaults.bloom.intensity), {
        syncShare: false,
      });
    }
    if (typeof defaults.bloom?.enabled === 'boolean') {
      this._setBloomEnabled(defaults.bloom.enabled);
    }

    if (
      typeof defaults.sharpen?.intensity === 'number' &&
      this._sharpenSlider
    ) {
      const sharpenPct = Math.max(
        0,
        Math.min(100, Math.round(defaults.sharpen.intensity)),
      );
      this._sharpenSlider.value = String(sharpenPct);
      this._sharpenSliderValue.textContent = `${sharpenPct}%`;
      this._applySharpenIntensity(sharpenPct / 100);
    }
    if (typeof defaults.sharpen?.enabled === 'boolean') {
      this._setSharpenEnabled(defaults.sharpen.enabled);
    }

    if (defaults.hudVariant) {
      this._setHudVariant(defaults.hudVariant);
    }
    if (typeof defaults.hudVisible === 'boolean') {
      this.hud.setMode(defaults.hudVisible ? 'on' : 'off');
      this._updateHudButtonState();
    }

    if (defaults.detectionMode) {
      this._setDetectionMode(defaults.detectionMode);
    }
    if (
      typeof defaults.detectionDensity === 'number' &&
      this._detectionDensitySlider
    ) {
      const density = canonicalizeDensity(defaults.detectionDensity);
      this._detectionDensitySlider.value = String(density);
      this._detectionDensityValue.textContent = `${density}%`;
      this._applyDetectionDensityFromUi();
    }
    this._setDetectionAllocation(
      this._detectionAllocationPreference ||
        defaults.detectionAllocation ||
        'ELASTIC',
      { syncShare: false, persist: false },
    );
    if (this._detectionFadeSlider) {
      this._detectionFadeSlider.value = String(defaults.detectionFadePct ?? 7);
    }
    if (this._detectionOpacitySlider) {
      this._detectionOpacitySlider.value = String(
        defaults.detectionOutsideOpacityPct ?? 1,
      );
    }
    this._applyDetectionFadeFromUi();
    if (typeof defaults.celestialRing === 'boolean') {
      this.setCelestialRingEnabled(defaults.celestialRing, {
        syncShare: false,
        focus: false,
      });
    }
  }

  _shareableDetectionState() {
    const { getDetectionMode } = this.services;
    return shareableDetectionState({
      owned: this._contactsDetectionRestore,
      liveMode: getDetectionMode(),
      liveDensityPct: parseInt(this._detectionDensitySlider?.value || '50', 10),
    });
  }

  subscribeShareState(listener, options) {
    return this._shareState.subscribe(listener, options);
  }

  _syncShareState() {
    if (this._disposed) return;
    this._shareState.publish({ type: 'settings-changed' });
  }

  _readShareState() {
    const {
      getDetectionTuning,
      isScopeMaskEnabled,
      getScopeMaskFeather,
      getScopeTerminusOverride,
    } = this.services;
    const detection = this._shareableDetectionState();
    return {
      bloomEnabled: this.bloomEnabled,
      sharpenEnabled: this.sharpenEnabled,
      options: {
        bloomIntensity: this._getBloomIntensity(),
        bloomVersion: BLOOM_SCALE_VERSION,
        sharpenIntensity: parseInt(this._sharpenSlider?.value || '49', 10),
        hudVariant: this.hud.getVariant(),
        hudVisible: this.hud.visible,
        detectionMode: detection.mode,
        detectionDensity: detection.densityPct,
        detectionAllocation: getDetectionTuning().allocationStrategy,
        detectionFadePct: parseInt(this._detectionFadeSlider?.value || '7', 10),
        detectionOutsideOpacityPct: parseInt(
          this._detectionOpacitySlider?.value || '1',
          10,
        ),
        celestialRingEnabled: this.celestialRingEnabled,
        scopeEnabled: isScopeMaskEnabled(),
        scopeFeatherPct: Math.round(getScopeMaskFeather() * 100),
        scopeTerminusPct:
          getScopeTerminusOverride() == null
            ? null
            : Math.round(getScopeTerminusOverride() * 100),
        mapStack: this.mapStackController?.getActiveId?.() || 'photoreal',
      },
    };
  }

  _updateTrafficSyncChip(forceShow, now) {
    return this._feedback._updateTrafficSyncChip(forceShow, now);
  }

  _initPanelChrome() {
    for (const control of this._panelDisclosureControls || [])
      control.destroy();
    this._panelDisclosureControls = [];
    const targets = new Map();
    document
      .querySelectorAll('.panel-collapse-btn[data-collapse-target]')
      .forEach((button) => {
        const targetId = button.dataset.collapseTarget;
        if (!targetId) return;
        if (!targets.has(targetId)) targets.set(targetId, []);
        targets.get(targetId).push(button);
      });
    for (const [targetId, buttons] of targets) {
      const panel = document.getElementById(targetId);
      if (!panel) continue;
      this._panelDisclosureControls.push(
        bindPanelDisclosure({
          panel,
          buttons,
          onChange: (collapsed, options) =>
            this.setPanelCollapsed(targetId, collapsed, options),
          onEscape: (event) => this._collapsePanelOnEscape(event, targetId),
        }),
      );
      this._restorePanelCollapsedState(targetId, {
        allowStored: !this._initialShareState,
      });
    }
    this.setPanelCollapsed('control-panel', true, {
      syncShare: false,
      persist: false,
    });
    this.setPanelCollapsed('location-bar', true, {
      syncShare: false,
      persist: false,
    });
    this._initAutoHoverPanel('control-panel', {
      openDelayMs: 140,
      closeDelayMs: 420,
    });
    this._initAutoHoverPanel('location-bar', {
      openDelayMs: 140,
      closeDelayMs: 420,
    });
    this._initCommandDockPins();
    this._initCommandDockTrayMetrics();
    this._maybeNotifyLayoutReset();
  }

  _collapsePanelOnEscape(event, panelId) {
    return collapsePanelOnEscape(event, {
      panel: document.getElementById(panelId),
      onChange: (collapsed, options) =>
        this.setPanelCollapsed(panelId, collapsed, options),
      beforeCollapse: () => {
        if (panelId !== 'location-bar' || !this._locationSearch) return;
        this._locationSearch.classList.remove('expanded');
        this._locationSearch.value = '';
        this._locationSearch.blur();
      },
    });
  }

  _initCommandDockPins() {
    document
      .querySelectorAll('.dock-pin-btn[data-pin-target]')
      .forEach((button) => {
        this._lifetime.listen(button, 'click', (event) => {
          event.stopPropagation();
          const panelId = button.dataset.pinTarget;
          this._setCommandDockPanelPinState(panelId);
        });
      });
  }

  _setCommandDockPanelPinState(
    panelId,
    pin,
    { restore = false, persist = true, syncShare = true } = {},
  ) {
    const panelEl = document.getElementById(panelId);
    const button = document.querySelector(
      `.dock-pin-btn[data-pin-target="${panelId}"]`,
    );
    if (!panelEl || !button) return undefined;
    const shouldPin =
      typeof pin === 'boolean'
        ? pin
        : !panelEl.classList.contains('dock-pinned');
    panelEl.classList.toggle('dock-pinned', shouldPin);
    button.setAttribute('aria-pressed', String(shouldPin));
    document
      .querySelectorAll('#command-dock .dock-pinned-top')
      .forEach((pinnedPanel) => {
        pinnedPanel.classList.remove('dock-pinned-top');
      });
    if (shouldPin) {
      panelEl.classList.add('dock-pinned-top');
      this.setPanelCollapsed(panelId, false, {
        explicit: !restore,
        restore,
        persist,
        syncShare: false,
      });
    } else {
      const remainingPinnedPanel = document.querySelector(
        '#command-dock .dock-pinned',
      );
      remainingPinnedPanel?.classList.add('dock-pinned-top');
      if (!restore && !panelEl.matches(':hover')) {
        this.setPanelCollapsed(panelId, true, {
          explicit: true,
          persist,
          syncShare: false,
        });
      }
    }
    this._updateCommandDockTrayStack();
    if (syncShare) {
      if (!restore) this.shareLinkManager?.claimRestoreLane?.('panel', panelId);
      this.shareLinkManager?.onPanelStateChange?.();
    }
    return shouldPin;
  }

  _initCommandDockTrayMetrics() {
    return this._panelLayout._initCommandDockTrayMetrics();
  }

  _updateCommandDockTrayStack() {
    return this._panelLayout._updateCommandDockTrayStack();
  }

  _maybeNotifyLayoutReset() {
    return this._panelPosition._maybeNotifyLayoutReset();
  }

  _initAutoHoverPanel(
    panelId,
    { openDelayMs = 850, closeDelayMs = 1000 } = {},
  ) {
    const panel = document.getElementById(panelId);
    if (!panel) return;
    this._hoverPanelControls ??= new Map();
    this._hoverPanelControls.get(panelId)?.destroy();
    const controller = createHoverDisclosure({
      panel,
      documentRef: document,
      disclosure: panel.querySelector(`[data-dock-toggle-target="${panelId}"]`),
      openDelayMs,
      closeDelayMs,
      isActive: () => !this._disposed,
      onChange: (collapsed, options) =>
        this.setPanelCollapsed(panelId, collapsed, options),
      onEscape: (event) => this._collapsePanelOnEscape(event, panelId),
      focusTarget:
        panelId === 'control-panel'
          ? () =>
              panel.querySelector('.map-stack-chip.active') ||
              panel.querySelector('.map-stack-chip')
          : null,
    });
    this._hoverPanelControls.set(panelId, controller);
    if (panelId === 'control-panel') {
      this._cancelMapSourceFocus?.();
      this._cancelMapSourceFocus = controller.cancelPendingFocus;
    }
  }

  _initPanelDrag() {
    return this._panelPosition._initPanelDrag();
  }

  _persistAwarenessSelection(event, cleared = false) {
    if (!this._dataManager) return;
    const origin = String(event?.detail?.origin || 'programmatic');
    if (!isExplicitLayerStateOrigin(origin)) return;
    const layerId = String(event?.detail?.layerId || '');
    const config = {
      flights: {
        key: 'selectedFlightsTrackingId',
        normalize: (value) =>
          String(value ?? '')
            .trim()
            .toLowerCase() || null,
      },
      military: {
        key: 'selectedMilitaryTrackingId',
        normalize: (value) =>
          String(value ?? '')
            .trim()
            .toLowerCase() || null,
      },
      satellites: {
        key: 'selectedSatTrackingId',
        normalize: (value) => {
          const candidate = Number(value);
          return Number.isFinite(candidate) && candidate > 0
            ? Math.trunc(candidate)
            : null;
        },
      },
    }[layerId];
    if (!config) return;
    const selectedValue = cleared ? null : config.normalize(event?.detail?.id);
    if (cleared || selectedValue === null) {
      this._dataManager.adoptLayerParams?.(
        layerId,
        {
          [config.key]: selectedValue,
        },
        { origin },
      );
      return;
    }
    const visibilityAdopted = this._dataManager.adoptLayerVisibility?.(
      layerId,
      true,
      { origin, adoptedFromSelection: true },
    );
    if (visibilityAdopted === false) return;
    for (const [otherLayerId, otherKey] of [
      ['flights', 'selectedFlightsTrackingId'],
      ['military', 'selectedMilitaryTrackingId'],
      ['satellites', 'selectedSatTrackingId'],
    ]) {
      if (otherLayerId === layerId) continue;
      this._dataManager.setLayerParams(
        otherLayerId,
        { [otherKey]: null },
        { origin },
      );
    }
    this._dataManager.adoptLayerParams?.(
      layerId,
      {
        [config.key]: selectedValue,
      },
      { origin },
    );
  }

  attachDataManager(dataManager) {
    this._dataManager = dataManager || null;
    this.hud.attachDataManager(this._dataManager);
    this._updateTrafficSyncChip();
    if (this._dataManagerUnsubscribe) {
      this._dataManagerUnsubscribe();
      this._dataManagerUnsubscribe = null;
    }
    this._contextControls.connect(this._dataManager);
    if (typeof this._dataManager?.subscribe === 'function') {
      this._dataManagerUnsubscribe = this._dataManager.subscribe((change) => {
        this._feedback._loadingFeedbackEvent = change;
        this._updateGlobalLoadingFeedback(performance.now());
      });
    }
    this._updateGlobalLoadingFeedback(performance.now());
    this._syncContextModeButtons();
    this._cctvControls.connect();
    this._radioControls.connect();
    if (!this._awarenessSelectedHandler) {
      this._awarenessSelectedHandler = (event) =>
        this._persistAwarenessSelection(event, false);
      this._awarenessClearedHandler = (event) =>
        this._persistAwarenessSelection(event, true);
      window.addEventListener(
        'gev:awareness-subject-selected',
        this._awarenessSelectedHandler,
      );
      window.addEventListener(
        'gev:awareness-subject-cleared',
        this._awarenessClearedHandler,
      );
    }
    this._layerStateCoordinator?.destroy();
    this._layerStateCoordinator = null;
    this._layerStateRestorePromise = null;
    if (this._dataManager) {
      this._layerStateCoordinator = new LayerStateCoordinator(
        this._dataManager,
        this.shareLinkManager,
        {
          onDurableStateChange: (state) =>
            this._syncModels3dFromLayerState(state),
          onTrackingRestoreStatus: (result) =>
            this._handleShareTrackingRestoreStatus(result),
        },
      );
      this._layerStateRestorePromise = this._layerStateCoordinator.start({
        shareLayerState: this._initialShareState?.layerState || null,
        shareCreatedAtMs: this._initialShareState?.sharedAtMs ?? null,
        allowLocalState: !this._initialShareState,
      });
      if (this._initialShareSelectionSuperseded) {
        this._layerStateCoordinator.cancelPendingShareTracking(
          'superseded-before-layer-coordinator-start',
          { clearSelection: true },
        );
      }
      void this._layerStateRestorePromise.then(() => {
        this._syncModels3dFromLayerState(
          this._layerStateCoordinator?.getDurableState(),
        );
      });
    }
  }

  _handleShareTrackingRestoreStatus(result) {
    if (!result || this._disposed) return;
    const trackingKey = `${result.layerId || ''}:${result.targetId ?? ''}`;
    if (result.classification === 'pending') {
      this._shareTrackingNoticeGeneration += 1;
      this._shareTrackingAcquiringKey = trackingKey;
      this._showGlobalStatusNotice('ACQUIRING', {
        state: 'acquiring',
        detail: `SHARED ${String(result.label || 'SUBJECT').toUpperCase()}`,
        persistent: true,
      });
      return;
    }
    const ownsAcquiringNotice = this._shareTrackingAcquiringKey === trackingKey;
    if (ownsAcquiringNotice) {
      this._shareTrackingNoticeGeneration += 1;
      this._shareTrackingAcquiringKey = null;
      if (this._feedback._globalStatusNotice?.state === 'acquiring') {
        this._feedback._globalStatusNotice = null;
        this._updateGlobalLoadingFeedback();
      }
    }
    if (
      result.classification === 'followed' ||
      result.classification === 'cancelled'
    )
      return;
    if (this._shareTrackingAcquiringKey) return;
    const noticeGeneration = ownsAcquiringNotice
      ? this._shareTrackingNoticeGeneration
      : ++this._shareTrackingNoticeGeneration;
    const subject = result.label || 'entity';
    const message =
      result.classification === 'expired'
        ? `Paylaşılan ${subject} takibi zaman aşımına uğradı`
        : result.classification === 'source-unavailable'
          ? `Paylaşılan ${subject} yüklenemedi — veri akışı kapalı`
          : `Paylaşılan ${subject} mevcut değil`;
    const showAfterStartupCover = () => {
      this._lifetime.frame(() => {
        if (
          !canPresentDeferredStatusNotice(
            noticeGeneration,
            this._shareTrackingNoticeGeneration,
            this._disposed,
          )
        )
          return;
        const startupCover = document.getElementById('loading-screen');
        if (
          !startupCover ||
          getComputedStyle(startupCover).visibility === 'hidden'
        ) {
          this._showGlobalStatusNotice(message);
          return;
        }
        let fallbackTimer = null;
        let removeStartupListener = () => {};
        const showOnce = () => {
          removeStartupListener();
          if (fallbackTimer) this._lifetime.cancelTimeout(fallbackTimer);
          if (
            canPresentDeferredStatusNotice(
              noticeGeneration,
              this._shareTrackingNoticeGeneration,
              this._disposed,
            )
          )
            this._showGlobalStatusNotice(message);
        };
        removeStartupListener = this._lifetime.listen(
          startupCover,
          'transitionend',
          showOnce,
          { once: true },
        );
        fallbackTimer = this._lifetime.timeout(showOnce, 1000);
      });
    };
    if (this._resolveInitialShareRestore) {
      void this.initialRestorePromise.then(showAfterStartupCover);
      return;
    }
    showAfterStartupCover();
  }

  get _contextMode() {
    return this._contextControls?._contextMode ?? null;
  }
  get _contextModeChanging() {
    return this._contextControls?._contextModeChanging ?? false;
  }
  get _preservePanelStateDuringLayerClear() {
    return this._contextControls?._preservePanelStateDuringLayerClear ?? false;
  }

  _initGlobalContextPanel() {
    const { radioLayer, militaryInstallationsLayer } = this.services;
    this._contextControls = new ContextControls({
      elements: {
        _globalContextPanel: document.getElementById('global-context-panel'),
        _globalContextFlightsBtn: this._globalContextFlightsBtn,
        _globalContextMissionsBtn: this._globalContextMissionsBtn,
        _contextModeStandby: this._contextModeStandby,
        _contextFlightsView: this._contextFlightsView,
        _contextMissionsView: this._contextMissionsView,
        _installationsSearchBtn: this._installationsSearchBtn,
      },
      installations: militaryInstallationsLayer,
      actions: {
        getCockpit: () => this.cockpitView,
        refreshRadio: () => this._renderRadioState(radioLayer.getUIState()),
        claimVisualAuthority: () =>
          this.shareLinkManager?.claimRestoreLane?.('visual'),
        syncDetection: () => this._syncContactsDetection(),
        scheduleLayout: () => this._scheduleRightPanelLayout(),
        setPanelCollapsed: (...args) => this.setPanelCollapsed(...args),
        showToast: (message) => {
          if (!this._disposed) this._showToast(message);
        },
        setClearBusy: (busy) => {
          if (!this._disposed) this._clearLayersControl?.setBusy(busy);
        },
      },
    });
  }

  _runUserFacingContextAction(...args) {
    return this._contextControls?._runUserFacingContextAction(...args);
  }

  _waitForContextLayerSettlement(...args) {
    return this._contextControls?._waitForContextLayerSettlement(...args);
  }

  _syncContextModeButtons(...args) {
    return this._contextControls?._syncContextModeButtons(...args);
  }

  _initRadioPanel() {
    const { radioLayer } = this.services;
    this._radioControls?.destroy();
    this._radioControls = new RadioControls({
      elements: {
        _cockpitDisplayPanel: this._cockpitDisplayPanel,
        _cockpitDisplayToggleBtn: this._cockpitDisplayToggleBtn,
        _cockpitRadioEnableBtn: this._cockpitRadioEnableBtn,
        _cockpitRadioNextBtn: this._cockpitRadioNextBtn,
        _cockpitRadioPanel: this._cockpitRadioPanel,
        _cockpitRadioPlayBtn: this._cockpitRadioPlayBtn,
        _cockpitRadioPrevBtn: this._cockpitRadioPrevBtn,
        _cockpitRadioStation: this._cockpitRadioStation,
        _cockpitRadioToggleBtn: this._cockpitRadioToggleBtn,
        _cockpitRadioVolume: this._cockpitRadioVolume,
        _cockpitRadioVolumeValue: this._cockpitRadioVolumeValue,
        _cockpitUtilityControls: this._cockpitUtilityControls,
        _contextRadioDetailsBtn: this._contextRadioDetailsBtn,
        _contextRadioDock: this._contextRadioDock,
        _contextRadioMini: this._contextRadioMini,
        _contextRadioMiniCloseBtn: this._contextRadioMiniCloseBtn,
        _contextRadioMiniEnableBtn: this._contextRadioMiniEnableBtn,
        _contextRadioMiniNextBtn: this._contextRadioMiniNextBtn,
        _contextRadioMiniPlayBtn: this._contextRadioMiniPlayBtn,
        _contextRadioMiniPrevBtn: this._contextRadioMiniPrevBtn,
        _contextRadioMiniStation: this._contextRadioMiniStation,
        _contextRadioMiniVolume: this._contextRadioMiniVolume,
        _contextRadioMiniVolumeValue: this._contextRadioMiniVolumeValue,
        _contextRadioToggleBtn: this._contextRadioToggleBtn,
        _radioEnableBtn: this._radioEnableBtn,
        _radioFilter: this._radioFilter,
        _radioLayerState: this._radioLayerState,
        _radioNextBtn: this._radioNextBtn,
        _radioPanel: this._radioPanel,
        _radioPlayBtn: this._radioPlayBtn,
        _radioPlaybackState: this._radioPlaybackState,
        _radioPrevBtn: this._radioPrevBtn,
        _radioStationHomepage: this._radioStationHomepage,
        _radioStationMeta: this._radioStationMeta,
        _radioStationName: this._radioStationName,
        _radioStationTags: this._radioStationTags,
        _radioStopBtn: this._radioStopBtn,
        _radioTuner: this._radioTuner,
        _radioTunerBandLabel: this._radioTunerBandLabel,
        _radioTunerNeedle: this._radioTunerNeedle,
        _radioTunerSlider: this._radioTunerSlider,
        _radioTunerStation: this._radioTunerStation,
        _radioTunerValue: this._radioTunerValue,
        _radioVolume: this._radioVolume,
        _radioVolumeValue: this._radioVolumeValue,
      },
      radio: radioLayer,
      canvas: this.viewer?.canvas,
      actions: {
        isRegistered: () => this._dataManager?.layers?.has('radio'),
        isEnabled: () => this._dataManager?.isEnabled('radio'),
        setEnabled: (enabled, options) =>
          this._dataManager.setEnabled('radio', enabled, options),
        setParams: (params, options) =>
          this._dataManager?.setLayerParams('radio', params, options),
        getLifecycle: () =>
          this._dataManager?.getLayerLifecycleState?.('radio'),
        runUserAction: (...args) => this._runUserFacingContextAction(...args),
        setPanelCollapsed: (...args) => this.setPanelCollapsed(...args),
        revealStyleParameters: () => this._revealCockpitStyleParameters(),
        setSignalCollapsed: (value) =>
          this.cockpitView?.setSignalCollapsed(value),
        isCockpitActive: () => this.cockpitView?.active,
        signalUserCollapsed: () => this.cockpitView?.signalUserCollapsed,
        layoutCockpit: () => this.cockpitView?.scheduleContextLayout(),
        preservePanelStateDuringClear: () =>
          this._preservePanelStateDuringLayerClear,
        scheduleLayout: () => this._scheduleRightPanelLayout(),
      },
    });
  }

  _setCockpitDisclosure(...args) {
    return this._radioControls?._setCockpitDisclosure?.(...args);
  }

  _setRadioDisclosure(...args) {
    return this._radioControls?._setRadioDisclosure?.(...args);
  }

  _syncContextRadioLauncherState(...args) {
    return this._radioControls?._syncContextRadioLauncherState?.(...args);
  }

  _renderRadioState(...args) {
    return this._radioControls?._renderRadioState?.(...args);
  }

  _runExplicitCctvFocus(activate, focus) {
    if (this._disposed) return false;
    const cameraId = activate();
    if (!cameraId) return false;
    return this._runExplicitNavigation('camera', () => focus(cameraId));
  }

  _initCctvPanel() {
    const { cctvLayer } = this.services;
    this._cctvControls?.destroy();
    this._cctvControls = new CctvControls({
      elements: {
        _cctvAdjustBtn: this._cctvAdjustBtn,
        _cctvAutoHopBtn: this._cctvAutoHopBtn,
        _cctvCalReadout: this._cctvCalReadout,
        _cctvCalibResetBtn: this._cctvCalibResetBtn,
        _cctvCalibSaveBtn: this._cctvCalibSaveBtn,
        _cctvCoverageBtn: this._cctvCoverageBtn,
        _cctvEnableBtn: this._cctvEnableBtn,
        _cctvFocusBtn: this._cctvFocusBtn,
        _cctvFrame: this._cctvFrame,
        _cctvFrameWrap: this._cctvFrameWrap,
        _cctvMeta: this._cctvMeta,
        _cctvNearestBtn: this._cctvNearestBtn,
        _cctvNextBtn: this._cctvNextBtn,
        _cctvPanel: this._cctvPanel,
        _cctvPrevBtn: this._cctvPrevBtn,
        _cctvProjectionBtn: this._cctvProjectionBtn,
        _cctvQualityChip: this._cctvQualityChip,
        _cctvSelect: this._cctvSelect,
        _cctvSourceBadge: this._cctvSourceBadge,
        _cctvSummary: this._cctvSummary,
        _cctvSyncChip: this._cctvSyncChip,
        _cctvSyncLabel: this._cctvSyncLabel,
        _cctvSyncProgress: this._cctvSyncProgress,
      },
      cctv: cctvLayer,
      actions: {
        isEnabled: () => this._dataManager?.isEnabled('cctv'),
        setParams: (params, options) =>
          this._dataManager?.setLayerParams('cctv', params, options),
        toggleEnabled: (...args) => this._toggleCctvEnabled(...args),
        runExplicitFocus: (...args) => this._runExplicitCctvFocus(...args),
        setPanelCollapsed: (...args) => this.setPanelCollapsed(...args),
        showToast: (message) => this._showToast(message),
        syncViewport: () => this._syncCctvPanelViewport(),
        setSplitFlapText,
      },
    });
  }

  async _toggleCctvEnabled(forceState) {
    const { cctvLayer } = this.services;
    if (this._disposed) return false;
    if (!this._dataManager || !this._dataManager.layers?.has('cctv')) {
      this._showToast('Kamera katmanı kullanılamıyor');
      return false;
    }
    const enabled = this._dataManager.isEnabled('cctv');
    const target = typeof forceState === 'boolean' ? forceState : !enabled;
    if (target === enabled) return true;
    await runCctvLayerEnableTransition({
      target,
      setEnabled: (next) =>
        this._dataManager.setEnabled('cctv', next, { origin: 'user' }),
      readOwnership: () => ({
        trackedEntity: this.viewer?.trackedEntity,
        cockpitActive: !!this.cockpitView?.active,
      }),
      shouldFocus: () =>
        !this._disposed &&
        this._dataManager.isEnabled('cctv') &&
        !this._cctvControls?.getState()?.activeCameraId,
      activate: () => cctvLayer.focusNearest({ focus: false }),
      fly: (cameraId) =>
        this._runExplicitCctvFocus(
          () => cameraId,
          (selectedId) => cctvLayer.focusCamera(selectedId, 1.6),
        ),
    });
    return true;
  }

  _panelStorageKey(panelId) {
    return this._panelPosition._panelStorageKey(panelId);
  }

  _panelCollapseStorageKey(panelId) {
    return this._panelPosition._panelCollapseStorageKey(panelId);
  }

  _restorePanelCollapsedState(panelId, options1) {
    return this._panelPosition._restorePanelCollapsedState(panelId, options1);
  }

  _savePanelCollapsedState(panelId, collapsed) {
    return this._panelPosition._savePanelCollapsedState(panelId, collapsed);
  }

  _initRightPanelAdaptiveLayout() {
    return this._panelLayout._initRightPanelAdaptiveLayout();
  }

  _scheduleRightPanelLayout(options0) {
    return this._panelLayout._scheduleRightPanelLayout(options0);
  }

  _syncRightPanelAdaptiveLayout() {
    return this._panelLayout._syncRightPanelAdaptiveLayout();
  }

  _initLeftPanelAdaptiveLayout() {
    return this._panelLayout._initLeftPanelAdaptiveLayout();
  }

  _scheduleLeftPanelLayout(options0) {
    return this._panelLayout._scheduleLeftPanelLayout(options0);
  }

  _syncLeftPanelAdaptiveLayout() {
    return this._panelLayout._syncLeftPanelAdaptiveLayout();
  }

  _syncPanelCollapseButton(panelEl) {
    const isRightRail = [
      'pp-toggles',
      'cctv-panel',
      'global-context-panel',
    ].includes(panelEl?.id);
    const collapsed = panelEl.classList.contains('collapsed');
    panelEl
      .querySelectorAll('.panel-collapse-btn[data-collapse-target]')
      .forEach((btn) => {
        const owner = btn.closest('[data-panel-id], #param-slider-panel');
        if (owner !== panelEl) return;
        if (isRightRail) {
          btn.textContent = collapsed ? '◀' : '▶';
        } else {
          btn.textContent = collapsed ? '+' : '−';
        }
        btn.setAttribute('aria-expanded', String(!collapsed));
        const panelName =
          panelEl
            .querySelector('.panel-title, .pp-header-label')
            ?.textContent?.trim() || 'panel';
        const action = collapsed ? 'Genişlet' : 'Daralt';
        btn.title = `${panelName} (${action})`;
        btn.setAttribute('aria-label', `${panelName} ${action}`);
        if (panelEl.id === 'radio-panel') {
          btn.title = `Telsiz (${action})`;
          btn.setAttribute('aria-label', `Telsiz bölümü ${action}`);
        }
      });
    const dockToggle = panelEl.querySelector(
      `[data-dock-toggle-target="${panelEl.id}"]`,
    );
    if (dockToggle) {
      const panelName =
        panelEl
          .querySelector('.panel-title, .location-toolbar-label')
          ?.textContent?.trim() || 'panel';
      const action = collapsed ? 'Genişlet' : 'Daralt';
      dockToggle.setAttribute('aria-expanded', String(!collapsed));
      dockToggle.setAttribute('aria-label', `${panelName} ${action}`);
      dockToggle.title = `${panelName} (${action})`;
    }
    if (panelEl.id === 'radio-panel' && this._contextRadioDetailsBtn) {
      this._contextRadioDetailsBtn.setAttribute(
        'aria-expanded',
        String(!collapsed),
      );
    }
    if (panelEl.id === 'radio-panel' || panelEl.id === 'global-context-panel') {
      this._syncContextRadioLauncherState();
    }
  }

  _pinPanelToRight(panelEl) {
    return this._panelPosition._pinPanelToRight(panelEl);
  }

  _restorePanelPosition(panelId, panelEl) {
    return this._panelPosition._restorePanelPosition(panelId, panelEl);
  }

  _clampToViewport(left, top, panelEl) {
    return this._panelPosition._clampToViewport(left, top, panelEl);
  }

  _savePanelPosition(panelId, panelEl) {
    return this._panelPosition._savePanelPosition(panelId, panelEl);
  }

  _promotePanelZ(panelEl) {
    return this._panelPosition._promotePanelZ(panelEl);
  }

  _makePanelDraggable(panelId, panelEl, handleEl) {
    return this._panelPosition._makePanelDraggable(panelId, panelEl, handleEl);
  }

  _buildSharePanelState() {
    const specs = [];
    for (const spec of SHARE_PANEL_STATE_SPECS) {
      const panelEl = document.getElementById(spec.id);
      if (!panelEl) continue;
      const collapsed = panelEl.classList.contains('layout-auto-collapsed')
        ? false
        : panelEl.classList.contains('collapsed');
      const entry = { id: spec.id, collapsed };
      if (spec.pinnable)
        entry.pinned = panelEl.classList.contains('dock-pinned');
      specs.push(entry);
    }
    return specs.length ? { specs } : null;
  }

  _restorePanelState(panelState) {
    if (!panelState || !Array.isArray(panelState.specs)) return;
    const specsById = new Map(panelState.specs.map((spec) => [spec.id, spec]));
    for (const spec of SHARE_PANEL_STATE_SPECS) {
      const state = specsById.get(spec.id);
      if (!state || typeof state.collapsed !== 'boolean') continue;
      if (spec.pinnable && typeof state.pinned === 'boolean') {
        this._setCommandDockPanelPinState(spec.id, state.pinned, {
          restore: true,
          persist: false,
          syncShare: false,
        });
      }
      const nextCollapsed =
        state.pinned && spec.pinnable ? false : state.collapsed;
      this.setPanelCollapsed(spec.id, nextCollapsed, {
        restore: true,
        persist: false,
        syncShare: false,
      });
    }
    this.shareLinkManager?.onPanelStateChange?.();
  }

  setPanelCollapsed(
    panelId,
    collapsed,
    {
      explicit = false,
      restore = false,
      persist = true,
      syncShare = true,
    } = {},
  ) {
    if (panelId === 'control-panel' && collapsed)
      this._cancelMapSourceFocus?.();
    const panelEl = document.getElementById(panelId);
    if (!panelEl) return;
    if (explicit && !restore)
      this.shareLinkManager?.claimRestoreLane?.('panel', panelId);
    const nextCollapsed = Boolean(collapsed);
    const wasAutoCollapsed = panelEl.classList.contains(
      'layout-auto-collapsed',
    );
    const leftOwnerPanel = this._leftPanelStack?.contains(panelEl)
      ? panelEl
      : null;
    const rightOwnerPanel =
      panelId === 'radio-panel'
        ? document.getElementById('global-context-panel')
        : this._rightPanelStack?.contains(panelEl)
          ? panelEl
          : null;
    const priorLeftOwner = this._panelLayout._leftStackPreferredPanelId;
    const priorRightOwner = this._panelLayout._rightStackPreferredPanelId;
    if (explicit && !restore && !nextCollapsed && leftOwnerPanel) {
      this._panelLayout._leftStackPreferredPanelId = leftOwnerPanel.id;
    } else if (
      explicit &&
      !restore &&
      nextCollapsed &&
      leftOwnerPanel?.id === this._panelLayout._leftStackPreferredPanelId
    ) {
      this._panelLayout._leftStackPreferredPanelId = null;
    }
    if (explicit && !restore && !nextCollapsed && rightOwnerPanel) {
      this._panelLayout._rightStackPreferredPanelId = rightOwnerPanel.id;
    } else if (
      explicit &&
      !restore &&
      nextCollapsed &&
      rightOwnerPanel?.id === this._panelLayout._rightStackPreferredPanelId
    ) {
      this._panelLayout._rightStackPreferredPanelId = null;
    }
    if (
      panelEl.classList.contains('collapsed') === nextCollapsed &&
      !wasAutoCollapsed
    ) {
      this._syncPanelCollapseButton(panelEl);
      if (priorLeftOwner !== this._panelLayout._leftStackPreferredPanelId) {
        this._scheduleLeftPanelLayout({ reconsiderAutoCollapse: true });
      }
      if (priorRightOwner !== this._panelLayout._rightStackPreferredPanelId) {
        this._scheduleRightPanelLayout({ reconsiderAutoCollapse: true });
      }
      return;
    }
    panelEl.classList.remove('layout-auto-collapsed');
    if (
      !nextCollapsed &&
      this.cockpitView?.active &&
      panelId === 'data-panel'
    ) {
      this._cockpitContextCollapsedForDataPanel =
        !this.cockpitView.contextCollapsed;
      if (this._cockpitContextCollapsedForDataPanel) {
        this.cockpitView.setContextCollapsed(true);
      }
    }
    if (
      !nextCollapsed &&
      panelId === 'global-context-panel' &&
      this._contextRadioDock?.classList.contains('disclosure-open')
    ) {
      this._setRadioDisclosure?.(false);
    }
    if (
      !nextCollapsed &&
      panelId === 'radio-panel' &&
      document
        .getElementById('global-context-panel')
        ?.classList.contains('collapsed')
    ) {
      this.setPanelCollapsed('global-context-panel', false, {
        restore,
        persist,
        syncShare,
      });
    }
    if (!nextCollapsed && !restore && panelId === 'location-bar') {
      const otherPanel = document.getElementById('control-panel');
      if (otherPanel && !otherPanel.classList.contains('dock-pinned')) {
        this.setPanelCollapsed('control-panel', true, {
          restore,
          persist,
          syncShare,
        });
      }
    } else if (!nextCollapsed && !restore && panelId === 'control-panel') {
      const otherPanel = document.getElementById('location-bar');
      if (otherPanel && !otherPanel.classList.contains('dock-pinned')) {
        this.setPanelCollapsed('location-bar', true, {
          restore,
          persist,
          syncShare,
        });
      }
    }
    panelEl.classList.toggle('collapsed', nextCollapsed);
    if (
      nextCollapsed &&
      this.cockpitView?.active &&
      panelId === 'data-panel' &&
      this._cockpitContextCollapsedForDataPanel
    ) {
      this._cockpitContextCollapsedForDataPanel = false;
      this.cockpitView.setContextCollapsed(false);
    }
    this._syncPanelCollapseButton(panelEl);
    if (persist !== false)
      this._savePanelCollapsedState(panelId, nextCollapsed);
    if (panelId === 'pp-toggles') {
      this._layoutRightPanels();
    }
    if (this._rightPanelStack?.contains(panelEl)) {
      this._scheduleRightPanelLayout({ reconsiderAutoCollapse: true });
    }
    if (panelId === 'cctv-panel') {
      this._syncCctvPanelViewport();
    }
    this._lifetime.frame(() => this._updateCommandDockTrayStack());
    this._scheduleLeftPanelLayout({
      reconsiderAutoCollapse: this._leftPanelStack?.contains(panelEl) === true,
    });
    if (syncShare) this.shareLinkManager?.onPanelStateChange?.();
  }

  toggleCleanView(forceEnabled) {
    const shouldEnable =
      typeof forceEnabled === 'boolean'
        ? forceEnabled
        : !document.body.classList.contains('ui-clean-view');
    document.body.classList.toggle('ui-clean-view', shouldEnable);
    if (this._cleanViewBtn) {
      this._cleanViewBtn.classList.toggle('active', shouldEnable);
    }
    this._scheduleLeftPanelLayout();
  }

  setHudVisible(mode) {
    const normalized = String(mode ?? '').toLowerCase();
    if (!['on', 'off', 'auto'].includes(normalized)) {
      return { ok: false, error: `Bilinmeyen gösterge modu: ${mode}` };
    }
    this.shareLinkManager?.claimRestoreLane?.('visual');
    this.hud.setMode(normalized);
    this._updateHudButtonState();
    this._syncShareState();
    return {
      ok: true,
      visible: !!this.hud.visible,
      mode: normalized,
      layout: this.hud.getVariant(),
    };
  }

  setHudLayout(variantName) {
    const variant = String(variantName ?? '').toLowerCase();
    if (!['tactical', 'operator', 'minimal'].includes(variant)) {
      return { ok: false, error: `Bilinmeyen gösterge düzeni: ${variantName}` };
    }
    this.shareLinkManager?.claimRestoreLane?.('visual');
    this._setHudVariant(variant);
    return {
      ok: true,
      layout: this.hud.getVariant(),
      visible: !!this.hud.visible,
    };
  }

  getDetectionState() {
    const { getDetectionTuning, getDetectionMode } = this.services;
    const pct = this._detectionDensitySlider
      ? parseInt(this._detectionDensitySlider.value, 10)
      : null;
    return {
      detectionMode: getDetectionMode(),
      densityPct: pct,
      allocationStrategy: getDetectionTuning().allocationStrategy,
      fadePct: parseInt(this._detectionFadeSlider?.value || '7', 10),
      outsideOpacityPct: parseInt(
        this._detectionOpacitySlider?.value || '0',
        10,
      ),
    };
  }

  getDetectionDiagnostics() {
    const { readDetectionDiagnostics } = this.services;
    return readDetectionDiagnostics();
  }

  setDetection({
    enabled,
    mode,
    densityPct,
    allocationStrategy,
    fadePct,
    outsideOpacityPct,
  } = {}) {
    const { getDetectionMode, setDetectionModeByLabel } = this.services;
    if (enabled !== undefined && typeof enabled !== 'boolean') {
      return {
        ok: false,
        error: `Geçersiz yoğun ağ durumu: ${enabled}`,
        ...this.getDetectionState(),
      };
    }
    let requestedProfile = null;
    if (typeof mode === 'string' && mode.trim()) {
      requestedProfile = normalizeProfile(mode);
      if (!requestedProfile) {
        return {
          ok: false,
          error: `Bilinmeyen yoğunluk modu: ${mode}`,
          ...this.getDetectionState(),
        };
      }
    }
    let requestedDensity = null;
    if (densityPct != null) {
      if (!Number.isFinite(Number(densityPct))) {
        return {
          ok: false,
          error: `Geçersiz yoğunluk: ${densityPct}`,
          ...this.getDetectionState(),
        };
      }
      requestedDensity = canonicalizeDensity(Number(densityPct));
    }
    if (
      requestedProfile &&
      requestedProfile !== 'OFF' &&
      requestedDensity != null &&
      profileForDensity(requestedDensity) !== requestedProfile
    ) {
      return {
        ok: false,
        error: `Yoğunluk modu ${requestedProfile}, ${requestedDensity}% yoğunluk ile uyuşmuyor`,
        ...this.getDetectionState(),
      };
    }
    let requestedAllocation = null;
    if (allocationStrategy != null) {
      requestedAllocation = String(allocationStrategy).trim().toUpperCase();
      if (!ALLOCATION_STRATEGIES.includes(requestedAllocation)) {
        return {
          ok: false,
          error: `Bilinmeyen dağılım stratejisi: ${allocationStrategy}`,
          ...this.getDetectionState(),
        };
      }
    }
    if (fadePct != null) {
      if (!Number.isFinite(Number(fadePct))) {
        return {
          ok: false,
          error: `Geçersiz sönümleme mesafesi: ${fadePct}`,
          ...this.getDetectionState(),
        };
      }
    }
    if (outsideOpacityPct != null) {
      if (!Number.isFinite(Number(outsideOpacityPct))) {
        return {
          ok: false,
          error: `Geçersiz dış opaklık: ${outsideOpacityPct}`,
          ...this.getDetectionState(),
        };
      }
    }
    const hasExplicitVisualChange =
      typeof enabled === 'boolean' ||
      requestedProfile !== null ||
      requestedDensity !== null ||
      requestedAllocation !== null ||
      fadePct != null ||
      outsideOpacityPct != null;
    if (hasExplicitVisualChange) {
      this.shareLinkManager?.claimRestoreLane?.('visual');
      this._detectionUserOverridden = true;
    }
    if (requestedAllocation) {
      this._setDetectionAllocation(requestedAllocation, { syncShare: false });
    }
    if (fadePct != null && this._detectionFadeSlider) {
      this._detectionFadeSlider.value = String(
        Math.max(0, Math.min(40, Math.round(Number(fadePct)))),
      );
    }
    if (outsideOpacityPct != null && this._detectionOpacitySlider) {
      this._detectionOpacitySlider.value = String(
        Math.max(0, Math.min(100, Math.round(Number(outsideOpacityPct)))),
      );
    }
    if (fadePct != null || outsideOpacityPct != null)
      this._applyDetectionFadeFromUi();

    if (
      requestedProfile &&
      requestedProfile !== 'OFF' &&
      requestedDensity == null
    ) {
      requestedDensity = defaultDensityForProfile(requestedProfile);
    }
    if (requestedDensity != null && this._detectionDensitySlider) {
      this._detectionDensitySlider.value = String(requestedDensity);
      this._applyDetectionDensityFromUi();
    }

    if (enabled === false || requestedProfile === 'OFF') {
      setDetectionModeByLabel('OFF');
    } else if (requestedProfile) {
      setDetectionModeByLabel(requestedProfile);
    } else if (enabled === true && getDetectionMode() === 'OFF') {
      setDetectionModeByLabel(
        profileForDensity(
          requestedDensity ?? this._detectionDensitySlider?.value ?? 50,
        ),
      );
    }
    this._syncDetectionUiFromEngine();
    this._syncShareState();
    return { ok: true, ...this.getDetectionState() };
  }

  async setMapStack(stackId) {
    if (!this.mapStackController) {
      return { ok: false, error: 'Harita altlık yöneticisi kullanılamıyor' };
    }
    const stacks = this.mapStackController.getStacks();
    const target = stacks.find((stack) => stack.id === stackId);
    if (!target) {
      return {
        ok: false,
        error: `Bilinmeyen harita altlığı: ${stackId}`,
        available: stacks.map((s) => s.id),
      };
    }
    if (!target.available) {
      return {
        ok: false,
        error: `${target.label} için Cesium ion belirteci gereklidir`,
        activeStack: this.mapStackController.getActiveId(),
      };
    }
    await this._setMapStack(stackId);
    const state = this.mapStackController.getState();
    const landed = state.activeId === stackId;
    return {
      ok: landed,
      activeStack: state.activeId,
      error: landed ? null : state.lastError || 'Harita altlığı değiştirilemedi',
    };
  }

  setBloom({ enabled, intensityPct } = {}) {
    const current = () => ({
      enabled: !!this.bloomEnabled,
      intensityPct: this._bloomSlider
        ? parseInt(this._bloomSlider.value, 10)
        : null,
    });
    if (enabled !== undefined && typeof enabled !== 'boolean') {
      return {
        ok: false,
        error: `Geçersiz parlaklık değeri: ${enabled}`,
        bloom: current(),
      };
    }
    if (
      intensityPct !== undefined &&
      (typeof intensityPct !== 'number' || !Number.isFinite(intensityPct))
    ) {
      return {
        ok: false,
        error: `Geçersiz parlaklık yoğunluğu: ${intensityPct}`,
        bloom: current(),
      };
    }
    const hasExplicitVisualChange =
      intensityPct !== undefined || enabled !== undefined;
    if (hasExplicitVisualChange)
      this.shareLinkManager?.claimRestoreLane?.('visual');
    if (intensityPct !== undefined) {
      this._setBloomIntensity(
        Math.round(Math.max(0, Math.min(200, intensityPct))),
      );
    }
    if (enabled !== undefined) this._setBloomEnabled(enabled);
    return {
      ok: true,
      bloom: current(),
    };
  }

  setSharpen({ enabled, intensityPct } = {}) {
    const current = () => ({
      enabled: !!this.sharpenEnabled,
      intensityPct: this._sharpenSlider
        ? parseInt(this._sharpenSlider.value, 10)
        : null,
    });
    if (enabled !== undefined && typeof enabled !== 'boolean') {
      return {
        ok: false,
        error: `Geçersiz keskinlik değeri: ${enabled}`,
        sharpen: current(),
      };
    }
    if (
      intensityPct !== undefined &&
      (typeof intensityPct !== 'number' || !Number.isFinite(intensityPct))
    ) {
      return {
        ok: false,
        error: `Geçersiz keskinlik yoğunluğu: ${intensityPct}`,
        sharpen: current(),
      };
    }
    const hasExplicitVisualChange =
      intensityPct !== undefined || enabled !== undefined;
    if (hasExplicitVisualChange)
      this.shareLinkManager?.claimRestoreLane?.('visual');
    if (intensityPct !== undefined) {
      const pct = Math.round(Math.max(0, Math.min(100, intensityPct)));
      if (this._sharpenSlider) this._sharpenSlider.value = String(pct);
      if (this._sharpenSliderValue)
        this._sharpenSliderValue.textContent = `${pct}%`;
      this._applySharpenIntensity(pct / 100);
      this._syncShareState();
    }
    if (enabled !== undefined) this._setSharpenEnabled(enabled);
    return {
      ok: true,
      sharpen: current(),
    };
  }

  get celestialRingEnabled() {
    return !!this.celestialRing?.enabled;
  }

  setCelestialRingEnabled(enabled, { syncShare = true, focus = false } = {}) {
    const { isCelestialRingStyleSupported } = this.services;
    const styleSupported = isCelestialRingStyleSupported(this.activeStyle);
    const current = () => ({
      enabled: this.celestialRingEnabled,
      visible: !!this.celestialRing?.visible,
    });
    if (typeof enabled !== 'boolean') {
      return {
        ok: false,
        celestialRing: current(),
        cameraFocused: false,
        error: `Geçersiz göksel halka değeri: ${enabled}`,
      };
    }
    if (typeof syncShare !== 'boolean' || typeof focus !== 'boolean') {
      return {
        ok: false,
        celestialRing: current(),
        cameraFocused: false,
        error: 'Göksel halka parametreleri mantıksal değer olmalıdır',
      };
    }
    if (!styleSupported && enabled) {
      return {
        ok: false,
        celestialRing: current(),
        cameraFocused: false,
        error: 'Göksel halka yalnızca Standart modda desteklenir',
      };
    }
    if (syncShare) this.shareLinkManager?.claimRestoreLane?.('visual');
    const nextEnabled = styleSupported && enabled;
    this.celestialRing?.setEnabled(nextEnabled);
    this._celestialBtn?.classList.toggle('active', nextEnabled);
    this._celestialBtn?.setAttribute('aria-pressed', String(nextEnabled));
    if (this._celestialBtn) {
      this._celestialBtn.disabled = !styleSupported;
      this._celestialBtn.setAttribute('aria-disabled', String(!styleSupported));
      this._celestialBtn.title = styleSupported
        ? 'Göksel halka — tüm küreyi gösterir'
        : 'Göksel halka — Standart modda kullanılabilir';
    }
    let cameraFocused = false;
    if (nextEnabled && focus) {
      cameraFocused = !!this.celestialRing?.focusFullGlobe();
    }
    if (syncShare) this._syncShareState();
    return {
      ok: styleSupported || !enabled,
      celestialRing: current(),
      cameraFocused,
    };
  }

  setOrbit(enabled) {
    const active = !!this.orbitController?.active;
    if (typeof enabled === 'boolean' && enabled === active) {
      return { ok: true, orbiting: active };
    }
    if (enabled === false) {
      this._stopOrbit();
      return { ok: true, orbiting: false };
    }
    if (!this._currentTarget) {
      return {
        ok: false,
        orbiting: false,
        error: 'Yörüngeye girilecek hedef bulunamadı — önce bir konuma odaklanın',
      };
    }
    this._toggleOrbit();
    return { ok: true, orbiting: !!this.orbitController?.active };
  }

  setCleanView(enabled) {
    this.toggleCleanView(enabled);
    return {
      ok: true,
      cleanView: document.body.classList.contains('ui-clean-view'),
    };
  }

  getContextModeState(...args) {
    return this._contextControls?.getContextModeState(...args);
  }

  setContextMode(...args) {
    return this._contextControls?.setContextMode(...args);
  }

  getCockpitState() {
    const { militaryAwarenessLayer } = this.services;
    const snapshot = militaryAwarenessLayer.getContextSnapshot?.();
    const info = this.cockpitView?.readAircraftInfo?.();
    const active = Boolean(this.cockpitView?.active);
    const gateOpen = Boolean(this.cockpitView?.isEntryAllowed?.());
    const entryAllowed =
      !active &&
      Boolean(gateOpen && info && this.viewer?.trackedEntity?.position);
    return {
      active,
      entryAllowed,
      entryBlockedReason:
        entryAllowed || active
          ? null
          : !gateOpen
            ? this._contextModeChanging
              ? 'contacts-starting'
              : 'contacts-inactive'
            : 'no-tracked-aircraft',
      visionMode: this.cockpitView?.visionMode || null,
      subject: info
        ? {
            id: info.icao24 || info.id || null,
            layerId: info.layerId || null,
            callsign: info.callsign || null,
          }
        : null,
      navigation: snapshot
        ? {
            canPrevious: Boolean(snapshot.navigation?.canPrevious),
            canNext: Boolean(snapshot.navigation?.canNext),
            canFocus: Boolean(snapshot.navigation?.canFocus),
          }
        : null,
      awareness: snapshot
        ? {
            radiusM: Number.isFinite(snapshot.radiusM)
              ? snapshot.radiusM
              : null,
            subject: snapshot.subject
              ? {
                  id: snapshot.subject.id || null,
                  layerId: snapshot.subject.layerId || null,
                }
              : null,
            cohorts: Array.isArray(snapshot.cohorts)
              ? snapshot.cohorts.map((cohort) => ({
                  id: cohort?.id || null,
                  source: cohort?.source || null,
                  count: Number.isFinite(cohort?.count) ? cohort.count : null,
                  relationship: cohort?.relationship || null,
                  reason: cohort?.reason || null,
                  coverage: cohort?.coverage || null,
                }))
              : [],
            navigation: snapshot.navigation
              ? {
                  canPrevious: Boolean(snapshot.navigation.canPrevious),
                  canNext: Boolean(snapshot.navigation.canNext),
                  canFocus: Boolean(snapshot.navigation.canFocus),
                }
              : null,
          }
        : null,
      activeTracked: this.cockpitView?.active
        ? Boolean(this.cockpitView?.trackedEntity)
        : false,
      activeMapView: !this.cockpitView?.active && entryAllowed,
    };
  }

  _retargetCockpitEntryLayer({
    targetLayer,
    aircraftClass,
    currentTarget,
    selectedTarget,
  }) {
    const { militaryAwarenessLayer } = this.services;
    if (!['flights', 'military'].includes(targetLayer)) {
      return {
        ok: false,
        error: `Kokpit yalnızca hava araçlarını destekler — ${targetLayer} seçilemez`,
      };
    }
    const activeLayer =
      selectedTarget?.layerId || currentTarget?.layerId || null;
    const alreadyOnLayer = activeLayer === targetLayer;
    if (alreadyOnLayer && !aircraftClass)
      return { ok: true, retargeted: false };
    const moved = militaryAwarenessLayer?.navigateNext
      ? !!militaryAwarenessLayer.navigateNext({
          targetLayer,
          aircraftClass,
          origin: 'voice',
        })
      : false;
    if (moved) return { ok: true, retargeted: true };
    if (alreadyOnLayer) return { ok: true, retargeted: false };
    const label = targetLayer === 'military' ? 'askeri' : 'sivil';
    const filtered = aircraftClass ? `${aircraftClass} ` : '';
    return {
      ok: false,
      error: `Geçerli bir ${filtered}${label} araç bulunamadı`,
    };
  }

  controlCockpit(
    action,
    {
      notificationToken = null,
      targetLayer = null,
      aircraftClass = null,
      selectedTarget = null,
      rollbackTarget = undefined,
    } = {},
  ) {
    const { flightsLayer, militaryFlightsLayer } = this.services;
    const normalized = String(action || '').toLowerCase();
    if (!this.cockpitView) {
      return {
        ok: false,
        action: 'control_cockpit',
        error: 'Kokpit yöneticisi kullanılamıyor',
        state: this.getCockpitState(),
      };
    }
    if (normalized === 'status') {
      return {
        ok: true,
        action: 'control_cockpit',
        state: this.getCockpitState(),
        notificationToken: notificationToken || null,
      };
    }
    if (normalized === 'enter') {
      if (!this.cockpitView.isEntryAllowed?.()) {
        return {
          ok: false,
          action: 'control_cockpit',
          error: this._contextModeChanging
            ? 'Trafik verileri başlatılıyor — birazdan tekrar deneyin'
            : 'Kokpite girmek için canlı hava trafiği aktif olmalıdır',
          state: this.getCockpitState(),
        };
      }
      let currentTarget = this.getAircraftTrackingTarget();
      const layerForTarget = (target) =>
        target?.layerId === 'military'
          ? militaryFlightsLayer
          : target?.layerId === 'flights'
            ? flightsLayer
            : null;
      if (targetLayer) {
        const requested = this._retargetCockpitEntryLayer({
          targetLayer,
          aircraftClass,
          currentTarget,
          selectedTarget,
        });
        if (!requested.ok) {
          return {
            ok: false,
            action: 'control_cockpit',
            error: requested.error,
            state: this.getCockpitState(),
          };
        }
        if (requested.retargeted) {
          selectedTarget = null;
          rollbackTarget =
            rollbackTarget === undefined ? currentTarget : rollbackTarget;
          currentTarget = this.getAircraftTrackingTarget();
        }
      }
      const selectedLayer =
        selectedTarget?.layerId === 'military'
          ? militaryFlightsLayer
          : selectedTarget?.layerId === 'flights'
            ? flightsLayer
            : null;
      const entry = enterCockpitWithTracking({
        cockpitView: this.cockpitView,
        selectedLayer,
        selectedTarget,
        currentLayer: layerForTarget(currentTarget),
        rollbackLayer: layerForTarget(
          rollbackTarget === undefined ? currentTarget : rollbackTarget,
        ),
        rollbackTarget,
        selectionOrigin: 'voice',
      });
      return {
        ok: entry.entered,
        action: 'control_cockpit',
        state: this.getCockpitState(),
        error: entry.error,
      };
    }
    if (normalized === 'exit') {
      const exited = !!this.cockpitView.exit();
      return {
        ok: exited,
        action: 'control_cockpit',
        state: this.getCockpitState(),
        error: exited ? null : 'Kokpit zaten kapalı',
      };
    }
    if (normalized === 'next' || normalized === 'previous') {
      const changed = this.cockpitView.navigateContext(
        normalized === 'next' ? 1 : -1,
        {
          targetLayer,
          aircraftClass,
          origin: 'voice',
        },
      );
      return {
        ok: changed,
        action: 'control_cockpit',
        state: this.getCockpitState(),
        error: changed ? null : 'Başka bir araç bulunamadı',
      };
    }
    return {
      ok: false,
      action: 'control_cockpit',
      error: `Bilinmeyen kokpit komutu: ${action}`,
      state: this.getCockpitState(),
    };
  }

  getControlState() {
    return {
      style: this.activeStyle || 'normal',
      mapStack: this.mapStackController?.getActiveId?.() || null,
      hud: {
        visible: !!this.hud?.visible,
        layout: this.hud?.getVariant?.() || null,
      },
      detection: this.getDetectionState(),
      bloom: {
        enabled: !!this.bloomEnabled,
        intensityPct: this._bloomSlider
          ? parseInt(this._bloomSlider.value, 10)
          : null,
      },
      sharpen: {
        enabled: !!this.sharpenEnabled,
        intensityPct: this._sharpenSlider
          ? parseInt(this._sharpenSlider.value, 10)
          : null,
      },
      celestialRing: {
        enabled: this.celestialRingEnabled,
        visible: !!this.celestialRing?.visible,
      },
      orbiting: !!this.orbitController?.active,
      models3d: {
        enabled: !!this._models3dEnabled,
        mode: this._models3dMode || 'proximity',
      },
      recording: !!this._recording._recordingMode,
      cleanView: document.body.classList.contains('ui-clean-view'),
    };
  }

  getCameraState() {
    const carto = this.viewer.camera.positionCartographic;
    if (!carto) return null;
    return {
      lat: Cesium.Math.toDegrees(carto.latitude),
      lon: Cesium.Math.toDegrees(carto.longitude),
      alt: carto.height,
      heading: Cesium.Math.toDegrees(this.viewer.camera.heading),
      pitch: Cesium.Math.toDegrees(this.viewer.camera.pitch),
      roll: Cesium.Math.toDegrees(this.viewer.camera.roll),
    };
  }

  applyCameraState(cameraState, duration = 2.8) {
    if (!cameraState) return;
    this.viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(
        cameraState.lon,
        cameraState.lat,
        cameraState.alt,
      ),
      orientation: {
        heading: Cesium.Math.toRadians(cameraState.heading || 0),
        pitch: Cesium.Math.toRadians(cameraState.pitch || -35),
        roll: Cesium.Math.toRadians(cameraState.roll || 0),
      },
      duration: Math.max(0.2, duration || 0),
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
    });
  }

  getVisualState() {
    const {
      getDetectionTuning,
      getDetectionMode,
      isScopeMaskEnabled,
      getScopeMaskFeather,
    } = this.services;
    const styleParams = {};
    for (const [styleName, stage] of Object.entries(this.stages)) {
      const shader = STYLES[styleName];
      if (!shader?.uniforms) continue;
      styleParams[styleName] = {};
      for (const uniformName of Object.keys(shader.uniforms)) {
        styleParams[styleName][uniformName] = stage.uniforms[uniformName];
      }
    }

    return {
      style: this.activeStyle,
      bloom: {
        enabled: this.bloomEnabled,
        intensity: this._getBloomIntensity(),
        version: BLOOM_SCALE_VERSION,
      },
      sharpen: {
        enabled: this.sharpenEnabled,
        intensity: parseInt(this._sharpenSlider?.value || '49', 10),
      },
      hud: {
        visible: this.hud.visible,
        variant: this.hud.getVariant(),
      },
      detection: {
        mode: getDetectionMode(),
        density: parseInt(this._detectionDensitySlider?.value || '50', 10),
        allocation: getDetectionTuning().allocationStrategy,
        fadePct: parseInt(this._detectionFadeSlider?.value || '7', 10),
        outsideOpacityPct: parseInt(
          this._detectionOpacitySlider?.value || '0',
          10,
        ),
      },
      scope: {
        enabled: isScopeMaskEnabled(),
        featherPct: Math.round(getScopeMaskFeather() * 100),
      },
      mapStack: this.mapStackController?.getActiveId?.() || 'photoreal',
      styleParams,
    };
  }

  async applyVisualState(state = {}, { isCurrent = null } = {}) {
    const { setScopeMaskEnabled, setScopeMaskFeather } = this.services;
    const superseded = () => typeof isCurrent === 'function' && !isCurrent();
    if (superseded()) return false;

    if (state.style && state.style !== this.activeStyle) {
      this.setStyle(state.style, { applyPreset: false });
    }

    const bloomState = state.bloom || {};
    if (typeof bloomState.intensity === 'number' && this._bloomSlider) {
      const intensity = decodeBloomIntensity(
        bloomState.intensity,
        bloomState.version ?? state.bloomVersion ?? BLOOM_SCALE_VERSION,
      );
      this._setBloomIntensity(intensity, { syncShare: false });
    }
    if (typeof bloomState.enabled === 'boolean') {
      this._setBloomEnabled(bloomState.enabled);
    }

    const sharpenState = state.sharpen || {};
    if (typeof sharpenState.intensity === 'number' && this._sharpenSlider) {
      const pct = Math.max(
        0,
        Math.min(100, Math.round(sharpenState.intensity)),
      );
      this._sharpenSlider.value = String(pct);
      this._sharpenSliderValue.textContent = `${pct}%`;
      this._applySharpenIntensity(pct / 100);
    }
    if (typeof sharpenState.enabled === 'boolean') {
      this._setSharpenEnabled(sharpenState.enabled);
    }

    const hudState = state.hud || {};
    if (hudState.variant) {
      this._setHudVariant(hudState.variant);
    }
    if (typeof hudState.visible === 'boolean') {
      this.hud.setMode(hudState.visible ? 'on' : 'off');
      this._updateHudButtonState();
    }

    const scopeState = state.scope || {};
    if (typeof scopeState.enabled === 'boolean') {
      setScopeMaskEnabled(scopeState.enabled);
      this._scopeBtn?.classList.toggle('active', scopeState.enabled);
      this._scopeBtn?.setAttribute('aria-pressed', String(scopeState.enabled));
    }
    if (typeof scopeState.featherPct === 'number' && this._scopeFeatherSlider) {
      const pct = Math.max(0, Math.min(100, Math.round(scopeState.featherPct)));
      this._scopeFeatherSlider.value = String(pct);
      if (this._scopeFeatherValue)
        this._scopeFeatherValue.textContent = `${pct}%`;
      setScopeMaskFeather(pct / 100);
    }

    const detectionState = state.detection || {};
    if (
      typeof detectionState.density === 'number' &&
      this._detectionDensitySlider
    ) {
      const pct = canonicalizeDensity(detectionState.density);
      this._detectionDensitySlider.value = String(pct);
      if (this._detectionDensityValue)
        this._detectionDensityValue.textContent = `${pct}%`;
      this._applyDetectionDensityFromUi();
    }
    if (detectionState.allocation) {
      this._setDetectionAllocation(detectionState.allocation, {
        syncShare: false,
      });
    }
    if (
      typeof detectionState.fadePct === 'number' &&
      this._detectionFadeSlider
    ) {
      this._detectionFadeSlider.value = String(detectionState.fadePct);
    }
    if (
      typeof detectionState.outsideOpacityPct === 'number' &&
      this._detectionOpacitySlider
    ) {
      this._detectionOpacitySlider.value = String(
        detectionState.outsideOpacityPct,
      );
    }
    this._applyDetectionFadeFromUi();
    if (detectionState.mode) {
      this._setDetectionMode(detectionState.mode);
    }

    if (state.mapStack) {
      if (superseded()) return false;
      const stackBefore = this.mapStackController?.getActiveId?.() ?? null;
      const genBefore =
        this.mapStackController?.getSwitchGeneration?.() ?? null;

      await this._setMapStack(state.mapStack, { syncShare: false });

      if (superseded()) {
        const genAfter =
          this.mapStackController?.getSwitchGeneration?.() ?? null;
        const globeIsStillOurs =
          genBefore !== null && genAfter !== null && genAfter <= genBefore + 1;
        const landed = this.mapStackController?.getActiveId?.() ?? null;
        if (globeIsStillOurs && stackBefore && landed !== stackBefore) {
          await this._setMapStack(stackBefore, { syncShare: false });
        }
        return false;
      }
    }

    if (state.styleParams && typeof state.styleParams === 'object') {
      for (const [styleName, params] of Object.entries(state.styleParams)) {
        const stage = this.stages[styleName];
        if (!stage || !params) continue;
        for (const [uniformName, uniformValue] of Object.entries(params)) {
          if (stage.uniforms[uniformName] === undefined) continue;
          stage.uniforms[uniformName] = uniformValue;
        }
      }
      this._updateSliderPanel(this.activeStyle);
    }

    this._syncShareState();
    return true;
  }

  _initRecordingOverlay() {
    return this._recording._initRecordingOverlay();
  }

  applyCinematicPreset(preset = {}) {
    const bloomInput =
      typeof preset.bloom === 'object'
        ? preset.bloom
        : { intensity: preset.bloom };
    let decodedBloomIntensity = null;
    if (typeof bloomInput.intensity === 'number') {
      decodedBloomIntensity = decodeBloomIntensity(
        bloomInput.intensity,
        bloomInput.version ?? preset.bloomVersion ?? BLOOM_SCALE_VERSION,
      );
      this._setBloomIntensity(decodedBloomIntensity, { syncShare: false });
    }
    if (typeof bloomInput.enabled === 'boolean') {
      this._setBloomEnabled(bloomInput.enabled);
    } else if (typeof bloomInput.intensity === 'number') {
      this._setBloomEnabled(
        (decodedBloomIntensity ?? this._getBloomIntensity()) > 0,
      );
    }

    const sharpenInput =
      typeof preset.sharpen === 'object'
        ? preset.sharpen
        : { enabled: preset.sharpen };
    if (typeof sharpenInput.intensity === 'number' && this._sharpenSlider) {
      const sharpenPct = Math.max(
        0,
        Math.min(100, Math.round(sharpenInput.intensity)),
      );
      this._sharpenSlider.value = String(sharpenPct);
      this._sharpenSliderValue.textContent = `${sharpenPct}%`;
      this._applySharpenIntensity(sharpenPct / 100);
    }
    if (typeof sharpenInput.enabled === 'boolean') {
      this._setSharpenEnabled(sharpenInput.enabled);
    } else if (typeof sharpenInput.intensity === 'number') {
      this._setSharpenEnabled(sharpenInput.intensity > 0);
    }

    if (preset.hudVariant) {
      this._setHudVariant(preset.hudVariant);
    }

    if (preset.detectionMode) {
      this._setDetectionMode(preset.detectionMode);
    }
    if (
      typeof preset.detectionDensity === 'number' &&
      this._detectionDensitySlider
    ) {
      const density = canonicalizeDensity(preset.detectionDensity);
      this._detectionDensitySlider.value = String(density);
      this._detectionDensityValue.textContent = `${density}%`;
      this._applyDetectionDensityFromUi();
    }
    if (preset.detectionAllocation) {
      this._setDetectionAllocation(preset.detectionAllocation, {
        syncShare: false,
      });
    }

    if (preset.styleParams && typeof preset.styleParams === 'object') {
      for (const [styleName, params] of Object.entries(preset.styleParams)) {
        const stage = this.stages[styleName];
        if (!stage || !params || typeof params !== 'object') continue;
        for (const [uniformName, uniformValue] of Object.entries(params)) {
          if (stage.uniforms[uniformName] === undefined) continue;
          stage.uniforms[uniformName] = uniformValue;
        }
      }
      this._updateSliderPanel(this.activeStyle);
    }

    this._syncShareState();
  }

  setRecordingMode(enabled, options) {
    return this._recording.setRecordingMode(enabled, options);
  }

  _updateSliderPanel(styleName, { reveal = false } = {}) {
    const { governorRequestRender } = this.services;
    this._styleParameters ||= createStyleParameters({
      container: this._sliderContainer,
    });
    this._styleParameters.clear();
    const shader = STYLES[styleName];

    if (!shader || !shader.uniforms || styleName === 'normal') {
      this._sliderPanel.classList.remove('active');
      this._scheduleRightPanelLayout();
      return;
    }

    this._styleParameters.render({
      uniforms: shader.uniforms,
      readValue: (uName) => this.stages[styleName].uniforms[uName],
      writeValue: (uName, val) => {
        this.shareLinkManager?.claimRestoreLane?.('visual');
        this.stages[styleName].uniforms[uName] = val;
      },
      onChange: () => {
        governorRequestRender('style-param-slider');
        this._syncShareState();
      },
    });

    this._sliderPanel.classList.add('active');
    this._scheduleRightPanelLayout();
    if (reveal) this._revealStyleParameters();
  }

  _revealStyleParameters() {
    if (!this._sliderPanel?.classList.contains('active')) return;
    if (this._cockpitDisplayPortalActive) return;
    this._sliderPanel.classList.remove('collapsed');
    this._syncPanelCollapseButton(this._sliderPanel);
    this.setPanelCollapsed('pp-toggles', false, { explicit: true });
    this._lifetime.frame(() =>
      this._lifetime.frame(() => {
        const scrollOwner = this._ppToggles;
        if (!scrollOwner) return;
        const ownerRect = scrollOwner.getBoundingClientRect();
        const panelRect = this._sliderPanel.getBoundingClientRect();
        scrollOwner.scrollTop += panelRect.top - ownerRect.top - 8;
      }),
    );
  }

  setStyle(
    styleName,
    {
      applyPreset = true,
      revealParameters = applyPreset,
      restore = false,
    } = {},
  ) {
    const { setDetectionStyle } = this.services;
    if (!restore) this.shareLinkManager?.claimRestoreLane?.('visual');
    if (styleName === this.activeStyle) {
      if (revealParameters && styleName !== 'normal')
        this._revealStyleParameters();
      return;
    }

    const previousStyle = this.activeStyle;
    this.activeStyle = styleName;
    document.documentElement.dataset.gevStyle = styleName;

    this.setCelestialRingEnabled(false, { syncShare: false, focus: false });

    if (previousStyle !== 'normal' && this.stages[previousStyle]) {
      this._startTransition(
        previousStyle,
        this.stages[previousStyle].uniforms.intensity,
        0.0,
      );
    }

    if (styleName !== 'normal' && this.stages[styleName]) {
      this._startTransition(
        styleName,
        this.stages[styleName].uniforms.intensity,
        1.0,
      );
    }

    if (applyPreset) {
      this._applyStylePresetDefaults(styleName);
    }

    document.querySelectorAll('.style-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.style === styleName);
    });

    const displayNames = { surveillance: 'NVG', thermal: 'FLIR', retro: 'CRT' };
    this._styleIndicator.textContent =
      displayNames[styleName] || styleName.toUpperCase();
    this._updateStyleMiniStatus(styleName);

    this._updateSliderPanel(styleName, { reveal: revealParameters });

    this.hud.onStyleChange(styleName);
    this._updateHudButtonState();

    setDetectionStyle(styleName);
    this._syncIrBoost();
    window.dispatchEvent(
      new CustomEvent('gev:style-change', {
        detail: { style: styleName },
      }),
    );

    this._syncCockpitInheritedStyle();

    this.shareLinkManager.onStyleChange(styleName);
    this._syncShareState();
  }

  _startTransition(styleName, fromValue, toValue) {
    this._visualEffects.startTransition(styleName, fromValue, toValue);
  }

  _updateGlobalLoadingFeedback(now) {
    return this._feedback._updateGlobalLoadingFeedback(now);
  }

  _showGlobalStatusNotice(message, options) {
    return this._feedback._showGlobalStatusNotice(message, options);
  }

  _startAnimationLoop() {
    this._visualEffects.startAnimationLoop();
  }

  _startTrafficChipTicker() {
    return this._feedback._startTrafficChipTicker();
  }

  _armLoadingFeedbackTicker() {
    return this._feedback._armLoadingFeedbackTicker();
  }

  _stopLoadingFeedbackTicker() {
    return this._feedback._stopLoadingFeedbackTicker();
  }

  subscribeLocationSearch(listener, options) {
    return this._locationState.subscribe(listener, options);
  }

  _handleLocationSearchState(state, change) {
    if (this._disposed || !change) return;
    if (change.type === 'started')
      this._activeLocationSearchGeneration = change.generation;
    else if (change.type === 'found') {
      this._searchedLocationLabel = state.destination.label || state.query;
      this._setActiveLocation(null);
      this._currentPoi = null;
      this._collapsePOIRow();
      this._updateLocationMiniStatus();
    } else if (change.type === 'missing') this._showToast('Konum bulunamadı');
    else if (change.type === 'failed') this._showToast('Arama başarısız oldu');
    else if (change.type === 'settled')
      this._settleLocationSearchUi(change.generation);
    else if (
      change.type === 'reset' &&
      this._activeLocationSearchGeneration !== null
    ) {
      this._settleLocationSearchUi(this._activeLocationSearchGeneration);
    }
  }

  _initLocationBar() {
    const { CITY_POIS, searchAndFlyTo, LocationSearch } = this.services;
    this._locationControls?.destroy();
    this._locationLookupUnsubscribe?.();
    this._locationLookup?.destroy();
    this._locationLookup = new LocationSearch({
      input: this._locationSearch,
      begin: () => this._beginDeferredNavigation('location'),
      isCurrent: (generation) =>
        !this._disposed && generation === this._navigationGeneration,
      beforeFly: (generation) => this._reassertNavigationHandoff(generation),
      search: (query, options) =>
        searchAndFlyTo(this.viewer, query, {
          placeSearch: this.placeSearch,
          ...options,
        }),
      onError: (error) => console.error('[Search] Geocoding failed:', error),
    });
    this._locationLookupUnsubscribe = this._locationLookup.subscribe(
      ({ initial, change }) => {
        this._locationState.publish(initial ? { type: 'reset' } : change);
      },
    );
    this._locationControls = new LocationControls({
      elements: {
        pills: this._locationPills,
        poiRow: this._poiRow,
        divider: this._locationBarDivider,
        search: this._locationSearch,
        searchToggle: this._searchToggle,
        resetButtons: [this._resetGlobeBtn, this._cockpitResetGlobeBtn],
        statusCity: this._locationMiniCity,
        statusPoi: this._locationMiniPoi,
      },
      cities: CITY_POIS,
      getExpandedCity: () => this._expandedCityId,
      onCity: (id) => this._onCityPillClick(id),
      onPoi: (id, index) => this._onPoiClick(id, index),
      onSearch: (query) => this._locationLookup.run(query),
      onReset: () => this.resetToGlobeView(),
    });
  }

  _beginWorldJumpTransition() {
    const { suspendDetection, trafficLayer } = this.services;
    clearTimeout(this._trafficTransitionTimer);
    trafficLayer.beginWorldJump?.();
    suspendDetection('intercity');
  }

  _endWorldJumpTransition() {
    const { resumeDetection, trafficLayer } = this.services;
    clearTimeout(this._trafficTransitionTimer);
    trafficLayer.endWorldJump?.();
    resumeDetection();
    this._updateTrafficSyncChip(true);
  }

  _flyWithTransition(cityChanged, flyAction) {
    return this._runExplicitNavigation('location', () => {
      if (!cityChanged) return flyAction({});
      let completed = false;
      const finalize = () => {
        if (completed) return;
        completed = true;
        this._endWorldJumpTransition();
      };
      const result = flyAction({
        onStart: () => this._beginWorldJumpTransition(),
        onComplete: finalize,
      });
      this._trafficTransitionTimer = window.setTimeout(finalize, 5200);
      return result;
    });
  }

  beginLocationNavigation() {
    this._stampNavigation();
    this.cockpitView?.exit({ restoreTracking: false });
    return this._releaseFollowCamera({ preserveVesselSelection: false });
  }

  _onCityPillClick(cityId) {
    const { CITY_POIS, flyToPresetLocation } = this.services;
    if (this._expandedCityId === cityId) {
      this._collapsePOIRow();
      return;
    }

    const isCityChanged =
      this._activeLocationId && this._activeLocationId !== cityId;
    const result = this._flyWithTransition(!!isCityChanged, (hooks) =>
      flyToPresetLocation(this.viewer, cityId, hooks),
    );
    if (result === false) return;
    this._expandPOIRow(cityId);
    this._setActiveLocation(cityId);
    this._activePoiIndex = 0;
    this._updatePoiHighlight();

    if (result) {
      this._currentTarget = result.targetPosition;
      this._currentPoi = CITY_POIS[cityId].pois[0];
    }
    this._updateLocationMiniStatus();
  }

  _onPoiClick(cityId, poiIndex) {
    const { CITY_POIS, flyToPOI } = this.services;
    const isCityChanged =
      this._activeLocationId && this._activeLocationId !== cityId;
    const result = this._flyWithTransition(!!isCityChanged, (hooks) =>
      flyToPOI(this.viewer, cityId, poiIndex, hooks),
    );
    if (result === false) return;
    this._setActiveLocation(cityId);
    this._activePoiIndex = poiIndex;
    this._updatePoiHighlight();

    if (result) {
      this._currentTarget = result.targetPosition;
      this._currentPoi = CITY_POIS[cityId].pois[poiIndex];
    }
    this._updateLocationMiniStatus();
  }

  _expandPOIRow(cityId) {
    const { CITY_POIS } = this.services;
    if (!CITY_POIS[cityId]) return;
    this._expandedCityId = cityId;
    this._locationControls.showPois(cityId);
  }

  _collapsePOIRow() {
    this._expandedCityId = null;
    this._activePoiIndex = null;
    this._locationControls.hidePois();
  }

  _updatePoiHighlight() {
    this._locationControls.highlightPoi(this._activePoiIndex);
  }

  clearSearchedLocation() {
    if (this._searchedLocationLabel === null) return;
    this._searchedLocationLabel = null;
    this._updateLocationMiniStatus();
  }

  _setActiveLocation(locationId) {
    this._activeLocationId = locationId;
    if (locationId) this._searchedLocationLabel = null;
    this._locationControls?.highlightCity(locationId);
    this._updateLocationMiniStatus();
  }

  _updateLocationMiniStatus() {
    const { CITY_POIS } = this.services;
    this._locationControls?.renderStatus({
      city: this._activeLocationId ? CITY_POIS[this._activeLocationId] : null,
      currentPoi: this._currentPoi,
      searchedLabel: this._searchedLocationLabel,
    });
  }

  _updateStyleMiniStatus(styleName = this.activeStyle) {
    if (!this._styleMiniValue) return;
    this._styleMiniValue.textContent =
      STYLE_STATUS_LABELS[styleName] ||
      String(styleName || 'normal').toUpperCase();
  }

  _initOrbit() {
    this._orbitIndicator = this._locationControls.createOrbitIndicator();
  }

  _toggleOrbit() {
    if (!this._currentTarget) {
      this._showToast('Önce bir konuma odaklanın');
      return;
    }

    const isActive = this.orbitController.toggle(this._currentTarget, {
      radius: this._currentPoi?.alt || 500,
      pitch: this._currentPoi?.pitch || -30,
    });

    this._orbitIndicator.classList.toggle('active', isActive);
  }

  _stopOrbit() {
    if (this.orbitController.active) {
      this.orbitController.stop();
      this._orbitIndicator.classList.remove('active');
    }
  }

  _initClearSelectedLayersButton() {
    if (!this._clearSelectedLayersBtn) return;
    this._clearLayersControl?.destroy();
    this._clearLayersControl = bindClearLayersControl(
      this._clearSelectedLayersBtn,
      () => this.clearSelectedLayers(),
    );
  }

  clearSelectedLayers(...args) {
    return this._contextControls?.clearSelectedLayers(...args);
  }

  resetToGlobeView() {
    const {
      GLOBE_VIEW,
      flyToGlobeView,
      interruptCameraMotion,
      flightsLayer,
      militaryFlightsLayer,
      satellitesLayer,
      aisLiveVesselsLayer,
      militaryAwarenessLayer,
      rocketLaunchesLayer,
    } = this.services;
    if (this._globeResetPromise) return this._globeResetPromise;
    this._stampNavigation();
    interruptCameraMotion('reset-globe');
    this._stopOrbit();
    this.cockpitView?.exit({ restoreTracking: false });
    try {
      militaryAwarenessLayer.releaseCameraOwnership?.({ origin: 'tool' });
    } catch {
      try {
        flightsLayer.stopTracking?.({ origin: 'tool' });
      } catch {
        /* best-effort release */
      }
      try {
        militaryFlightsLayer.stopTracking?.({ origin: 'tool' });
      } catch {
        /* best-effort release */
      }
      try {
        aisLiveVesselsLayer.clearSelection?.();
      } catch {
        /* best-effort release */
      }
    }
    try {
      satellitesLayer.stopTracking?.({ origin: 'tool' });
    } catch {
      /* best-effort release */
    }
    try {
      rocketLaunchesLayer.releaseCameraOwnership?.();
    } catch {
      /* best-effort release */
    }
    this.viewer.trackedEntity = undefined;
    this.viewer.camera.cancelFlight();
    this.viewer.camera.lookAtTransform(Cesium.Matrix4.IDENTITY);
    this._beginWorldJumpTransition();

    let resolveReset;
    const resetPromise = new Promise((resolve) => {
      resolveReset = resolve;
    });
    this._globeResetPromise = resetPromise;
    let settled = false;
    let timer = null;
    const finish = (cancelled = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      this._endWorldJumpTransition();
      const carto = this.viewer.camera.positionCartographic;
      const result = {
        ok: !cancelled,
        action: 'zoom_to_globe',
        cancelled,
        heightKm: Math.round(GLOBE_VIEW.heightM / 1000),
        centeredOn: {
          latitude: Number(Cesium.Math.toDegrees(carto.latitude).toFixed(2)),
          longitude: Number(Cesium.Math.toDegrees(carto.longitude).toFixed(2)),
        },
      };
      this._resetGlobeBtn?.setAttribute(
        'aria-label',
        'Küre görünümüne dön',
      );
      this._cockpitResetGlobeBtn?.setAttribute(
        'aria-label',
        'Kokpiti sıfırla ve küre görünümüne dön',
      );
      this._globeResetPromise = null;
      resolveReset(result);
    };
    timer = window.setTimeout(() => {
      const height = this.viewer.camera.positionCartographic?.height;
      finish(
        !Number.isFinite(height) ||
          Math.abs(height - GLOBE_VIEW.heightM) > 1000,
      );
    }, 4200);
    this._resetGlobeBtn?.setAttribute(
      'aria-label',
      'Küre görünümüne dönülüyor',
    );
    this._cockpitResetGlobeBtn?.setAttribute(
      'aria-label',
      'Kokpitten çıkılıyor',
    );
    const target = flyToGlobeView(this.viewer, {
      onComplete: () => finish(false),
      onCancel: () => finish(true),
    });
    if (!target) finish(true);
    return resetPromise;
  }

  _initShareButton() {
    this._lifetime.listen(this._shareBtn, 'click', async () => {
      const success = await this.shareLinkManager.copyLink();
      this._showToast(success ? 'Bağlantı kopyalandı!' : 'Kopyalama başarısız');
    });
  }

  _showToast(message) {
    return this._feedback._showToast(message);
  }

  _setModels3dParams(params, { origin = 'user' } = {}) {
    this._dataManager?.setLayerParams('flights', params, { origin });
    this._dataManager?.setLayerParams('military', params, { origin });
  }

  _syncModels3dFromLayerState(state) {
    const options = state?.options?.flights;
    if (!options) return;
    this._models3dEnabled = options.models3d === true;
    this._models3dMode = options.models3dMode === 'all' ? 'all' : 'proximity';
    this._syncModels3dButtonState();
    this._models3dModeRow?.classList.toggle('visible', this._models3dEnabled);
    for (const button of this._models3dModeBtns || []) {
      if (!button) continue;
      const active = button.dataset.mode === this._models3dMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', String(active));
    }
    this._layoutRightPanels();
  }

  _syncModels3dModeRow() {
    if (this._models3dModeRow)
      this._models3dModeRow.classList.toggle('visible', this._models3dEnabled);
    this._layoutRightPanels();
  }

  _initModels3dToggle() {
    if (!this._models3dBtn) return;
    this._syncModels3dButtonState();
    this._syncModels3dModeRow();
  }

  _setModels3dEnabled(enabled) {
    this._models3dEnabled = !!enabled;
    this._setModels3dParams({ models3d: this._models3dEnabled });
    this._syncModels3dButtonState();
  }

  _setModels3dMode(mode) {
    const normalized = mode === 'all' ? 'all' : 'proximity';
    this._models3dMode = normalized;
    this._setModels3dParams({ models3dMode: normalized });
    for (const button of this._models3dModeBtns) {
      if (!button) continue;
      const active = button.dataset.mode === normalized;
      button.classList.toggle('active', active);
      button.setAttribute('aria-checked', String(active));
    }
    this._syncModels3dButtonState();
  }

  _syncModels3dButtonState() {
    this._models3dBtn?.classList.toggle('active', this._models3dEnabled);
    this._models3dBtn?.setAttribute(
      'aria-pressed',
      String(this._models3dEnabled),
    );
  }

  _initHUDToggle() {
    if (this._hudLayoutSelect) {
      this._hudLayoutSelect.value = 'tactical';
    }
    this._setHudVariant('tactical');
    this.hud.setMode('on');
    this._updateHudButtonState();

    this._lifetime.listen(this._cockpitDisplayToggleBtn, 'click', () => {
      const open =
        this._cockpitDisplayToggleBtn.getAttribute('aria-expanded') === 'true';
      this._setCockpitDisclosure?.('display', !open);
    });
    this._initCockpitDisplayPortal();
  }

  _initCockpitDisplayPortal() {
    this._cockpitDisplayPortal?.destroy();
    this._cockpitDisplayPortal = new CockpitDisplayPortal({
      standardPanel: this._ppToggles,
      cockPanel: this._cockpitDisplayPanel,
      groups: [
        ['hud', this._hudBtn?.closest('.pp-toggle-group')],
        ['detection', this._detectionBtn?.closest('.pp-toggle-group')],
        ['parameters', this._sliderPanel],
        ['models3d', this._models3dBtn?.closest('.pp-toggle-group')],
      ],
      layout: () => {
        this._layoutRightPanels();
        this.cockpitView?.scheduleContextLayout();
      },
    });
  }

  _setCockpitDisplayPortalActive(active) {
    this._cockpitDisplayPortal?.setActive(active);
  }
  get _cockpitDisplayPortalActive() {
    return this._cockpitDisplayPortal?.active ?? false;
  }
  get _displayPortalScrollRestoreOwner() {
    return this._cockpitDisplayPortal?.restoreOwner ?? null;
  }
  get _standardDisplayScrollTop() {
    return this._cockpitDisplayPortal?.standardScrollTop ?? 0;
  }

  _updateHudButtonState() {
    this._hudBtn.classList.toggle('active', this.hud.visible);
    if (this._hudLayoutRow) {
      this._hudLayoutRow.classList.toggle('visible', this.hud.visible);
    }
    this._scheduleAdaptivePanelLayout({ settle: true });
  }

  _updateDetectionButton(modeLabel) {
    const btn = this._detectionBtn;
    if (!btn) return;
    const enabled = modeLabel !== 'OFF';
    btn.setAttribute('aria-pressed', String(enabled));
    btn.setAttribute(
      'aria-label',
      enabled
        ? `Yoğun ağ modu: ${String(modeLabel).toLowerCase()}`
        : 'Yoğun ağ modu: kapalı',
    );
    btn.classList.remove('active', 'god', 'panoptic');
    const labelEl = btn.querySelector('.pp-label');
    if (labelEl) {
      if (modeLabel === 'SPARSE') {
        labelEl.textContent = 'SEYREK';
        btn.classList.add('active');
      } else if (modeLabel === 'BALANCED') {
        labelEl.textContent = 'DENGELİ';
        btn.classList.add('active');
      } else if (modeLabel === 'DENSE') {
        labelEl.textContent = 'YOĞUN AĞ';
        btn.classList.add('active', 'panoptic');
      } else {
        labelEl.textContent = 'YOĞUN AĞ';
      }
    }

    if (this._detectionSliderRow) {
      this._detectionSliderRow.classList.toggle('visible', modeLabel !== 'OFF');
    }
    if (this._detectionAllocationRow) {
      this._detectionAllocationRow.classList.toggle(
        'visible',
        modeLabel !== 'OFF',
      );
    }
    if (this._detectionFadeRow) {
      this._detectionFadeRow.classList.toggle('visible', modeLabel !== 'OFF');
    }
    if (this._detectionOpacityRow) {
      this._detectionOpacityRow.classList.toggle(
        'visible',
        modeLabel !== 'OFF',
      );
    }
    this._layoutRightPanels();
  }

  _layoutRightPanels() {
    this._scheduleRightPanelLayout();
  }

  _syncCctvPanelViewport() {
    if (!this._cctvPanel) return;
    const inner = this._cctvPanel.querySelector('.cctv-panel-inner');
    this._lifetime.frame(() => {
      if (this._cctvPanel.parentElement?.id === 'right-context-rail') {
        this._cctvPanel.style.maxHeight = '';
        if (inner) inner.style.maxHeight = '';
        this._scheduleRightPanelLayout();
        return;
      }
      const rect = this._cctvPanel.getBoundingClientRect();
      const availableHeight = Math.max(
        190,
        Math.floor(window.innerHeight - rect.top - 12),
      );
      this._cctvPanel.style.maxHeight = `${availableHeight}px`;
      if (inner) {
        inner.style.maxHeight = `${availableHeight}px`;
      }
    });
  }

  get hasShareState() {
    return !!this._hasShareState;
  }

  get initialRestorePromise() {
    return (
      this._initialShareRestorePromise ||
      Promise.resolve({ status: 'not-requested' })
    );
  }

  _settleInitialShareRestore(result) {
    if (!this._resolveInitialShareRestore) return;
    const resolve = this._resolveInitialShareRestore;
    this._resolveInitialShareRestore = null;
    resolve(result);
    window.dispatchEvent(
      new CustomEvent('gev:initial-share-restore-settled', { detail: result }),
    );
  }

  async dispose() {
    const { destroyTrackedReadout, destroyWorldOverlay, destroyDetection } =
      this.services;
    if (this._disposed) return;
    this._shareTrackingNoticeGeneration += 1;
    this._shareTrackingAcquiringKey = null;
    this._feedback._globalStatusNotice = null;
    if (this._globalLoadingStatus) this._globalLoadingStatus.hidden = true;
    this._disposed = true;
    this._shareState.destroy();
    this._locationState.destroy();
    this._locationLookupUnsubscribe?.();
    this._locationLookupUnsubscribe = null;
    this._lifetime.destroy();
    this._recording.destroy();
    this._panelPosition.destroy();
    this._feedback.destroy();
    this._panelLayout.destroy();
    this._applicationShortcuts?.destroy();
    this._displayControls?.destroy();
    this._frameRateMonitor?.destroy();
    this._mapSourceControls?.destroy();
    this._clearLayersControl?.destroy();
    this._locationControls?.destroy();
    this._cctvControls?.destroy();
    this._radioControls?.destroy();
    this.cockpitView?.stop();
    this._cockpitDisplayPortal?.stop();
    this._visualEffects.stop();
    this._styleParameters?.destroy();
    for (const control of this._panelDisclosureControls || [])
      control.destroy();
    this._panelDisclosureControls = [];
    this._hoverPanelControls?.forEach((control) => control.destroy());
    this._hoverPanelControls?.clear();
    this._locationLookup?.destroy();
    this._cancelMapSourceFocus?.();
    this._layerStateCoordinator?.destroy();
    this._layerStateCoordinator = null;
    this._layerStateRestorePromise = null;
    clearTimeout(this._initialShareRestoreTimeout);
    this._initialShareRestoreTimeout = null;
    this._settleInitialShareRestore({
      status: 'destroyed',
      share: null,
      layers: [],
    });
    if (this._initialShareGestureHandler) {
      this.viewer?.canvas?.removeEventListener(
        'pointerdown',
        this._initialShareGestureHandler,
      );
      this.viewer?.canvas?.removeEventListener(
        'wheel',
        this._initialShareGestureHandler,
      );
      this._initialShareGestureHandler = null;
    }
    this.shareLinkManager?.destroy();
    if (this._awarenessSelectedHandler) {
      window.removeEventListener(
        'gev:awareness-subject-selected',
        this._awarenessSelectedHandler,
      );
      this._awarenessSelectedHandler = null;
    }
    if (this._awarenessClearedHandler) {
      window.removeEventListener(
        'gev:awareness-subject-cleared',
        this._awarenessClearedHandler,
      );
      this._awarenessClearedHandler = null;
    }

    this._contextControls.stop();
    this._stampNavigation();
    this._removeCctvRequestFocusListener?.();
    this._removeCctvRequestFocusListener = null;
    this._cctvRequestFocusHandler = null;
    this._removeWorldRequestFocusListener?.();
    this._removeWorldRequestFocusListener = null;
    this._worldRequestFocusHandler = null;
    this._navigationOwnerChangedRemover?.();
    this._navigationOwnerChangedRemover = null;
    this._removeNavigationAuthorityListener?.();
    this._removeNavigationAuthorityListener = null;
    await this._contextControls.restoreForDisposal();
    if (this._irBoostActive) {
      if (this._irFogWasEnabled != null && this.viewer?.scene?.fog) {
        this.viewer.scene.fog.enabled = this._irFogWasEnabled;
      }
      this._dataManager?.setLayerParams('flights', { irBoost: false });
      this._dataManager?.setLayerParams('military', { irBoost: false });
      this._irBoostActive = false;
      this._irFogWasEnabled = null;
    }
    this.cockpitView?.dispose();
    this._cockpitDisplayPortal?.destroy();
    this._cockpitDisplayPortal = null;
    this._contextControls.disconnect();
    this._dataManagerUnsubscribe?.();
    this._dataManagerUnsubscribe = null;

    if (this._windowResizeHandler) {
      window.removeEventListener('resize', this._windowResizeHandler);
      this._windowResizeHandler = null;
    }
    destroyTrackedReadout();
    destroyDetection();
    destroyWorldOverlay();
    this.celestialRing?.destroy();
    this._visualEffects.destroy();
  }
}