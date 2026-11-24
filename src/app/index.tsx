import AsyncStorage from '@react-native-async-storage/async-storage';
import { router, Stack } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { replan, runTasks } from '../engine';
import { refreshLimits } from '../llm';
import { AgentState, OfficeMap } from '../OfficeMap';
import { EnergyBar, Panel, px, PxButton } from '../pixel';
import { ROLES, roleInfo } from '../roles';
import { useSettings } from '../settings';
import { useBusy, useCurrentProjectId, useProject, useProjects } from '../store';
import { useSyncStatus } from '../sync';
import { Project, RoleId, Task } from '../types';
import { energyColor, remainingPct, resetText, tightestWindow, useUsage } from '../usage';

const NAMES = Object.fromEntries(ROLES.map((r) => [r.id, r.name])) as Record<RoleId, string>;

function short(text: string, n = 16): string {
  return text.length > n ? text.slice(0, n) + '…' : text;
}

/** 프로젝트 상태로 팀원마다 지금 할 일(자리에서 일하기 · 대표실에서 결재 대기 · 쉬기)을 정합니다. */
function agentStates(project: Project, busy: Partial<Record<RoleId, boolean>>): Record<RoleId, AgentState> {
  const out = {} as Record<RoleId, AgentState>;
  const running = project.tasks.find((t) => t.status === 'running');
  const failed = project.tasks.find((t) => t.status === 'failed');
  let lastDone: Task | undefined;
  for (const t of project.tasks) {
    if (t.status === 'done') lastDone = t;
    if (t.status === 'pending') break;
  }
  for (const r of ROLES) {
    const id = r.id;
    if (busy[id]) {
      let text = '답변 작성 중…';
      if (running?.role === id) text = short(running.title) + ' 중…';
      else if (id === 'pm' && project.phase === 'planning') text = '작업 계획 세우는 중…';
      out[id] = { mode: 'work', text };
    } else if (id === 'pm' && project.phase === 'awaiting_approval') {
      out[id] = { mode: 'wait', text: `계획 결재 대기 (작업 ${project.tasks.filter((t) => t.status === 'pending').length}개)` };
    } else if (project.phase === 'paused' && failed?.role === id) {
      out[id] = { mode: 'wait', text: '문제가 생겼어요' };
    } else if (project.phase === 'paused' && !failed && lastDone?.role === id) {
      out[id] = { mode: 'wait', text: `결재 대기 · ${short(lastDone.title, 12)}` };
    } else if (project.phase === 'done' && id === 'pm') {
      out[id] = { mode: 'idle', text: '프로젝트 완료!' };
    } else {
      out[id] = { mode: 'idle' };
    }
  }
  return out;
}

function EnergyChip(props: { name: string; provider: 'claude' | 'openai' }) {
  const usage = useUsage();
  const limits = usage.limits[props.provider];
  const pct = remainingPct(limits);
  const tight = tightestWindow(limits);
  const color = energyColor(pct);
  return (
    <Pressable onPress={() => router.push('/energy')} style={{ flex: 1 }} accessibilityRole="button">
      <Panel style={{ flex: 1 }}>
        <View style={styles.chipHead}>
          <Text style={styles.chipName}>{props.name} 에너지</Text>
          <Text style={[styles.chipPct, { color }]}>{pct === undefined ? '—' : `${pct}%`}</Text>
        </View>
        <EnergyBar pct={pct} color={color} />
        <Text style={styles.chipSub} numberOfLines={1}>
          {tight ? `${tight.label} 한도 · ${resetText(tight.resetsAt) || '여유'}` : '아직 확인 전'}
        </Text>
      </Panel>
    </Pressable>
  );
}

const ENERGY_OPEN_KEY = 'home.energyOpen';

/** 에너지 칸: 화살표로 접고 펼칩니다. 접으면 한 줄 요약만 보여요. */
function EnergySection() {
  const usage = useUsage();
  const [open, setOpen] = useState(true);
  useEffect(() => {
    AsyncStorage.getItem(ENERGY_OPEN_KEY).then((v) => v === '0' && setOpen(false), () => {});
  }, []);
  const toggle = () => {
    const next = !open;
    setOpen(next);
    AsyncStorage.setItem(ENERGY_OPEN_KEY, next ? '1' : '0').catch(() => {});
  };
  const pctOf = (p: 'claude' | 'openai') => {
    const pct = remainingPct(usage.limits[p]);
    return { pct, color: energyColor(pct) };
  };
  const c = pctOf('claude');
  const o = pctOf('openai');
  return (
    <View style={{ marginTop: 10, gap: 8 }}>
      <Pressable
        onPress={toggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={open ? 'AI 에너지 접기' : 'AI 에너지 펼치기'}
        style={styles.energyToggle}
      >
        <Text style={styles.energyTitle}>AI 에너지</Text>
        {!open && (
          <Text style={styles.energyShort} numberOfLines={1}>
            Claude <Text style={{ color: c.color }}>{c.pct === undefined ? '—' : `${c.pct}%`}</Text>
            {'  ·  '}ChatGPT <Text style={{ color: o.color }}>{o.pct === undefined ? '—' : `${o.pct}%`}</Text>
          </Text>
        )}
        <Text style={styles.energyArrow}>{open ? '▲' : '▼'}</Text>
      </Pressable>
      {open && (
        <View style={styles.chips}>
          <EnergyChip name="Claude" provider="claude" />
          <EnergyChip name="ChatGPT" provider="openai" />
        </View>
      )}
    </View>
  );
}

export default function Home() {
  const project = useProject();
  const projects = useProjects();
  const currentId = useCurrentProjectId();
  const current = projects.list.find((p) => p.id === currentId);
  const settings = useSettings();
  const busy = useBusy();
  const sync = useSyncStatus();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const scrollRef = useRef<ScrollViewInstance>(null);
  const [panelY, setPanelY] = useState(0);

  useEffect(() => {
    refreshLimits(settings).catch(() => {});
  }, [settings]);

  const needsServer = !settings.serverUrl || !settings.serverToken;
  const pending = project.tasks.filter((t) => t.status === 'pending');
  const done = project.tasks.filter((t) => t.status === 'done').length;
  const failed = project.tasks.find((t) => t.status === 'failed');
  const running = project.tasks.find((t) => t.status === 'running');
  let lastDone: Task | undefined;
  for (const t of project.tasks) {
    if (t.status === 'done') lastDone = t;
    if (t.status === 'pending') break;
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView
        ref={scrollRef}
        style={{ backgroundColor: px.bg }}
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.pad}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>나만의사무실</Text>
            <Pressable
              onPress={() => router.push('/settings')}
              accessibilityRole="button"
              accessibilityLabel="설정"
              style={styles.iconBtn}
            >
              <Text style={styles.iconText}>설정</Text>
            </Pressable>
          </View>

          {!sync.connected && (
            <Pressable onPress={() => router.push('/settings')} accessibilityRole="button" style={styles.offline}>
              <Text style={styles.offlineText} numberOfLines={2}>
                서버 연결 안 됨 · {sync.error ?? '연결하는 중…'}
              </Text>
            </Pressable>
          )}

          <EnergySection />

          <View style={styles.projectRow}>
            <Pressable
              onPress={() => router.push('/projects')}
              accessibilityRole="button"
              accessibilityLabel="프로젝트 바꾸기"
              style={styles.switcher}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.projectText} numberOfLines={1}>
                  {current ? `${current.kind} · ${current.name}` : projects.list.length ? '프로젝트를 고르세요' : '새 프로젝트를 기다리는 중'}
                </Text>
                {!!current && (
                  <Text style={styles.projectSub} numberOfLines={1}>
                    {current.activity}
                  </Text>
                )}
              </View>
              {project.tasks.length > 0 && (
                <Text style={styles.progress}>
                  {done}/{project.tasks.length}
                </Text>
              )}
              <Text style={styles.energyArrow}>▼</Text>
            </Pressable>
            <Pressable onPress={() => router.push('/projects')} accessibilityRole="button" style={styles.slotBox}>
              <Text style={styles.slotLabel}>일하는 중</Text>
              <Text style={[styles.slotNum, { color: projects.slots.used >= projects.slots.max ? px.coral : px.mint }]}>
                {projects.slots.used}/{projects.slots.max}
              </Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.mapFrame}>
          <OfficeMap
            width={width}
            agents={agentStates(project, busy)}
            names={NAMES}
            onPressAgent={(r) => router.push(`/room/${r}`)}
            onPressCeo={() => scrollRef.current?.scrollTo({ y: Math.max(0, panelY - 40), animated: true })}
          />
        </View>

        <View style={[styles.pad, { gap: 10, marginTop: 10 }]} onLayout={(e) => setPanelY(e.nativeEvent.layout.y)}>
          {needsServer && (
            <Pressable onPress={() => router.push('/settings')}>
              <Panel accent>
                <Text style={styles.warn}>설정에서 맥미니 서버 주소와 토큰을 입력해야 팀원들이 일할 수 있어요. 눌러서 이동</Text>
              </Panel>
            </Pressable>
          )}

          {project.phase === 'idle' && !project.request && (
            <Panel accent>
              <Text style={styles.boxTitle}>▶ PM에게 지시하기</Text>
              <Text style={styles.boxText}>요청서를 단계별로 채우면 PM이 작업 계획을 세워 대표실로 결재를 올려요.</Text>
              <PxButton title="새 프로젝트 요청하기" onPress={() => router.push('/request')} disabled={needsServer} />
            </Panel>
          )}

          {project.phase === 'queued' && (
            <Panel accent>
              <Text style={styles.boxTitle}>대기열 {current?.queuePos ? `${current.queuePos}번째` : ''}</Text>
              <Text style={styles.boxText}>
                다른 프로젝트 {projects.slots.max}개가 일하는 중이에요. 하나가 끝나거나 결재를 기다리면 자리가 나서 바로 시작해요.
              </Text>
            </Panel>
          )}

          {project.phase === 'planning' && (
            <Panel accent>
              <View style={styles.rowGap}>
                <ActivityIndicator color={px.gold} />
                <Text style={styles.boxText}>PM이 작업 계획을 세우고 있어요…</Text>
              </View>
            </Panel>
          )}

          {project.phase === 'awaiting_approval' && (
            <Panel accent>
              <Text style={styles.boxTitle}>대표실 결재 · PM의 작업 계획</Text>
              {!!project.planSummary && <Text style={styles.boxText}>{project.planSummary}</Text>}
              {pending.map((t, i) => (
                <Pressable key={t.id} onPress={() => router.push(`/room/${t.role}`)} style={styles.taskRow}>
                  <Text style={styles.taskNo}>{i + 1}</Text>
                  <Text style={[styles.taskRole, { color: roleInfo(t.role).color }]}>{roleInfo(t.role).name}</Text>
                  <Text style={styles.taskTitle} numberOfLines={2}>
                    {t.title}
                  </Text>
                </Pressable>
              ))}
              <View style={styles.actions}>
                <PxButton title="다시 계획" variant="dark" onPress={replan} />
                <PxButton title={`승인하고 시작 (${pending.length}개)`} onPress={runTasks} style={{ flex: 1 }} />
              </View>
            </Panel>
          )}

          {project.phase === 'running' && (
            <Panel accent>
              <View style={styles.rowGap}>
                <ActivityIndicator color={px.mint} />
                <Text style={styles.boxText}>
                  {running ? `${roleInfo(running.role).name}: ${running.title}` : '작업 진행 중…'}
                </Text>
              </View>
            </Panel>
          )}

          {project.phase === 'paused' && (
            <Panel accent>
              {failed ? (
                <>
                  <Text style={styles.boxTitle}>대표실 보고 · 작업이 멈췄어요</Text>
                  <Text style={styles.boxText}>
                    {roleInfo(failed.role).name}: {failed.title}
                  </Text>
                  {!!failed.error && (
                    <Text style={styles.error} numberOfLines={3}>
                      {failed.error}
                    </Text>
                  )}
                  <View style={styles.actions}>
                    <PxButton title="다시 계획" variant="dark" onPress={replan} />
                    <PxButton title="다시 시도" onPress={runTasks} style={{ flex: 1 }} />
                  </View>
                </>
              ) : (
                <>
                  <Text style={styles.boxTitle}>대표실 결재 · {lastDone ? roleInfo(lastDone.role).name : '팀원'}</Text>
                  <Text style={styles.boxText}>
                    {lastDone ? `"${lastDone.title}" 완료했어요. 확인하고 다음 작업을 승인해 주세요.` : '다음 작업 승인을 기다려요.'}
                  </Text>
                  <View style={styles.actions}>
                    {lastDone && (
                      <PxButton title="결과 보기" variant="dark" onPress={() => router.push(`/room/${lastDone.role}`)} />
                    )}
                    <PxButton title={`승인 (${pending.length}개 남음)`} onPress={runTasks} style={{ flex: 1 }} />
                  </View>
                </>
              )}
            </Panel>
          )}

          {project.phase === 'done' && (
            <Panel accent>
              <Text style={styles.boxTitle}>프로젝트 완료</Text>
              <Text style={styles.boxText}>PM의 완료 보고는 PM 채팅방에서 볼 수 있어요.</Text>
              <View style={styles.actions}>
                <PxButton title="PM에게 추가 요청" variant="dark" onPress={() => router.push('/room/pm')} style={{ flex: 1 }} />
              </View>
            </Panel>
          )}

          {project.phase === 'idle' && !!project.request && (
            <Panel accent>
              <Text style={styles.boxText}>PM이 계획을 만들지 못했어요. PM 채팅방에서 다시 요청해 보세요.</Text>
              <View style={styles.actions}>
                <PxButton title="PM 채팅방" variant="dark" onPress={() => router.push('/room/pm')} style={{ flex: 1 }} />
              </View>
            </Panel>
          )}

          <Text style={styles.section}>팀원 채팅방</Text>
          <View style={styles.roomGrid}>
            {ROLES.map((r) => (
              <Pressable key={r.id} onPress={() => router.push(`/room/${r.id}`)} style={styles.roomChip}>
                <View style={[styles.roomDot, { backgroundColor: r.color }]} />
                <Text style={styles.roomName}>{r.name}</Text>
                {busy[r.id] && <ActivityIndicator size="small" color={px.mint} />}
              </Pressable>
            ))}
          </View>

          <View style={styles.nav}>
            <PxButton title={`산출물 ${project.deliverables.length}`} variant="dark" onPress={() => router.push('/files')} style={{ flex: 1 }} />
            <PxButton title="에너지" variant="dark" onPress={() => router.push('/energy')} style={{ flex: 1 }} />
            <PxButton title="새 프로젝트" variant="dark" onPress={() => router.push('/request')} style={{ flex: 1 }} disabled={needsServer} />
          </View>
        </View>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  pad: { paddingHorizontal: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: px.cream, fontSize: 21, fontWeight: '900' },
  offline: { marginTop: 8, padding: 8, backgroundColor: px.dark, borderWidth: 2, borderColor: px.coral },
  offlineText: { color: px.coral, fontSize: 12, fontWeight: '700' },
  iconBtn: {
    minWidth: 52,
    height: 40,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: px.panel,
    borderWidth: 2,
    borderColor: px.ink,
  },
  iconText: { color: px.cream, fontWeight: '800', fontSize: 13 },
  chips: { flexDirection: 'row', gap: 8 },
  energyToggle: {
    minHeight: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 10,
    backgroundColor: px.panel,
    borderWidth: 2,
    borderColor: px.ink,
  },
  energyTitle: { color: px.gold, fontSize: 12, fontWeight: '800' },
  energyShort: { flex: 1, color: px.cream, fontSize: 12, fontWeight: '700' },
  energyArrow: { marginLeft: 'auto', color: px.gold, fontSize: 12, fontWeight: '900' },
  chipHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 },
  chipName: { color: px.cream, fontSize: 12, fontWeight: '800' },
  chipPct: { fontSize: 18, fontWeight: '900' },
  chipSub: { color: px.sub, fontSize: 11, marginTop: 5 },
  projectRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginVertical: 10 },
  switcher: {
    flex: 1,
    minHeight: 48,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: px.panel,
    borderWidth: 2,
    borderColor: px.gold,
  },
  projectText: { color: px.cream, fontSize: 13, fontWeight: '800' },
  projectSub: { color: px.sub, fontSize: 11, marginTop: 2 },
  slotBox: {
    width: 64,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: px.dark,
    borderWidth: 2,
    borderColor: px.ink,
  },
  slotLabel: { color: px.sub, fontSize: 10, fontWeight: '700' },
  slotNum: { fontSize: 16, fontWeight: '900' },
  progress: { color: px.gold, fontSize: 13, fontWeight: '900' },
  mapFrame: { borderTopWidth: 3, borderBottomWidth: 3, borderColor: px.ink },
  warn: { color: px.gold, fontSize: 13, fontWeight: '700', lineHeight: 19 },
  boxTitle: { color: px.gold, fontSize: 13, fontWeight: '900', marginBottom: 6 },
  boxText: { color: px.cream, fontSize: 13, lineHeight: 19, flexShrink: 1 },
  error: { color: px.coral, fontSize: 12, marginTop: 6 },
  rowGap: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  input: {
    minHeight: 80,
    backgroundColor: px.bg,
    borderWidth: 2,
    borderColor: px.line,
    color: px.cream,
    padding: 10,
    fontSize: 14,
    marginBottom: 8,
  },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: px.line,
  },
  taskNo: { color: px.sub, width: 16, fontWeight: '800', textAlign: 'center' },
  taskRole: { fontSize: 12, fontWeight: '900', width: 52 },
  taskTitle: { color: px.cream, fontSize: 13, flex: 1 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 10 },
  section: { color: px.gold, fontSize: 12, fontWeight: '900', marginTop: 4 },
  roomGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  roomChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 40,
    paddingHorizontal: 10,
    backgroundColor: px.panel,
    borderWidth: 2,
    borderColor: px.ink,
  },
  roomDot: { width: 8, height: 8 },
  roomName: { color: px.cream, fontSize: 13, fontWeight: '700' },
  nav: { flexDirection: 'row', gap: 6, marginTop: 4 },
});
