// 나만의사무실 AI 팀 엔진 (서버에서 실행)
// 폰 앱이 꺼져 있어도 PM 계획 → 결재 → 작업 실행 → 결재를 서버가 이어서 진행하고,
// 결재가 필요해지면 notify()로 알립니다. 프로젝트·산출물·설정은 dataDir에 저장합니다.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { mimeFor, parseReply } from '../src/reply';
import { isWorkerRole, roleInfo, ROLES, systemPrompt } from '../src/roles';
import type { ChatMessage, Deliverable, Project, ProjectPhase, Provider, RoleId, RoleModel, Task } from '../src/types';

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type ChatFn = (p: {
  provider: Provider;
  model: string;
  system: string;
  messages: LlmMessage[];
}) => Promise<{ text: string; usage?: { input?: number; output?: number } }>;

export type ImageFn = (prompt: string) => Promise<{ base64: string; usage?: { input?: number; output?: number } }>;

/** 대표에게 알릴 일 하나. id가 바뀌면 새 알림입니다. */
export interface Attention {
  id: string;
  title: string;
  body: string;
  at: number;
}

export interface OfficeSettings {
  stepApproval: boolean;
  roles: Record<RoleId, RoleModel>;
}

interface MonthlyUsage {
  input: number;
  output: number;
  requests: number;
}

interface UsageFile {
  month: string;
  byProvider: Record<Provider, MonthlyUsage>;
}

export interface OfficeState {
  rev: number;
  project: Project;
  busy: Partial<Record<RoleId, boolean>>;
  attention: Attention | null;
  usage: UsageFile;
}

export type Action =
  | { type: 'start'; request: string }
  | { type: 'run' }
  | { type: 'replan' }
  | { type: 'reset' }
  | { type: 'room'; role: RoleId; text: string };

const MAX_FILE_CHARS = 12000;
const MAX_CONTEXT_CHARS = 60000;
const HISTORY_LIMIT = 20;

function newId(): string {
  return Date.now().toString(36) + randomBytes(4).toString('hex');
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function emptyProject(): Project {
  return { request: '', planSummary: '', tasks: [], phase: 'idle', messages: [], deliverables: [], createdAt: Date.now() };
}

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function emptyUsage(): UsageFile {
  const zero = (): MonthlyUsage => ({ input: 0, output: 0, requests: 0 });
  return { month: thisMonth(), byProvider: { claude: zero(), openai: zero() } };
}

function defaultSettings(): OfficeSettings {
  const roles = {} as Record<RoleId, RoleModel>;
  for (const r of ROLES) roles[r.id] = { provider: r.id === 'designer' ? 'openai' : 'claude', model: '' };
  return { stepApproval: true, roles };
}

function statusLabel(s: Task['status']): string {
  return { pending: '대기', running: '진행 중', done: '완료', failed: '실패' }[s];
}

export function createOffice(opts: { dataDir: string; chat: ChatFn; image: ImageFn; notify: (a: Attention) => void }) {
  const { dataDir } = opts;
  const filesDir = join(dataDir, 'files');
  mkdirSync(filesDir, { recursive: true });

  function load<T>(name: string, fallback: T): T {
    try {
      const p = join(dataDir, name);
      return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : fallback;
    } catch (e) {
      console.error(`[office] ${name} 읽기 실패`, errorText(e));
      return fallback;
    }
  }

  function save(name: string, value: unknown) {
    const p = join(dataDir, name);
    writeFileSync(p + '.tmp', JSON.stringify(value));
    renameSync(p + '.tmp', p);
  }

  let project: Project = { ...emptyProject(), ...load<Partial<Project>>('project.json', {}) };
  const savedSettings = load<Partial<OfficeSettings>>('settings.json', {});
  let settings: OfficeSettings = {
    ...defaultSettings(),
    ...savedSettings,
    roles: { ...defaultSettings().roles, ...(savedSettings.roles ?? {}) },
  };
  let usage = load<UsageFile>('usage.json', emptyUsage());
  let attention = load<Attention | null>('attention.json', null);
  let busy: Partial<Record<RoleId, boolean>> = {};
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
        save('project.json', project);
        save('usage.json', usage);
        save('attention.json', attention);
      } catch (e) {
        console.error('[office] 저장 실패', errorText(e));
      }
    }, 300);
  }

  function setProject(update: (p: Project) => Project) {
    project = update(project);
    changed();
  }

  function setPhase(phase: ProjectPhase) {
    setProject((p) => ({ ...p, phase }));
  }

  function updateTask(id: string, patch: Partial<Task>) {
    setProject((p) => ({ ...p, tasks: p.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)) }));
  }

  function setBusy(role: RoleId, value: boolean) {
    busy = { ...busy, [role]: value };
    changed();
  }

  function addMessage(msg: Omit<ChatMessage, 'id' | 'createdAt'>): ChatMessage {
    const full: ChatMessage = { ...msg, id: newId(), createdAt: Date.now() };
    setProject((p) => ({ ...p, messages: [...p.messages, full] }));
    return full;
  }

  function alert(title: string, body: string) {
    attention = { id: newId(), title, body, at: Date.now() };
    changed();
    try {
      opts.notify(attention);
    } catch (e) {
      console.error('[office] 알림 실패', errorText(e));
    }
  }

  function recordUsage(provider: Provider, u?: { input?: number; output?: number }) {
    if (usage.month !== thisMonth()) usage = emptyUsage();
    const cur = usage.byProvider[provider];
    usage = {
      ...usage,
      byProvider: {
        ...usage.byProvider,
        [provider]: {
          input: cur.input + (u?.input ?? 0),
          output: cur.output + (u?.output ?? 0),
          requests: cur.requests + 1,
        },
      },
    };
    changed();
  }

  // ---------- 산출물 ----------

  function filePath(d: Deliverable): string {
    return join(dataDir, d.uri);
  }

  function upsert(d: Deliverable): Deliverable {
    setProject((p) => ({
      ...p,
      deliverables: [...p.deliverables.filter((x) => !(x.role === d.role && x.name === d.name)), d],
    }));
    return d;
  }

  function writeDeliverable(role: RoleId, name: string, data: Buffer, isBinary: boolean, taskId?: string): Deliverable {
    const dir = join(filesDir, role);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, name), data);
    return upsert({
      id: newId(),
      role,
      name,
      mime: mimeFor(name),
      uri: `files/${role}/${name}`,
      isBinary,
      size: data.length,
      taskId,
      createdAt: Date.now(),
    });
  }

  function saveText(role: RoleId, name: string, content: string, taskId?: string): Deliverable {
    // A BOM lets Excel open Korean CSV files without broken characters.
    const body = name.toLowerCase().endsWith('.csv') && !content.startsWith('﻿') ? '﻿' + content : content;
    return writeDeliverable(role, name, Buffer.from(body, 'utf8'), false, taskId);
  }

  function readText(d: Deliverable): string {
    const text = readFileSync(filePath(d), 'utf8');
    return text.startsWith('﻿') ? text.slice(1) : text;
  }

  // ---------- 에이전트 ----------

  /** The shared spec store every agent reads: request, plan, and the latest deliverables. */
  function buildContext(): string {
    const p = project;
    const lines: string[] = [];
    lines.push(`[대표의 프로젝트 요청]\n${p.request || '(아직 없음)'}`);
    if (p.planSummary) lines.push(`[PM 계획 요약]\n${p.planSummary}`);
    if (p.tasks.length) {
      lines.push(
        '[작업 목록]\n' +
          p.tasks.map((t, i) => `${i + 1}. (${roleInfo(t.role).name}) ${t.title} — ${statusLabel(t.status)}`).join('\n'),
      );
    }
    const texts = p.deliverables.filter((d) => !d.isBinary).sort((a, b) => b.createdAt - a.createdAt);
    const images = p.deliverables.filter((d) => d.isBinary);
    let budget = MAX_CONTEXT_CHARS;
    const blocks: string[] = [];
    for (const d of texts) {
      if (budget <= 0) {
        blocks.push(`### ${d.name} (${roleInfo(d.role).name}) — 분량 초과로 생략`);
        continue;
      }
      let body = '';
      try {
        body = readText(d);
      } catch {
        body = '(파일을 읽지 못했습니다)';
      }
      const limit = Math.min(MAX_FILE_CHARS, budget);
      if (body.length > limit) body = body.slice(0, limit) + '\n...(이하 생략)';
      budget -= body.length;
      blocks.push(`### 파일: ${d.name} (작성: ${roleInfo(d.role).name})\n${body}`);
    }
    for (const d of images) blocks.push(`### 이미지: ${d.name} (작성: ${roleInfo(d.role).name})`);
    if (blocks.length) lines.push('[현재까지의 산출물]\n' + blocks.reverse().join('\n\n'));
    return lines.join('\n\n');
  }

  async function callAgent(role: RoleId, messages: LlmMessage[]): Promise<string> {
    const rm = settings.roles[role];
    setBusy(role, true);
    try {
      const r = await opts.chat({ provider: rm.provider, model: rm.model, system: systemPrompt(role), messages });
      recordUsage(rm.provider, r.usage);
      return r.text;
    } finally {
      setBusy(role, false);
    }
  }

  function roomHistory(role: RoleId): LlmMessage[] {
    return project.messages
      .filter((m) => m.role === role && !m.error)
      .slice(-HISTORY_LIMIT)
      .map((m) => ({
        role: m.from === 'agent' ? 'assistant' : 'user',
        content: m.from === 'system' ? `[PM 지시]\n${m.text}` : m.text,
      }));
  }

  /** Saves files and images from a reply and posts the remaining text to the room. */
  async function handleReply(role: RoleId, reply: string, taskId?: string) {
    const parsed = parseReply(reply);
    const saved: Deliverable[] = [];
    const notes: string[] = [];
    for (const f of parsed.files) {
      try {
        saved.push(saveText(role, f.name, f.content, taskId));
      } catch (e) {
        notes.push(`(${f.name} 저장 실패: ${errorText(e)})`);
      }
    }
    for (let i = 0; i < parsed.imagePrompts.length; i++) {
      setBusy(role, true);
      try {
        const img = await opts.image(parsed.imagePrompts[i]);
        recordUsage('openai', img.usage);
        saved.push(writeDeliverable(role, `디자인시안_${i + 1}.png`, Buffer.from(img.base64, 'base64'), true, taskId));
      } catch (e) {
        notes.push(`(시안 이미지 ${i + 1} 생성 실패: ${errorText(e)})`);
      } finally {
        setBusy(role, false);
      }
    }
    const text = [parsed.text || (saved.length ? '산출물을 작성했습니다.' : '(빈 응답)'), ...notes]
      .filter(Boolean)
      .join('\n\n');
    addMessage({ role, from: 'agent', text, files: saved.map((d) => d.id) });
    return parsed;
  }

  interface PlanJson {
    summary?: string;
    tasks?: { role?: string; title?: string; instructions?: string }[];
  }

  function parsePlan(json: string | undefined, raw: string): PlanJson | null {
    const candidates: string[] = [];
    if (json) candidates.push(json);
    const fenced = raw.match(/```json\s*\n([\s\S]*?)```/);
    if (fenced) candidates.push(fenced[1]);
    for (const c of candidates) {
      try {
        const parsed = JSON.parse(c.slice(c.indexOf('{'), c.lastIndexOf('}') + 1)) as PlanJson;
        if (Array.isArray(parsed.tasks)) return parsed;
      } catch {
        // try next candidate
      }
    }
    return null;
  }

  function formatPlan(tasks: Task[]): string {
    return tasks.map((t, i) => `${i + 1}. [${roleInfo(t.role).name}] ${t.title}\n   ${t.instructions}`).join('\n');
  }

  /** Talk to the PM. Any PLAN it returns is queued for the user's approval. */
  async function askPm(userText: string, isNewProject: boolean) {
    const context = buildContext();
    const history = isNewProject ? [] : roomHistory('pm').slice(0, -1);
    const reply = await callAgent('pm', [
      { role: 'user', content: `${context}\n\n위 프로젝트 맥락을 참고하세요.` },
      { role: 'assistant', content: '맥락을 확인했습니다.' },
      ...history,
      { role: 'user', content: userText },
    ]);
    const parsed = parseReply(reply);
    const plan = parsePlan(parsed.planJson, reply);
    const newTasks: Task[] = (plan?.tasks ?? [])
      .filter((t) => t.role && isWorkerRole(t.role) && t.title)
      .map((t) => ({
        id: newId(),
        role: t.role as Task['role'],
        title: String(t.title),
        instructions: String(t.instructions ?? ''),
        status: 'pending' as const,
      }));

    let text = parsed.text;
    if (newTasks.length) {
      setProject((p) => ({
        ...p,
        planSummary: isNewProject || !p.planSummary ? plan?.summary ?? '' : p.planSummary,
        tasks: [...p.tasks, ...newTasks],
        phase: 'awaiting_approval',
      }));
      text = [text, `작업 ${newTasks.length}개를 계획했습니다. 홈 화면에서 승인하면 실행합니다.`, formatPlan(newTasks)]
        .filter(Boolean)
        .join('\n\n');
    } else if (isNewProject) {
      setPhase('idle');
    }
    for (const f of parsed.files) saveText('pm', f.name, f.content);
    addMessage({ role: 'pm', from: 'agent', text: text || '(빈 응답)' });
    if (newTasks.length) alert('계획 결재가 필요해요', `PM이 작업 ${newTasks.length}개를 계획했어요. 승인하면 시작해요.`);
    return newTasks.length;
  }

  async function startProject(request: string) {
    setProject(() => ({ ...emptyProject(), request, phase: 'planning' }));
    addMessage({ role: 'pm', from: 'user', text: request });
    try {
      await askPm(`[대표 요청]\n${request}\n\n이 요청을 팀원에게 나눠 할당하는 계획을 PLAN 형식으로 작성하세요.`, true);
    } catch (e) {
      setPhase('idle');
      addMessage({ role: 'pm', from: 'agent', text: `계획 작성 실패: ${errorText(e)}`, error: true });
      alert('계획을 만들지 못했어요', errorText(e).slice(0, 120));
    }
  }

  async function replan() {
    setProject((p) => ({ ...p, tasks: p.tasks.filter((t) => t.status !== 'pending'), phase: 'planning' }));
    const msg = '대기 중인 작업을 지우고 계획을 다시 작성해 주세요.';
    addMessage({ role: 'pm', from: 'user', text: msg });
    try {
      await askPm(msg + ' 완료된 작업은 그대로 두고, 남은 작업만 PLAN에 넣으세요.', false);
    } catch (e) {
      setPhase(project.tasks.length ? 'paused' : 'idle');
      addMessage({ role: 'pm', from: 'agent', text: `계획 작성 실패: ${errorText(e)}`, error: true });
    }
    if (project.phase === 'planning') {
      setPhase(project.tasks.some((t) => t.status === 'pending') ? 'awaiting_approval' : 'done');
    }
  }

  let loopRunning = false;

  async function runTask(task: Task) {
    updateTask(task.id, { status: 'running', error: undefined });
    addMessage({ role: task.role, from: 'system', text: `PM이 작업을 할당했습니다: ${task.title}\n\n${task.instructions}` });
    try {
      const reply = await callAgent(task.role, [
        {
          role: 'user',
          content: `${buildContext()}\n\n[이번에 할당된 작업]\n${task.title}\n\n${task.instructions}\n\n산출물은 규칙에 맞춰 파일로 작성하세요.`,
        },
      ]);
      await handleReply(task.role, reply, task.id);
      updateTask(task.id, { status: 'done' });
    } catch (e) {
      updateTask(task.id, { status: 'failed', error: errorText(e) });
      addMessage({ role: task.role, from: 'agent', text: `작업 실패: ${errorText(e)}`, error: true });
    }
  }

  async function pmSummary() {
    try {
      const reply = await callAgent('pm', [
        {
          role: 'user',
          content: `${buildContext()}\n\n모든 작업이 끝났습니다. 대표에게 결과를 5줄 이내로 보고하고 확인이 필요한 점을 짚어 주세요. PLAN은 쓰지 마세요.`,
        },
      ]);
      addMessage({ role: 'pm', from: 'agent', text: parseReply(reply).text });
    } catch (e) {
      addMessage({ role: 'pm', from: 'agent', text: `완료 보고 작성 실패: ${errorText(e)}`, error: true });
    }
  }

  /** Runs pending tasks in order. Stops after a failure, or after each task when step approval is on. */
  async function runTasks() {
    if (loopRunning) return;
    loopRunning = true;
    setPhase('running');
    try {
      setProject((p) => ({ ...p, tasks: p.tasks.map((t) => (t.status === 'failed' ? { ...t, status: 'pending' } : t)) }));
      while (true) {
        const next = project.tasks.find((t) => t.status === 'pending');
        if (!next) {
          setPhase('done');
          addMessage({ role: 'pm', from: 'system', text: '모든 작업이 끝났습니다.' });
          await pmSummary();
          alert('프로젝트가 끝났어요', 'PM의 완료 보고와 산출물을 확인해 주세요.');
          return;
        }
        await runTask(next);
        const failed = project.tasks.find((t) => t.id === next.id)?.status === 'failed';
        const who = roleInfo(next.role).name;
        if (failed) {
          setPhase('paused');
          addMessage({ role: 'pm', from: 'system', text: `"${next.title}" 작업이 실패해 멈췄습니다. 홈에서 다시 시도할 수 있습니다.` });
          alert(`${who} 작업이 멈췄어요`, `"${next.title}" 작업이 실패했어요. 다시 시도할 수 있어요.`);
          return;
        }
        if (settings.stepApproval && project.tasks.some((t) => t.status === 'pending')) {
          setPhase('paused');
          addMessage({ role: 'pm', from: 'system', text: `"${next.title}" 완료. 결과를 확인하고 홈에서 다음 작업을 승인하세요.` });
          alert('결재가 필요해요', `${who}가 "${next.title}"을 마쳤어요. 확인하고 다음 작업을 승인해 주세요.`);
          return;
        }
      }
    } finally {
      loopRunning = false;
    }
  }

  /** A message the user types in a room. */
  async function sendToRoom(role: RoleId, text: string) {
    if (busy[role]) return;
    if (role === 'pm' && !project.request) return startProject(text);
    addMessage({ role, from: 'user', text });
    const name = roleInfo(role).name;
    try {
      if (role === 'pm') {
        await askPm(text, false);
      } else {
        const reply = await callAgent(role, [
          { role: 'user', content: `${buildContext()}\n\n위 프로젝트 맥락을 참고하세요.` },
          { role: 'assistant', content: '맥락을 확인했습니다.' },
          ...roomHistory(role),
        ]);
        const parsed = await handleReply(role, reply);
        alert(`${name}의 답장`, (parsed.text || '산출물을 작성했습니다.').slice(0, 120));
      }
    } catch (e) {
      addMessage({ role, from: 'agent', text: `응답 실패: ${errorText(e)}`, error: true });
    }
  }

  function reset() {
    if (loopRunning || Object.values(busy).some(Boolean)) throw new Error('팀원이 일하는 중에는 새로 시작할 수 없어요.');
    setProject(() => emptyProject());
  }

  // ---------- 서버가 다시 켜졌을 때 ----------

  const wasRunning = project.phase === 'running';
  project = {
    ...project,
    tasks: project.tasks.map((t) => (t.status === 'running' ? { ...t, status: 'pending' } : t)),
    phase:
      project.phase === 'planning' ? (project.tasks.length ? 'awaiting_approval' : 'idle') : project.phase,
  };
  if (wasRunning) {
    console.log('[office] 중단된 작업을 이어서 실행합니다.');
    setTimeout(() => runTasks().catch((e) => console.error('[office]', e)), 1000);
  }

  // ---------- 바깥에 여는 함수 ----------

  function state(): OfficeState {
    if (usage.month !== thisMonth()) usage = emptyUsage();
    return { rev, project, busy, attention, usage };
  }

  return {
    state,

    /** since와 rev가 같으면 바뀔 때까지(최대 waitMs) 기다렸다가 상태를 돌려줍니다. */
    waitForChange(since: number, waitMs: number): Promise<OfficeState> {
      if (since !== rev || waitMs <= 0) return Promise.resolve(state());
      return new Promise((resolve) => {
        const done = () => {
          clearTimeout(timer);
          waiters.delete(done);
          resolve(state());
        };
        const timer = setTimeout(done, waitMs);
        waiters.add(done);
      });
    },

    /** 바로 응답하고, 작업은 뒤에서 계속합니다. */
    act(a: Action) {
      const run = (p: Promise<unknown>) => p.catch((e) => console.error('[office]', e));
      switch (a.type) {
        case 'start':
          if (!a.request?.trim()) throw new Error('요청 내용이 비어 있어요.');
          if (busy.pm) throw new Error('PM이 다른 일을 하는 중이에요.');
          run(startProject(a.request.trim()));
          return;
        case 'run':
          if (!project.tasks.some((t) => t.status === 'pending' || t.status === 'failed')) throw new Error('실행할 작업이 없어요.');
          run(runTasks());
          return;
        case 'replan':
          if (busy.pm || loopRunning) throw new Error('작업 중에는 다시 계획할 수 없어요.');
          run(replan());
          return;
        case 'reset':
          reset();
          return;
        case 'room':
          if (!a.text?.trim() || !ROLES.some((r) => r.id === a.role)) throw new Error('메시지를 확인해 주세요.');
          run(sendToRoom(a.role, a.text.trim()));
          return;
        default:
          throw new Error('알 수 없는 요청이에요.');
      }
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
      settings = {
        stepApproval: typeof next.stepApproval === 'boolean' ? next.stepApproval : settings.stepApproval,
        roles,
      };
      save('settings.json', settings);
      return settings;
    },

    /** 산출물 파일 (없으면 null) */
    file(id: string): { path: string; mime: string; name: string; size: number } | null {
      const d = project.deliverables.find((x) => x.id === id);
      if (!d) return null;
      const path = filePath(d);
      if (!existsSync(path)) return null;
      return { path, mime: d.mime, name: d.name, size: statSync(path).size };
    },
  };
}
