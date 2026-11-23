import { Provider, Settings } from './types';
import { recordRateHeaders, recordSubscriptionLimit, recordUsage } from './usage';

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

/** 맥미니 서버 주소가 있으면 API 키 대신 서버(구독)로 호출합니다. */
export function usesServer(settings: Settings): boolean {
  return !!settings.serverUrl.trim();
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

async function readError(res: Response): Promise<string> {
  try {
    const j = await res.json();
    return j?.error?.message ?? JSON.stringify(j);
  } catch {
    return res.statusText || '알 수 없는 오류';
  }
}

export async function chat(params: {
  provider: Provider;
  model: string;
  system: string;
  messages: LlmMessage[];
  settings: Settings;
  maxTokens?: number;
}): Promise<string> {
  const { provider, model, system, settings } = params;
  const messages = normalize(params.messages);
  const maxTokens = params.maxTokens ?? 16000;

  if (usesServer(settings)) {
    const data = await callServer<{
      text: string;
      usage?: ServerUsage;
      limits?: Parameters<typeof recordSubscriptionLimit>[1];
    }>(settings, '/v1/chat', { provider, model, system, messages, maxTokens });
    recordUsage(provider, data.usage?.input ?? 0, data.usage?.output ?? 0);
    if (data.limits) recordSubscriptionLimit(provider, data.limits);
    return data.text ?? '';
  }

  if (provider === 'claude') {
    if (!settings.anthropicKey) throw new Error('Claude API 키가 없습니다. 설정에서 입력하세요.');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': settings.anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, system, messages }),
    });
    recordRateHeaders('claude', res.headers);
    if (!res.ok) throw new Error(`Claude API 오류 (${res.status}): ${await readError(res)}`);
    const data = await res.json();
    recordUsage(
      'claude',
      (data.usage?.input_tokens ?? 0) +
        (data.usage?.cache_creation_input_tokens ?? 0) +
        (data.usage?.cache_read_input_tokens ?? 0),
      data.usage?.output_tokens ?? 0,
    );
    const text = (data.content ?? [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text)
      .join('');
    if (data.stop_reason === 'max_tokens') {
      return text + '\n\n(응답이 길어 중간에 끊겼습니다. "이어서 작성해줘"라고 요청하세요.)';
    }
    return text;
  }

  if (!settings.openaiKey) throw new Error('OpenAI API 키가 없습니다. 설정에서 입력하세요.');
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${settings.openaiKey}`,
    },
    body: JSON.stringify({
      model,
      instructions: system,
      input: messages.map((m) => ({ role: m.role, content: m.content })),
      max_output_tokens: maxTokens,
    }),
  });
  recordRateHeaders('openai', res.headers);
  if (!res.ok) throw new Error(`OpenAI API 오류 (${res.status}): ${await readError(res)}`);
  const data = await res.json();
  recordUsage('openai', data.usage?.input_tokens ?? 0, data.usage?.output_tokens ?? 0);
  let text = typeof data.output_text === 'string' ? data.output_text : '';
  if (!text) {
    const parts: string[] = [];
    for (const item of data.output ?? []) {
      if (item.type !== 'message') continue;
      for (const c of item.content ?? []) {
        if (c.type === 'output_text' && typeof c.text === 'string') parts.push(c.text);
      }
    }
    text = parts.join('');
  }
  if (data.status === 'incomplete') {
    text += '\n\n(응답이 길어 중간에 끊겼습니다. "이어서 작성해줘"라고 요청하세요.)';
  }
  return text;
}

export interface GeneratedImage {
  base64?: string;
  url?: string;
}

export async function generateImage(settings: Settings, prompt: string): Promise<GeneratedImage> {
  if (usesServer(settings)) {
    const data = await callServer<{ base64?: string; usage?: ServerUsage }>(settings, '/v1/image', { prompt });
    recordUsage('openai', data.usage?.input ?? 0, data.usage?.output ?? 0);
    if (!data.base64) throw new Error('이미지 응답이 비어 있습니다.');
    return { base64: data.base64 };
  }
  if (!settings.openaiKey) throw new Error('시안 이미지는 OpenAI API 키가 있어야 만들 수 있습니다.');
  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${settings.openaiKey}`,
    },
    body: JSON.stringify({ model: settings.imageModel, prompt, size: '1024x1536', n: 1 }),
  });
  recordRateHeaders('openai', res.headers);
  if (!res.ok) throw new Error(`이미지 API 오류 (${res.status}): ${await readError(res)}`);
  const data = await res.json();
  recordUsage('openai', data.usage?.input_tokens ?? 0, data.usage?.output_tokens ?? 0);
  const first = data.data?.[0];
  if (first?.b64_json) return { base64: first.b64_json };
  if (first?.url) return { url: first.url };
  throw new Error('이미지 응답이 비어 있습니다.');
}

/**
 * Providers only report remaining limits in response headers, so this sends the
 * smallest possible request (a few tokens) to refresh them.
 */
export async function checkLimits(provider: Provider, settings: Settings, model: string): Promise<void> {
  await chat({
    provider,
    model,
    system: '짧게 답하세요.',
    messages: [{ role: 'user', content: 'ping' }],
    settings,
    maxTokens: provider === 'claude' ? 1 : 16,
  });
}
