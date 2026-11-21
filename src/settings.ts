import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import { useSyncExternalStore } from 'react';
import { RoleId, RoleModel, Settings } from './types';

export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5-5';
export const DEFAULT_OPENAI_MODEL = 'gpt-5.6-sol';
export const DEFAULT_IMAGE_MODEL = 'gpt-image-2.6-sunburst';

const claude: RoleModel = { provider: 'claude', model: DEFAULT_CLAUDE_MODEL };

export function defaultSettings(): Settings {
  return {
    anthropicKey: '',
    openaiKey: '',
    imageModel: DEFAULT_IMAGE_MODEL,
    stepApproval: false,
    roles: {
      pm: { ...claude },
      planner: { ...claude },
      designer: { provider: 'openai', model: DEFAULT_OPENAI_MODEL },
      publisher: { ...claude },
      pl: { ...claude },
      developer: { ...claude },
      tester: { ...claude },
    },
  };
}

const SETTINGS_KEY = 'settings.v1';
const ANTHROPIC_KEY = 'anthropicKey';
const OPENAI_KEY = 'openaiKey';

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
      base.imageModel = saved.imageModel || base.imageModel;
      base.stepApproval = saved.stepApproval ?? base.stepApproval;
      if (saved.roles) {
        (Object.keys(base.roles) as RoleId[]).forEach((r) => {
          const m = saved.roles?.[r];
          if (m && m.model) base.roles[r] = m;
        });
      }
    }
    base.anthropicKey = (await SecureStore.getItemAsync(ANTHROPIC_KEY)) ?? '';
    base.openaiKey = (await SecureStore.getItemAsync(OPENAI_KEY)) ?? '';
  } catch {
    // keep defaults
  }
  current = base;
  emit();
}

export async function saveSettings(next: Settings): Promise<void> {
  const { anthropicKey, openaiKey, ...rest } = next;
  await AsyncStorage.setItem(SETTINGS_KEY, JSON.stringify(rest));
  await SecureStore.setItemAsync(ANTHROPIC_KEY, anthropicKey.trim());
  await SecureStore.setItemAsync(OPENAI_KEY, openaiKey.trim());
  current = { ...next, anthropicKey: anthropicKey.trim(), openaiKey: openaiKey.trim() };
  emit();
}
