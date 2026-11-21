import { router, Stack } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { replan, resetProject, runTasks, startProject, statusLabel } from '../engine';
import { ROLES, roleInfo } from '../roles';
import { useSettings } from '../settings';
import { useBusy, useProject } from '../store';
import { ProjectPhase, Task } from '../types';
import { Badge, Button, Card, colors } from '../ui';

const PHASE: Record<ProjectPhase, { label: string; color: string }> = {
  idle: { label: '대기', color: colors.sub },
  planning: { label: 'PM 계획 중', color: colors.primary },
  awaiting_approval: { label: '승인 대기', color: colors.warn },
  running: { label: '실행 중', color: colors.primary },
  paused: { label: '일시 정지', color: colors.warn },
  done: { label: '완료', color: colors.success },
};

const TASK_COLOR: Record<Task['status'], string> = {
  pending: colors.sub,
  running: colors.primary,
  done: colors.success,
  failed: colors.danger,
};

export default function Home() {
  const project = useProject();
  const settings = useSettings();
  const busy = useBusy();
  const [request, setRequest] = useState('');

  const needsKeys = !settings.anthropicKey && !settings.openaiKey;
  const phase = PHASE[project.phase];
  const pending = project.tasks.filter((t) => t.status === 'pending').length;
  const hasFailed = project.tasks.some((t) => t.status === 'failed');

  const start = () => {
    const text = request.trim();
    if (!text) return;
    setRequest('');
    startProject(text);
  };

  const confirmReset = () =>
    Alert.alert('새 프로젝트', '현재 프로젝트의 대화와 작업 목록을 지웁니다. 산출물 파일은 기기에 남습니다.', [
      { text: '취소', style: 'cancel' },
      { text: '새로 시작', style: 'destructive', onPress: resetProject },
    ]);

  return (
    <>
      <Stack.Screen
        options={{
          headerRight: () => (
            <Pressable onPress={() => router.push('/settings')} hitSlop={10}>
              <Text style={styles.headerLink}>설정</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
        {needsKeys && (
          <Pressable onPress={() => router.push('/settings')}>
            <Card style={styles.warn}>
              <Text style={styles.warnText}>
                설정에서 Claude 또는 OpenAI API 키를 입력해야 AI 팀원이 일할 수 있습니다. 눌러서 이동
              </Text>
            </Card>
          </Pressable>
        )}

        {project.phase === 'idle' && !project.request ? (
          <Card>
            <Text style={styles.title}>무엇을 만들까요?</Text>
            <Text style={styles.sub}>요청을 적으면 PM이 팀원에게 일을 나눠 계획을 세웁니다. 승인하면 실행합니다.</Text>
            <TextInput
              style={styles.input}
              value={request}
              onChangeText={setRequest}
              placeholder="예: 동네 헬스장 회원 관리 앱. 회원 등록, 출석 체크, 이용권 만료 알림이 필요해."
              multiline
              textAlignVertical="top"
            />
            <Button title="PM에게 맡기기" onPress={start} disabled={!request.trim()} />
          </Card>
        ) : (
          <Card>
            <View style={styles.row}>
              <Text style={styles.title}>프로젝트</Text>
              <Badge label={phase.label} color={phase.color} />
            </View>
            <Text style={styles.request}>{project.request}</Text>
            {!!project.planSummary && <Text style={styles.summary}>{project.planSummary}</Text>}

            {project.phase === 'planning' && (
              <View style={styles.row}>
                <ActivityIndicator color={colors.primary} />
                <Text style={styles.sub}>PM이 계획을 세우고 있습니다…</Text>
              </View>
            )}

            {project.tasks.map((t, i) => (
              <Pressable key={t.id} style={styles.task} onPress={() => router.push(`/room/${t.role}`)}>
                <Text style={styles.taskIndex}>{i + 1}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.taskTitle}>
                    [{roleInfo(t.role).name}] {t.title}
                  </Text>
                  {!!t.error && (
                    <Text style={styles.taskError} numberOfLines={2}>
                      {t.error}
                    </Text>
                  )}
                </View>
                {t.status === 'running' ? (
                  <ActivityIndicator color={colors.primary} />
                ) : (
                  <Badge label={statusLabel(t.status)} color={TASK_COLOR[t.status]} />
                )}
              </Pressable>
            ))}

            <View style={styles.actions}>
              {project.phase === 'awaiting_approval' && (
                <>
                  <Button title={`승인하고 실행 (${pending}개)`} onPress={runTasks} style={{ flex: 1 }} />
                  <Button title="다시 계획" variant="secondary" onPress={replan} />
                </>
              )}
              {project.phase === 'paused' && (
                <>
                  <Button
                    title={hasFailed ? '실패한 작업 다시 시도' : `다음 작업 승인 (${pending}개 남음)`}
                    onPress={runTasks}
                    style={{ flex: 1 }}
                  />
                  <Button title="다시 계획" variant="secondary" onPress={replan} />
                </>
              )}
              {project.phase === 'done' && (
                <Button title="PM에게 추가 요청" variant="secondary" onPress={() => router.push('/room/pm')} style={{ flex: 1 }} />
              )}
            </View>
            {project.phase !== 'running' && project.phase !== 'planning' && (
              <Button title="새 프로젝트" variant="secondary" small onPress={confirmReset} style={{ marginTop: 8 }} />
            )}
          </Card>
        )}

        <View style={styles.sectionHeader}>
          <Text style={styles.section}>채팅방</Text>
          <Pressable onPress={() => router.push('/files')}>
            <Text style={styles.headerLink}>전체 산출물 {project.deliverables.length}개</Text>
          </Pressable>
        </View>
        {ROLES.map((r) => {
          const msgs = project.messages.filter((m) => m.role === r.id);
          const last = msgs[msgs.length - 1];
          const fileCount = project.deliverables.filter((d) => d.role === r.id).length;
          const model = settings.roles[r.id];
          return (
            <Pressable key={r.id} onPress={() => router.push(`/room/${r.id}`)}>
              <Card style={styles.room}>
                <View style={[styles.avatar, { backgroundColor: r.color }]}>
                  <Text style={styles.avatarText}>{r.name.slice(0, 2)}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={styles.row}>
                    <Text style={styles.roomName}>{r.name}</Text>
                    <Text style={styles.model}>
                      {model.provider === 'claude' ? 'Claude' : 'OpenAI'} · {model.model}
                    </Text>
                  </View>
                  <Text style={styles.sub} numberOfLines={1}>
                    {busy[r.id] ? '작성 중…' : last ? last.text : r.description}
                  </Text>
                </View>
                {busy[r.id] ? (
                  <ActivityIndicator color={r.color} />
                ) : fileCount > 0 ? (
                  <Badge label={`파일 ${fileCount}`} color={r.color} />
                ) : null}
              </Card>
            </Pressable>
          );
        })}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12, paddingBottom: 40 },
  headerLink: { color: colors.primary, fontSize: 15, fontWeight: '600' },
  warn: { backgroundColor: '#FFFBEB', borderColor: '#FDE68A' },
  warnText: { color: '#92400E', fontSize: 14 },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  sub: { fontSize: 13, color: colors.sub, marginTop: 4 },
  input: {
    minHeight: 110,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    padding: 12,
    marginVertical: 12,
    fontSize: 15,
    color: colors.text,
  },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  request: { fontSize: 14, color: colors.text, marginTop: 8 },
  summary: { fontSize: 13, color: colors.sub, marginTop: 8, lineHeight: 19 },
  task: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: 8,
  },
  taskIndex: { width: 20, textAlign: 'center', color: colors.sub, fontWeight: '700' },
  taskTitle: { fontSize: 14, color: colors.text },
  taskError: { fontSize: 12, color: colors.danger, marginTop: 2 },
  actions: { flexDirection: 'row', gap: 8, marginTop: 12 },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  section: { fontSize: 16, fontWeight: '700', color: colors.text },
  room: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#fff', fontWeight: '700', fontSize: 13 },
  roomName: { fontSize: 15, fontWeight: '700', color: colors.text },
  model: { fontSize: 11, color: colors.sub, flexShrink: 1 },
});
