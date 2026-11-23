import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';
import { Provider, RoleId, RoleModel, Settings } from './types';

export interface ModelOption {
  id: string;
  label: string;
  note?: string;
}

/** 맥미니에서 Claude Pro 구독으로 쓸 수 있는 모델. 빈 값은 구독 기본 모델입니다. */
export const CLAUDE_MODELS: ModelOption[] = [
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: '추천 · 한도를 아끼면서 대부분의 일에 충분' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: '어려운 설계·코드 · 한도를 더 씀' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: '가볍고 빠른 일' },
  { id: '', label: '기본 모델', note: 'Claude Code에 설정된 기본 모델' },
];

/** 맥미니에서 ChatGPT Plus 구독(Codex)으로 쓸 수 있는 모델. 빈 값은 Codex 기본 모델입니다. */
export const OPENAI_MODELS: ModelOption[] = [
  { id: '', label: '기본 모델', note: 'Codex 기본 모델 (현재 GPT-6.2 Sol)' },
  { id: 'gpt-6.2-sol', label: 'GPT-6.2 Sol', note: '일상 작업' },
  { id: 'gpt-6.2-astra', label: 'GPT-6.2 Astra', note: '어려운 작업 · 한도를 더 씀' },
  { id: 'gpt-6-luna', label: 'GPT-6 Luna', note: '가볍고 반복적인 일' },
];

export function modelOptions(provider: Provider): ModelOption[] {
  return provider === 'claude' ? CLAUDE_MODELS : OPENAI_MODELS;
}

export function defaultModel(provider: Provider): string {
  return modelOptions(provider)[0].id;
}

export function modelLabel(rm: RoleModel): string {
  return modelOptions(rm.provider).find((o) => o.id === rm.model)?.label ?? rm.model;
}

const claude: RoleModel = { provider: 'claude', model: defaultModel('claude') };

export function defaultSettings(): Settings {
  return {
    serverUrl: '',
    serverToken: '',
    stepApproval: false,
    roles: {
      pm: { ...claude },
      planner: { ...claude },
      designer: { provider: 'openai', model: defaultModel('openai') },
      publisher: { ...claude },
      pl: { ...claude },
      developer: { ...claude },
      tester: { ...claude },
    },
  };
}

const SETTINGS_KEY = 'settings.v1';
const SERVER_TOKEN = 'serverToken';

let current: Settings = defaultSettings();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function getSettings(): Settings {
  return current;
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => current,
  );
}

export async function loadSettings(): Promise<void> {
  const base = defaultSettings();
  try {
    const raw = await AsyncStorage.getItem(SETTINGS_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings>;
      base.serverUrl = saved.serverUrl ?? base.serverUrl;
      base.stepApproval = saved.stepApproval ?? base.stepApproval;
      if (saved.roles) {
        (Object.keys(base.roles) as RoleId[]).forEach((r) => {
          const m = saved.roles?.[r];
          if (!m || (m.provider !== 'claude' && m.provider !== 'openai')) return;
          // 예전에 직접 적어 둔 모델 ID가 목록에 없으면 기본값으로 바꿉니다.
          const known = modelOptions(m.provider).some((o) => o.id === m.model);
          base.roles[r] = { provider: m.provider, model: known ? m.model : defaultModel(m.provider) };
        });
      }
    }
    base.serverToken = (await SecureStore.getItemAsync(SERVER_TOKEN)) ?? '';
  } catch {
    // keep defaults
  }
  current = base;
  emit();
}

export async function saveSettings(next: Settings): Promise<void> {
  const { serverToken, ...rest } = next;
  const serverUrl = rest.serverUrl.trim().replace(/\/+$/, '');
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...rest, serverUrl }));
  await SecureStore.setItemAsync(SERVER_TOKEN, serverToken.trim());
  current = { ...next, serverUrl, serverToken: serverToken.trim() };
  emit();
}
