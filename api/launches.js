let cachedLaunches = null;
let lastFetchTime = 0;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const now = Date.now();
  // 30 dakikalık hafıza: TheSpaceDevs 15 istek/saat limitine takılmayı engeller
  if (cachedLaunches && now - lastFetchTime < 30 * 60 * 1000) {
    return res.status(200).json(cachedLaunches);
  }

  try {
    // Son 15 gün ile önümüzdeki 30 günü kapsayan zaman penceresi
    const windowStart = new Date(now - 15 * 24 * 60 * 60 * 1000).toISOString();
    const windowEnd = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();

    const targetUrl = `https://ll.thespacedevs.com/2.2.0/launch/?net__gte=${encodeURIComponent(
      windowStart
    )}&net__lte=${encodeURIComponent(windowEnd)}&limit=35&mode=detailed`;

    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Targil-Space-Tracker/1.0 (Mozilla/5.0; Cesium-Globe)',
        Accept: 'application/json',
      },
    });

    if (response.ok) {
      const data = await response.json();
      if (Array.isArray(data?.results) && data.results.length > 0) {
        cachedLaunches = data;
        lastFetchTime = now;
        return res.status(200).json(data);
      }
    }

    // Yedek: Eğer tarih filtreli sorgu boş dönerse standart upcoming endpoint'ini al
    const fallbackUrl =
      'https://ll.thespacedevs.com/2.2.0/launch/upcoming/?limit=30&mode=detailed';
    const fallbackResp = await fetch(fallbackUrl, {
      headers: {
        'User-Agent': 'Targil-Space-Tracker/1.0',
        Accept: 'application/json',
      },
    });

    if (fallbackResp.ok) {
      const fallbackData = await fallbackResp.json();
      cachedLaunches = fallbackData;
      lastFetchTime = now;
      return res.status(200).json(fallbackData);
    }

    // Limit aşıldıysa eski önbelleği dön veya güvenli boş dizi ver
    if (cachedLaunches) return res.status(200).json(cachedLaunches);
    return res.status(200).json({ results: [] });
  } catch (err) {
    if (cachedLaunches) return res.status(200).json(cachedLaunches);
    return res.status(200).json({ results: [], error: err.message });
  }
}