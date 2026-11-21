import {
  parseReply,
  readText,
  saveImageDeliverable,
  saveTextDeliverable,
} from './deliverables';
import { chat, generateImage, LlmMessage } from './llm';
import { isWorkerRole, roleInfo, systemPrompt } from './roles';
import { getSettings } from './settings';
import { addMessage, busyStore, emptyProject, newId, projectStore, setBusy } from './store';
import { Deliverable, ProjectPhase, RoleId, Task } from './types';

const MAX_FILE_CHARS = 12000;
const MAX_CONTEXT_CHARS = 60000;
const HISTORY_LIMIT = 20;

function setPhase(phase: ProjectPhase) {
  projectStore.set((p) => ({ ...p, phase }));
}

function updateTask(id: string, patch: Partial<Task>) {
  projectStore.set((p) => ({
    ...p,
    tasks: p.tasks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
  }));
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** The shared spec store every agent reads: request, plan, and the latest deliverables. */
async function buildContext(): Promise<string> {
  const p = projectStore.get();
  const lines: string[] = [];
  lines.push(`[대표의 프로젝트 요청]\n${p.request || '(아직 없음)'}`);
  if (p.planSummary) lines.push(`[PM 계획 요약]\n${p.planSummary}`);
  if (p.tasks.length) {
    lines.push(
      '[작업 목록]\n' +
        p.tasks
          .map((t, i) => `${i + 1}. (${roleInfo(t.role).name}) ${t.title} — ${statusLabel(t.status)}`)
          .join('\n'),
    );
  }
  const texts = [...p.deliverables]
    .filter((d) => !d.isBinary)
    .sort((a, b) => b.createdAt - a.createdAt);
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
      body = await readText(d);
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

export function statusLabel(s: Task['status']): string {
  return { pending: '대기', running: '진행 중', done: '완료', failed: '실패' }[s];
}

async function callAgent(role: RoleId, messages: LlmMessage[]): Promise<string> {
  const settings = getSettings();
  const rm = settings.roles[role];
  setBusy(role, true);
  try {
    return await chat({
      provider: rm.provider,
      model: rm.model,
      system: systemPrompt(role),
      messages,
      settings,
    });
  } finally {
    setBusy(role, false);
  }
}

function roomHistory(role: RoleId): LlmMessage[] {
  return projectStore
    .get()
    .messages.filter((m) => m.role === role && !m.error)
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
      saved.push(await saveTextDeliverable(role, f.name, f.content, taskId));
    } catch (e) {
      notes.push(`(${f.name} 저장 실패: ${errorText(e)})`);
    }
  }
  if (parsed.imagePrompts.length) {
    const settings = getSettings();
    for (let i = 0; i < parsed.imagePrompts.length; i++) {
      try {
        const img = await generateImage(settings, parsed.imagePrompts[i]);
        saved.push(await saveImageDeliverable(role, `디자인시안_${i + 1}.png`, img, taskId));
      } catch (e) {
        notes.push(`(시안 이미지 ${i + 1} 생성 실패: ${errorText(e)})`);
      }
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
      const start = c.indexOf('{');
      const end = c.lastIndexOf('}');
      const parsed = JSON.parse(c.slice(start, end + 1)) as PlanJson;
      if (Array.isArray(parsed.tasks)) return parsed;
    } catch {
      // try next candidate
    }
  }
  return null;
}

function formatPlan(tasks: Task[]): string {
  return tasks
    .map((t, i) => `${i + 1}. [${roleInfo(t.role).name}] ${t.title}\n   ${t.instructions}`)
    .join('\n');
}

/** Talk to the PM. Any PLAN it returns is queued for the user's approval. */
async function askPm(userText: string, isNewProject: boolean) {
  const context = await buildContext();
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
    projectStore.set((p) => ({
      ...p,
      planSummary: isNewProject || !p.planSummary ? plan?.summary ?? '' : p.planSummary,
      tasks: [...p.tasks, ...newTasks],
      phase: 'awaiting_approval',
    }));
    text = [
      text,
      `작업 ${newTasks.length}개를 계획했습니다. 홈 화면에서 승인하면 실행합니다.`,
      formatPlan(newTasks),
    ]
      .filter(Boolean)
      .join('\n\n');
  } else if (isNewProject) {
    setPhase('idle');
  }
  // Files the PM writes (rare) are still saved.
  for (const f of parsed.files) await saveTextDeliverable('pm', f.name, f.content);
  addMessage({ role: 'pm', from: 'agent', text: text || '(빈 응답)' });
}

export async function startProject(request: string) {
  projectStore.set(() => ({ ...emptyProject(), request, phase: 'planning' }));
  addMessage({ role: 'pm', from: 'user', text: request });
  try {
    await askPm(
      `[대표 요청]\n${request}\n\n이 요청을 팀원에게 나눠 할당하는 계획을 PLAN 형식으로 작성하세요.`,
      true,
    );
  } catch (e) {
    setPhase('idle');
    addMessage({ role: 'pm', from: 'agent', text: `계획 작성 실패: ${errorText(e)}`, error: true });
  }
}

export async function replan() {
  projectStore.set((p) => ({
    ...p,
    tasks: p.tasks.filter((t) => t.status !== 'pending'),
    phase: 'planning',
  }));
  const msg = '대기 중인 작업을 지우고 계획을 다시 작성해 주세요.';
  addMessage({ role: 'pm', from: 'user', text: msg });
  try {
    await askPm(msg + ' 완료된 작업은 그대로 두고, 남은 작업만 PLAN에 넣으세요.', false);
  } catch (e) {
    setPhase(projectStore.get().tasks.length ? 'paused' : 'idle');
    addMessage({ role: 'pm', from: 'agent', text: `계획 작성 실패: ${errorText(e)}`, error: true });
  }
  if (projectStore.get().phase === 'planning') {
    setPhase(projectStore.get().tasks.some((t) => t.status === 'pending') ? 'awaiting_approval' : 'done');
  }
}

let loopRunning = false;

async function runTask(task: Task) {
  updateTask(task.id, { status: 'running', error: undefined });
  addMessage({
    role: task.role,
    from: 'system',
    text: `PM이 작업을 할당했습니다: ${task.title}\n\n${task.instructions}`,
  });
  try {
    const context = await buildContext();
    const reply = await callAgent(task.role, [
      {
        role: 'user',
        content: `${context}\n\n[이번에 할당된 작업]\n${task.title}\n\n${task.instructions}\n\n산출물은 규칙에 맞춰 파일로 작성하세요.`,
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
    const context = await buildContext();
    const reply = await callAgent('pm', [
      {
        role: 'user',
        content: `${context}\n\n모든 작업이 끝났습니다. 대표에게 결과를 5줄 이내로 보고하고 확인이 필요한 점을 짚어 주세요. PLAN은 쓰지 마세요.`,
      },
    ]);
    addMessage({ role: 'pm', from: 'agent', text: parseReply(reply).text });
  } catch (e) {
    addMessage({ role: 'pm', from: 'agent', text: `완료 보고 작성 실패: ${errorText(e)}`, error: true });
  }
}

/** Runs pending tasks in order. Stops after a failure, or after each task when step approval is on. */
export async function runTasks() {
  if (loopRunning) return;
  loopRunning = true;
  setPhase('running');
  try {
    projectStore.set((p) => ({
      ...p,
      tasks: p.tasks.map((t) => (t.status === 'failed' ? { ...t, status: 'pending' } : t)),
    }));
    while (true) {
      const next = projectStore.get().tasks.find((t) => t.status === 'pending');
      if (!next) {
        setPhase('done');
        addMessage({ role: 'pm', from: 'system', text: '모든 작업이 끝났습니다.' });
        await pmSummary();
        return;
      }
      await runTask(next);
      const after = projectStore.get();
      const failed = after.tasks.find((t) => t.id === next.id)?.status === 'failed';
      if (failed) {
        setPhase('paused');
        addMessage({
          role: 'pm',
          from: 'system',
          text: `"${next.title}" 작업이 실패해 멈췄습니다. 홈에서 다시 시도할 수 있습니다.`,
        });
        return;
      }
      if (getSettings().stepApproval && after.tasks.some((t) => t.status === 'pending')) {
        setPhase('paused');
        addMessage({
          role: 'pm',
          from: 'system',
          text: `"${next.title}" 완료. 결과를 확인하고 홈에서 다음 작업을 승인하세요.`,
        });
        return;
      }
    }
  } finally {
    loopRunning = false;
  }
}

/** A message the user types in a room. */
export async function sendToRoom(role: RoleId, text: string) {
  if (busyStore.get()[role]) return;
  if (role === 'pm' && !projectStore.get().request) {
    await startProject(text);
    return;
  }
  addMessage({ role, from: 'user', text });
  if (role === 'pm') {
    try {
      await askPm(text, false);
    } catch (e) {
      addMessage({ role: 'pm', from: 'agent', text: `응답 실패: ${errorText(e)}`, error: true });
    }
    return;
  }
  try {
    const context = await buildContext();
    const reply = await callAgent(role, [
      { role: 'user', content: `${context}\n\n위 프로젝트 맥락을 참고하세요.` },
      { role: 'assistant', content: '맥락을 확인했습니다.' },
      ...roomHistory(role),
    ]);
    await handleReply(role, reply);
  } catch (e) {
    addMessage({ role, from: 'agent', text: `응답 실패: ${errorText(e)}`, error: true });
  }
}

export function resetProject() {
  projectStore.set(() => emptyProject());
}
