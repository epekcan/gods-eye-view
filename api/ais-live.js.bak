import WebSocket from 'ws';

export default async function handler(req, res) {
  // CORS başlıkları
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate=20');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const API_KEY = '73adfb7c69e8837e41aa7b8cb8e4dc96906791b8';

  return new Promise((resolve) => {
    const vessels = new Map();
    let ws;

    const timeout = setTimeout(() => {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      const records = Array.from(vessels.values());
      res.status(200).json({
        records,
        timestamp: Date.now(),
        status: 200,
      });
      resolve();
    }, 3500); // 3.5 saniye boyunca Türkiye denizlerindeki gemileri toplar

    try {
      ws = new WebSocket('wss://stream.aisstream.io/v0/stream');

      ws.on('open', () => {
        const subscriptionMessage = {
          Apikey: API_KEY,
          BoundingBoxes: [
            [
              [35.0, 25.0], // Ege, Akdeniz, Karadeniz ve Boğazlar (Güneybatı: [lat, lon])
              [42.5, 42.0], // Kuzeydoğu: [lat, lon]
            ],
          ],
          FilterMessageTypes: ['PositionReport', 'ShipStaticData'],
        };
        ws.send(JSON.stringify(subscriptionMessage));
      });

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          const mmsi = msg?.MetaData?.MMSI;
          const pos = msg?.Message?.PositionReport;
          const meta = msg?.MetaData;

          if (mmsi && (pos || meta)) {
            const current = vessels.get(mmsi) || {
              mmsi: String(mmsi),
              name: (meta?.ShipName || `MMSI-${mmsi}`).trim(),
              lat: meta?.latitude ?? pos?.Latitude,
              lon: meta?.longitude ?? pos?.Longitude,
              sog: pos?.Sog ?? 0,
              cog: pos?.Cog ?? 0,
              hdg: pos?.TrueHeading ?? pos?.Cog ?? 0,
              timestamp: Date.now(),
            };

            if (meta?.latitude != null && meta?.longitude != null) {
              current.lat = meta.latitude;
              current.lon = meta.longitude;
            } else if (pos?.Latitude != null && pos?.Longitude != null) {
              current.lat = pos.Latitude;
              current.lon = pos.Longitude;
            }

            if (current.lat && current.lon) {
              vessels.set(mmsi, current);
            }
          }
        } catch (_) {
          // JSON ayrıştırma hatalarını yut
        }
      });

      ws.on('error', (err) => {
        clearTimeout(timeout);
        const records = Array.from(vessels.values());
        res.status(200).json({ records, timestamp: Date.now(), status: 200, error: err.message });
        resolve();
      });
    } catch (err) {
      clearTimeout(timeout);
      res.status(500).json({ error: err.message });
      resolve();
    }
  });
}