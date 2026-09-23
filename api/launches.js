export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Hem yaklaşan fırlatmaları hem de koordinat detaylarını (mode=detailed) çeker
    const url = 'https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=40&mode=detailed';
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Targil-Dashboard/1.0 (Mozilla/5.0; Cesium-Space-Tracker)',
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      // API geçici limit uyguladıysa boş liste yerine 200 dönerek arayüzün çökmesini engeller
      return res.status(200).json({ results: [] });
    }

    const data = await response.json();
    return res.status(200).json(data);
  } catch (err) {
    return res.status(200).json({ results: [], error: err.message });
  }
}