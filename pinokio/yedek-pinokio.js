module.exports = {
  version: '3.6',
  title: "TARGIL Türkiye",
  description: 'Açık Kaynaklı Coğrafi Veri ve Gözlem Platformu (İBB, HGM ve Canlı Uçuşlar Entegreli)',
  menu: async (kernel, info) => {
    const installed = await kernel.exists(__dirname, '.installed');
    const installing = info.running('install.js');
    const starting = info.running('start.js');
    const updating = info.running('update.js');
    const resetting = info.running('reset.js');

    if (installing || updating || resetting) {
      const href = installing ? 'install.js' : updating ? 'update.js' : 'reset.js';
      const text = installing ? 'Kuruluyor...' : updating ? 'Güncelleniyor...' : 'Sıfırlanıyor...';
      return [{ default: true, icon: 'fa-solid fa-terminal', text, href }];
    }

    if (!installed) {
      return [{ default: true, icon: 'fa-solid fa-download', text: 'Kur (Install)', href: 'install.js' }];
    }

    if (starting) {
      const local = info.local('start.js');
      if (local?.url) {
        return [
          { default: true, icon: 'fa-solid fa-earth-americas', text: 'TARGIL Türkiye\'yi Aç', href: local.url },
          { icon: 'fa-solid fa-terminal', text: 'Sunucu', href: 'start.js' },
        ];
      }
      return [{ default: true, icon: 'fa-solid fa-terminal', text: 'Başlatılıyor...', href: 'start.js' }];
    }

    return [
      { default: true, icon: 'fa-solid fa-power-off', text: 'Başlat', href: 'start.js' },
      { icon: 'fa-solid fa-arrows-rotate', text: 'Güncelle', href: 'update.js' },
      { icon: 'fa-solid fa-broom', text: 'Kurulumu Onar', href: 'reset.js' },
    ];
  },
};