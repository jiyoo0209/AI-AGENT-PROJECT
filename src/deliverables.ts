// 산출물 파일은 서버에 있습니다. 볼 때는 서버에서 읽고, 공유·저장할 때만 기기에 내려받습니다.

import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { authHeaders, serverBase } from './llm';
import { getSettings } from './settings';
import { Deliverable } from './types';

export function fileUrl(d: Deliverable): string {
  return `${serverBase(getSettings())}/v1/files/${d.id}`;
}

export function fileHeaders(): Record<string, string> {
  return authHeaders(getSettings());
}

export async function readText(d: Deliverable): Promise<string> {
  let res: Response;
  try {
    res = await fetch(fileUrl(d), { headers: fileHeaders() });
  } catch {
    throw new Error('서버에 연결하지 못해 파일을 열 수 없어요.');
  }
  if (res.status === 404) throw new Error('서버에서 파일을 찾지 못했어요.');
  if (!res.ok) throw new Error(`파일을 읽지 못했어요 (${res.status}).`);
  const text = await res.text();
  return text.startsWith('﻿') ? text.slice(1) : text;
}

/** 서버의 파일을 기기 캐시에 내려받습니다. */
async function localCopy(d: Deliverable): Promise<File> {
  const dir = new Directory(Paths.cache, 'deliverables', d.id);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const file = new File(dir, d.name);
  if (file.exists && file.size === d.size) return file;
  return File.downloadFileAsync(fileUrl(d), file, { headers: fileHeaders(), idempotent: true });
}

export async function shareDeliverable(d: Deliverable): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('이 기기에서는 공유를 사용할 수 없습니다.');
  const file = await localCopy(d);
  await Sharing.shareAsync(file.uri, { mimeType: d.mime, dialogTitle: d.name });
}

/** Lets the user pick a folder (e.g. Download) and writes a copy there. */
export async function downloadDeliverable(d: Deliverable): Promise<string> {
  const target = await Directory.pickDirectoryAsync();
  const src = await localCopy(d);
  const out = target.createFile(d.name, d.mime);
  if (d.isBinary) {
    await out.write(await src.base64(), { encoding: 'base64' });
  } else {
    await out.write(await src.text());
  }
  return out.name;
}
