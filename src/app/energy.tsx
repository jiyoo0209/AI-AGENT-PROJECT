import { useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { refreshLimits } from '../llm';
import { EnergyBar, Panel, px, PxButton } from '../pixel';
import { ROLES } from '../roles';
import { useSettings } from '../settings';
import { Provider } from '../types';
import { energyColor, remainingPct, resetText, useUsage } from '../usage';

function fmt(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function ProviderCard(props: { provider: Provider; name: string; plan: string }) {
  const usage = useUsage();
  const settings = useSettings();
  const limits = usage.limits[props.provider];
  const pct = remainingPct(limits);
  const color = energyColor(pct);
  const month = usage.byProvider[props.provider];
  const members = ROLES.filter((r) => settings.roles[r.id].provider === props.provider).map((r) => r.name);
  return (
    <Panel>
      <View style={styles.head}>
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>{props.name}</Text>
          <Text style={styles.sub}>
            {props.plan} · {members.length ? members.join(', ') : '담당 팀원 없음'}
          </Text>
        </View>
        <View style={styles.pctBox}>
          <Text style={[styles.pct, { color }]}>{pct === undefined ? '—' : `${pct}%`}</Text>
          <Text style={styles.sub}>남음</Text>
        </View>
      </View>
      <View style={styles.bigBar}>
        <EnergyBar pct={pct} color={color} cells={20} height={16} />
      </View>
      {limits ? (
        limits.windows.map((w) => {
          const left = Math.max(0, Math.round(100 - w.usedPct));
          return (
            <View key={w.key} style={styles.winRow}>
              <Text style={styles.winLabel}>{w.label} 한도</Text>
              <View style={styles.winBar}>
                <View style={{ width: `${left}%`, height: 6, backgroundColor: energyColor(left) }} />
              </View>
              <Text style={styles.winPct}>{left}%</Text>
              <Text style={styles.winReset}>{resetText(w.resetsAt)}</Text>
            </View>
          );
        })
      ) : (
        <Text style={styles.sub}>아직 한도 정보를 받지 못했어요. "지금 확인"을 눌러 보세요.</Text>
      )}
      {limits && <Text style={styles.at}>마지막 확인 {new Date(limits.at).toLocaleTimeString()}</Text>}
      <Text style={styles.month}>
        이번 달 이 앱에서 쓴 양 · 요청 {fmt(month.requests)}회 · 토큰 {fmt(month.input + month.output)}
      </Text>
    </Panel>
  );
}

export default function Energy() {
  const settings = useSettings();
  const [checking, setChecking] = useState(false);

  const check = async () => {
    setChecking(true);
    try {
      await refreshLimits(settings, true);
    } catch (e) {
      Alert.alert('확인 실패', e instanceof Error ? e.message : String(e));
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    refreshLimits(settings).catch(() => {});
  }, [settings]);

  return (
    <ScrollView style={{ backgroundColor: px.bg }} contentContainerStyle={styles.container}>
      <Text style={styles.lead}>구독 한도 중 남은 양이에요. 5시간·주간 한도 중 더 많이 쓴 쪽을 기준으로 보여 줘요.</Text>
      <ProviderCard provider="claude" name="Claude" plan="Pro 구독" />
      <ProviderCard provider="openai" name="ChatGPT" plan="Plus 구독 (Codex)" />
      <PxButton title="지금 확인" onPress={check} loading={checking} />
      <View style={styles.legend}>
        {[
          ['#5FD3A6', '50% 이상'],
          ['#F5C04A', '20~50%'],
          ['#F07A63', '20% 미만'],
        ].map(([c, t]) => (
          <View key={t} style={styles.legendItem}>
            <View style={{ width: 10, height: 10, backgroundColor: c }} />
            <Text style={styles.legendText}>{t}</Text>
          </View>
        ))}
      </View>
      <Text style={styles.sub}>
        ChatGPT 한도는 맥미니의 Codex가 남긴 마지막 기록에서 읽어요. 최근에 ChatGPT를 쓴 팀원이 없으면 비어 있을 수 있어요.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 14, gap: 12, paddingBottom: 40 },
  lead: { color: px.sub, fontSize: 13, lineHeight: 19 },
  head: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  name: { color: px.cream, fontSize: 16, fontWeight: '900' },
  sub: { color: px.sub, fontSize: 12, lineHeight: 18 },
  pctBox: { alignItems: 'flex-end' },
  pct: { fontSize: 40, fontWeight: '900', lineHeight: 44 },
  bigBar: { backgroundColor: px.ink, padding: 3, marginVertical: 10 },
  winRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  winLabel: { color: px.sub, fontSize: 12, width: 62 },
  winBar: { flex: 1, height: 6, backgroundColor: px.line },
  winPct: { color: px.cream, fontSize: 12, fontWeight: '800', width: 36, textAlign: 'right' },
  winReset: { color: px.sub, fontSize: 11, width: 92, textAlign: 'right' },
  at: { color: px.sub, fontSize: 11, marginTop: 2 },
  month: { color: px.sub, fontSize: 11, marginTop: 8 },
  legend: { flexDirection: 'row', gap: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText: { color: px.cream, fontSize: 12, fontWeight: '700' },
});
