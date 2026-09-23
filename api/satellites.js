export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=7200'); // TLE verisi saatlik önbelleklenebilir

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // İstek parametresine göre CelesTrak sorgusu (örneğin active uydular, istasyonlar vs.)
  const group = req.query.group || 'active';
  const targetUrl = `https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(group)}&FORMAT=TLE`;

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'text/plain, */*',
      },
    });

    if (!response.ok) {
      return res.status(response.status).send(`CelesTrak error: ${response.status}`);
    }

    const text = await response.text();
    res.setHeader('Content-Type', 'text/plain');
    return res.status(200).send(text);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}