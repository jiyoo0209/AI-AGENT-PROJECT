import { Image } from 'expo-image';
import { router } from 'expo-router';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { downloadDeliverable, hasThumb, imageSource, isScreen, shareDeliverable, sharePdf } from './deliverables';
import { roleInfo } from './roles';
import { Deliverable } from './types';
import { Button, colors } from './ui';

export async function shareWithAlert(d: Deliverable) {
  try {
    await shareDeliverable(d);
  } catch (e) {
    Alert.alert('공유 실패', e instanceof Error ? e.message : String(e));
  }
}

export async function sharePdfWithAlert(d: Deliverable) {
  try {
    await sharePdf(d);
  } catch (e) {
    Alert.alert('PDF 공유 실패', e instanceof Error ? e.message : String(e));
  }
}

export async function downloadWithAlert(d: Deliverable) {
  try {
    const name = await downloadDeliverable(d);
    Alert.alert('저장 완료', `${name} 파일을 저장했습니다.`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/cancel/i.test(msg)) return;
    Alert.alert('저장 실패', msg);
  }
}

export function FileCard({ d, showRole }: { d: Deliverable; showRole?: boolean }) {
  const ext = d.name.split('.').pop()?.toUpperCase() ?? 'FILE';
  return (
    <View style={styles.card}>
      <Pressable style={styles.info} onPress={() => router.push(`/viewer/${d.id}`)}>
        {hasThumb(d) ? (
          <Image source={imageSource(d, 'thumb')} cachePolicy="disk" contentFit="cover" contentPosition="top" style={styles.ext} />
        ) : (
          <View style={styles.ext}>
            <Text style={styles.extText}>{ext.slice(0, 4)}</Text>
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={styles.name} numberOfLines={1}>
            {d.name}
          </Text>
          <Text style={styles.meta}>
            {showRole ? `${roleInfo(d.role).name} · ` : ''}
            {new Date(d.createdAt).toLocaleString()}
          </Text>
        </View>
      </Pressable>
      <View style={styles.actions}>
        {isScreen(d) && <Button small title="▶ 실행" onPress={() => router.push(`/site/${d.id}`)} />}
        <Button small variant="secondary" title="보기" onPress={() => router.push(`/viewer/${d.id}`)} />
        <Button small variant="secondary" title="공유" onPress={() => shareWithAlert(d)} />
        <Button small title="다운로드" onPress={() => downloadWithAlert(d)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 10,
    marginTop: 8,
    gap: 8,
  },
  info: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  ext: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: colors.primary + '1A',
    alignItems: 'center',
    justifyContent: 'center',
  },
  extText: { color: colors.primary, fontWeight: '700', fontSize: 11 },
  name: { fontSize: 14, fontWeight: '600', color: colors.text },
  meta: { fontSize: 12, color: colors.sub, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 6, justifyContent: 'flex-end' },
});
