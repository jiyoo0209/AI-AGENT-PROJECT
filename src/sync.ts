// 서버와 상태 맞추기
// AI 팀은 서버에서 일하고, 앱은 화면에 보이는 동안 서버 상태를 계속 받아 옵니다(롱 폴링).

import { Image } from 'expo-image';
import { AppState } from 'react-native';
import { useSyncExternalStore } from 'react';
import { imageSource } from './deliverables';
import { callServer, refreshLimits } from './llm';
import { markAttentionSeen, registerPush } from './notify';
import { getSettings, subscribeSettings } from './settings';
import { busyStore, projectStore } from './store';
import { Project, Provider, RoleId } from './types';
import { MonthlyUsage, setMonthlyUsage } from './usage';

export type Action =
  | { type: 'start'; request: string }
  | { type: 'run' }
  | { type: 'replan' }
  | { type: 'reset' }
  | { type: 'room'; role: RoleId; text: string };

interface ServerState {
  rev: number;
  project: Project;
  busy: Partial<Record<RoleId, boolean>>;
  attention: { id: string; title: string; body: string; at: number } | null;
  usage: { month: string; byProvider: Record<Provider, MonthlyUsage> };
}

export interface SyncStatus {
  connected: boolean;
  error?: string;
}

let status: SyncStatus = { connected: false };
const statusListeners = new Set<() => void>();

function setStatus(next: SyncStatus) {
  if (next.connected === status.connected && next.error === status.error) return;
  status = next;
  statusListeners.forEach((l) => l());
}

export function useSyncStatus(): SyncStatus {
  return useSyncExternalStore(
    (l) => {
      statusListeners.add(l);
      return () => {
        statusListeners.delete(l);
      };
    },
    () => status,
  );
}

let rev = 0;
let failures = 0;
let generation = 0;
let controller: AbortController | undefined;

/** 새 시안 이미지는 열기 전에 미리 받아 둡니다. */
const prefetched = new Set<string>();
function prefetchImages(p: Project) {
  for (const d of p.deliverables) {
    if (!d.isBinary || prefetched.has(d.id)) continue;
    prefetched.add(d.id);
    for (const v of ['thumb', 'preview'] as const) {
      const src = imageSource(d, v);
      Image.prefetch(src.uri, { headers: src.headers, cachePolicy: 'disk' }).catch(() => prefetched.delete(d.id));
    }
  }
}

function apply(s: ServerState) {
  rev = s.rev;
  projectStore.set(() => s.project);
  busyStore.set(() => s.busy);
  prefetchImages(s.project);
  if (s.usage) setMonthlyUsage(s.usage.month, s.usage.byProvider);
  // 앱을 보고 있으면 알림이 따로 필요 없습니다.
  if (s.attention) markAttentionSeen(s.attention.id).catch(() => {});
  refreshLimits(getSettings()).catch(() => {});
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loop(gen: number) {
  while (gen === generation) {
    const settings = getSettings();
    if (!settings.serverUrl.trim() || !settings.serverToken) {
      setStatus({ connected: false, error: '설정에서 서버 주소와 토큰을 입력하세요.' });
      return;
    }
    try {
      // 처음 한 번은 바로, 그다음부터는 바뀔 때까지 최대 20초 기다립니다.
      const wait = rev === 0 ? 0 : 20;
      const s = await callServer<ServerState>(settings, `/v1/state?since=${rev}&wait=${wait}`, undefined, controller?.signal);
      if (gen !== generation) return;
      apply(s);
      failures = 0;
      setStatus({ connected: true });
    } catch (e) {
      if (gen !== generation) return;
      // 모바일 네트워크에서는 한 번씩 끊기는 일이 흔해서, 연달아 실패할 때만 알립니다.
      failures++;
      if (failures >= 2) setStatus({ connected: false, error: e instanceof Error ? e.message : String(e) });
      await sleep(failures === 1 ? 1000 : 5000);
    }
  }
}

function restart() {
  controller?.abort();
  generation++;
  if (AppState.currentState !== 'active') return;
  controller = new AbortController();
  rev = 0;
  loop(generation);
}

function stop() {
  controller?.abort();
  generation++;
}

/** 역할별 모델과 '작업마다 결재' 설정을 서버에 맞춥니다. */
let lastSettingsSent = '';
async function pushSettings() {
  const s = getSettings();
  if (!s.serverUrl.trim() || !s.serverToken) return;
  const body = JSON.stringify({ roles: s.roles, stepApproval: s.stepApproval });
  if (body === lastSettingsSent) return;
  try {
    await callServer(s, '/v1/settings', JSON.parse(body));
    lastSettingsSent = body;
  } catch {
    // 다음 변경이나 다음 실행 때 다시 보냅니다.
  }
}

let started = false;
let lastConnection = '';

export function startSync() {
  if (started) return;
  started = true;
  const connection = () => `${getSettings().serverUrl}|${getSettings().serverToken}`;
  lastConnection = connection();
  subscribeSettings(() => {
    pushSettings();
    if (connection() !== lastConnection) {
      lastConnection = connection();
      lastSettingsSent = '';
      pushSettings();
      registerPush();
      restart();
    }
  });
  AppState.addEventListener('change', (s) => {
    if (s === 'active') restart();
    else stop();
  });
  pushSettings();
  restart();
}

/** 서버에 일을 시킵니다. 서버는 바로 답하고 일은 뒤에서 계속합니다. */
export async function act(action: Action): Promise<void> {
  await callServer(getSettings(), '/v1/action', action);
}
