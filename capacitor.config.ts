import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.qingjian.chat',
  appName: '青笺',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    backgroundColor: '#F7F8FC',
  },
  plugins: {
    // 让 matrix-js-sdk 的 fetch 在 Android 上改走原生网络层，避免 WebView
    // 以 https://localhost 为 Origin 时被 Homeserver 的 CORS 策略拦截。
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
