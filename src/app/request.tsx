// 새 프로젝트 요청 (5단계): 종류 → 내용 → 산출물·일정 → 기술 스펙(선택) → 확인
import { router, Stack } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Pressable,
  ScrollView,
  type ScrollViewInstance,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  briefToRequest,
  DUE_OPTIONS,
  effectiveFrontend,
  emptyBrief,
  EXPO,
  KINDS,
  outputsFor,
  PRESET,
  ProjectBrief,
  TECH_LABELS,
  TECH_OPTIONS,
  wantsApk,
} from '../brief';
import { startProjectWithBrief } from '../engine';
import { useKeyboardShown } from '../keyboard';
import { px, PxButton } from '../pixel';
import { PxSelect } from '../PxSelect';
import { useProjects } from '../store';

const TITLES = ['결과물 종류', '무엇을 만들까요', '산출물과 일정', '기술 스펙 (선택)', '확인하고 보내기'];
const STEPS = TITLES.length;

export default function RequestScreen() {
  const [step, setStep] = useState(1);
  const { list, slots } = useProjects();
  const busyList = list.filter((p) => p.phase === 'planning' || p.phase === 'running');
  const [b, setB] = useState<ProjectBrief>(emptyBrief);
  const [sending, setSending] = useState(false);
  const insets = useSafeAreaInsets();
  const headerHeight = useHeaderHeight();
  const scrollRef = useRef<ScrollViewInstance>(null);
  const keyboard = useKeyboardShown();

  const set = (patch: Partial<ProjectBrief>) => setB((x) => ({ ...x, ...patch }));
  const setTech = (k: keyof ProjectBrief['tech'], v: string) => setB((x) => ({ ...x, tech: { ...x.tech, [k]: v } }));
  const go = (n: number) => {
    setStep(n);
    scrollRef.current?.scrollTo({ y: 0, animated: false });
  };

  const missingGoal = step === 2 && !b.goal.trim();
  const noOutputs = step === 3 && b.outputs.length === 0;
  const outs = outputsFor(b.kind);
  const pickedOuts = outs.filter((o) => b.outputs.includes(o.id));
  const taskGuess = Math.max(2, Math.ceil(b.outputs.length * 0.9));

  const submit = async () => {
    setSending(true);
    const ok = await startProjectWithBrief(briefToRequest(b), b);
    setSending(false);
    if (ok) router.back();
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: px.bg }} behavior="padding" keyboardVerticalOffset={headerHeight}>
      <Stack.Screen options={{ title: '새 프로젝트 요청' }} />
      <View style={styles.top}>
        <Text style={styles.stepNo}>
          STEP {step} / {STEPS}
        </Text>
        <Text style={styles.stepTitle}>{TITLES[step - 1]}</Text>
        <View
          style={styles.cells}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 1, max: STEPS, now: step }}
        >
          {TITLES.map((_, i) => (
            <View
              key={i}
              style={[styles.cell, { backgroundColor: i + 1 < step ? px.mint : i + 1 === step ? px.gold : px.line }]}
            />
          ))}
        </View>
      </View>

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1 }}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        {step === 1 && (
          <View style={{ gap: 10 }} accessibilityRole="radiogroup">
            <Text style={styles.hint}>고른 종류에 맞춰 PM이 필요한 팀원과 산출물을 정해요.</Text>
            {KINDS.map((k) => {
              const on = b.kind === k.id;
              return (
                <Pressable
                  key={k.id}
                  onPress={() => set({ kind: k.id, outputs: PRESET[k.id] })}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  style={[styles.kind, on ? styles.kindOn : styles.kindOff]}
                >
                  <View style={styles.kindMark}>
                    <Text style={styles.kindMarkText}>{k.mark}</Text>
                  </View>
                  <View style={{ flex: 1, gap: 2 }}>
                    <Text style={[styles.kindLabel, on && { color: px.dark }]}>{k.label}</Text>
                    <Text style={[styles.kindDesc, on && { color: px.dark }]}>{k.desc}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

        {step === 2 && (
          <View style={{ gap: 16 }}>
            <Field label="프로젝트 이름" optional>
              <TextInput
                style={styles.input}
                value={b.name}
                onChangeText={(name) => set({ name })}
                placeholder="예: 사내 회의실 예약 앱"
                placeholderTextColor={px.grey}
              />
            </Field>
            <Field label="목표와 배경" hint={'팁: "누가, 언제, 무엇을 하려고" 순서로 쓰면 PM이 더 정확히 나눠요.'}>
              <TextInput
                style={[styles.input, { minHeight: 140 }]}
                value={b.goal}
                onChangeText={(goal) => set({ goal })}
                placeholder="왜 필요한지, 꼭 되어야 하는 기능을 적어 주세요."
                placeholderTextColor={px.grey}
                multiline
                textAlignVertical="top"
              />
            </Field>
            <Field label="누가 쓰나요" optional>
              <TextInput
                style={styles.input}
                value={b.users}
                onChangeText={(users) => set({ users })}
                placeholder="예: 본사 직원 약 300명, 총무팀 관리자"
                placeholderTextColor={px.grey}
              />
            </Field>
          </View>
        )}

        {step === 3 && (
          <View style={{ gap: 18 }}>
            <View style={{ gap: 8 }}>
              <Text style={styles.label}>받고 싶은 산출물</Text>
              <Text style={styles.hint}>종류에 맞춰 골라 뒀어요. 눌러서 바꾸세요.</Text>
              <View style={styles.outGrid}>
                {outs.map((o) => {
                  const on = b.outputs.includes(o.id);
                  return (
                    <Pressable
                      key={o.id}
                      onPress={() => set({ outputs: on ? b.outputs.filter((x) => x !== o.id) : [...b.outputs, o.id] })}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      style={[styles.out, on ? styles.outOn : styles.outOff]}
                    >
                      <Text style={[styles.outLabel, on && { color: px.ink }]} numberOfLines={1}>
                        {o.label}
                      </Text>
                      <Text style={[styles.outFmt, on && { color: px.ink }]} numberOfLines={1}>
                        {o.fmt}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
            <View style={styles.row2}>
              <PxSelect label="희망 마감" value={b.due} options={DUE_OPTIONS} onChange={(due) => set({ due })} />
            </View>
          </View>
        )}

        {step === 4 && (
          <View style={{ gap: 14 }}>
            <View style={styles.note}>
              <Text style={styles.hint}>
                선택 단계예요. 정해 둔 기술이 없으면 "다음 (건너뛰기)"를 누르세요. PM과 PL이 요청에 맞게 골라요.
              </Text>
            </View>
            <PxSelect label={TECH_LABELS.arch} value={b.tech.arch} options={TECH_OPTIONS.arch} onChange={(v) => setTech('arch', v)} />
            <View style={styles.row2}>
              <PxSelect
                label={TECH_LABELS.frontend}
                value={effectiveFrontend(b)}
                options={TECH_OPTIONS.frontend}
                onChange={(v) => setTech('frontend', v)}
                disabled={wantsApk(b)}
              />
              <PxSelect label={TECH_LABELS.backend} value={b.tech.backend} options={TECH_OPTIONS.backend} onChange={(v) => setTech('backend', v)} />
            </View>
            {wantsApk(b) && <Text style={styles.hint}>설치 파일(APK)은 {EXPO}로 만들 때 자동으로 빌드돼요.</Text>}
            <View style={styles.row2}>
              <PxSelect label={TECH_LABELS.db} value={b.tech.db} options={TECH_OPTIONS.db} onChange={(v) => setTech('db', v)} />
              <PxSelect label={TECH_LABELS.deploy} value={b.tech.deploy} options={TECH_OPTIONS.deploy} onChange={(v) => setTech('deploy', v)} />
            </View>
            <PxSelect label={TECH_LABELS.auth} value={b.tech.auth} options={TECH_OPTIONS.auth} onChange={(v) => setTech('auth', v)} />
            <Field label={TECH_LABELS.etc} optional>
              <TextInput
                style={[styles.input, { minHeight: 90 }]}
                value={b.tech.etc}
                onChangeText={(v) => setTech('etc', v)}
                placeholder="예: 기존 인사 DB와 연동, 사내망에서만 접속"
                placeholderTextColor={px.grey}
                multiline
                textAlignVertical="top"
              />
            </Field>
          </View>
        )}

        {step === 5 && (
          <View style={{ gap: 12 }}>
            <View style={styles.pmLine}>
              <Text style={styles.pmText}>
                PM: 이대로면 작업 {taskGuess}개 정도로 나눠서 하나씩 결재를 올릴게요.
              </Text>
            </View>
            {slots.used >= slots.max && (
              <View style={styles.queueBox}>
                <Text style={styles.queueTitle}>지금 {slots.max}개가 모두 일하는 중이에요</Text>
                {busyList.map((p) => (
                  <Text key={p.id} style={styles.queueItem} numberOfLines={1}>
                    · {p.name} — {p.activity}
                  </Text>
                ))}
                <Text style={styles.queueText}>
                  이 프로젝트는 대기열 {slots.queued + 1}번째로 들어가요. 하나가 결재 대기로 넘어가거나 끝나면 PM이 바로 계획을 시작하고 알림을 보낼게요.
                </Text>
              </View>
            )}
            <View style={styles.summary}>
              <Row k="종류" v={KINDS.find((k) => k.id === b.kind)?.label ?? ''} strong />
              <Row k="이름" v={b.name.trim() || '(이름 없음)'} strong />
              <Row k="목표" v={b.goal.trim()} />
              <Row k="사용자" v={b.users.trim() || '(적지 않음)'} />
              <Row k="산출물" v={pickedOuts.map((o) => o.label).join(', ') || '(없음)'} />
              <Row k="마감" v={b.due} />
              <Row
                k="기술 스펙"
                v={
                  [effectiveFrontend(b), b.tech.backend, b.tech.db, b.tech.arch, b.tech.deploy, b.tech.auth]
                    .filter((x) => x && x !== 'PM 추천')
                    .join(' · ') || 'PM 추천'
                }
              />
            </View>
            <Text style={styles.hint}>고칠 곳이 있으면 "이전"으로 돌아가세요.</Text>
          </View>
        )}
      </ScrollView>

      <View style={[styles.footer, { paddingBottom: keyboard ? 10 : Math.max(insets.bottom, 10) + 6 }]}>
        {(missingGoal || noOutputs) && (
          <Text style={styles.warn}>{missingGoal ? '목표와 배경을 적어 주세요.' : '산출물을 하나 이상 골라 주세요.'}</Text>
        )}
        <View style={styles.footerRow}>
        <PxButton title="이전" variant="dark" onPress={() => go(step - 1)} disabled={step === 1 || sending} style={{ flex: 1 }} />
        {step < STEPS ? (
          <PxButton
            title={step === 4 ? '다음 (건너뛰기)' : '다음'}
            onPress={() => go(step + 1)}
            disabled={missingGoal || noOutputs}
            style={{ flex: 1 }}
          />
        ) : (
          <PxButton title="▶ PM에게 지시하기" onPress={submit} loading={sending} style={{ flex: 1 }} />
        )}
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function Field(props: { label: string; optional?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.label}>
        {props.label}
        {props.optional ? <Text style={styles.optional}>  선택</Text> : null}
      </Text>
      {props.children}
      {!!props.hint && <Text style={styles.hint}>{props.hint}</Text>}
    </View>
  );
}

function Row(props: { k: string; v: string; strong?: boolean }) {
  return (
    <View style={styles.sumRow}>
      <Text style={styles.sumKey}>{props.k}</Text>
      <Text style={[styles.sumVal, props.strong && { fontWeight: '800' }]}>{props.v}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12, gap: 4, borderBottomWidth: 3, borderColor: px.ink },
  stepNo: { color: px.gold, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  stepTitle: { color: px.cream, fontSize: 19, fontWeight: '900' },
  cells: { flexDirection: 'row', gap: 4, padding: 3, marginTop: 8, backgroundColor: px.ink },
  cell: { flex: 1, height: 10 },
  body: { padding: 16, paddingBottom: 32 },
  hint: { color: px.sub, fontSize: 12, lineHeight: 18 },
  queueBox: { padding: 12, gap: 4, backgroundColor: px.dark, borderWidth: 2, borderColor: '#6CB6F0' },
  queueTitle: { color: '#6CB6F0', fontSize: 13, fontWeight: '900', marginBottom: 2 },
  queueItem: { color: px.cream, fontSize: 12 },
  queueText: { color: px.cream, fontSize: 12, lineHeight: 18, marginTop: 4 },
  label: { color: px.cream, fontSize: 13, fontWeight: '800' },
  optional: { color: px.sub, fontSize: 11, fontWeight: '700' },
  input: {
    minHeight: 46,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: px.bg,
    color: px.cream,
    borderWidth: 2,
    borderColor: px.line,
    fontSize: 14,
    lineHeight: 20,
  },
  kind: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderWidth: 2, borderColor: px.ink },
  kindOn: { backgroundColor: px.cream },
  kindOff: { backgroundColor: px.panel },
  kindMark: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', backgroundColor: px.ink },
  kindMarkText: { color: px.gold, fontSize: 16, fontWeight: '900' },
  kindLabel: { color: px.cream, fontSize: 15, fontWeight: '800' },
  kindDesc: { color: px.sub, fontSize: 12, lineHeight: 17 },
  // 3단계 산출물 버튼: 2열로 너비와 높이를 똑같이 맞춥니다.
  outGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  out: { width: '48.5%', height: 58, justifyContent: 'center', paddingHorizontal: 12, gap: 2, borderWidth: 2, borderColor: px.ink },
  outOn: { backgroundColor: px.mint },
  outOff: { backgroundColor: px.bg, borderColor: px.line },
  outLabel: { color: px.cream, fontSize: 14, fontWeight: '800' },
  outFmt: { color: px.sub, fontSize: 11, fontWeight: '700' },
  row2: { flexDirection: 'row', gap: 10 },
  note: { padding: 10, backgroundColor: px.panel, borderWidth: 2, borderColor: px.ink },
  pmLine: { backgroundColor: px.cream, borderWidth: 2, borderColor: px.ink, padding: 12 },
  pmText: { color: px.dark, fontSize: 13, fontWeight: '700', lineHeight: 20 },
  summary: { backgroundColor: px.panel, borderWidth: 2, borderColor: px.ink, padding: 12, gap: 10 },
  sumRow: { flexDirection: 'row', gap: 12 },
  sumKey: { width: 64, color: px.sub, fontSize: 13 },
  sumVal: { flex: 1, color: px.cream, fontSize: 13, lineHeight: 19 },
  footer: { gap: 8, paddingHorizontal: 16, paddingTop: 10, borderTopWidth: 3, borderColor: px.ink, backgroundColor: px.dark },
  footerRow: { flexDirection: 'row', gap: 8 },
  warn: { textAlign: 'center', color: px.coral, fontSize: 12, fontWeight: '700' },
});
