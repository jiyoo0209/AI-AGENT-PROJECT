import { File } from 'expo-file-system';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { readText } from '../../deliverables';
import { downloadWithAlert, shareWithAlert } from '../../FileCard';
import { roleInfo } from '../../roles';
import { useProject } from '../../store';
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

export default function Viewer() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const d = useProject().deliverables.find((x) => x.id === id);
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!d || d.isBinary) return;
    readText(d)
      .then(setContent)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [d]);

  if (!d) {
    return (
      <View style={styles.center}>
        <Text style={styles.sub}>산출물을 찾을 수 없습니다.</Text>
      </View>
    );
  }

  const exists = new File(d.uri).exists;
  const isCsv = d.name.toLowerCase().endsWith('.csv');

  return (
    <View style={{ flex: 1 }}>
      <Stack.Screen options={{ title: d.name }} />
      <View style={styles.header}>
        <Text style={styles.sub}>
          {roleInfo(d.role).name} · {new Date(d.createdAt).toLocaleString()}
        </Text>
        <View style={styles.actions}>
          <Button small variant="secondary" title="공유 / 다른 앱으로 열기" onPress={() => shareWithAlert(d)} />
          <Button small title="다운로드" onPress={() => downloadWithAlert(d)} />
        </View>
      </View>
      {!exists ? (
        <View style={styles.center}>
          <Text style={styles.sub}>파일이 기기에서 삭제되었습니다.</Text>
        </View>
      ) : d.isBinary ? (
        <ScrollView contentContainerStyle={{ padding: 12 }}>
          <Image source={{ uri: d.uri }} style={styles.image} resizeMode="contain" />
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
  image: { width: '100%', aspectRatio: 2 / 3, borderRadius: 8, backgroundColor: '#eee' },
  tr: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.border },
  th: { backgroundColor: '#EEF2FF' },
  td: { width: 140, padding: 8, fontSize: 12, color: colors.text },
  thText: { fontWeight: '700' },
});
