/** AI 답변에서 파일·이미지 요청·계획을 뽑아냅니다. 앱과 서버가 같이 씁니다. */

const FILE_RE = /<<<FILE:\s*([^\n]+?)\s*\n([\s\S]*?)\n?>>>END/g;
const IMAGE_RE = /<<<IMAGE_PROMPT\s*\n([\s\S]*?)\n?>>>END/g;
const PLAN_RE = /<<<PLAN\s*\n([\s\S]*?)\n?>>>END/g;

export interface ParsedReply {
  text: string;
  files: { name: string; content: string }[];
  imagePrompts: string[];
  planJson?: string;
}

export function parseReply(reply: string): ParsedReply {
  const files: { name: string; content: string }[] = [];
  const imagePrompts: string[] = [];
  let planJson: string | undefined;
  let text = reply.replace(FILE_RE, (_m, name: string, content: string) => {
    files.push({ name: sanitizeName(name), content: stripFence(content) });
    return '';
  });
  text = text.replace(IMAGE_RE, (_m, prompt: string) => {
    if (prompt.trim()) imagePrompts.push(prompt.trim());
    return '';
  });
  text = text.replace(PLAN_RE, (_m, json: string) => {
    planJson = json;
    return '';
  });
  return { text: text.replace(/\n{3,}/g, '\n\n').trim(), files, imagePrompts, planJson };
}

/** Models sometimes wrap file contents in a code fence; the file should not contain it. */
function stripFence(content: string): string {
  const m = content.match(/^\s*```[^\n]*\n([\s\S]*?)\n```\s*$/);
  return m ? m[1] : content;
}

function sanitizeName(name: string): string {
  const cleaned = name
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '_')
    .replace(/\s+/g, '_');
  return cleaned || 'output.txt';
}

const MIME: Record<string, string> = {
  md: 'text/markdown',
  markdown: 'text/markdown',
  txt: 'text/plain',
  csv: 'text/csv',
  tsv: 'text/tab-separated-values',
  html: 'text/html',
  htm: 'text/html',
  css: 'text/css',
  json: 'application/json',
  js: 'text/javascript',
  mjs: 'text/javascript',
  pdf: 'application/pdf',
  apk: 'application/vnd.android.package-archive',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xml: 'application/xml',
  sql: 'text/plain',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

export function mimeFor(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return MIME[ext] ?? 'text/plain';
}
