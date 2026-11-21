import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { loadSettings } from '../settings';
import { loadProject } from '../store';
import { loadUsage } from '../usage';
import { colors } from '../ui';

export default function RootLayout() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    Promise.all([loadSettings(), loadProject(), loadUsage()]).finally(() => setReady(true));
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
      <StatusBar style="dark" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.card },
          headerTitleStyle: { fontWeight: '700' },
          contentStyle: { backgroundColor: colors.bg },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'AI 프로젝트매니저' }} />
        <Stack.Screen name="settings" options={{ title: '설정' }} />
        <Stack.Screen name="files" options={{ title: '전체 산출물' }} />
        <Stack.Screen name="room/[role]" options={{ title: '채팅방' }} />
        <Stack.Screen name="viewer/[id]" options={{ title: '산출물 보기' }} />
      </Stack>
    </SafeAreaProvider>
  );
}
