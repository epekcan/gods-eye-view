import { createVesselLayer } from '../layers/vessels/index.js';
import { createAisStreamSource } from '../sources/live/standalone.js';
import * as context from './contextStore.js';
import * as trails from './trailRenderer.js';
import * as labels from './detectionDraw.js';
import * as picking from './pickRegistry.js';
import * as overlay from '../overlays/worldOverlay.js';
import * as geoid from './geoid.js';
import * as sprites from './spriteOrder.js';
import * as focus from './focusDeemphasis.js';
import * as worldFocus from '../worldFocus.js';
import * as render from '../renderGovernor.js';

const baseAisLayer = createVesselLayer({
  source: createAisStreamSource({
    apiUrl: import.meta.env?.VITE_AIS_LIVE_API_URL || '/api/ais-live',
  }),
  options: {
    maxRows: import.meta.env?.VITE_AIS_LIVE_MAX_ROWS,
    maxLabels: import.meta.env?.VITE_AIS_LIVE_LABEL_MAX_ROWS,
  },
  services: {
    context,
    trails,
    labels,
    picking,
    overlay,
    geoid,
    sprites,
    focus,
    worldFocus,
    render,
  },
});

export { AIS_FIRST_CONNECT_GRACE_MS } from '../layers/vessels/policy.js';
export const deriveAisFeedError = baseAisLayer.deriveAisFeedError;
export const classifyAisFeedSnapshot =
  baseAisLayer.classifyAisFeedSnapshot;
export const mapAnalystRecord = baseAisLayer.mapAnalystRecord;
export const vesselDatumHeightM = baseAisLayer.vesselDatumHeightM;
export const reduceVesselSelection = baseAisLayer.reduceVesselSelection;
export const applyVesselFocusDeemphasis =
  baseAisLayer.applyVesselFocusDeemphasis;
export const buildVesselCard = baseAisLayer.buildVesselCard;
export const buildSelectedVesselCard =
  baseAisLayer.buildSelectedVesselCard;
export const cardScreenSeparated = baseAisLayer.cardScreenSeparated;
export const _bindVesselInteractionForTest =
  baseAisLayer.testing._bindVesselInteractionForTest;
export const _setVesselStateForTest =
  baseAisLayer.testing._setVesselStateForTest;
export const _setVesselOverlayHostForTest =
  baseAisLayer.testing._setVesselOverlayHostForTest;
export const _updateVesselCardsForTest =
  baseAisLayer.testing._updateVesselCardsForTest;
export const _reconcileVesselsForTest =
  baseAisLayer.testing._reconcileVesselsForTest;
export const _applyAisFeedSnapshotForTest =
  baseAisLayer.testing._applyAisFeedSnapshotForTest;
export const _loadLivePositionsForTest =
  baseAisLayer.testing._loadLivePositionsForTest;
export const _beginAisSessionForTest =
  baseAisLayer.testing._beginAisSessionForTest;
export const _setAisRuntimeForTest =
  baseAisLayer.testing._setAisRuntimeForTest;
export const _getVesselFeedStateForTest =
  baseAisLayer.testing._getVesselFeedStateForTest;
export const _getVesselStateForTest =
  baseAisLayer.testing._getVesselStateForTest;

const aisLiveVesselsLayer = {
  ...baseAisLayer,
  name: 'Canlı Gemi Trafiği (AIS)',
  source: 'AISHub · Küresel Deniz Trafiği',
};

export default aisLiveVesselsLayer;