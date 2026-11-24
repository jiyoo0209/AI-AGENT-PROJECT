import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { loadSettings } from '../settings';
import { loadProject } from '../store';
import { setupNotifications } from '../notify';
import { startSync } from '../sync';
import { loadUsage } from '../usage';
import { px } from '../pixel';
import { colors } from '../ui';

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Promise.all([loadSettings(), loadProject(), loadUsage()]).finally(() => {
      setReady(true);
      startSync();
      setupNotifications();
    });
  }, []);

  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: px.bg },
          headerTintColor: px.cream,
          headerTitleStyle: { fontWeight: '800' },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: '나만의사무실', headerShown: false }} />
        <Stack.Screen name="settings" options={{ title: '설정' }} />
        <Stack.Screen name="energy" options={{ title: 'AI 에너지', contentStyle: { backgroundColor: px.bg } }} />
        <Stack.Screen name="files" options={{ title: '전체 산출물' }} />
        <Stack.Screen name="room/[role]" options={{ title: '채팅방' }} />
        <Stack.Screen name="viewer/[id]" options={{ title: '산출물 보기' }} />
        <Stack.Screen name="site/[id]" options={{ title: '화면 실행' }} />
        <Stack.Screen name="request" options={{ title: '새 프로젝트 요청', contentStyle: { backgroundColor: px.bg } }} />
      </Stack>
    </SafeAreaProvider>
  );
}
