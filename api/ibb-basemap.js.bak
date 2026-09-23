export default async function handler(req, res) {
  try {
    const { z, x, y } = req.query;
    if (!z || !x || !y) {
      return res.status(400).send('Missing coordinates');
    }

    // İBB basemap / tile servis uç noktası
    const targetUrl = `https://basemap.ibb.gov.tr/eva/rest/services/IBB_Basemap/MapServer/tile/${z}/${y}/${x}`;

    const upstream = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://harita.istanbul/',
      },
    });

    if (!upstream.ok) {
      return res.status(upstream.status).send('IBB basemap upstream error');
    }

    const contentType = upstream.headers.get('content-type') || 'image/png';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=86400');

    const buffer = await upstream.arrayBuffer();
    return res.status(200).send(Buffer.from(buffer));
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}