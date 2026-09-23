export default async function handler(req, res) {
  try {
    // Doğru ADSB (tar1090) formatı: /v2/point/Enlem/Boylam/Yarıçap(Deniz Mili)
    // Türkiye'nin merkezi (39.0, 35.0) alınarak 300 deniz mili (~550 km) yarıçapındaki uçuşlar taranır.
    const targetUrl = 'https://api.adsb.lol/v2/point/39.0/35.0/300';

    const upstream = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Targil-GodsEyeView/1.0',
      },
    });

    // Eğer adsb.lol 400 vb. bir hata döndürürse, hatanın ne olduğunu ekrana (konsola) bas!
    if (!upstream.ok) {
      const errorText = await upstream.text();
      return res.status(upstream.status).json({ 
        error: `ADSB Sağlayıcı Hatası (${upstream.status})`, 
        details: errorText,
        attemptedUrl: targetUrl 
      });
    }

    const data = await upstream.json();
    
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=5, s-maxage=5'); // 5 saniyede bir yenilensin
    
    return res.status(200).json(data);
  } catch (err) {
    return res.status(500).json({ error: 'Vercel Proxy Hatası: ' + err.message });
  }
}