import WebSocket from 'ws';

// Sunucu çalıştığı sürece toplanan gemileri hafızada tutar
const vesselCache = new Map();
let isConnecting = false;
let globalWs = null;

function ensureWebSocket(apiKey) {
  if (globalWs && (globalWs.readyState === WebSocket.OPEN || globalWs.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    globalWs = new WebSocket('wss://stream.aisstream.io/v0/stream');

    globalWs.on('open', () => {
      // Türkiye çevresi: Ege, Akdeniz, Marmara, Karadeniz
      const subscriptionMessage = {
        Apikey: apiKey,
        BoundingBoxes: [
          [
            [34.0, 24.0], // Güneybatı: Akdeniz / Girit
            [43.5, 42.5], // Kuzeydoğu: Karadeniz / Gürcistan sınırı
          ],
        ],
        FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
      };
      globalWs.send(JSON.stringify(subscriptionMessage));
    });

    globalWs.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        const mmsi = msg?.MetaData?.MMSI;
        const pos = msg?.Message?.PositionReport;
        const meta = msg?.MetaData;

        if (mmsi && (pos || meta)) {
          const lat = meta?.latitude ?? pos?.Latitude;
          const lon = meta?.longitude ?? pos?.Longitude;

          if (lat != null && lon != null && lat !== 0 && lon !== 0) {
            const existing = vesselCache.get(mmsi) || {};
            vesselCache.set(mmsi, {
              mmsi: String(mmsi),
              name: (meta?.ShipName || existing.name || `VESSEL-${mmsi}`).trim(),
              lat,
              lon,
              sog: pos?.Sog ?? existing.sog ?? 0,
              cog: pos?.Cog ?? existing.cog ?? 0,
              hdg: pos?.TrueHeading ?? pos?.Cog ?? existing.hdg ?? 0,
              timestamp: Date.now(),
            });
          }
        }
      } catch (_) {}
    });

    globalWs.on('error', () => {
      try { globalWs.close(); } catch (_) {}
    });

    globalWs.on('close', () => {
      globalWs = null;
    });
  } catch (_) {
    globalWs = null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=5, stale-while-revalidate=10');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const API_KEY = '73adfb7c69e8837e41aa7b8cb8e4dc96906791b8';
  ensureWebSocket(API_KEY);

  // İlk açılışta soketin ilk verileri alması için 2 saniye dinle
  await new Promise((r) => setTimeout(r, 2000));

  // Son 45 dakika içinde sinyal vermiş tüm gemileri tut
  const now = Date.now();
  const activeCutoff = now - 45 * 60 * 1000;
  for (const [mmsi, vessel] of vesselCache.entries()) {
    if (vessel.timestamp < activeCutoff) {
      vesselCache.delete(mmsi);
    }
  }

  return res.status(200).json({
    records: Array.from(vesselCache.values()),
    timestamp: now,
    status: 200,
  });
}