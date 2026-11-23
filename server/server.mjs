// 나만의사무실 서버 (맥미니 또는 VPS)
// Claude Pro(Claude Agent SDK)와 ChatGPT Plus(Codex SDK) 구독으로 AI 팀을 서버에서 돌립니다.
// 폰 앱이 꺼져 있어도 작업을 이어가고, 결재가 필요하면 푸시 알림을 보냅니다.
// API 키를 쓰지 않도록 ANTHROPIC_API_KEY / OPENAI_API_KEY / CODEX_API_KEY 는 하위 프로세스에 넘기지 않습니다.

import { query } from '@anthropic-ai/claude-agent-sdk';
import { Codex } from '@openai/codex-sdk';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, renameSync, rmSync, statSync, closeSync } from 'node:fs';
import http from 'node:http';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { register as registerTypeScript } from 'tsx/esm/api';
import { createPush } from './push.mjs';

const TOKEN = process.env.SERVER_TOKEN || '';
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const WORK_ROOT = join(tmpdir(), 'ai-agent-server');
const MAX_BODY = 5 * 1024 * 1024;
const HEARTBEAT_MS = 15000;
const CHAT_TIMEOUT_MS = 10 * 60 * 1000;
const IMAGE_TIMEOUT_MS = 10 * 60 * 1000;

if (!TOKEN) {
  console.error('SERVER_TOKEN 환경 변수가 필요합니다.');
  process.exit(1);
}
mkdirSync(WORK_ROOT, { recursive: true });

/** 구독 로그인만 쓰도록 API 키 환경 변수를 뺀 환경 */
function subscriptionEnv() {
  const env = { ...process.env };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  delete env.OPENAI_API_KEY;
  delete env.CODEX_API_KEY;
  delete env.SERVER_TOKEN;
  return Object.fromEntries(Object.entries(env).filter(([, v]) => typeof v === 'string'));
}

function workDir() {
  const dir = join(WORK_ROOT, randomUUID());
  mkdirSync(dir, { recursive: true });
  return dir;
}

function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // 임시 폴더 삭제 실패는 무시
  }
}

/** 여러 턴의 대화를 한 번의 요청 문장으로 합칩니다. */
function transcript(messages) {
  const list = (messages || []).filter((m) => m && typeof m.content === 'string' && m.content.trim());
  if (list.length === 0) return '(대화 시작)';
  if (list.length === 1) return list[0].content;
  const body = list
    .map((m) => `[${m.role === 'assistant' ? '어시스턴트' : '사용자'}]\n${m.content}`)
    .join('\n\n');
  return `아래는 지금까지의 대화입니다. 마지막 [사용자] 메시지에 [어시스턴트]로서 답하세요. 답변 앞에 [어시스턴트] 표시는 붙이지 마세요.\n\n${body}`;
}

/** 로그인 문제일 때 맥미니에서 할 일을 덧붙입니다. */
function withHint(provider, e) {
  const msg = e instanceof Error ? e.message : String(e);
  const t = msg.toLowerCase();
  if (t.includes('abort')) return new Error(`${provider === 'openai' ? 'ChatGPT' : 'Claude'} 응답 시간이 초과되었습니다.`);
  if (t.includes('auth') || t.includes('login') || t.includes('401') || t.includes('unauthorized')) {
    const how = provider === 'openai' ? '`codex` 실행 후 Sign in with ChatGPT' : '`claude` 실행 후 /login';
    return new Error(`${msg}\n(맥미니 로그인이 풀렸을 수 있습니다. 맥미니 터미널에서 ${how}로 다시 로그인하세요.)`);
  }
  return e instanceof Error ? e : new Error(msg);
}

function isModelError(e) {
  const t = String(e?.message || e).toLowerCase();
  return t.includes('model') && (t.includes('not found') || t.includes('invalid') || t.includes('not supported') || t.includes('unknown') || t.includes('does not exist') || t.includes('not available'));
}

// ---------- Claude (Pro 구독) ----------

async function claudeOnce({ model, system, prompt, signal }) {
  const dir = workDir();
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), CHAT_TIMEOUT_MS);
  const onAbort = () => abortController.abort();
  signal?.addEventListener('abort', onAbort);
  let result;
  let limits;
  try {
    const q = query({
      prompt,
      options: {
        systemPrompt: system || undefined,
        model: model || undefined,
        tools: [],
        maxTurns: 1,
        settingSources: [],
        persistSession: false,
        cwd: dir,
        env: subscriptionEnv(),
        abortController,
      },
    });
    for await (const m of q) {
      if (m.type === 'rate_limit_event') limits = m.rate_limit_info;
      if (m.type === 'result') result = m;
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
    cleanup(dir);
  }
  if (!result) throw new Error('Claude 응답이 없습니다.');
  if (result.subtype !== 'success' || result.is_error) {
    const detail = (result.errors && result.errors.join(' ')) || result.result || result.subtype;
    throw new Error(`Claude 오류: ${detail}`);
  }
  const u = result.usage || {};
  let text = result.result || '';
  if (result.stop_reason === 'max_tokens') {
    text += '\n\n(응답이 길어 중간에 끊겼습니다. "이어서 작성해줘"라고 요청하세요.)';
  }
  return {
    text,
    usage: {
      input: (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
      output: u.output_tokens || 0,
    },
    limits: limits
      ? {
          status: limits.status,
          utilization: limits.utilization,
          resetsAt: limits.resetsAt,
          type: limits.rateLimitType,
        }
      : undefined,
  };
}

async function claudeChat({ model, system, messages }, signal) {
  const prompt = transcript(messages);
  try {
    return await claudeOnce({ model, system, prompt, signal });
  } catch (e) {
    if (model && isModelError(e)) {
      const r = await claudeOnce({ model: undefined, system, prompt, signal });
      r.text += `\n\n(모델 "${model}"을 쓸 수 없어 기본 모델로 답했습니다. 설정에서 모델 ID를 확인하세요.)`;
      return r;
    }
    throw withHint('claude', e);
  }
}

// ---------- ChatGPT (Plus 구독, Codex) ----------

const codex = new Codex({ env: subscriptionEnv() });

async function codexOnce({ model, prompt, dir, sandboxMode, signal, timeoutMs }) {
  const thread = codex.startThread({
    model: model || undefined,
    workingDirectory: dir,
    skipGitRepoCheck: true,
    sandboxMode,
    approvalPolicy: 'never',
    webSearchEnabled: false,
  });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    return await thread.run(prompt, { signal: controller.signal });
  } catch (e) {
    throw withHint('openai', e);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

async function codexChat({ model, system, messages }, signal) {
  const prompt = [
    system ? `# 지시사항\n${system}` : '',
    '# 응답 규칙\n도구나 셸 명령을 쓰지 말고, 답변 텍스트만 작성하세요.',
    `# 요청\n${transcript(messages)}`,
  ]
    .filter(Boolean)
    .join('\n\n');
  const dir = workDir();
  try {
    let turn;
    let note = '';
    try {
      turn = await codexOnce({ model, prompt, dir, sandboxMode: 'read-only', signal, timeoutMs: CHAT_TIMEOUT_MS });
    } catch (e) {
      if (!model || !isModelError(e)) throw e;
      turn = await codexOnce({ model: undefined, prompt, dir, sandboxMode: 'read-only', signal, timeoutMs: CHAT_TIMEOUT_MS });
      note = `\n\n(모델 "${model}"을 쓸 수 없어 Codex 기본 모델로 답했습니다. 설정에서 모델 ID를 비우거나 확인하세요.)`;
    }
    const u = turn.usage || {};
    return {
      text: (turn.finalResponse || '') + note,
      usage: { input: u.input_tokens || 0, output: (u.output_tokens || 0) + (u.reasoning_output_tokens || 0) },
    };
  } finally {
    cleanup(dir);
  }
}

function newestPng(dir, since) {
  if (!existsSync(dir)) return null;
  let best = null;
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      let s;
      try {
        s = statSync(p);
      } catch {
        continue;
      }
      if (s.isDirectory()) walk(p);
      else if (/\.png$/i.test(name) && s.mtimeMs >= since && (!best || s.mtimeMs > best.t)) best = { p, t: s.mtimeMs };
    }
  };
  walk(dir);
  return best ? best.p : null;
}

async function codexImage({ prompt }, signal) {
  const dir = workDir();
  const started = Date.now() - 1000;
  try {
    const instructions = [
      'Use the imagegen skill with the built-in image_gen tool.',
      'Do not use any CLI fallback script and do not ask for or use OPENAI_API_KEY.',
      'If the built-in tool is unavailable, stop and reply exactly: IMAGEGEN_UNAVAILABLE.',
      'Make exactly one image_gen call. Use a portrait 2:3 aspect ratio.',
      'Do not crop, resize, convert, or post-process the image.',
      'Copy the generated PNG into the current working directory as image.png.',
      'Reply with only the absolute path of image.png.',
      '',
      'PROMPT:',
      prompt,
    ].join('\n');
    const turn = await codexOnce({
      model: undefined,
      prompt: instructions,
      dir,
      sandboxMode: 'workspace-write',
      signal,
      timeoutMs: IMAGE_TIMEOUT_MS,
    });
    if ((turn.finalResponse || '').includes('IMAGEGEN_UNAVAILABLE')) {
      throw new Error('Codex에서 이미지 생성 도구를 쓸 수 없습니다. ChatGPT 유료 플랜 로그인 상태를 확인하세요.');
    }
    const file =
      (existsSync(join(dir, 'image.png')) && join(dir, 'image.png')) ||
      newestPng(dir, started) ||
      newestPng(join(homedir(), '.codex', 'generated_images'), started);
    if (!file) throw new Error('생성된 이미지를 찾지 못했습니다.');
    const u = turn.usage || {};
    return {
      base64: readFileSync(file).toString('base64'),
      usage: { input: u.input_tokens || 0, output: (u.output_tokens || 0) + (u.reasoning_output_tokens || 0) },
    };
  } finally {
    cleanup(dir);
  }
}

// ---------- 남은 한도 ----------

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

/** Claude 구독 한도: Agent SDK의 /usage 정보 (실험적 기능이라 실패하면 null) */
async function claudeLimits() {
  const dir = workDir();
  const abortController = new AbortController();
  let release;
  const hold = new Promise((r) => (release = r));
  async function* input() {
    await hold;
  }
  try {
    const q = query({
      prompt: input(),
      options: { tools: [], settingSources: [], persistSession: false, cwd: dir, env: subscriptionEnv(), abortController },
    });
    (async () => {
      try {
        for await (const _ of q) {
          // 메시지를 흘려보내 제어 요청이 처리되게 함
        }
      } catch {
        // 중단 시 무시
      }
    })();
    const fn = q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
    if (typeof fn !== 'function') return null;
    const u = await withTimeout(fn.call(q, { skipBehaviors: true }), 30000);
    const rl = u && u.rate_limits;
    if (!rl) return null;
    const win = (w, key, label) =>
      w && typeof w.utilization === 'number' ? { key, label, usedPct: w.utilization, resetsAt: w.resets_at || null } : null;
    return [win(rl.five_hour, 'five_hour', '5시간'), win(rl.seven_day, 'seven_day', '주간')].filter(Boolean);
  } catch (e) {
    console.error('[limits] claude', e?.message || e);
    return null;
  } finally {
    release();
    abortController.abort();
    cleanup(dir);
  }
}

function tail(file, bytes) {
  const size = statSync(file).size;
  const start = Math.max(0, size - bytes);
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

function findRateLimits(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.rate_limits && typeof obj.rate_limits === 'object') return obj.rate_limits;
  for (const v of Object.values(obj)) {
    const r = findRateLimits(v);
    if (r) return r;
  }
  return null;
}

/** ChatGPT 구독 한도: Codex가 남기는 세션 기록(~/.codex/sessions)의 마지막 rate_limits */
function codexLimits() {
  try {
    const root = join(homedir(), '.codex', 'sessions');
    if (!existsSync(root)) return null;
    const files = [];
    const walk = (d, depth) => {
      for (const name of readdirSync(d)) {
        const p = join(d, name);
        if (depth < 3 && statSync(p).isDirectory()) walk(p, depth + 1);
        else if (/^rollout-.*\.jsonl$/.test(name)) files.push({ p, name });
      }
    };
    walk(root, 0);
    // 파일 이름의 시각 순서 (Codex가 옛 파일을 다시 쓰기도 해서 수정 시각은 믿지 않음)
    files.sort((a, b) => (a.name < b.name ? 1 : -1));
    const now = Date.now() / 1000;
    for (const f of files.slice(0, 8)) {
      const lines = tail(f.p, 256 * 1024).split('\n').reverse();
      for (const line of lines) {
        if (!line.includes('rate_limits')) continue;
        let rl;
        try {
          rl = findRateLimits(JSON.parse(line));
        } catch {
          continue;
        }
        if (!rl) continue;
        const out = [];
        for (const w of [rl.primary, rl.secondary]) {
          if (!w || typeof w.used_percent !== 'number') continue;
          let resetSec = typeof w.resets_at === 'number' ? w.resets_at : null;
          if (resetSec == null && typeof w.resets_in_seconds === 'number') resetSec = null;
          const passed = resetSec != null && resetSec < now;
          const minutes = w.window_minutes;
          out.push({
            key: minutes === 300 ? 'five_hour' : minutes === 10080 ? 'seven_day' : `m${minutes}`,
            label: minutes === 300 ? '5시간' : minutes === 10080 ? '주간' : `${Math.round((minutes || 0) / 60)}시간`,
            usedPct: passed ? 0 : w.used_percent,
            resetsAt: resetSec != null && !passed ? new Date(resetSec * 1000).toISOString() : null,
          });
        }
        if (out.length) return out;
      }
    }
    return null;
  } catch (e) {
    console.error('[limits] codex', e?.message || e);
    return null;
  }
}

// ---------- AI 팀 (서버에서 실행) ----------

const DATA_DIR = process.env.DATA_DIR || join(homedir(), '.my-office');
mkdirSync(DATA_DIR, { recursive: true });
// office.ts는 앱과 같은 역할 정의(src/roles.ts)를 쓰므로 TypeScript로 불러옵니다.
registerTypeScript();
const { createOffice } = await import('./office.ts');
const { createDocuments } = await import('./documents.ts');
const docs = createDocuments(DATA_DIR);
const push = createPush({
  dataDir: DATA_DIR,
  serviceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT || join(DATA_DIR, 'firebase-service-account.json'),
});
const office = createOffice({
  dataDir: DATA_DIR,
  docs,
  onImageSaved: (id) => {
    for (const v of ['thumb', 'preview']) imageVariant(id, v).catch(() => {});
  },
  chat: ({ provider, ...p }) => {
    console.log(`[office] ${provider} ${p.model || '(기본 모델)'}`);
    return provider === 'openai' ? codexChat(p) : claudeChat(p);
  },
  image: (prompt) => codexImage({ prompt }),
  notify: (a) => {
    console.log(`[알림] ${a.title} — ${a.body}`);
    push.send(a).catch((e) => console.error('[push]', e?.message || e));
  },
});
console.log(`데이터 폴더: ${DATA_DIR}`);

// ---------- 이미지 미리보기 ----------
// AI가 만든 PNG는 수 MB라 폰에서 느립니다. 화면용으로 작게 줄인 WebP를 만들어 캐시합니다.

const VARIANTS = { thumb: 360, preview: 1280 };
const PREVIEW_DIR = join(DATA_DIR, 'previews');
mkdirSync(PREVIEW_DIR, { recursive: true });
let sharp = null;
try {
  sharp = (await import('sharp')).default;
} catch {
  console.log('[image] sharp가 없어 원본 이미지를 그대로 보냅니다. (cd server && npm install)');
}
const making = new Map();

/** 미리보기 파일 경로. 만들 수 없으면 null (원본을 보냄). */
async function imageVariant(id, variant) {
  const f = office.file(id);
  if (!f || !sharp || !VARIANTS[variant] || !f.mime.startsWith('image/') || f.mime === 'image/svg+xml') return null;
  const out = join(PREVIEW_DIR, `${id}-${variant}.webp`);
  if (existsSync(out)) return out;
  if (!making.has(out)) {
    const size = VARIANTS[variant];
    const job = sharp(f.path)
      .resize(size, size, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: variant === 'thumb' ? 70 : 82 })
      .toFile(out + '.tmp')
      .then(() => {
        renameSync(out + '.tmp', out);
        return out;
      })
      .finally(() => making.delete(out));
    making.set(out, job);
  }
  return making.get(out);
}

// ---------- HTTP ----------

function authorized(req, url) {
  const header = req.headers.authorization || '';
  const given = header.startsWith('Bearer ') ? header.slice(7) : url.searchParams.get('token') || '';
  const a = Buffer.from(given);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('요청이 너무 큽니다.'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(new Error('JSON 형식이 아닙니다.'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * 오래 걸리는 작업 동안 연결이 끊기지 않도록 15초마다 공백을 보내고,
 * 끝나면 JSON을 보냅니다. JSON 앞의 공백은 파싱에 영향이 없습니다.
 * 이미 200을 보냈으므로 오류는 본문의 error 필드로 전달합니다.
 */
async function longJson(res, work) {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  const beat = setInterval(() => res.write(' '), HEARTBEAT_MS);
  // 폰 연결이 끊기면 작업도 멈춰서 구독 한도를 아낍니다.
  const gone = new AbortController();
  res.on('close', () => {
    if (!res.writableFinished) gone.abort();
  });
  try {
    res.end(JSON.stringify(await work(gone.signal)));
  } catch (e) {
    console.error(e);
    res.end(JSON.stringify({ error: { message: e instanceof Error ? e.message : String(e) } }));
  } finally {
    clearInterval(beat);
  }
}

function send(res, status, body, type = 'application/json; charset=utf-8') {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const headers = { 'Content-Type': type, 'Cache-Control': 'no-store' };
  // 프로젝트 상태(JSON)는 수백 KB가 될 수 있어 압축해서 보냅니다.
  if (text.length > 1024 && /\bgzip\b/.test(res.req?.headers['accept-encoding'] || '')) {
    const gz = gzipSync(text);
    res.writeHead(status, { ...headers, 'Content-Encoding': 'gzip', 'Content-Length': gz.length });
    return res.end(gz);
  }
  res.writeHead(status, headers);
  res.end(text);
}

// 퍼블리셔 화면 실행 주소: /site/<비밀 값>/<역할>/<파일>
// 앱의 웹 화면(WebView)은 CSS·JS·이미지를 불러올 때 토큰 헤더를 붙일 수 없어서, 주소 안의 비밀 값으로 확인합니다.
const SITE_KEY = createHmac('sha256', TOKEN).update('my-office-site').digest('hex').slice(0, 32);
const SITE_BASE = `/site/${SITE_KEY}`;

function textType(mime) {
  return /^text\/|\/json$|\/javascript$|[+/]xml$/.test(mime) ? `${mime}; charset=utf-8` : mime;
}

function serveSite(req, res, url) {
  const m = url.pathname.match(/^\/site\/([0-9a-f]{32})\/([a-z]+)\/(.+)$/);
  const key = Buffer.from(m?.[1] || '');
  if (!m || key.length !== SITE_KEY.length || !timingSafeEqual(key, Buffer.from(SITE_KEY))) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('not found');
  }
  let sub = m[3];
  try {
    sub = decodeURIComponent(sub);
  } catch {
    // 그대로 사용
  }
  const path = office.siteFile(m[2], sub);
  if (!path) {
    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    return res.end(`<meta name="viewport" content="width=device-width"><p style="font-family:sans-serif;padding:24px">아직 없는 화면이에요: ${sub.replace(/[<>&]/g, '')}</p>`);
  }
  const ext = path.split('.').pop().toLowerCase();
  const types = { html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };
  // 퍼블리셔가 같은 파일을 고치면 바로 보여야 하므로 캐시하지 않습니다.
  res.writeHead(200, { 'Content-Type': textType(types[ext] || 'text/plain'), 'Content-Length': statSync(path).size, 'Cache-Control': 'no-cache' });
  if (req.method === 'HEAD') return res.end();
  return createReadStream(path).pipe(res);
}

/** 미리보기 이미지(WebP)를 보냅니다. 파일이 없으면 false */
function sendWebp(res, path) {
  if (!path || !existsSync(path)) return false;
  res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': statSync(path).size, 'Cache-Control': 'private, max-age=31536000, immutable' });
  createReadStream(path).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname.startsWith('/site/')) return serveSite(req, res, url);
  if (!authorized(req, url)) return send(res, 401, 'unauthorized', 'text/plain; charset=utf-8');

  try {
    if (req.method === 'GET' && url.pathname === '/') {
      return send(res, 200, 'macmini server OK', 'text/plain; charset=utf-8');
    }
    if (req.method === 'GET' && url.pathname === '/v1/health') {
      return send(res, 200, { ok: true, providers: ['claude', 'openai'] });
    }
    if (req.method === 'GET' && url.pathname === '/v1/limits') {
      const [claude, openai] = await Promise.all([claudeLimits(), Promise.resolve(codexLimits())]);
      return send(res, 200, { claude, openai, at: new Date().toISOString() });
    }
    if (req.method === 'POST' && url.pathname === '/v1/chat') {
      const body = await readJson(req);
      const provider = body.provider === 'openai' ? 'openai' : 'claude';
      console.log(`[chat] ${provider} ${body.model || '(기본 모델)'}`);
      return longJson(res, (signal) => (provider === 'openai' ? codexChat(body, signal) : claudeChat(body, signal)));
    }
    if (req.method === 'GET' && url.pathname === '/v1/state') {
      const since = Number(url.searchParams.get('since') || 0);
      const waitMs = Math.max(0, Math.min(Number(url.searchParams.get('wait') || 0), 30)) * 1000;
      const s = await office.waitForChange(since, waitMs);
      return send(res, 200, { ...s, settings: office.settings(), push: push.enabled(), siteBase: SITE_BASE });
    }
    if (req.method === 'POST' && url.pathname === '/v1/action') {
      const body = await readJson(req);
      console.log(`[action] ${body.type}${body.role ? ' ' + body.role : ''}`);
      office.act(body);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'POST' && url.pathname === '/v1/settings') {
      return send(res, 200, office.setSettings(await readJson(req)));
    }
    if (req.method === 'POST' && url.pathname === '/v1/push/register') {
      const body = await readJson(req);
      return send(res, 200, { ok: true, push: push.register(body.token) });
    }
    // /v1/files/<id>[/pdf | /page/<n>][?v=thumb|preview|source]
    const fileMatch = req.method === 'GET' && url.pathname.match(/^\/v1\/files\/([A-Za-z0-9_-]+)(?:\/(pdf|page)(?:\/(\d+))?)?$/);
    if (fileMatch) {
      const [, id, sub, pageNo] = fileMatch;
      const f = office.file(id);
      if (!f) return send(res, 404, { error: { message: '파일이 없습니다.' } });
      // 산출물은 바뀔 때마다 새 id를 받으므로, 같은 주소의 내용은 바뀌지 않습니다. 폰이 오래 캐시해도 됩니다.
      const cache = 'private, max-age=31536000, immutable';
      const variant = url.searchParams.get('v');
      const d = f.deliverable;
      if (sub === 'pdf') {
        const pdf = docs.pdfPath(id);
        if (!existsSync(pdf)) return send(res, 404, { error: { message: 'PDF가 아직 없어요.' } });
        res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': statSync(pdf).size, 'Cache-Control': cache });
        return createReadStream(pdf).pipe(res);
      }
      if (sub === 'page') {
        if (sendWebp(res, docs.pagePath(id, Number(pageNo || 1), variant === 'thumb'))) return;
        return send(res, 404, { error: { message: '미리보기가 아직 없어요.' } });
      }
      if (variant === 'source' && d.source) {
        const src = join(DATA_DIR, d.source);
        if (existsSync(src)) return send(res, 200, readFileSync(src, 'utf8'), 'text/markdown; charset=utf-8');
      }
      // 문서·HTML 화면의 썸네일은 첫 페이지(캡처) 이미지입니다.
      if ((variant === 'thumb' || variant === 'preview') && d.preview?.status === 'ready') {
        if (sendWebp(res, docs.pagePath(id, 1, variant === 'thumb'))) return;
      }
      const small = variant ? await imageVariant(id, variant).catch(() => null) : null;
      if (small) {
        res.writeHead(200, { 'Content-Type': 'image/webp', 'Content-Length': statSync(small).size, 'Cache-Control': cache });
        return createReadStream(small).pipe(res);
      }
      res.writeHead(200, { 'Content-Type': textType(f.mime), 'Content-Length': f.size, 'Cache-Control': cache });
      return createReadStream(f.path).pipe(res);
    }
    if (req.method === 'POST' && url.pathname === '/v1/image') {
      const body = await readJson(req);
      if (!body.prompt) return send(res, 400, { error: { message: 'prompt가 필요합니다.' } });
      console.log('[image] codex');
      return longJson(res, (signal) => codexImage(body, signal));
    }
    return send(res, 404, { error: { message: '없는 주소입니다.' } });
  } catch (e) {
    return send(res, 400, { error: { message: e instanceof Error ? e.message : String(e) } });
  }
});

server.requestTimeout = 0;
server.listen(PORT, HOST, () => console.log(`AI 서버 실행 중: http://${HOST}:${PORT}`));
