import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { ROLES } from '../roles';
import {
  DEFAULT_CLAUDE_MODEL,
  DEFAULT_OPENAI_MODEL,
  saveSettings,
  useSettings,
} from '../settings';
import { Provider, RoleId, Settings } from '../types';
import { Button, Card, colors } from '../ui';
import { UsageCard } from '../UsageCard';

export default function SettingsScreen() {
  const saved = useSettings();
  const [draft, setDraft] = useState<Settings>(() => JSON.parse(JSON.stringify(saved)));
  const [saving, setSaving] = useState(false);

  const setRole = (role: RoleId, patch: Partial<Settings['roles'][RoleId]>) =>
    setDraft((d) => ({ ...d, roles: { ...d.roles, [role]: { ...d.roles[role], ...patch } } }));

  const switchProvider = (role: RoleId, provider: Provider) =>
    setRole(role, {
      provider,
      model: provider === 'claude' ? DEFAULT_CLAUDE_MODEL : DEFAULT_OPENAI_MODEL,
    });

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
    <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <Card>
        <Text style={styles.title}>API 키</Text>
        <Text style={styles.sub}>키는 이 기기의 보안 저장소에만 저장되고, 각 AI 회사 서버로만 전송됩니다.</Text>
        <Text style={styles.label}>Claude (Anthropic) API 키</Text>
        <TextInput
          style={styles.input}
          value={draft.anthropicKey}
          onChangeText={(v) => setDraft((d) => ({ ...d, anthropicKey: v }))}
          placeholder="sk-ant-..."
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Text style={styles.label}>OpenAI API 키</Text>
        <TextInput
          style={styles.input}
          value={draft.openaiKey}
          onChangeText={(v) => setDraft((d) => ({ ...d, openaiKey: v }))}
          placeholder="sk-..."
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />
      </Card>

      <UsageCard
        draft={draft}
        onBudgetChange={(p, v) =>
          setDraft((d) => ({ ...d, monthlyTokenBudget: { ...d.monthlyTokenBudget, [p]: v } }))
        }
      />

      <Card>
        <Text style={styles.title}>역할별 AI 모델</Text>
        <Text style={styles.sub}>모델명은 각 회사의 API 모델 ID를 그대로 적습니다.</Text>
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
                    title={p === 'claude' ? 'Claude' : 'OpenAI'}
                    variant={m.provider === p ? 'primary' : 'secondary'}
                    onPress={() => switchProvider(r.id, p)}
                    style={{ flex: 1 }}
                  />
                ))}
              </View>
              <TextInput
                style={styles.input}
                value={m.model}
                onChangeText={(v) => setRole(r.id, { model: v.trim() })}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          );
        })}
        <Text style={styles.label}>디자인 시안 이미지 모델 (OpenAI)</Text>
        <TextInput
          style={styles.input}
          value={draft.imageModel}
          onChangeText={(v) => setDraft((d) => ({ ...d, imageModel: v.trim() }))}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </Card>

      <Card>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>작업마다 승인</Text>
            <Text style={styles.sub}>켜면 작업 하나가 끝날 때마다 멈추고, 결과를 확인한 뒤 다음 작업을 승인합니다.</Text>
          </View>
          <Switch
            value={draft.stepApproval}
            onValueChange={(v) => setDraft((d) => ({ ...d, stepApproval: v }))}
          />
        </View>
      </Card>

      <Button title="저장" onPress={save} loading={saving} />
    </ScrollView>
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
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
});
