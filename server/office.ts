// 나만의사무실 AI 팀 엔진 (서버에서 실행): 프로젝트 하나를 맡습니다.
// 폰 앱이 꺼져 있어도 PM 계획 → 결재 → 작업 실행 → 결재를 서버가 이어서 진행하고,
// 결재가 필요해지면 notify()로 알립니다. 프로젝트·산출물은 dataDir(프로젝트 폴더)에 저장합니다.
// 여러 프로젝트와 동시 실행 자리(최대 3개)는 projects.ts가 관리합니다.

import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { mimeFor, parseReply } from '../src/reply';
import { docKind, type Documents } from './documents';
import { BuildError, errorSummary, type ApkBuilder } from './apk';
import { wantsApk } from '../src/brief';
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

/** 동시 실행 자리. 자리가 없으면 onWait를 부르고 자리가 날 때까지 기다립니다. */
export interface Slots {
  acquire(id: string, onWait: () => void): Promise<void>;
  release(id: string): void;
}

export type Action =
  | { type: 'run' }
  | { type: 'replan' }
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

export function defaultSettings(): OfficeSettings {
  const roles = {} as Record<RoleId, RoleModel>;
  for (const r of ROLES) roles[r.id] = { provider: r.id === 'designer' ? 'openai' : 'claude', model: '' };
  return { stepApproval: true, roles };
}

function statusLabel(s: Task['status']): string {
  return { pending: '대기', running: '진행 중', done: '완료', failed: '실패' }[s];
}

export function createOffice(opts: {
  /** 프로젝트 id와 폴더 */
  id: string;
  dataDir: string;
  /** 처음 만들 때의 프로젝트 (없으면 폴더에서 읽음) */
  initial?: Partial<Project>;
  getSettings: () => OfficeSettings;
  onUsage: (provider: Provider, u?: { input?: number; output?: number }) => void;
  onChange: () => void;
  slots: Slots;
  chat: ChatFn;
  image: ImageFn;
  notify: (a: Attention) => void;
  /** 이미지가 저장되면 불립니다 (미리보기를 미리 만들어 둠). */
  onImageSaved?: (id: string) => void;
  /** Word·Excel·PPT 만들기와 미리보기. 없으면 Markdown 그대로 둡니다. */
  docs?: Documents;
  /** 개발자 코드로 APK 빌드 */
  apk?: ApkBuilder;
}) {
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

  let project: Project = { ...emptyProject(), ...(opts.initial ?? load<Partial<Project>>('project.json', {})) };
  let busy: Partial<Record<RoleId, boolean>> = {};
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const settings = () => opts.getSettings();

  function saveNow() {
    try {
      save('project.json', project);
    } catch (e) {
      console.error('[office] 저장 실패', errorText(e));
    }
  }

  function changed() {
    opts.onChange();
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 300);
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
    try {
      opts.notify({ id: newId(), title, body, at: Date.now() });
    } catch (e) {
      console.error('[office] 알림 실패', errorText(e));
    }
  }

  const recordUsage = (provider: Provider, u?: { input?: number; output?: number }) => opts.onUsage(provider, u);

  /** AI가 오래 일하는 동안(계획·작업 실행) 동시 실행 자리를 차지합니다. 자리가 없으면 대기열에서 기다립니다. */
  async function withSlot(work: () => Promise<void>) {
    await opts.slots.acquire(opts.id, () => setPhase('queued'));
    try {
      await work();
    } finally {
      opts.slots.release(opts.id);
    }
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
    const d = upsert({
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
    if (isBinary) opts.onImageSaved?.(d.id);
    return d;
  }

  function saveText(role: RoleId, name: string, content: string, taskId?: string): Deliverable {
    // A BOM lets Excel open Korean CSV files without broken characters.
    const body = name.toLowerCase().endsWith('.csv') && !content.startsWith('﻿') ? '﻿' + content : content;
    return writeDeliverable(role, name, Buffer.from(body, 'utf8'), false, taskId);
  }

  function readText(d: Deliverable): string {
    const text = readFileSync(d.source ? join(dataDir, d.source) : filePath(d), 'utf8');
    return text.startsWith('﻿') ? text.slice(1) : text;
  }

  // ---------- Word·Excel·PPT와 미리보기 ----------

  function patchDeliverable(id: string, patch: Partial<Deliverable>) {
    if (!project.deliverables.some((d) => d.id === id)) return;
    setProject((p) => ({ ...p, deliverables: p.deliverables.map((d) => (d.id === id ? { ...d, ...patch } : d)) }));
  }

  /** 문서 안의 ![](파일명)을 실제 이미지 경로로 바꿉니다. HTML 화면은 캡처해서 넣습니다. */
  async function resolveImage(ref: string): Promise<string | null> {
    const name = decodeURIComponent(basename(ref.split(/[?#]/)[0]));
    const candidates = project.deliverables.filter((d) => d.name === name || d.name === name.replace(/\s+/g, '_'));
    const d = candidates.sort((a, b) => b.createdAt - a.createdAt)[0];
    if (!d) return null;
    if (d.mime.startsWith('image/') && d.mime !== 'image/svg+xml') return filePath(d);
    if (d.mime === 'text/html' && opts.docs) return opts.docs.screenshot(d.id, filePath(d));
    return null;
  }

  function previewLater(d: Deliverable) {
    const docs = opts.docs;
    if (!docs) return;
    const job = docKind(d.name) ? docs.preview(d.id, filePath(d)) : docs.screenshot(d.id, filePath(d)).then((p) => (p ? 1 : Promise.reject(new Error('화면을 캡처하지 못했어요.'))));
    job.then(
      (pages) => patchDeliverable(d.id, { preview: { status: 'ready', pages } }),
      (e) => {
        console.error(`[docs] ${d.name} 미리보기 실패:`, errorText(e));
        patchDeliverable(d.id, { preview: { status: 'failed', error: errorText(e).slice(0, 200) } });
      },
    );
  }

  /** Markdown 원본으로 Word·Excel·PPT 산출물을 만듭니다. */
  async function saveDocument(role: RoleId, name: string, markdown: string, taskId?: string): Promise<Deliverable> {
    const kind = docKind(name)!;
    const docs = opts.docs;
    if (!docs) return saveText(role, name.replace(/\.\w+$/, '.md'), markdown, taskId);
    const srcDir = join(filesDir, role, '.src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, `${name}.md`), markdown);
    const out = join(filesDir, role, name);
    await docs.build(kind, markdown, out, {
      title: name.replace(/\.\w+$/, ''),
      resourceDirs: ROLES.map((r) => join(filesDir, r.id)),
      resolveImage,
    });
    const d = upsert({
      id: newId(),
      role,
      name,
      mime: mimeFor(name),
      uri: `files/${role}/${name}`,
      isBinary: true,
      size: statSync(out).size,
      taskId,
      createdAt: Date.now(),
      source: `files/${role}/.src/${name}.md`,
      preview: docs.canPreview() ? { status: 'pending' } : { status: 'failed', error: 'PDF 미리보기 도구가 설치되지 않았어요.' },
    });
    if (docs.canPreview()) previewLater(d);
    return d;
  }

  /** 새 화면·이미지가 생기면, 그 파일을 넣은 문서(예: 화면설계서.pptx)를 다시 만듭니다. */
  async function refreshDependents(names: string[]) {
    if (!opts.docs || !names.length) return;
    for (const d of project.deliverables.filter((x) => x.source && docKind(x.name))) {
      let md = '';
      try {
        md = readFileSync(join(dataDir, d.source!), 'utf8');
      } catch {
        continue;
      }
      if (!names.some((n) => md.includes(n))) continue;
      try {
        await saveDocument(d.role, d.name, md, d.taskId);
        console.log(`[docs] ${d.name}에 새 화면을 반영했어요.`);
      } catch (e) {
        console.error(`[docs] ${d.name} 다시 만들기 실패:`, errorText(e));
      }
    }
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
    const texts = p.deliverables.filter((d) => !d.isBinary || d.source).sort((a, b) => b.createdAt - a.createdAt);
    const images = p.deliverables.filter((d) => d.isBinary && !d.source);
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
    const rm = settings().roles[role];
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
    const screens: Deliverable[] = [];
    for (const f of parsed.files) {
      try {
        if (docKind(f.name)) {
          setBusy(role, true);
          try {
            saved.push(await saveDocument(role, f.name, f.content, taskId));
          } finally {
            setBusy(role, false);
          }
        } else {
          const d = saveText(role, f.name, f.content, taskId);
          if (d.mime === 'text/html' && opts.docs) {
            patchDeliverable(d.id, { preview: { status: 'pending' } });
            screens.push(d);
          }
          saved.push(d);
        }
      } catch (e) {
        // 변환에 실패해도 내용은 Markdown으로 남깁니다.
        notes.push(`(${f.name} 만들기 실패: ${errorText(e)})`);
        if (docKind(f.name)) {
          try {
            saved.push(saveText(role, f.name.replace(/\.\w+$/, '.md'), f.content, taskId));
          } catch {
            // 무시
          }
        }
      }
    }
    // CSS·JS까지 모두 저장한 뒤에 화면을 캡처합니다.
    for (const d of screens) previewLater(d);
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
    await refreshDependents(saved.filter((d) => !d.source).map((d) => d.name));
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
    for (const f of parsed.files) {
      try {
        if (docKind(f.name)) await saveDocument('pm', f.name, f.content);
        else saveText('pm', f.name, f.content);
      } catch (e) {
        console.error('[office] PM 파일 저장 실패', errorText(e));
      }
    }
    addMessage({ role: 'pm', from: 'agent', text: text || '(빈 응답)' });
    if (newTasks.length) alert('계획 결재가 필요해요', `PM이 작업 ${newTasks.length}개를 계획했어요. 승인하면 시작해요.`);
    return newTasks.length;
  }

  /** 첫 계획. 요청 메시지는 프로젝트를 만들 때 이미 들어가 있습니다. */
  async function planProject() {
    await withSlot(async () => {
      setPhase('planning');
      try {
        await askPm(`[대표 요청]\n${project.request}\n\n이 요청을 팀원에게 나눠 할당하는 계획을 PLAN 형식으로 작성하세요.`, true);
      } catch (e) {
        setPhase('idle');
        addMessage({ role: 'pm', from: 'agent', text: `계획 작성 실패: ${errorText(e)}`, error: true });
        alert('계획을 만들지 못했어요', errorText(e).slice(0, 120));
      }
    });
  }

  async function replan() {
    setProject((p) => ({ ...p, tasks: p.tasks.filter((t) => t.status !== 'pending') }));
    const msg = '대기 중인 작업을 지우고 계획을 다시 작성해 주세요.';
    addMessage({ role: 'pm', from: 'user', text: msg });
    await withSlot(async () => {
      setPhase('planning');
      try {
        await askPm(msg + ' 완료된 작업은 그대로 두고, 남은 작업만 PLAN에 넣으세요.', false);
      } catch (e) {
        setPhase(project.tasks.length ? 'paused' : 'idle');
        addMessage({ role: 'pm', from: 'agent', text: `계획 작성 실패: ${errorText(e)}`, error: true });
      }
      if (project.phase === 'planning') {
        setPhase(project.tasks.some((t) => t.status === 'pending') ? 'awaiting_approval' : 'done');
      }
    });
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
      if (task.role === 'developer' && wantsApk(project.brief)) await buildApkWithFixes(task);
      updateTask(task.id, { status: 'done' });
    } catch (e) {
      updateTask(task.id, { status: 'failed', error: errorText(e) });
      addMessage({ role: task.role, from: 'agent', text: `작업 실패: ${errorText(e)}`, error: true });
    }
  }

  // ---------- APK 빌드 ----------

  const MAX_BUILDS = 3;

  /** 개발자 코드로 APK를 빌드합니다. 실패하면 오류를 개발자에게 보내 고치게 하고 다시 빌드합니다. */
  async function buildApkWithFixes(task: Task) {
    const builder = opts.apk;
    const reason = builder ? builder.unavailable() : '서버에 APK 빌드 기능이 없어요.';
    if (!builder || reason) {
      addMessage({ role: 'developer', from: 'system', text: `APK를 만들 수 없어요: ${reason}` });
      alert('APK를 만들 수 없어요', reason ?? '');
      return;
    }
    const appName = (project.brief?.name || '내 앱').slice(0, 30);
    const packageId = `com.myoffice.p${project.createdAt.toString(36)}`;
    for (let attempt = 1; attempt <= MAX_BUILDS; attempt++) {
      const files = project.deliverables
        .filter((d) => d.role === 'developer' && !d.isBinary)
        .map((d) => ({ name: d.name, path: filePath(d) }));
      addMessage({ role: 'developer', from: 'system', text: `APK 빌드 중… (${attempt}/${MAX_BUILDS}) 처음에는 10분 정도 걸릴 수 있어요.` });
      setBusy('developer', true);
      let failure: BuildError | Error;
      try {
        const r = await builder.build({ files, appName, packageId });
        const d = writeDeliverable('developer', `${appName.replace(/[\\/:*?"<>|\s]+/g, '_')}.apk`, readFileSync(r.apk), true, task.id);
        addMessage({
          role: 'developer',
          from: 'agent',
          text: `설치 파일(APK)을 만들었어요. 빌드 ${Math.ceil(r.seconds / 60)}분. 산출물에서 "설치"를 누르면 폰에 깔려요.`,
          files: [d.id],
        });
        return;
      } catch (e) {
        failure = e instanceof Error ? e : new Error(String(e));
      } finally {
        setBusy('developer', false);
      }
      const log = failure instanceof BuildError ? errorSummary(failure.log) : '';
      if (attempt === MAX_BUILDS) {
        addMessage({ role: 'developer', from: 'system', text: `APK 빌드 실패: ${failure.message}

${log.slice(-1500)}` });
        throw new Error(`APK 빌드에 ${MAX_BUILDS}번 실패했어요. 개발자 채팅방에서 오류를 확인하세요.`);
      }
      addMessage({ role: 'developer', from: 'system', text: `APK 빌드 실패 (${attempt}/${MAX_BUILDS}): ${failure.message}. 오류를 고쳐서 다시 빌드할게요.` });
      const fix = await callAgent('developer', [
        {
          role: 'user',
          content: `${buildContext()}

[APK 빌드 오류]
${failure.message}

${log}

위 오류가 나지 않도록 고친 파일을 FILE 형식으로 다시 작성하세요. 고친 파일은 내용 전체를 씁니다. Expo 앱 규칙(하위 폴더 없음, package.json, app.json, App.tsx, import './파일명')을 지키세요.`,
        },
      ]);
      await handleReply('developer', fix, task.id);
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
    try {
      setProject((p) => ({ ...p, tasks: p.tasks.map((t) => (t.status === 'failed' ? { ...t, status: 'pending' } : t)) }));
      await withSlot(runLoop);
    } finally {
      loopRunning = false;
    }
  }

  async function runLoop() {
    setPhase('running');
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
      // 요청서에 정한 결재 방식이 있으면 그걸 따릅니다.
      const stepApproval = project.brief ? project.brief.approval === 'step' : settings().stepApproval;
      if (stepApproval && project.tasks.some((t) => t.status === 'pending')) {
        setPhase('paused');
        addMessage({ role: 'pm', from: 'system', text: `"${next.title}" 완료. 결과를 확인하고 홈에서 다음 작업을 승인하세요.` });
        alert('결재가 필요해요', `${who}가 "${next.title}"을 마쳤어요. 확인하고 다음 작업을 승인해 주세요.`);
        return;
      }
    }
  }

  /** A message the user types in a room. */
  async function sendToRoom(role: RoleId, text: string) {
    if (busy[role]) return;
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

  // ---------- 서버가 다시 켜졌을 때 ----------

  /** 멈췄던 계획·작업을 이어서 합니다 (자리가 없으면 대기열로). */
  function resume() {
    const was = project.phase;
    project = { ...project, tasks: project.tasks.map((t) => (t.status === 'running' ? { ...t, status: 'pending' } : t)) };
    const run = (p: Promise<unknown>) => p.catch((e) => console.error('[office]', e));
    if (was === 'running' || (was === 'queued' && project.tasks.length > 0)) {
      console.log(`[office] ${project.brief?.name || project.request.slice(0, 20)}: 중단된 작업을 이어서 실행합니다.`);
      run(runTasks());
    } else if (was === 'planning' || (was === 'queued' && project.tasks.length === 0)) {
      if (project.tasks.length) setPhase('awaiting_approval');
      else run(planProject());
    }
  }

  // ---------- 바깥에 여는 함수 ----------

  return {
    id: opts.id,
    state: () => ({ project, busy }),
    project: () => project,
    busy: () => busy,
    /** AI가 지금 일하는 중(또는 대기열)인지 */
    isActive: () => loopRunning || ['planning', 'running', 'queued'].includes(project.phase) || Object.values(busy).some(Boolean),
    plan: () => planProject().catch((e) => console.error('[office]', e)),
    resume,
    flush: saveNow,

    /** 바로 응답하고, 작업은 뒤에서 계속합니다. */
    act(a: Action) {
      const run = (p: Promise<unknown>) => p.catch((e) => console.error('[office]', e));
      switch (a.type) {
        case 'run':
          if (!project.tasks.some((t) => t.status === 'pending' || t.status === 'failed')) throw new Error('실행할 작업이 없어요.');
          run(runTasks());
          return;
        case 'replan':
          if (busy.pm || loopRunning || project.phase === 'queued') throw new Error('작업 중에는 다시 계획할 수 없어요.');
          run(replan());
          return;
        case 'room':
          if (!a.text?.trim() || !ROLES.some((r) => r.id === a.role)) throw new Error('메시지를 확인해 주세요.');
          run(sendToRoom(a.role, a.text.trim()));
          return;
        default:
          throw new Error('알 수 없는 요청이에요.');
      }
    },

    /** 산출물 파일 (없으면 null) */
    file(id: string): { path: string; mime: string; name: string; size: number; deliverable: Deliverable } | null {
      const d = project.deliverables.find((x) => x.id === id);
      if (!d) return null;
      const path = filePath(d);
      if (!existsSync(path)) return null;
      return { path, mime: d.mime, name: d.name, size: statSync(path).size, deliverable: d };
    },

    /** 퍼블리셔 등 역할 폴더의 파일 (화면 실행용). 없으면 null */
    siteFile(role: string, sub: string): string | null {
      if (!ROLES.some((r) => r.id === role)) return null;
      // 파일 이름은 저장할 때 / 를 _ 로 바꾸므로 같은 규칙으로 찾습니다 (css/style.css → css_style.css).
      const name = sub
        .split('/')
        .filter((x) => x && x !== '.' && x !== '..')
        .join('_')
        .replace(/[\\:*?"<>|]+/g, '_')
        .replace(/\s+/g, '_');
      if (!name || name.startsWith('.')) return null;
      const path = join(filesDir, role, name);
      return existsSync(path) ? path : null;
    },
  };
}
