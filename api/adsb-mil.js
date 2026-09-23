export default async function handler(req, res) {
  try {
    // ADSB.lol Küresel Askeri Uçuşlar Uç Noktası
    const targetUrl = 'https://api.adsb.lol/v2/mil';

    const upstream = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: 'ADSB Mil provider failed' });
    }

    const data = await upstream.json();
    
    // Veriyi arayüzün beklediği JSON formatında döndür
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=5, s-maxage=5');
    
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Proxy Error: ' + err.message });
  }
}