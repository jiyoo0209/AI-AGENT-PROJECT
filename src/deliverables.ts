import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { GeneratedImage } from './llm';
import { newId, projectStore } from './store';
import { Deliverable, RoleId } from './types';

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

function roleDir(role: RoleId): Directory {
  const dir = new Directory(Paths.document, 'deliverables', role);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function upsert(d: Deliverable): Deliverable {
  projectStore.set((p) => {
    const rest = p.deliverables.filter((x) => !(x.role === d.role && x.name === d.name));
    return { ...p, deliverables: [...rest, d] };
  });
  return d;
}

export async function saveTextDeliverable(
  role: RoleId,
  name: string,
  content: string,
  taskId?: string,
): Promise<Deliverable> {
  const file = new File(roleDir(role), name);
  file.create({ overwrite: true });
  // A BOM lets Excel open Korean CSV files without broken characters.
  const body = name.toLowerCase().endsWith('.csv') && !content.startsWith('﻿') ? '﻿' + content : content;
  await file.write(body);
  return upsert({
    id: newId(),
    role,
    name,
    mime: mimeFor(name),
    uri: file.uri,
    isBinary: false,
    size: content.length,
    taskId,
    createdAt: Date.now(),
  });
}

export async function saveImageDeliverable(
  role: RoleId,
  name: string,
  image: GeneratedImage,
  taskId?: string,
): Promise<Deliverable> {
  const dir = roleDir(role);
  const file = new File(dir, name);
  if (file.exists) file.delete();
  if (image.base64) {
    file.create({ overwrite: true });
    await file.write(image.base64, { encoding: 'base64' });
  } else if (image.url) {
    await File.downloadFileAsync(image.url, file);
  }
  return upsert({
    id: newId(),
    role,
    name,
    mime: mimeFor(name),
    uri: file.uri,
    isBinary: true,
    size: file.size ?? 0,
    taskId,
    createdAt: Date.now(),
  });
}

export async function readText(d: Deliverable): Promise<string> {
  const text = await new File(d.uri).text();
  return text.startsWith('﻿') ? text.slice(1) : text;
}

export async function shareDeliverable(d: Deliverable): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('이 기기에서는 공유를 사용할 수 없습니다.');
  await Sharing.shareAsync(d.uri, { mimeType: d.mime, dialogTitle: d.name });
}

/** Lets the user pick a folder (e.g. Download) and writes a copy there. */
export async function downloadDeliverable(d: Deliverable): Promise<string> {
  const target = await Directory.pickDirectoryAsync();
  const src = new File(d.uri);
  const out = target.createFile(d.name, d.mime);
  if (d.isBinary) {
    await out.write(await src.base64(), { encoding: 'base64' });
  } else {
    await out.write(await src.text());
  }
  return out.name;
}
