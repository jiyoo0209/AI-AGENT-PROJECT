import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { Provider } from './types';

/** 구독 한도 창 하나 (예: 5시간, 주간). usedPct는 0~100. */
export interface LimitWindow {
  key: string;
  label: string;
  usedPct: number;
  resetsAt: string | null;
}

export interface ProviderLimits {
  windows: LimitWindow[];
  at: number;
}

export interface MonthlyUsage {
  input: number;
  output: number;
  requests: number;
}

export interface UsageState {
  month: string; // YYYY-MM
  byProvider: Record<Provider, MonthlyUsage>;
  limits: Partial<Record<Provider, ProviderLimits>>;
}

const KEY = 'usage.v2';

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function emptyUsage(): UsageState {
  const zero = (): MonthlyUsage => ({ input: 0, output: 0, requests: 0 });
  return { month: thisMonth(), byProvider: { claude: zero(), openai: zero() }, limits: {} };
}

let state: UsageState = emptyUsage();
const listeners = new Set<() => void>();

function set(next: UsageState) {
  state = next;
  listeners.forEach((l) => l());
  AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => {});
}

/** Starts a new monthly tally when the month changes; limit snapshots are kept. */
function current(): UsageState {
  if (state.month === thisMonth()) return state;
  return { ...emptyUsage(), limits: state.limits };
}

export async function loadUsage(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as UsageState;
      state = { ...emptyUsage(), ...saved, byProvider: { ...emptyUsage().byProvider, ...saved.byProvider } };
      state = current();
      listeners.forEach((l) => l());
    }
  } catch {
    // keep empty usage
  }
}

export function useUsage(): UsageState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => state,
  );
}

export function recordUsage(provider: Provider, input: number, output: number) {
  const s = current();
  const prev = s.byProvider[provider];
  set({
    ...s,
    byProvider: {
      ...s.byProvider,
      [provider]: {
        input: prev.input + (input || 0),
        output: prev.output + (output || 0),
        requests: prev.requests + 1,
      },
    },
  });
}

/** 맥미니 서버가 알려준 구독 한도를 기록합니다. null이면 이번에 못 읽은 것이므로 이전 값을 둡니다. */
export function recordLimits(provider: Provider, windows: LimitWindow[] | null) {
  if (!windows || windows.length === 0) return;
  const s = current();
  set({ ...s, limits: { ...s.limits, [provider]: { windows, at: Date.now() } } });
}

/** 남은 에너지(%): 가장 많이 쓴 창 기준. 정보가 없으면 undefined. */
export function remainingPct(limits?: ProviderLimits): number | undefined {
  if (!limits || limits.windows.length === 0) return undefined;
  const now = Date.now();
  const used = Math.max(
    ...limits.windows.map((w) => (w.resetsAt && Date.parse(w.resetsAt) < now ? 0 : w.usedPct)),
  );
  return Math.max(0, Math.min(100, Math.round(100 - used)));
}

/** 남은 에너지가 가장 적은 창 (홈 화면 요약용) */
export function tightestWindow(limits?: ProviderLimits): LimitWindow | undefined {
  if (!limits || limits.windows.length === 0) return undefined;
  return [...limits.windows].sort((a, b) => b.usedPct - a.usedPct)[0];
}

export function energyColor(pct: number | undefined): string {
  if (pct === undefined) return '#8C8FA8';
  if (pct >= 50) return '#5FD3A6';
  if (pct >= 20) return '#F5C04A';
  return '#F07A63';
}

export function resetText(iso: string | null | undefined): string {
  if (!iso) return '';
  const ms = Date.parse(iso) - Date.now();
  if (Number.isNaN(ms)) return '';
  if (ms <= 0) return '곧 충전';
  const min = Math.round(ms / 60000);
  if (min < 60) return `${min}분 후 충전`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}시간 ${min % 60}분 후 충전`;
  return `${Math.floor(h / 24)}일 후 충전`;
}
