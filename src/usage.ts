import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { Provider } from './types';

/** Per-minute rate-limit state as reported by the provider's response headers. */
export interface RateSnapshot {
  tokensRemaining?: number;
  tokensLimit?: number;
  inputRemaining?: number;
  inputLimit?: number;
  outputRemaining?: number;
  outputLimit?: number;
  requestsRemaining?: number;
  requestsLimit?: number;
  reset?: string;
  /** 구독(Claude Pro 등) 한도 사용률 0~1. 맥미니 서버를 쓸 때만 옵니다. */
  utilization?: number;
  limitType?: string;
  limitStatus?: string;
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
  rate: Partial<Record<Provider, RateSnapshot>>;
}

const KEY = 'usage.v1';

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function emptyUsage(): UsageState {
  const zero = (): MonthlyUsage => ({ input: 0, output: 0, requests: 0 });
  return { month: thisMonth(), byProvider: { claude: zero(), openai: zero() }, rate: {} };
}

let state: UsageState = emptyUsage();
const listeners = new Set<() => void>();

function set(next: UsageState) {
  state = next;
  listeners.forEach((l) => l());
  AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => {});
}

/** Starts a new monthly tally when the month changes; rate snapshots are kept. */
function current(): UsageState {
  if (state.month === thisMonth()) return state;
  return { ...emptyUsage(), rate: state.rate };
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

function num(headers: Headers, name: string): number | undefined {
  const v = headers.get(name);
  if (v == null || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** 맥미니 서버가 알려준 구독 한도 상태를 기록합니다. */
export function recordSubscriptionLimit(
  provider: Provider,
  info: { status?: string; utilization?: number; resetsAt?: number; type?: string },
) {
  let reset: string | undefined;
  if (typeof info.resetsAt === 'number' && info.resetsAt > 0) {
    // 초 단위와 밀리초 단위 모두 받아 줍니다.
    const ms = info.resetsAt < 1e12 ? info.resetsAt * 1000 : info.resetsAt;
    reset = new Date(ms).toISOString();
  }
  const snap: RateSnapshot = {
    utilization: typeof info.utilization === 'number' ? info.utilization : undefined,
    limitType: info.type,
    limitStatus: info.status,
    reset,
    at: Date.now(),
  };
  const s = current();
  set({ ...s, rate: { ...s.rate, [provider]: snap } });
}

export function recordRateHeaders(provider: Provider, headers: Headers) {
  let snap: RateSnapshot;
  if (provider === 'claude') {
    snap = {
      tokensRemaining: num(headers, 'anthropic-ratelimit-tokens-remaining'),
      tokensLimit: num(headers, 'anthropic-ratelimit-tokens-limit'),
      inputRemaining: num(headers, 'anthropic-ratelimit-input-tokens-remaining'),
      inputLimit: num(headers, 'anthropic-ratelimit-input-tokens-limit'),
      outputRemaining: num(headers, 'anthropic-ratelimit-output-tokens-remaining'),
      outputLimit: num(headers, 'anthropic-ratelimit-output-tokens-limit'),
      requestsRemaining: num(headers, 'anthropic-ratelimit-requests-remaining'),
      requestsLimit: num(headers, 'anthropic-ratelimit-requests-limit'),
      reset:
        headers.get('anthropic-ratelimit-tokens-reset') ??
        headers.get('anthropic-ratelimit-input-tokens-reset') ??
        undefined,
      at: Date.now(),
    };
  } else {
    snap = {
      tokensRemaining: num(headers, 'x-ratelimit-remaining-tokens'),
      tokensLimit: num(headers, 'x-ratelimit-limit-tokens'),
      requestsRemaining: num(headers, 'x-ratelimit-remaining-requests'),
      requestsLimit: num(headers, 'x-ratelimit-limit-requests'),
      reset: headers.get('x-ratelimit-reset-tokens') ?? undefined,
      at: Date.now(),
    };
  }
  const hasAny = Object.entries(snap).some(([k, v]) => k !== 'at' && v !== undefined);
  if (!hasAny) return;
  const s = current();
  set({ ...s, rate: { ...s.rate, [provider]: snap } });
}
