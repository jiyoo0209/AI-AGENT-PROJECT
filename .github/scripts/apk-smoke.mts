// 서버의 APK 빌더를 예제 Expo 앱으로 실제 빌드해 봅니다. (GitHub Actions에서 실행)
// 1) 일부러 틀린 import로 실패 → 오류 요약 확인  2) 고친 뒤 성공 → APK 확인
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createApkBuilder, errorSummary, BuildError } from '../../server/apk.ts';

const repo = join(import.meta.dirname, '..', '..');
const data = process.env.DATA_DIR || '/tmp/apk-smoke';
const src = join(data, 'src');
mkdirSync(src, { recursive: true });
const write = (name: string, body: string) => writeFileSync(join(src, name), body);

write('package.json', JSON.stringify({ name: 'x', dependencies: { expo: '*', react: '*', 'react-native': '*', '@react-native-async-storage/async-storage': '*', 'expo-status-bar': '*' } }));
write('app.json', JSON.stringify({ expo: { name: 'Room', icon: './icon.png' } }));
write('Home.tsx', `import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

export default function Home(props: { onOpen: () => void }) {
  const [count, setCount] = useState(0);
  useEffect(() => { AsyncStorage.getItem('n').then((v) => setCount(Number(v || 0))); }, []);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <Text style={{ fontSize: 22 }}>회의실 예약 {count}</Text>
      <Pressable onPress={() => { const n = count + 1; setCount(n); AsyncStorage.setItem('n', String(n)); props.onOpen(); }}><Text>예약하기</Text></Pressable>
    </View>
  );
}
`);
const app = (homeImport: string) => `import { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { Text, View } from 'react-native';
import Home from '${homeImport}';

export default function App() {
  const [screen, setScreen] = useState<'home' | 'done'>('home');
  return (
    <View style={{ flex: 1, paddingTop: 48 }}>
      <StatusBar style="dark" />
      {screen === 'home' ? <Home onOpen={() => setScreen('done')} /> : <Text style={{ fontSize: 20, textAlign: 'center' }}>예약 완료</Text>}
    </View>
  );
}
`;
const files = () => ['package.json', 'app.json', 'App.tsx', 'Home.tsx'].map((name) => ({ name, path: join(src, name) }));
const builder = createApkBuilder(data, repo);
console.log('unavailable:', builder.unavailable());

write('App.tsx', app('./Homee'));
try {
  await builder.build({ files: files(), appName: '회의실 예약', packageId: 'com.myoffice.smoke' });
  console.log('UNEXPECTED: broken app built');
  process.exit(1);
} catch (e) {
  console.log('EXPECTED FAILURE:', (e as Error).message);
  console.log('--- summary sent to developer ---\n' + (e instanceof BuildError ? errorSummary(e.log, 3000) : ''));
}

write('App.tsx', app('./Home'));
const r = await builder.build({ files: files(), appName: '회의실 예약', packageId: 'com.myoffice.smoke' });
console.log(`APK OK: ${r.apk} ${statSync(r.apk).size} bytes in ${r.seconds}s`);
