import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import { createBrowserViteConfig } from '../../build/vite.js';
import { localProviderPlugins } from '../providers/local.js';
import { apiNotFoundPlugin } from './api-not-found.js';

const root = fileURLToPath(new URL('../../', import.meta.url));

/** Load this checkout's configuration and attach its local provider middleware. */
export default defineConfig(({ mode }) => {
  const loaded = loadEnv(mode, root, '');
  for (const [key, value] of Object.entries(loaded)) {
    if (process.env[key] === undefined) process.env[key] = value;
  }

  const baseConfig = createBrowserViteConfig({
    plugins: [...localProviderPlugins(), apiNotFoundPlugin()],
    googleApiKey: process.env.GOOGLE_MAPS_API_KEY,
    cesiumToken: process.env.CESIUM_ION_TOKEN,
    host: process.env.HOST,
    port: process.env.PORT,
  });

  const nationalMapProxyRules = {
    '/ibb-ortofoto': {
      target: 'https://cbssrcache.ibb.gov.tr',
      changeOrigin: true,
      secure: false,
      followRedirects: true,
      rewrite: (path) => path.replace(/^\/ibb-ortofoto/, ''),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://harita.istanbul/',
        'Origin': 'https://harita.istanbul',
      },
    },
    '/hgm-servis': {
      target: 'https://atlas.harita.gov.tr',
      changeOrigin: true,
      secure: false,
      followRedirects: true,
      rewrite: (path) => path.replace(/^\/hgm-servis/, '/webservis'),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://atlas.harita.gov.tr/',
        'Origin': 'https://atlas.harita.gov.tr',
      },
    },
    '/kandilli-api': {
      target: 'https://api.orhanaydogdu.com.tr',
      changeOrigin: true,
      secure: false,
      rewrite: (path) => path.replace(/^\/kandilli-api/, ''),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
    },
    '/mta-wms': {
      target: 'https://mtayenicbs-geoserver.mta.gov.tr',
      changeOrigin: true,
      secure: false,
      followRedirects: true,
      rewrite: (path) => path.replace(/^\/mta-wms/, '/geoserver/gwc/service/wms'),
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Referer': 'https://yerbilimleri.mta.gov.tr/',
      },
    },
  };

  return {
    ...baseConfig,
    server: {
      ...(baseConfig.server || {}),
      proxy: {
        ...((baseConfig.server && baseConfig.server.proxy) || {}),
        ...nationalMapProxyRules,
      },
    },
    preview: {
      ...(baseConfig.preview || {}),
      proxy: {
        ...((baseConfig.preview && baseConfig.preview.proxy) || {}),
        ...nationalMapProxyRules,
      },
    },
  };
});