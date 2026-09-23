export default async function handler(req, res) {
  try {
    const { z, x, y } = req.query;
    if (!z || !x || !y) {
      return res.status(400).send('Missing coordinates');
    }

    const apiKey = 'rXKdDZxXgj2hgFspEC4BKG4HMittQ0Y6';
    // Çift slash hatasını temizleyip doğru Atlas servisine yönlendiriyoruz
    const targetUrl = `https://atlas.harita.gov.tr/webservis/hgmrasterhrt/fiziki/${z}/${x}/${y}.png?apikey=${apiKey}`;

    const upstream = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://atlas.harita.gov.tr/',
      },
    });

    if (!upstream.ok) {
      return res.status(upstream.status).send('HGM Fiziki upstream error');
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