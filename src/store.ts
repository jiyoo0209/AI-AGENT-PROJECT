import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { ChatMessage, Project, RoleId } from './types';

type Listener = () => void;

function createStore<T>(initial: T) {
  let state = initial;
  const listeners = new Set<Listener>();
  return {
    get: () => state,
    set: (update: (s: T) => T) => {
      state = update(state);
      listeners.forEach((l) => l());
    },
    subscribe: (l: Listener) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function emptyProject(): Project {
  return {
    request: '',
    planSummary: '',
    tasks: [],
    phase: 'idle',
    messages: [],
    deliverables: [],
    createdAt: Date.now(),
  };
}

const PROJECT_KEY = 'project.v1';

export const projectStore = createStore<Project>(emptyProject());
export const busyStore = createStore<Partial<Record<RoleId, boolean>>>({});

let saveTimer: ReturnType<typeof setTimeout> | undefined;
projectStore.subscribe(() => {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    AsyncStorage.setItem(PROJECT_KEY, JSON.stringify(projectStore.get())).catch(() => {});
  }, 300);
});

export async function loadProject(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PROJECT_KEY);
    if (!raw) return;
    // 서버가 진짜 상태를 갖고 있고, 이 값은 서버와 연결되기 전까지 보여 줄 마지막 화면입니다.
    projectStore.set(() => ({ ...emptyProject(), ...(JSON.parse(raw) as Project) }));
  } catch {
    // ignore corrupted state
  }
}

export function useProject(): Project {
  return useSyncExternalStore(projectStore.subscribe, projectStore.get);
}

export function useBusy(): Partial<Record<RoleId, boolean>> {
  return useSyncExternalStore(busyStore.subscribe, busyStore.get);
}

export function setBusy(role: RoleId, busy: boolean) {
  busyStore.set((s) => ({ ...s, [role]: busy }));
}

export function addMessage(msg: Omit<ChatMessage, 'id' | 'createdAt'>): ChatMessage {
  const full: ChatMessage = { ...msg, id: newId(), createdAt: Date.now() };
  projectStore.set((p) => ({ ...p, messages: [...p.messages, full] }));
  return full;
}
