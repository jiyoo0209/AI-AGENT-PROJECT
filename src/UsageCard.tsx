import { useState } from 'react';
import { Alert, StyleSheet, Text, TextInput, View } from 'react-native';
import { checkLimits } from './llm';
import { DEFAULT_CLAUDE_MODEL, DEFAULT_OPENAI_MODEL } from './settings';
import { Provider, RoleId, Settings } from './types';
import { Button, Card, colors } from './ui';
import { RateSnapshot, useUsage } from './usage';

function fmt(n: number | undefined): string {
  if (n === undefined) return '-';
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function pair(remaining?: number, limit?: number): string {
  if (remaining === undefined && limit === undefined) return '-';
  return `${fmt(remaining)} / ${fmt(limit)}`;
}

function formatReset(reset?: string): string {
  if (!reset) return '-';
  const t = Date.parse(reset);
  // Claude sends an RFC 3339 time; OpenAI sends a duration such as "6m0s".
  return Number.isNaN(t) ? `${reset} 후` : new Date(t).toLocaleTimeString();
}

function Bar({ ratio }: { ratio: number }) {
  const r = Math.max(0, Math.min(1, ratio));
  const color = r < 0.1 ? colors.danger : r < 0.3 ? colors.warn : colors.success;
  return (
    <View style={styles.bar}>
      <View style={[styles.barFill, { width: `${r * 100}%`, backgroundColor: color }]} />
    </View>
  );
}

function RateRows({ provider, rate }: { provider: Provider; rate?: RateSnapshot }) {
  if (!rate) {
    return <Text style={styles.sub}>아직 기록이 없습니다. "지금 확인"을 누르거나 에이전트를 한 번 실행하세요.</Text>;
  }
  const main =
    rate.tokensLimit !== undefined
      ? { r: rate.tokensRemaining, l: rate.tokensLimit }
      : { r: rate.inputRemaining, l: rate.inputLimit };
  return (
    <>
      {main.l !== undefined && main.r !== undefined && <Bar ratio={main.r / main.l} />}
      {provider === 'claude' && rate.tokensLimit === undefined ? (
        <>
          <Row label="입력 토큰 남음" value={pair(rate.inputRemaining, rate.inputLimit)} />
          <Row label="출력 토큰 남음" value={pair(rate.outputRemaining, rate.outputLimit)} />
        </>
      ) : (
        <Row label="토큰 남음" value={pair(rate.tokensRemaining, rate.tokensLimit)} />
      )}
      <Row label="요청 남음" value={pair(rate.requestsRemaining, rate.requestsLimit)} />
      <Row label="한도 초기화" value={formatReset(rate.reset)} />
      <Row label="마지막 확인" value={new Date(rate.at).toLocaleString()} />
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.row}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

function probeModel(settings: Settings, provider: Provider): string {
  const role = (Object.keys(settings.roles) as RoleId[]).find(
    (r) => settings.roles[r].provider === provider,
  );
  if (role) return settings.roles[role].model;
  return provider === 'claude' ? DEFAULT_CLAUDE_MODEL : DEFAULT_OPENAI_MODEL;
}

export function UsageCard(props: {
  draft: Settings;
  onBudgetChange: (provider: Provider, value: number) => void;
}) {
  const usage = useUsage();
  const [checking, setChecking] = useState<Provider | null>(null);

  const check = async (provider: Provider) => {
    setChecking(provider);
    try {
      await checkLimits(provider, props.draft, probeModel(props.draft, provider));
    } catch (e) {
      Alert.alert('확인 실패', e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(null);
    }
  };

  return (
    <Card>
      <Text style={styles.title}>사용량 · 남은 한도</Text>
      <Text style={styles.sub}>
        분당 한도는 각 회사가 응답마다 알려주는 값입니다. 계정의 충전 잔액은 각 회사 콘솔에서 확인하세요. 월 예산을 정해 두면 이 앱에서 쓴 토큰 기준으로 남은 양을 보여줍니다.
      </Text>
      {(['claude', 'openai'] as Provider[]).map((p) => {
        const hasKey = p === 'claude' ? !!props.draft.anthropicKey : !!props.draft.openaiKey;
        const month = usage.byProvider[p];
        const used = month.input + month.output;
        const budget = props.draft.monthlyTokenBudget[p];
        return (
          <View key={p} style={styles.provider}>
            <View style={styles.headerRow}>
              <Text style={styles.providerName}>{p === 'claude' ? 'Claude' : 'OpenAI'}</Text>
              <Button
                small
                variant="secondary"
                title="지금 확인"
                onPress={() => check(p)}
                disabled={!hasKey || checking !== null}
                loading={checking === p}
              />
            </View>
            {!hasKey && <Text style={styles.sub}>API 키를 넣으면 확인할 수 있습니다.</Text>}

            <Text style={styles.section}>분당 한도</Text>
            <RateRows provider={p} rate={usage.rate[p]} />

            <Text style={styles.section}>이번 달 이 앱 사용량 ({usage.month})</Text>
            <Row label="입력 / 출력 토큰" value={`${fmt(month.input)} / ${fmt(month.output)}`} />
            <Row label="요청 수" value={fmt(month.requests)} />

            <Text style={styles.section}>월 토큰 예산</Text>
            <TextInput
              style={styles.input}
              value={budget ? String(budget) : ''}
              onChangeText={(v) => props.onBudgetChange(p, Number(v.replace(/[^0-9]/g, '')) || 0)}
              placeholder="예: 2000000 (비우면 사용 안 함)"
              keyboardType="number-pad"
            />
            {budget > 0 && (
              <>
                <Bar ratio={(budget - used) / budget} />
                <Row label="남은 예산" value={`${fmt(Math.max(0, budget - used))} / ${fmt(budget)} 토큰`} />
              </>
            )}
          </View>
        );
      })}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 16, fontWeight: '700', color: colors.text },
  sub: { fontSize: 12, color: colors.sub, marginTop: 4, lineHeight: 18 },
  provider: { marginTop: 16, paddingTop: 12, borderTopWidth: 1, borderTopColor: colors.border },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  providerName: { fontSize: 15, fontWeight: '700', color: colors.text },
  section: { fontSize: 13, fontWeight: '600', color: colors.text, marginTop: 12, marginBottom: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  rowLabel: { fontSize: 13, color: colors.sub },
  rowValue: { fontSize: 13, color: colors.text, fontWeight: '600' },
  bar: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden', marginVertical: 6 },
  barFill: { height: 6, borderRadius: 3 },
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
});
