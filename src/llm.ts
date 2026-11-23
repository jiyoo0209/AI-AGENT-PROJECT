import { Provider, Settings } from './types';
import { LimitWindow, recordLimits, recordUsage } from './usage';

export interface LlmMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Both APIs want alternating turns that start with the user. */
function normalize(messages: LlmMessage[]): LlmMessage[] {
  const out: LlmMessage[] = [];
  for (const m of messages) {
    if (!m.content.trim()) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content += '\n\n' + m.content;
    else out.push({ ...m });
  }
  if (out.length === 0 || out[0].role !== 'user') {
    out.unshift({ role: 'user', content: '(대화 시작)' });
  }
  return out;
}

interface ServerUsage {
  input?: number;
  output?: number;
}

/**
 * 맥미니 서버에 요청합니다. 서버는 오래 걸리는 작업 동안 공백을 먼저 보내고
 * 마지막에 JSON을 보내므로, 실패도 200 응답 본문의 error 필드로 옵니다.
 */
async function callServer<T>(settings: Settings, path: string, body?: unknown): Promise<T> {
  if (!settings.serverUrl.trim()) throw new Error('맥미니 서버 주소가 없습니다. 설정에서 입력하세요.');
  if (!settings.serverToken) throw new Error('맥미니 서버 토큰이 없습니다. 설정에서 입력하세요.');
  const base = settings.serverUrl.trim().replace(/\/+$/, '');
  let res: Response;
  try {
    res = await fetch(base + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        authorization: `Bearer ${settings.serverToken}`,
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(
      `맥미니 서버에 연결하지 못했습니다. 맥미니가 켜져 있는지, 주소가 맞는지 확인하세요. (${e instanceof Error ? e.message : String(e)})`,
    );
  }
  if (res.status === 401) throw new Error('맥미니 서버 토큰이 맞지 않습니다. 설정의 토큰을 확인하세요.');
  const raw = await res.text();
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`맥미니 서버 오류 (${res.status}): ${raw.trim().slice(0, 200) || '빈 응답'}`);
  }
  if (!res.ok || data?.error) {
    throw new Error(`맥미니 서버 오류: ${data?.error?.message ?? res.statusText}`);
  }
  return data as T;
}

/** 설정 화면의 연결 테스트용 */
export async function checkServer(settings: Settings): Promise<void> {
  await callServer(settings, '/v1/health');
}

export async function chat(params: {
  provider: Provider;
  model: string;
  system: string;
  messages: LlmMessage[];
  settings: Settings;
}): Promise<string> {
  const { provider, model, system, settings } = params;
  const data = await callServer<{ text: string; usage?: ServerUsage }>(settings, '/v1/chat', {
    provider,
    model,
    system,
    messages: normalize(params.messages),
  });
  recordUsage(provider, data.usage?.input ?? 0, data.usage?.output ?? 0);
  refreshLimits(settings).catch(() => {});
  return data.text ?? '';
}

export interface GeneratedImage {
  base64?: string;
  url?: string;
}

export async function generateImage(settings: Settings, prompt: string): Promise<GeneratedImage> {
  const data = await callServer<{ base64?: string; usage?: ServerUsage }>(settings, '/v1/image', { prompt });
  recordUsage('openai', data.usage?.input ?? 0, data.usage?.output ?? 0);
  if (!data.base64) throw new Error('이미지 응답이 비어 있습니다.');
  return { base64: data.base64 };
}

/** 두 구독의 남은 한도를 맥미니 서버에서 받아 옵니다. */
let lastLimitsAt = 0;

export async function refreshLimits(settings: Settings, force = false): Promise<void> {
  if (!settings.serverUrl.trim() || !settings.serverToken) return;
  if (!force && Date.now() - lastLimitsAt < 60000) return;
  lastLimitsAt = Date.now();
  const data = await callServer<{ claude: LimitWindow[] | null; openai: LimitWindow[] | null }>(
    settings,
    '/v1/limits',
  );
  recordLimits('claude', data.claude);
  recordLimits('openai', data.openai);
}
