import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image } from 'expo-image';
import { ActivityIndicator, FlatList, ScrollView, StyleSheet, Text, View } from 'react-native';
import { docKind, imageSource, isScreen, pageSource, readText } from '../../deliverables';
import { downloadWithAlert, sharePdfWithAlert, shareWithAlert } from '../../FileCard';
import { roleInfo } from '../../roles';
import { useProject } from '../../store';
import { Deliverable } from '../../types';
import { Button, colors } from '../../ui';

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cell);
      cell = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += c;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim()));
}

function CsvTable({ text }: { text: string }) {
  const rows = parseCsv(text);
  return (
    <ScrollView horizontal>
      <View>
        {rows.map((r, i) => (
          <View key={i} style={[styles.tr, i === 0 && styles.th]}>
            {r.map((c, j) => (
              <Text key={j} style={[styles.td, i === 0 && styles.thText]}>
                {c}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

/** 문서 한 페이지. 작은 이미지를 먼저 보여 주고 큰 이미지로 바꿉니다. */
function DocPage({ d, n, total, ratio0 }: { d: Deliverable; n: number; total: number; ratio0: number }) {
  const [ratio, setRatio] = useState(ratio0);
  return (
    <View style={styles.page}>
      <Image
        source={pageSource(d, n)}
        placeholder={pageSource(d, n, true)}
        placeholderContentFit="contain"
        cachePolicy="disk"
        contentFit="contain"
        transition={120}
        onLoad={(e) => e.source.width && setRatio(e.source.width / e.source.height)}
        style={[styles.pageImage, { aspectRatio: ratio }]}
        accessibilityLabel={`${d.name} ${n}쪽`}
      />
      <Text style={styles.pageNo}>
        {n} / {total}
      </Text>
    </View>
  );
}

/** Word·Excel·PPT: 서버가 만든 PDF 페이지 이미지를 넘겨 봅니다. */
function DocPages({ d }: { d: Deliverable }) {
  const status = d.preview?.status;
  const [source, setSource] = useState<string | null>(null);

  useEffect(() => {
    if (status === 'failed') readText(d).then(setSource, () => setSource(''));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d.id, status]);

  if (status === 'pending') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
        <Text style={[styles.sub, { marginTop: 10 }]}>미리보기를 만드는 중이에요. 보통 몇 초면 끝나요.</Text>
      </View>
    );
  }
  if (status !== 'ready') {
    return (
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Text style={styles.sub}>
          미리보기를 만들지 못했어요{d.preview?.error ? ` (${d.preview.error})` : ''}. 파일은 공유로 다른 앱에서 열 수 있어요. 아래는 원본 내용이에요.
        </Text>
        {source === null ? <ActivityIndicator color={colors.primary} /> : <Text selectable style={styles.content}>{source}</Text>}
      </ScrollView>
    );
  }
  const total = d.preview?.pages ?? 1;
  const ratio0 = docKind(d) === 'docx' ? 210 / 297 : 297 / 210;
  return (
    <FlatList
      data={Array.from({ length: total }, (_, i) => i + 1)}
      keyExtractor={(n) => String(n)}
      renderItem={({ item }) => <DocPage d={d} n={item} total={total} ratio0={ratio0} />}
      contentContainerStyle={{ padding: 12, gap: 12 }}
      initialNumToRender={2}
      windowSize={5}
    />
  );
}

export default function Viewer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const d = useProject().deliverables.find((x) => x.id === id);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [ratio, setRatio] = useState(1);

  useEffect(() => {
    if (!d || d.isBinary) return;
    readText(d)
      .then(setContent)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // 같은 산출물은 내용이 바뀌지 않으므로 id가 바뀔 때만 다시 읽습니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [d?.id]);

  if (!d) {
    return (
      <View style={styles.center}>
        <Text style={styles.sub}>산출물을 찾을 수 없습니다.</Text>
      </View>
    );
  }

  const isCsv = d.name.toLowerCase().endsWith('.csv');
  const kind = docKind(d);
  const screen = isScreen(d);

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: d.name }} />
      <View style={styles.header}>
        <Text style={styles.sub}>
          {roleInfo(d.role).name} · {new Date(d.createdAt).toLocaleString()}
        </Text>
        {screen && <Button title="▶ 화면 실행해 보기" onPress={() => router.push(`/site/${d.id}`)} />}
        <View style={styles.actions}>
          <Button small variant="secondary" title="공유 / 다른 앱으로 열기" onPress={() => shareWithAlert(d)} />
          {kind && d.preview?.status === 'ready' && <Button small variant="secondary" title="PDF로 공유" onPress={() => sharePdfWithAlert(d)} />}
          <Button small title="다운로드" onPress={() => downloadWithAlert(d)} />
        </View>
      </View>
      {kind ? (
        <DocPages d={d} />
      ) : d.isBinary ? (
        <ScrollView contentContainerStyle={{ padding: 12 }}>
          <Image
            source={imageSource(d, 'preview')}
            placeholder={imageSource(d, 'thumb')}
            placeholderContentFit="contain"
            cachePolicy="disk"
            contentFit="contain"
            transition={150}
            onLoad={(e) => e.source.width && setRatio(e.source.width / e.source.height)}
            onError={() => setError('이미지를 불러오지 못했어요. 서버 연결을 확인하세요.')}
            style={[styles.image, { aspectRatio: ratio }]}
            accessibilityLabel={d.name}
          />
          {!!error && <Text style={[styles.sub, { marginTop: 8 }]}>{error}</Text>}
        </ScrollView>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.sub}>{error}</Text>
        </View>
      ) : content === null ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : isCsv ? (
        <ScrollView contentContainerStyle={{ padding: 12 }}>
          <CsvTable text={content} />
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16 }}>
          {screen && d.preview?.status === 'ready' && (
            <Image
              source={imageSource(d, 'preview')}
              placeholder={imageSource(d, 'thumb')}
              cachePolicy="disk"
              contentFit="contain"
              style={styles.shot}
              accessibilityLabel={`${d.name} 화면 캡처`}
            />
          )}
          {screen && <Text style={[styles.sub, { marginBottom: 8 }]}>소스 코드</Text>}
          <Text selectable style={styles.content}>
            {content}
          </Text>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  header: {
    padding: 12,
    gap: 8,
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  actions: { flexDirection: 'row', gap: 8 },
  sub: { color: colors.sub, fontSize: 13 },
  content: { fontSize: 14, color: colors.text, lineHeight: 21, fontFamily: 'monospace' },
  image: { width: '100%', borderRadius: 8, backgroundColor: '#eee' },
  page: { backgroundColor: '#fff', borderRadius: 6, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  pageImage: { width: '100%', backgroundColor: '#fff' },
  pageNo: { textAlign: 'center', fontSize: 11, color: colors.sub, paddingVertical: 4 },
  shot: { width: '60%', aspectRatio: 390 / 844, alignSelf: 'center', marginBottom: 16, borderRadius: 12, backgroundColor: '#eee' },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  th: { backgroundColor: '#EEF2FF' },
  td: { width: 140, padding: 8, fontSize: 12, color: colors.text },
  thText: { fontWeight: '700' },
});
