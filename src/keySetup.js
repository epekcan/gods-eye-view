import { createSurfaceKeyboard } from './ui/surfaceKeyboard.js';

/**
 * TARGIL IRS — Sağlayıcı ve Anahtar Kurulum Yüzeyi
 */

/** Chip label — Taktik buton etiketi */
export function keySetupChipLabel(status) {
  const missing = Math.max(0, (status?.total || 0) - (status?.setCount || 0));
  return missing > 0 ? `API BAĞLANTILARI · ${missing} EKSİK ANAHTAR` : 'TÜM BAĞLANTILAR AKTİF';
}

/**
 * Collect a POST body from field descriptors — pure, exported for tests.
 * @param {Array<{envVar: string, value: string}>} fields
 * @returns {Record<string, string>} non-empty trimmed values only
 */
export function collectKeyUpdates(fields) {
  const updates = {};
  for (const field of fields || []) {
    const value = String(field?.value ?? '').trim();
    if (value && field?.envVar) updates[field.envVar] = value;
  }
  return updates;
}

/**
 * Strips only `map=osm` when primary keys land.
 * @param {string} hash Location hash without the leading '#'.
 * @returns {string|null}
 */
export function stripKeylessBasemapFromHash(hash) {
  if (!hash) return null;
  try {
    const params = new URLSearchParams(hash);
    if (!['osm', 'esri-imagery'].includes(params.get('map'))) return null;
    params.delete('map');
    return params.toString();
  } catch {
    return null;
  }
}

const TIER_DOTS = Object.freeze({ metered: '🔴', free: '🟡' });

/** Build one key row. */
function buildRow(documentRef, key) {
  const row = documentRef.createElement('section');
  row.className = 'key-setup-row';
  row.dataset.keyId = key.id;
  row.dataset.set = String(Boolean(key.set));
  if (key.managed) row.dataset.managed = key.managed;
  const external = key.managed === 'external';

  const head = documentRef.createElement('div');
  head.className = 'key-setup-row-head';
  const led = documentRef.createElement('span');
  led.className = 'key-setup-led';
  led.setAttribute('aria-hidden', 'true');
  const title = documentRef.createElement('strong');
  title.textContent = key.title;
  const tier = documentRef.createElement('span');
  tier.className = 'key-setup-tier';
  tier.textContent = TIER_DOTS[key.tier] || '';
  tier.title = key.tier === 'metered' ? 'Ücretli / Faturalandırma hesabı gerekir' : 'Ücretsiz — kayıt ol, anahtarı yapıştır';
  head.append(led, title, tier);
  if (key.clientExposed) {
    const exposed = documentRef.createElement('span');
    exposed.className = 'key-setup-exposed';
    exposed.textContent = 'istemci taraflı';
    exposed.title = 'Bu anahtar tarayıcıda çalışır — sağlayıcı panelinden alan adı kısıtlaması yapınız';
    head.append(exposed);
  }
  if (external) {
    const badge = documentRef.createElement('span');
    badge.className = 'key-setup-external';
    badge.textContent = 'harici yapılandırma';
    badge.title = 'Ortam değişkeni olarak ayarlanmış';
    head.append(badge);
  }
  const get = documentRef.createElement('a');
  get.className = 'key-setup-get';
  get.href = key.getUrl;
  get.target = '_blank';
  get.rel = 'noopener noreferrer';
  get.textContent = key.set ? 'YÖNET ↗' : 'ANAHTAR AL ↗';
  head.append(get);

  const unlocks = documentRef.createElement('p');
  unlocks.className = 'key-setup-unlocks';
  unlocks.textContent = key.unlocks;

  row.append(head, unlocks);
  if (!external) {
    const fields = documentRef.createElement('div');
    fields.className = 'key-setup-fields';
    for (const envVar of key.envVars) {
      const input = documentRef.createElement('input');
      input.type = 'password';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.dataset.envVar = envVar;
      input.setAttribute('aria-label', envVar);
      input.placeholder = key.set
        ? `${envVar} kayıtlı — değiştirmek için yapıştırın`
        : `${envVar} yapıştırın`;
      fields.append(input);
    }
    if (key.managed === 'file') {
      const remove = documentRef.createElement('button');
      remove.type = 'button';
      remove.className = 'key-setup-remove';
      remove.dataset.keySetupRemove = JSON.stringify(key.envVars);
      remove.textContent = 'SİL';
      remove.title = `${key.title} anahtarını kayıtlı yapılandırmadan kaldır`;
      fields.append(remove);
    }
    row.append(fields);
  }
  return row;
}

export async function initKeySetup({ documentRef = globalThis.document, fetchImpl, signal } = {}) {
  const chip = documentRef?.getElementById?.('key-setup-chip');
  const root = documentRef?.getElementById?.('key-setup');
  if (!chip || !root || root.dataset.initialized === 'true') return null;
  root.dataset.initialized = 'true';
  const lifetime = new AbortController();
  let disposed = false;
  let disposeControls = () => {};
  const destroy = () => {
    if (disposed) return;
    disposed = true;
    lifetime.abort();
    signal?.removeEventListener('abort', destroy);
    disposeControls();
    chip.remove();
    root.remove();
  };
  if (signal?.aborted) { destroy(); return null; }
  signal?.addEventListener('abort', destroy, { once: true });
  const doFetch = fetchImpl || globalThis.fetch?.bind(globalThis);

  let status = null;
  try {
    const response = await doFetch('/api/setup/status', { cache: 'no-store', signal: lifetime.signal });
    if (!response.ok) throw new Error(String(response.status));
    status = await response.json();
    if (disposed) return null;
  } catch {
    destroy();
    return null;
  }

  const rowsHost = root.querySelector('[data-key-setup-rows]');
  const applyButton = root.querySelector('[data-key-setup-apply]');
  const closeButton = root.querySelector('[data-key-setup-close]');
  const chipLabel = chip.querySelector('[data-key-setup-chip-label]') || chip;
  const statusLine = root.querySelector('[data-key-setup-status]');
  const defaultStatusText = statusLine?.textContent || '';
  let busy = false;
  let open = false;

  const render = (nextStatus) => {
    if (disposed) return;
    status = nextStatus;
    chipLabel.textContent = keySetupChipLabel(status);
    chip.hidden = status.setCount >= status.total;
    if (!rowsHost) return;
    rowsHost.textContent = '';
    for (const key of status.keys || []) rowsHost.append(buildRow(documentRef, key));
  };

  const visible = () => root.isConnected
    && root.classList.contains('visible')
    && root.getClientRects().length > 0;

  const keyboard = createSurfaceKeyboard({
    root,
    documentRef,
    isActive: () => open && visible(),
    onEscape: () => close(),
  });

  const openDialog = () => {
    if (disposed || open) return;
    open = true;
    keyboard.activate();
    root.hidden = false;
    globalThis.requestAnimationFrame?.(() => {
      if (!open) return;
      root.classList.add('visible');
      root.querySelector('input')?.focus?.({ preventScroll: true });
    });
  };

  const close = () => {
    if (!open) return;
    open = false;
    root.classList.remove('visible');
    const hide = () => { if (!open) root.hidden = true; };
    root.addEventListener('transitionend', hide, { once: true });
    globalThis.setTimeout?.(hide, 400);
    if (statusLine) statusLine.textContent = defaultStatusText;
    keyboard.deactivate({ restoreFocus: true });
  };

  const say = (text) => { if (statusLine) statusLine.textContent = text; };

  const storeLabel = () => (status?.store === 'pinokio-environment'
    ? 'uygulama yapılandırmanıza'
    : 'yerel .env dosyanıza');

  const submitUpdates = async (updates, doneVerb) => {
    if (disposed || busy) return;
    const googleWasUnset = !status?.keys?.find((key) => key.id === 'google-maps')?.set;
    busy = true;
    applyButton?.setAttribute('aria-disabled', 'true');
    say('Kaydediliyor…');
    try {
      const response = await doFetch('/api/setup/keys', {
        method: 'POST',
        signal: lifetime.signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
      const payload = await response.json().catch(() => ({}));
      if (disposed) return;
      if (!response.ok || !payload.ok) {
        say(payload.error || `Kayıt başarısız (${response.status}).`);
        return;
      }
      for (const input of root.querySelectorAll('input[data-env-var]')) input.value = '';
      render(payload.status);
      if (googleWasUnset && payload.saved?.includes('GOOGLE_MAPS_API_KEY')) {
        const strip = () => {
          try {
            const next = stripKeylessBasemapFromHash(globalThis.location?.hash?.slice(1) || '');
            if (next !== null) globalThis.history?.replaceState?.(null, '', `#${next}`);
          } catch {}
        };
        strip();
        globalThis.addEventListener?.('pagehide', strip, { once: true, signal: lifetime.signal });
      }
      say(`${doneVerb} ${storeLabel()}. Sunucu yeniden başlatılıyor — sayfa yenilenecek.`);
    } catch (error) {
      say(`Kayıt hatası: ${error?.message || error}`);
    } finally {
      busy = false;
      applyButton?.setAttribute('aria-disabled', 'false');
    }
  };

  const onApply = async () => {
    if (disposed || busy) return;
    const inputs = [...root.querySelectorAll('input[data-env-var]')];
    const updates = collectKeyUpdates(
      inputs.map((input) => ({ envVar: input.dataset.envVar, value: input.value })),
    );
    if (!Object.keys(updates).length) {
      say('Önce en az bir API anahtarı yapıştırın.');
      return;
    }
    await submitUpdates(updates, 'Kaydedildi:');
  };

  chip.addEventListener('click', openDialog);
  closeButton?.addEventListener('click', close);
  applyButton?.addEventListener('click', onApply);
  rowsHost?.addEventListener('click', (event) => {
    const button = event.target?.closest?.('[data-key-setup-remove]');
    if (disposed || !button || busy) return;
    let envVars = [];
    try {
      envVars = JSON.parse(button.dataset.keySetupRemove || '[]');
    } catch {
      return;
    }
    if (!Array.isArray(envVars) || !envVars.length) return;
    const ok = typeof globalThis.confirm !== 'function'
      || globalThis.confirm('Bu anahtarı kayıtlı yapılandırmadan kaldırmak istiyor musunuz?');
    if (!ok) return;
    void submitUpdates(
      Object.fromEntries(envVars.map((name) => [name, null])),
      'Kaldırıldı:',
    );
  });

  render(status);

  try {
    if (new URLSearchParams(globalThis.location?.search || '').get('setup') === '1') openDialog();
  } catch {}

  disposeControls = () => {
    open = false;
    keyboard.destroy();
    chip.removeEventListener('click', openDialog);
    closeButton?.removeEventListener('click', close);
    applyButton?.removeEventListener('click', onApply);
  };
  return { open: openDialog, close, render, destroy };
}