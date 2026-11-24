// 여러 프로젝트 관리
// - 프로젝트마다 폴더 하나 (dataDir/projects/<id>/): 대화, 작업, 산출물
// - 동시 실행 자리: AI가 계획하거나 작업하는 프로젝트는 최대 MAX_ACTIVE개. 넘으면 대기열에서 순서를 기다림.
//   결재를 기다리는 프로젝트는 AI를 쓰지 않으므로 자리를 차지하지 않습니다.
// - 설정(역할별 모델), 이번 달 사용량, 최근 알림은 모든 프로젝트가 같이 씁니다.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { KINDS, normalizeBrief } from '../src/brief';
import { roleInfo, ROLES } from '../src/roles';
import type { Project, ProjectSummary, Provider } from '../src/types';
import type { ApkBuilder } from './apk';
import type { Documents } from './documents';
import { createOffice, defaultSettings, type Action, type Attention, type ChatFn, type ImageFn, type OfficeSettings } from './office';

export const MAX_ACTIVE = 3;

interface MonthlyUsage {
  input: number;
  output: number;
  requests: number;
}

interface UsageFile {
  month: string;
  byProvider: Record<Provider, MonthlyUsage>;
}

/** 알림 (어느 프로젝트의 일인지 함께) */
export interface ProjectAttention extends Attention {
  projectId: string;
  projectName: string;
}

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function emptyUsage(): UsageFile {
  const zero = (): MonthlyUsage => ({ input: 0, output: 0, requests: 0 });
  return { month: thisMonth(), byProvider: { claude: zero(), openai: zero() } };
}

function newProjectId(): string {
  return 'p' + Date.now().toString(36) + randomBytes(3).toString('hex');
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

type Office = ReturnType<typeof createOffice>;

export function createProjects(opts: {
  dataDir: string;
  chat: ChatFn;
  image: ImageFn;
  notify: (a: ProjectAttention) => void;
  onImageSaved?: (id: string) => void;
  docs?: Documents;
  apk?: ApkBuilder;
}) {
  const { dataDir } = opts;
  const root = join(dataDir, 'projects');

  function load<T>(name: string, fallback: T): T {
    try {
      const p = join(dataDir, name);
      return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : fallback;
    } catch {
      return fallback;
    }
  }
  function save(name: string, value: unknown) {
    const p = join(dataDir, name);
    writeFileSync(p + '.tmp', JSON.stringify(value));
    renameSync(p + '.tmp', p);
  }

  const saved = load<Partial<OfficeSettings>>('settings.json', {});
  let settings: OfficeSettings = { ...defaultSettings(), ...saved, roles: { ...defaultSettings().roles, ...(saved.roles ?? {}) } };
  let usage = load<UsageFile>('usage.json', emptyUsage());
  let attention = load<ProjectAttention | null>('attention.json', null);

  // ---------- 바뀌면 기다리던 요청에 알리기 ----------

  let rev = 1;
  const waiters = new Set<() => void>();
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function changed() {
    rev++;
    for (const w of waiters) w();
    waiters.clear();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        save('usage.json', usage);
        save('attention.json', attention);
      } catch (e) {
        console.error('[projects] 저장 실패', errorText(e));
      }
    }, 300);
  }

  // ---------- 동시 실행 자리 ----------

  const active = new Set<string>();
  const queue: { id: string; go: () => void }[] = [];
  const slots = {
    acquire(id: string, onWait: () => void): Promise<void> {
      if (active.has(id)) return Promise.resolve();
      if (active.size < MAX_ACTIVE) {
        active.add(id);
        changed();
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        queue.push({ id, go: resolve });
        onWait();
        changed();
      });
    },
    release(id: string) {
      active.delete(id);
      const next = queue.shift();
      if (next) {
        active.add(next.id);
        next.go();
      }
      changed();
    },
  };

  // ---------- 프로젝트 ----------

  const offices = new Map<string, Office>();

  function openOffice(id: string, initial?: Partial<Project>): Office {
    const dir = join(root, id);
    mkdirSync(dir, { recursive: true });
    const office = createOffice({
      id,
      dataDir: dir,
      initial,
      getSettings: () => settings,
      onUsage: recordUsage,
      onChange: changed,
      slots,
      chat: opts.chat,
      image: opts.image,
      docs: opts.docs,
      apk: opts.apk,
      onImageSaved: opts.onImageSaved,
      notify: (a) => {
        const p = office.project();
        attention = { ...a, projectId: id, projectName: nameOf(p) };
        changed();
        opts.notify(attention);
      },
    });
    offices.set(id, office);
    return office;
  }

  function recordUsage(provider: Provider, u?: { input?: number; output?: number }) {
    if (usage.month !== thisMonth()) usage = emptyUsage();
    const cur = usage.byProvider[provider];
    usage = {
      ...usage,
      byProvider: {
        ...usage.byProvider,
        [provider]: { input: cur.input + (u?.input ?? 0), output: cur.output + (u?.output ?? 0), requests: cur.requests + 1 },
      },
    };
    changed();
  }

  function nameOf(p: Project): string {
    return (p.brief?.name || p.request.replace(/^\[프로젝트 요청서\]\s*/, '').split('\n').find((l) => l.trim()) || '이름 없는 프로젝트').trim().slice(0, 40);
  }

  // 예전(프로젝트 하나) 데이터는 첫 프로젝트로 옮깁니다.
  function migrate() {
    const legacy = join(dataDir, 'project.json');
    if (!existsSync(legacy)) return;
    try {
      const p = JSON.parse(readFileSync(legacy, 'utf8')) as Project;
      if (p.request) {
        const id = newProjectId();
        const dir = join(root, id);
        mkdirSync(dir, { recursive: true });
        if (existsSync(join(dataDir, 'files'))) renameSync(join(dataDir, 'files'), join(dir, 'files'));
        writeFileSync(join(dir, 'project.json'), JSON.stringify(p));
        console.log(`[projects] 기존 프로젝트를 ${id}로 옮겼어요.`);
      }
      renameSync(legacy, legacy + '.moved');
    } catch (e) {
      console.error('[projects] 기존 프로젝트 옮기기 실패', errorText(e));
    }
  }

  mkdirSync(root, { recursive: true });
  migrate();
  for (const id of readdirSync(root)) {
    if (existsSync(join(root, id, 'project.json'))) openOffice(id);
  }
  // 멈췄던 프로젝트는 만든 순서대로 이어서 합니다 (자리가 없으면 대기열로).
  setTimeout(() => {
    [...offices.values()]
      .sort((a, b) => a.project().createdAt - b.project().createdAt)
      .forEach((o) => o.resume());
  }, 1000);

  function summary(o: Office): ProjectSummary {
    const p = o.project();
    const busy = o.busy();
    const running = p.tasks.find((t) => t.status === 'running');
    const working = ROLES.find((r) => busy[r.id]);
    const pos = queue.findIndex((q) => q.id === o.id);
    let activity = '';
    if (p.phase === 'queued') activity = `대기열 ${pos + 1}번째 · 자리가 나면 바로 시작`;
    else if (p.phase === 'planning') activity = 'PM 계획 중';
    else if (running) activity = `${roleInfo(running.role).name} · ${running.title}`;
    else if (working) activity = `${roleInfo(working.id).name} 답변 중`;
    else if (p.phase === 'awaiting_approval') activity = '계획 결재 대기';
    else if (p.phase === 'paused') {
      const failed = p.tasks.find((t) => t.status === 'failed');
      activity = failed ? `${roleInfo(failed.role).name} 작업이 멈췄어요` : '작업 결재 대기';
    } else if (p.phase === 'done') activity = '완료';
    else activity = '대기';
    const last = p.messages[p.messages.length - 1];
    return {
      id: o.id,
      name: nameOf(p),
      kind: KINDS.find((k) => k.id === p.brief?.kind)?.label ?? '프로젝트',
      phase: p.phase,
      ...(pos >= 0 ? { queuePos: pos + 1 } : {}),
      device: p.device,
      done: p.tasks.filter((t) => t.status === 'done').length,
      total: p.tasks.length,
      activity,
      createdAt: p.createdAt,
      updatedAt: last?.createdAt ?? p.createdAt,
    };
  }

  function list(): ProjectSummary[] {
    return [...offices.values()].map(summary).sort((a, b) => b.createdAt - a.createdAt);
  }

  function state(projectId?: string | null) {
    if (usage.month !== thisMonth()) usage = emptyUsage();
    const o = projectId ? offices.get(projectId) : undefined;
    const s = o?.state();
    return {
      rev,
      projectId: o ? o.id : null,
      project: s?.project ?? null,
      busy: s?.busy ?? {},
      projects: list(),
      slots: { used: active.size, max: MAX_ACTIVE, queued: queue.length },
      attention,
      usage,
    };
  }

  function get(id: unknown): Office {
    const o = typeof id === 'string' ? offices.get(id) : undefined;
    if (!o) throw new Error('프로젝트를 찾을 수 없어요. 목록을 새로 고쳐 주세요.');
    return o;
  }

  return {
    state,

    waitForChange(since: number, waitMs: number, projectId?: string | null) {
      if (since !== rev || waitMs <= 0) return Promise.resolve(state(projectId));
      return new Promise<ReturnType<typeof state>>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          waiters.delete(done);
          resolve(state(projectId));
        };
        const timer = setTimeout(done, waitMs);
        waiters.add(done);
      });
    },

    /** 요청서로 새 프로젝트를 만들고 PM 계획을 시작합니다 (자리가 없으면 대기열). */
    create(input: { request?: unknown; brief?: unknown; device?: unknown }) {
      const request = typeof input.request === 'string' ? input.request.trim() : '';
      if (!request) throw new Error('요청 내용이 비어 있어요.');
      const brief = normalizeBrief(input.brief);
      const dev = input.device as { id?: unknown; name?: unknown } | undefined;
      const device =
        dev && typeof dev.id === 'string' ? { id: dev.id.slice(0, 64), name: typeof dev.name === 'string' ? dev.name.slice(0, 60) : '기기' } : undefined;
      const id = newProjectId();
      const now = Date.now();
      const o = openOffice(id, {
        request,
        planSummary: '',
        tasks: [],
        phase: 'planning',
        messages: [{ id: 'm' + now.toString(36), role: 'pm', from: 'user', text: request, createdAt: now }],
        deliverables: [],
        createdAt: now,
        ...(brief ? { brief } : {}),
        ...(device ? { device } : {}),
      });
      o.flush();
      changed();
      o.plan();
      return id;
    },

    act(projectId: unknown, a: Action) {
      get(projectId).act(a);
    },

    /** 일하는 중이 아닌 프로젝트를 지웁니다 (산출물 파일도 함께). */
    remove(projectId: unknown) {
      const o = get(projectId);
      if (o.isActive()) throw new Error('일하는 중이거나 대기열에 있는 프로젝트는 지울 수 없어요.');
      offices.delete(o.id);
      rmSync(join(root, o.id), { recursive: true, force: true });
      changed();
    },

    settings: () => settings,

    setSettings(next: Partial<OfficeSettings>) {
      const roles = { ...settings.roles };
      for (const r of ROLES) {
        const m = next.roles?.[r.id];
        if (m && (m.provider === 'claude' || m.provider === 'openai')) {
          roles[r.id] = { provider: m.provider, model: typeof m.model === 'string' ? m.model : '' };
        }
      }
      settings = { stepApproval: typeof next.stepApproval === 'boolean' ? next.stepApproval : settings.stepApproval, roles };
      save('settings.json', settings);
      changed();
      return settings;
    },

    /** 산출물 파일 (어느 프로젝트에 있든 id로 찾음) */
    file(id: string) {
      for (const o of offices.values()) {
        const f = o.file(id);
        if (f) return f;
      }
      return null;
    },

    siteFile(projectId: string, role: string, sub: string): string | null {
      return offices.get(projectId)?.siteFile(role, sub) ?? null;
    },
  };
}
