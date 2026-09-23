export default async function handler(req, res) {
  try {
    const { z, x, y } = req.query;
    if (!z || !x || !y) return res.status(400).send('Missing coordinates');

    const targetUrl = `https://cbsc2.ibb.gov.tr/arcgis/rest/services/Ortofoto/Ortofoto_2022_RGB/MapServer/tile/${z}/${y}/${x}`;

    const upstream = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://harita.istanbul/',
      },
    });

    // 1. Eğer sunucu 404/500 verirse bunu önbelleğe ALMA
    if (!upstream.ok) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(upstream.status).send('IBB Upstream Error');
    }

    const contentType = upstream.headers.get('content-type') || '';

    // 2. İBB sunucusu İstanbul dışı için resim yerine HTML/JSON dönüyorsa bunu yakala ve 404 bas!
    if (contentType.includes('text/html') || contentType.includes('application/json')) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(404).send('Blank tile outside Istanbul');
    }

    // Sadece GERÇEK resimleri 24 saat önbelleğe al
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');

    const buffer = await upstream.arrayBuffer();
    return res.status(200).send(Buffer.from(buffer));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}