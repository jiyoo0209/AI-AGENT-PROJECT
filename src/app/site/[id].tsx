// 퍼블리셔가 만든 화면을 앱 안에서 실제로 눌러 보는 곳
import { Stack, useLocalSearchParams } from 'expo-router';
import { ComponentType, ReactElement, Ref, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { WebView as RNWebView } from 'react-native-webview';
import { siteUrl } from '../../deliverables';
import { useProject } from '../../store';
import { colors } from '../../ui';

// react-native-webview의 타입 정의가 이 React 버전에서 props를 never로 계산해, 쓰는 props만 직접 적습니다.
interface WebViewHandle {
  reload(): void;
}
interface WebViewLiteProps {
  ref?: Ref<WebViewHandle>;
  source: { uri: string };
  style?: object;
  domStorageEnabled?: boolean;
  javaScriptEnabled?: boolean;
  setSupportMultipleWindows?: boolean;
  startInLoadingState?: boolean;
  renderLoading?: () => ReactElement;
  onNavigationStateChange?: (nav: { title?: string; url: string }) => void;
  onError?: (e: { nativeEvent: { description: string } }) => void;
}
const WebView = RNWebView as unknown as ComponentType<WebViewLiteProps>;

export default function SiteRunner() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const d = useProject().deliverables.find((x) => x.id === id);
  const web = useRef<WebViewHandle>(null);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const url = d ? siteUrl(d) : null;

  if (!d || !url) {
    return (
      <View style={styles.center}>
        <Text style={styles.sub}>{d ? '서버에 연결되면 화면을 열 수 있어요.' : '화면을 찾을 수 없습니다.'}</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: '#fff' }}>
      <Stack.Screen
        options={{
          title: title || d.name,
          headerRight: () => (
            <Pressable
              onPress={() => {
                setError('');
                web.current?.reload();
              }}
              accessibilityRole="button"
              accessibilityLabel="새로고침"
              hitSlop={10}
            >
              <Text style={styles.reload}>새로고침</Text>
            </Pressable>
          ),
        }}
      />
      {error ? (
        <View style={styles.center}>
          <Text style={styles.sub}>{error}</Text>
        </View>
      ) : (
        <WebView
          ref={web}
          source={{ uri: url }}
          style={{ flex: 1 }}
          domStorageEnabled
          javaScriptEnabled
          setSupportMultipleWindows={false}
          startInLoadingState
          renderLoading={() => (
            <View style={StyleSheet.absoluteFill}>
              <View style={styles.center}>
                <ActivityIndicator color={colors.primary} />
              </View>
            </View>
          )}
          onNavigationStateChange={(nav) => setTitle(nav.title && !nav.title.startsWith('http') ? nav.title : '')}
          onError={(e) => setError(`화면을 열지 못했어요. 서버 연결을 확인하세요.\n(${e.nativeEvent.description})`)}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  sub: { color: colors.sub, fontSize: 13, textAlign: 'center', lineHeight: 20 },
  reload: { color: colors.primary, fontWeight: '700', fontSize: 14 },
});
