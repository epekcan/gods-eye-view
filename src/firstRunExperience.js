import { createSurfaceKeyboard } from './ui/surfaceKeyboard.js';

// First-run mission launcher.
//
// The map deliberately does not auto-enable live feeds on every visit: doing so
// would spend optional API quotas, surprise returning operators, and fight share
// links. A new visitor instead gets one compact, explicit choice after startup.
//
// SHOW POLICY (owner ruling, 2026-08-23). The launcher is NOT one-shot. A new
// operator needs the map explained more than once, so it returns every fresh
// browser session until they say otherwise:
//
//   - a share link never sees it — its author already chose the experience;
//   - `?welcome=0` suppresses, `?welcome=1` replays (it outranks BOTH the
//     session flag and the durable one, so support can always demo it);
//   - ticking "Don't show this again" writes the DURABLE suppression — that
//     tick is the only thing that stops it coming back;
//   - any other close (a mission, Explore manually, ESC) writes only the
//     SESSION flag, so it stays gone for this tab and returns next session.
//
// Choosing a mission is deliberately NOT durable suppression: picking a mission
// is enthusiasm, not "never show me this again".

/** Durable suppression. Written ONLY by the "Don't show this again" checkbox. */
export const FIRST_RUN_STORAGE_KEY = 'gev:first-run-mission:v1';
/** Per-session dismissal. Written by every close path; scoped to sessionStorage. */
export const FIRST_RUN_SESSION_KEY = 'gev:first-run-mission-session:v1';

/**
 * Owner-selectable name for the fires/quakes mission. Flip this ONE constant to
 * re-label the tile; the alternates are pre-written so the choice is a taste
 * call at review time, not an edit.
 * @type {'ENVIRONMENTAL'|'EARTH_WATCH'|'ACTIVE_EVENTS'}
 */
export const ENVIRONMENTAL_LABEL_CHOICE = 'ENVIRONMENTAL';

const ENVIRONMENTAL_LABELS = Object.freeze({
  ENVIRONMENTAL: Object.freeze({ title: 'SİSMİK VE DOĞAL OLAYLAR' }),
  EARTH_WATCH: Object.freeze({ title: 'DÜNYA GÖZLEMİ' }),
  ACTIVE_EVENTS: Object.freeze({ title: 'AKTİF OLAYLAR' }),
});

/**
 * @param {string} [choice]
 * @returns {{title: string}} The label set the constant above selects.
 */
export function environmentalLabel(choice = ENVIRONMENTAL_LABEL_CHOICE) {
  return ENVIRONMENTAL_LABELS[choice] || ENVIRONMENTAL_LABELS.ENVIRONMENTAL;
}

/** @type {Readonly<Record<string, object>>} */
export const FIRST_RUN_MISSIONS = Object.freeze({
  contacts: Object.freeze({
    kind: 'context',
    contextMode: 'contacts',
    busyText: 'Canlı trafik başlatılıyor…',
  }),
  'space-missions': Object.freeze({
    kind: 'context',
    contextMode: 'space-missions',
    busyText: 'Uzay görevleri açılıyor…',
  }),
  environmental: Object.freeze({
    kind: 'globe',
    // Hem Kandilli/AFAD depremleri hem de MTA diri fay hatları aynı anda otomatik açılır
    layerIds: Object.freeze(['earthquakes', 'mta-faults']),
    busyText: 'Sismik ve fay verileri taranıyor…',
  }),
  explore: Object.freeze({ kind: 'none' }),
});

function resolveStore(kind, injected) {
  if (injected !== undefined) return injected;
  try {
    return kind === 'session' ? globalThis.sessionStorage : globalThis.localStorage;
  } catch {
    return null;
  }
}

function readStored(kind, injected, key) {
  try {
    return resolveStore(kind, injected)?.getItem?.(key) ?? null;
  } catch {
    return null;
  }
}

function writeStored(kind, injected, key, value) {
  try {
    const store = resolveStore(kind, injected);
    if (typeof store?.setItem !== 'function') return false;
    store.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function removeStored(kind, injected, key) {
  try {
    const store = resolveStore(kind, injected);
    if (typeof store?.removeItem !== 'function') return false;
    store.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

export function shouldShowFirstRun({
  hasShareState = false,
  storage,
  sessionStorageRef,
  location = globalThis.location,
} = {}) {
  if (hasShareState) return false;
  const params = new URLSearchParams(location?.search || '');
  if (params.get('welcome') === '0') return false;
  if (params.get('welcome') === '1') return true;
  if (readStored('local', storage, FIRST_RUN_STORAGE_KEY) === 'suppressed') return false;
  if (readStored('session', sessionStorageRef, FIRST_RUN_SESSION_KEY) === 'dismissed') return false;
  return true;
}

export function setFirstRunSuppressed(suppressed, storage) {
  return suppressed
    ? writeStored('local', storage, FIRST_RUN_STORAGE_KEY, 'suppressed')
    : removeStored('local', storage, FIRST_RUN_STORAGE_KEY);
}

export function rememberFirstRunSessionDismissed(sessionStorageRef) {
  writeStored('session', sessionStorageRef, FIRST_RUN_SESSION_KEY, 'dismissed');
}

export async function runFirstRunChoice(choice, { setContextMode, setLayerEnabled, flyToGlobe }) {
  const mission = FIRST_RUN_MISSIONS[choice];
  if (!mission) return { ok: false, choice };
  if (mission.kind === 'none') return { ok: true, choice };
  if (mission.kind === 'context') {
    const result = await setContextMode(mission.contextMode);
    return { ok: Boolean(result?.ok), choice, result };
  }

  const flight = Promise.resolve()
    .then(() => flyToGlobe())
    .catch(() => null);

  const outcomes = await Promise.all(
    mission.layerIds.map(async (layerId) => {
      try {
        return { layerId, ok: (await setLayerEnabled(layerId)) !== false };
      } catch {
        return { layerId, ok: false };
      }
    })
  );

  await flight;
  const failedLayerIds = outcomes.filter((entry) => !entry.ok).map((entry) => entry.layerId);
  return { ok: failedLayerIds.length === 0, choice, failedLayerIds };
}

export const EXCLUSIVE_SURFACE_CLASSES = Object.freeze([
  'cockpit-mode',
  'scene-playback-mode',
  'recording-mode',
  'ui-clean-view',
]);

export function exclusiveSurfaceActive(documentRef = globalThis.document) {
  const list = documentRef?.body?.classList;
  if (!list) return false;
  return EXCLUSIVE_SURFACE_CLASSES.some((name) => list.contains(name));
}

export function initFirstRunExperience({
  styleManager,
  dataManager = styleManager?._dataManager,
  documentRef = globalThis.document,
  storage,
  sessionStorageRef,
  location = globalThis.location,
} = {}) {
  const root = documentRef?.getElementById?.('first-run-launcher');
  if (!root || root.dataset.initialized === 'true') return null;
  root.dataset.initialized = 'true';

  if (!shouldShowFirstRun({
    hasShareState: styleManager?.hasShareState,
    storage,
    sessionStorageRef,
    location,
  })) {
    root.remove();
    return null;
  }

  const environmentalTitle = root.querySelector('[data-first-run-environmental-title]');
  if (environmentalTitle) environmentalTitle.textContent = environmentalLabel().title;

  const status = root.querySelector('[data-first-run-status]');
  const suppressBox = root.querySelector('[data-first-run-suppress]');
  const buttons = [...root.querySelectorAll('[data-first-run-choice]')];
  const defaultStatus = status?.textContent || '';
  let busy = false;
  let closing = false;

  const coveredByOverlay = () => {
    if (typeof documentRef.elementFromPoint !== 'function') return false;
    const rect = root.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return false;
    try {
      const hit = documentRef.elementFromPoint(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
      );
      return Boolean(hit) && !root.contains(hit);
    } catch {
      return false;
    }
  };

  const isTopmost = () => root.isConnected
    && root.classList.contains('visible')
    && root.getClientRects().length > 0
    && !coveredByOverlay();

  const dismiss = ({ restoreFocus = true } = {}) => {
    if (closing) return;
    closing = true;
    rememberFirstRunSessionDismissed(sessionStorageRef);
    root.classList.remove('visible');
    root.setAttribute('aria-hidden', 'true');
    globalThis.removeEventListener?.('resize', onViewportResize);
    surfaceObserver?.disconnect();
    const remove = () => root.remove();
    root.addEventListener('transitionend', remove, { once: true });
    globalThis.setTimeout?.(remove, 400);
    keyboard.deactivate({ restoreFocus });
  };

  const setBusy = (next, choice = '') => {
    busy = next;
    root.dataset.state = next ? 'loading' : 'ready';
    root.setAttribute('aria-busy', String(next));
    for (const button of buttons) button.setAttribute('aria-disabled', String(next));
    if (!status) return;
    if (next) status.textContent = FIRST_RUN_MISSIONS[choice]?.busyText || 'İşleniyor…';
    else if (status.dataset.sticky !== 'true') status.textContent = defaultStatus;
  };

  const onChoice = async (event) => {
    if (busy || closing) return;
    const choice = event.currentTarget?.dataset?.firstRunChoice;
    if (!FIRST_RUN_MISSIONS[choice]) return;
    if (status) delete status.dataset.sticky;
    setBusy(true, choice);
    let outcome = null;
    try {
      outcome = await runFirstRunChoice(choice, {
        setContextMode: async (mode) => {
          const result = await styleManager.setContextMode(mode);
          if (result?.ok) {
            styleManager.setPanelCollapsed?.('global-context-panel', false, { explicit: true });
          }
          return result;
        },
        setLayerEnabled: (layerId) => dataManager.setEnabled(layerId, true, { origin: 'user' }),
        flyToGlobe: () => styleManager.resetToGlobeView(),
      });
    } catch (error) {
      console.warn('[First run] Mission launch failed:', error);
    }
    if (closing) return;
    if (outcome?.ok) {
      dismiss();
      return;
    }
    const failed = outcome?.failedLayerIds?.length
      ? outcome.failedLayerIds
      : outcome?.result?.failedLayerIds;
    const detail = Array.isArray(failed) && failed.length ? ` (${failed.join(', ')})` : '';
    if (status) {
      status.dataset.sticky = 'true';
      status.textContent = `Bu görev başlatılamadı${detail}. Lütfen tekrar deneyin.`;
    }
    setBusy(false);
  };

  const onSuppressChange = (event) => {
    const box = event.currentTarget;
    const wanted = Boolean(box?.checked);
    if (setFirstRunSuppressed(wanted, storage)) return;
    if (box) box.checked = !wanted;
    if (!status) return;
    status.dataset.sticky = 'true';
    status.textContent = 'Tarayıcı depolamayı engellediği için tercih kaydedilemedi.';
  };

  const keyboard = createSurfaceKeyboard({
    root,
    documentRef,
    isActive: () => !closing && isTopmost(),
    onEscape: () => dismiss(),
    fallbackFocus: () => documentRef.body,
  });

  for (const button of buttons) button.addEventListener('click', onChoice);
  suppressBox?.addEventListener('change', onSuppressChange);
  keyboard.activate();

  const choiceList = root.querySelector('.first-run-choices');
  const syncScrollAffordance = () => {
    if (!choiceList) return;
    const overflows = choiceList.scrollHeight > choiceList.clientHeight + 1;
    choiceList.dataset.scrollable = String(overflows);
  };

  let revealed = false;
  const reveal = () => {
    if (revealed || closing) return;
    revealed = true;
    root.hidden = false;
    globalThis.requestAnimationFrame?.(() => {
      if (closing) return;
      root.classList.add('visible');
      syncScrollAffordance();
      buttons[0]?.focus?.({ preventScroll: true });
    });
  };

  const yieldToExclusiveSurface = () => {
    if (closing) return;
    dismiss({ restoreFocus: false });
  };

  const syncToExclusiveSurfaces = () => {
    if (closing) return;
    const blocked = exclusiveSurfaceActive(documentRef);
    if (revealed && blocked) yieldToExclusiveSurface();
    else if (!revealed && !blocked) reveal();
  };

  const onViewportResize = () => syncScrollAffordance();
  globalThis.addEventListener?.('resize', onViewportResize);

  const surfaceObserver = typeof globalThis.MutationObserver === 'function'
    ? new globalThis.MutationObserver(syncToExclusiveSurfaces)
    : null;

  if (documentRef.body) {
    surfaceObserver?.observe(documentRef.body, { attributes: true, attributeFilter: ['class'] });
  }
  syncToExclusiveSurfaces();

  const destroy = () => {
    closing = true;
    keyboard.destroy();
    globalThis.removeEventListener?.('resize', onViewportResize);
    surfaceObserver?.disconnect();
    root.remove();
  };
  return { dismiss, isTopmost, destroy };
}