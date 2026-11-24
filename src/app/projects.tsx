// 프로젝트 목록: 바꾸기, 지우기, 새로 요청하기
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { thisDevice } from '../device';
import { Panel, px, PxButton } from '../pixel';
import { setCurrentProject, useCurrentProjectId, useProjects } from '../store';
import { deleteProject } from '../sync';
import type { ProjectSummary } from '../types';

const QUEUE_BLUE = '#6CB6F0';

function statusColor(p: ProjectSummary): string {
  if (p.phase === 'planning' || p.phase === 'running') return px.mint;
  if (p.phase === 'queued') return QUEUE_BLUE;
  if (p.phase === 'awaiting_approval' || p.phase === 'paused') return px.gold;
  return '#8C8FA8';
}

const isActive = (p: ProjectSummary) => p.phase === 'planning' || p.phase === 'running' || p.phase === 'queued';

export default function Projects() {
  const { list, slots } = useProjects();
  const currentId = useCurrentProjectId();
  const insets = useSafeAreaInsets();
  const [mine, setMine] = useState<string>('');
  const [filter, setFilter] = useState<'all' | 'mine'>('all');

  useEffect(() => {
    thisDevice().then((d) => setMine(d.id), () => {});
  }, []);

  const mineCount = list.filter((p) => p.device?.id === mine).length;
  const shown = filter === 'all' ? list : list.filter((p) => p.device?.id === mine);

  const pick = (id: string) => {
    setCurrentProject(id);
    router.back();
  };

  const confirmDelete = (p: ProjectSummary) => {
    if (isActive(p)) {
      Alert.alert('지울 수 없어요', '일하는 중이거나 대기열에 있는 프로젝트는 지울 수 없어요.');
      return;
    }
    Alert.alert('프로젝트 지우기', `"${p.name}"의 대화, 작업, 산출물 파일을 모두 지웁니다. 되돌릴 수 없어요.`, [
      { text: '취소', style: 'cancel' },
      {
        text: '지우기',
        style: 'destructive',
        onPress: () => deleteProject(p.id).catch((e) => Alert.alert('지우지 못했어요', e instanceof Error ? e.message : String(e))),
      },
    ]);
  };

  return (
    <ScrollView style={{ backgroundColor: px.bg }} contentContainerStyle={[styles.container, { paddingBottom: insets.bottom + 24 }]}>
      <Panel>
        <View style={styles.slotHead}>
          <Text style={styles.slotTitle}>일하는 중</Text>
          <Text style={[styles.slotNum, { color: slots.used >= slots.max ? px.coral : px.mint }]}>
            {slots.used}/{slots.max}
          </Text>
        </View>
        <View style={styles.slotBar}>
          {Array.from({ length: slots.max }, (_, i) => (
            <View key={i} style={[styles.slotCell, { backgroundColor: i < slots.used ? px.mint : px.dark }]} />
          ))}
        </View>
        <Text style={styles.slotSub}>
          결재 대기는 자리를 차지하지 않아요{slots.queued ? ` · 대기열 ${slots.queued}개` : ''}
        </Text>
      </Panel>

      <View style={styles.tabs}>
        {(['all', 'mine'] as const).map((f) => (
          <Pressable
            key={f}
            onPress={() => setFilter(f)}
            accessibilityRole="tab"
            accessibilityState={{ selected: filter === f }}
            style={[styles.tab, filter === f && styles.tabOn]}
          >
            <Text style={[styles.tabText, filter === f && styles.tabTextOn]}>
              {f === 'all' ? `전체 ${list.length}` : `이 기기에서 만든 것 ${mineCount}`}
            </Text>
          </Pressable>
        ))}
      </View>

      {!shown.length && <Text style={styles.empty}>{list.length ? '이 기기에서 만든 프로젝트가 없어요.' : '아직 프로젝트가 없어요.'}</Text>}

      {shown.map((p) => {
        const cur = p.id === currentId;
        const color = statusColor(p);
        return (
          <Pressable
            key={p.id}
            onPress={() => pick(p.id)}
            onLongPress={() => confirmDelete(p)}
            accessibilityRole="button"
            accessibilityState={{ selected: cur }}
            accessibilityHint="길게 누르면 지울 수 있어요"
            style={[styles.card, cur && styles.cardOn]}
          >
            <View style={styles.cardHead}>
              <View style={[styles.dot, { backgroundColor: color }]} />
              <Text style={[styles.name, cur && { color: px.dark }]} numberOfLines={1}>
                {p.name}
              </Text>
              {cur && <Text style={styles.badge}>보는 중</Text>}
            </View>
            <Text style={[styles.meta, cur && { color: '#4A4E6A' }]} numberOfLines={1}>
              {p.kind} · {p.device ? (p.device.id === mine ? '이 기기' : p.device.name) : '예전 프로젝트'}
              {p.total > 0 ? ` · ${p.done}/${p.total}` : ''}
            </Text>
            <Text style={[styles.status, { color: cur ? px.dark : color }]} numberOfLines={1}>
              {p.activity}
            </Text>
          </Pressable>
        );
      })}

      <PxButton title="+ 새 프로젝트 요청" onPress={() => router.push('/request')} />
      <Text style={styles.hint}>카드를 누르면 그 프로젝트로 바뀌고, 길게 누르면 지울 수 있어요.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 12, gap: 10 },
  slotHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  slotTitle: { color: px.gold, fontSize: 13, fontWeight: '900' },
  slotNum: { fontSize: 20, fontWeight: '900' },
  slotBar: { flexDirection: 'row', gap: 4, marginTop: 8 },
  slotCell: { flex: 1, height: 12, borderWidth: 2, borderColor: px.ink },
  slotSub: { color: px.sub, fontSize: 11, marginTop: 6 },
  tabs: { flexDirection: 'row', gap: 6 },
  tab: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: px.panel,
    borderWidth: 2,
    borderColor: px.ink,
  },
  tabOn: { backgroundColor: px.cream },
  tabText: { color: px.sub, fontSize: 13, fontWeight: '800' },
  tabTextOn: { color: px.dark },
  empty: { color: px.sub, textAlign: 'center', marginVertical: 24 },
  card: { padding: 12, gap: 4, backgroundColor: px.panel, borderWidth: 2, borderColor: px.ink },
  cardOn: { backgroundColor: px.cream, borderColor: px.gold },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 12, height: 12, borderWidth: 2, borderColor: px.ink },
  name: { flex: 1, color: px.cream, fontSize: 15, fontWeight: '900' },
  badge: { color: px.dark, backgroundColor: px.gold, fontSize: 11, fontWeight: '900', paddingHorizontal: 6, paddingVertical: 2 },
  meta: { color: px.sub, fontSize: 12 },
  status: { fontSize: 12, fontWeight: '800' },
  hint: { color: px.sub, fontSize: 11, textAlign: 'center' },
});
