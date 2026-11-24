import { router } from 'expo-router';
import { useHeaderHeight } from 'expo-router/react-navigation';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { checkServer } from '../llm';
import { ROLES } from '../roles';
import { defaultModel, modelLabel, modelOptions, saveSettings, useSettings } from '../settings';
import { Provider, RoleId, RoleModel, Settings } from '../types';
import { Button, Card, colors } from '../ui';

/** 모델 선택 콤보박스: 누르면 목록이 열립니다. */
function ModelPicker(props: { value: RoleModel; onChange: (model: string) => void; roleName: string }) {
  const [open, setOpen] = useState(false);
  const options = modelOptions(props.value.provider);
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`${props.roleName} 모델 선택, 현재 ${modelLabel(props.value)}`}
        style={styles.combo}
      >
        <Text style={styles.comboText}>{modelLabel(props.value)}</Text>
        <Text style={styles.comboArrow}>▾</Text>
      </Pressable>
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.sheetTitle}>{props.roleName} 모델</Text>
            {options.map((o) => {
              const selected = o.id === props.value.model;
              return (
                <Pressable
                  key={o.id || 'default'}
                  onPress={() => {
                    props.onChange(o.id);
                    setOpen(false);
                  }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[styles.option, selected && styles.optionSelected]}
                >
                  <Text style={[styles.optionLabel, selected && { color: colors.primary }]}>
                    {selected ? '● ' : '○ '}
                    {o.label}
                  </Text>
                  {!!o.note && <Text style={styles.optionNote}>{o.note}</Text>}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

export default function SettingsScreen() {
  const saved = useSettings();
  const [draft, setDraft] = useState<Settings>(() => JSON.parse(JSON.stringify(saved)));
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const headerHeight = useHeaderHeight();

  const testServer = async () => {
    setTesting(true);
    try {
      await checkServer(draft);
      Alert.alert('연결 성공', '맥미니 서버에 연결되었습니다. 저장을 눌러 적용하세요.');
    } catch (e) {
      Alert.alert('연결 실패', e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  };

  const setRole = (role: RoleId, patch: Partial<RoleModel>) =>
    setDraft((d) => ({ ...d, roles: { ...d.roles, [role]: { ...d.roles[role], ...patch } } }));

  const switchProvider = (role: RoleId, provider: Provider) => setRole(role, { provider, model: defaultModel(provider) });

  const save = async () => {
    setSaving(true);
    try {
      await saveSettings(draft);
      router.back();
    } catch (e) {
      Alert.alert('저장 실패', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={headerHeight}>
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Card>
        <Text style={styles.title}>맥미니 서버</Text>
        <Text style={styles.sub}>
          맥미니에 로그인된 Claude Pro와 ChatGPT Plus 구독으로 일합니다. 토큰은 이 기기의 보안 저장소에만 저장됩니다.
        </Text>
        <Text style={styles.label}>서버 주소</Text>
        <TextInput
          style={styles.input}
          value={draft.serverUrl}
          onChangeText={(v) => setDraft((d) => ({ ...d, serverUrl: v }))}
          placeholder="https://macmini.xxxx.ts.net"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
        />
        <Text style={styles.label}>토큰</Text>
        <TextInput
          style={styles.input}
          value={draft.serverToken}
          onChangeText={(v) => setDraft((d) => ({ ...d, serverToken: v }))}
          placeholder="맥미니 서버의 SERVER_TOKEN"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button
          small
          variant="secondary"
          title="연결 테스트"
          onPress={testServer}
          loading={testing}
          disabled={!draft.serverUrl.trim() || !draft.serverToken.trim()}
          style={{ marginTop: 12 }}
        />
      </Card>

      <Card>
        <Text style={styles.title}>역할별 AI 모델</Text>
        <Text style={styles.sub}>남은 한도는 홈의 AI 에너지에서 볼 수 있어요.</Text>
        {ROLES.map((r) => {
          const m = draft.roles[r.id];
          return (
            <View key={r.id} style={styles.roleRow}>
              <Text style={[styles.roleName, { color: r.color }]}>{r.name}</Text>
              <View style={styles.segment}>
                {(['claude', 'openai'] as Provider[]).map((p) => (
                  <Button
                    key={p}
                    small
                    title={p === 'claude' ? 'Claude' : 'ChatGPT'}
                    variant={m.provider === p ? 'primary' : 'secondary'}
                    onPress={() => switchProvider(r.id, p)}
                    style={{ flex: 1 }}
                  />
                ))}
              </View>
              <ModelPicker value={m} roleName={r.name} onChange={(model) => setRole(r.id, { model })} />
            </View>
          );
        })}
      </Card>

      <Card>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>작업마다 결재</Text>
            <Text style={styles.sub}>켜면 작업 하나가 끝날 때마다 담당 팀원이 대표실로 와서 결재를 기다립니다.</Text>
          </View>
          <Switch value={draft.stepApproval} onValueChange={(v) => setDraft((d) => ({ ...d, stepApproval: v }))} />
        </View>
      </Card>

      <Button title="저장" onPress={save} loading={saving} />
    </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, gap: 12, paddingBottom: 40 },
  title: { fontSize: 16, fontWeight: '700', color: colors.text },
  sub: { fontSize: 12, color: colors.sub, marginTop: 4, lineHeight: 18 },
  label: { fontSize: 13, fontWeight: '600', color: colors.text, marginTop: 14 },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginTop: 6,
    fontSize: 14,
    color: colors.text,
  },
  roleRow: { marginTop: 16 },
  roleName: { fontSize: 14, fontWeight: '700' },
  segment: { flexDirection: 'row', gap: 6, marginTop: 6 },
  combo: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    marginTop: 6,
  },
  comboText: { fontSize: 14, color: colors.text, fontWeight: '600' },
  comboArrow: { fontSize: 14, color: colors.sub },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    padding: 16,
    paddingBottom: 32,
    gap: 6,
  },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: 6 },
  option: { paddingVertical: 12, paddingHorizontal: 12, borderRadius: 10, borderWidth: 1, borderColor: colors.border },
  optionSelected: { borderColor: colors.primary, backgroundColor: '#EFF6FF' },
  optionLabel: { fontSize: 15, fontWeight: '600', color: colors.text },
  optionNote: { fontSize: 12, color: colors.sub, marginTop: 2 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
