// 서버와 상태 맞추기
// AI 팀은 서버에서 일하고, 앱은 화면에 보이는 동안 서버 상태를 계속 받아 옵니다(롱 폴링).

import { Image } from 'expo-image';
import { AppState } from 'react-native';
import { useSyncExternalStore } from 'react';
import { docKind, imageSource, pageSource, setSiteBase } from './deliverables';
import { callServer, refreshLimits } from './llm';
import { markAttentionSeen, registerPush } from './notify';
import { getSettings, subscribeSettings } from './settings';
import { thisDevice } from './device';
import { busyStore, currentIdStore, emptyProject, projectsStore, ProjectsInfo, projectStore, setCurrentProject } from './store';
import type { ProjectBrief } from './brief';
import { Project, Provider, RoleId } from './types';
import { MonthlyUsage, setMonthlyUsage } from './usage';

export type Action =
  | { type: 'run' }
  | { type: 'replan' }
  | { type: 'room'; role: RoleId; text: string };

interface ServerState {
  rev: number;
  /** 요청한 프로젝트가 서버에 있으면 그 id, 없으면 null */
  projectId: string | null;
  project: Project | null;
  busy: Partial<Record<RoleId, boolean>>;
  projects: ProjectsInfo['list'];
  slots: ProjectsInfo['slots'];
  attention: { id: string; title: string; body: string; at: number } | null;
  usage: { month: string; byProvider: Record<Provider, MonthlyUsage> };
  siteBase?: string;
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

/** 새 시안 이미지, 문서 앞 페이지, 화면 캡처는 열기 전에 미리 받아 둡니다. */
const prefetched = new Set<string>();
function prefetchImages(p: Project) {
  for (const d of p.deliverables) {
    const ready = d.preview?.status === 'ready';
    const isImage = d.isBinary && d.mime.startsWith('image/') && !d.preview;
    if (!ready && !isImage) continue;
    const key = `${d.id}:${d.preview?.status ?? 'image'}`;
    if (prefetched.has(key)) continue;
    prefetched.add(key);
    const sources = docKind(d)
      ? [imageSource(d, 'thumb'), ...Array.from({ length: Math.min(3, d.preview?.pages ?? 0) }, (_, i) => pageSource(d, i + 1))]
      : [imageSource(d, 'thumb'), imageSource(d, 'preview')];
    for (const src of sources) {
      Image.prefetch(src.uri, { headers: src.headers, cachePolicy: 'disk' }).catch(() => prefetched.delete(key));
    }
  }
}

/** 보던 프로젝트가 없으면(처음이거나 지워짐) 이 기기에서 만든 최신 프로젝트, 없으면 가장 최근 것을 고릅니다. */
async function pickFallback(list: ServerState['projects']): Promise<string | null> {
  if (!list.length) return null;
  const me = (await thisDevice()).id;
  return (list.find((p) => p.device?.id === me) ?? list[0]).id;
}

function apply(s: ServerState) {
  rev = s.rev;
  projectsStore.set(() => ({ list: s.projects ?? [], slots: s.slots ?? { used: 0, max: 3, queued: 0 } }));
  setSiteBase(s.siteBase);
  const cur = currentIdStore.get();
  if (!s.project || s.projectId !== cur) {
    // 이 기기가 보던 프로젝트가 서버에 없으면 다른 것을 고릅니다 (고르면 다시 받아 옵니다).
    pickFallback(s.projects ?? []).then((id) => {
      if (id && id !== cur) setCurrentProject(id);
      else if (!id) {
        projectStore.set(() => emptyProject());
        busyStore.set(() => ({}));
      }
    });
  } else {
    projectStore.set(() => s.project!);
    busyStore.set(() => s.busy);
    prefetchImages(s.project);
  }
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
      const cur = currentIdStore.get();
      const s = await callServer<ServerState>(
        settings,
        `/v1/state?since=${rev}&wait=${wait}${cur ? `&project=${encodeURIComponent(cur)}` : ''}`,
        undefined,
        controller?.signal,
      );
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
  // 다른 프로젝트로 바꾸면 바로 그 프로젝트를 받아 옵니다.
  let lastCurrent = currentIdStore.get();
  currentIdStore.subscribe(() => {
    if (currentIdStore.get() !== lastCurrent) {
      lastCurrent = currentIdStore.get();
      restart();
    }
  });
  thisDevice().catch(() => {});
  pushSettings();
  restart();
}

/** 지금 보는 프로젝트에 일을 시킵니다. 서버는 바로 답하고 일은 뒤에서 계속합니다. */
export async function act(action: Action): Promise<void> {
  const project = currentIdStore.get();
  if (!project) throw new Error('먼저 프로젝트를 고르거나 새로 요청하세요.');
  await callServer(getSettings(), '/v1/action', { ...action, project });
}

/** 요청서로 새 프로젝트를 만들고, 이 기기에서 그 프로젝트를 봅니다. */
export async function createProject(request: string, brief: ProjectBrief): Promise<string> {
  const device = await thisDevice();
  const r = await callServer<{ project: string }>(getSettings(), '/v1/action', { type: 'start', request, brief, device });
  setCurrentProject(r.project);
  return r.project;
}

/** 프로젝트를 지웁니다 (일하는 중이 아닐 때만). */
export async function deleteProject(id: string): Promise<void> {
  await callServer(getSettings(), '/v1/action', { type: 'delete', project: id });
  if (currentIdStore.get() === id) setCurrentProject(null);
}
