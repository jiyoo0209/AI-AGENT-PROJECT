// app.json에 더해, Firebase 설정 파일(google-services.json)이 있을 때만 푸시 알림을 켭니다.
const { existsSync } = require('fs');

module.exports = ({ config }) => ({
  ...config,
  android: {
    ...config.android,
    ...(existsSync('./google-services.json') ? { googleServicesFile: './google-services.json' } : {}),
  },
});
