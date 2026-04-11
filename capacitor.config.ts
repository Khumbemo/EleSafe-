import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hatialert.nagaland',
  appName: 'HatiAlert Nagaland',
  webDir: 'dist',
  plugins: {
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
    Geolocation: {},
    Camera: { resultType: 'uri' },
  }
};

export default config;
