// 산출물 파일은 서버에 있습니다. 볼 때는 서버에서 읽고, 공유·저장할 때만 기기에 내려받습니다.

import { Directory, File, Paths } from 'expo-file-system';
import { getContentUriAsync } from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Sharing from 'expo-sharing';
import { authHeaders, serverBase } from './llm';
import { getSettings } from './settings';
import { currentIdStore } from './store';
import { Deliverable } from './types';

/** thumb: 목록용 작은 이미지, preview: 화면용 이미지 (둘 다 서버가 작게 줄인 WebP). 없으면 원본. */
export type ImageVariant = 'thumb' | 'preview';

export function fileUrl(d: Deliverable, variant?: ImageVariant): string {
  return `${serverBase(getSettings())}/v1/files/${d.id}${variant ? `?v=${variant}` : ''}`;
}

/** expo-image에 넘길 이미지 주소. 같은 산출물은 내용이 바뀌지 않으므로 기기에 오래 캐시합니다. */
export function imageSource(d: Deliverable, variant: ImageVariant) {
  return stableSource(fileUrl(d, variant));
}

// 서버 상태가 바뀔 때마다(팀원이 일하는 동안 몇 초마다) 화면이 다시 그려집니다.
// 이미지 주소 객체를 새로 만들면 expo-image가 같은 이미지를 처음부터 다시 불러와 깜빡이므로, 같은 주소는 같은 객체를 씁니다.
type Source = { uri: string; headers: Record<string, string> };
const sources = new Map<string, Source>();
function stableSource(uri: string): Source {
  const headers = fileHeaders();
  const cached = sources.get(uri);
  if (cached && cached.headers.authorization === headers.authorization) return cached;
  if (sources.size > 500) sources.clear();
  const s = { uri, headers };
  sources.set(uri, s);
  return s;
}

export function fileHeaders(): Record<string, string> {
  return authHeaders(getSettings());
}

export type DocKind = 'docx' | 'xlsx' | 'pptx';

/** Word·Excel·PPT 산출물이면 종류를, 아니면 null */
export function docKind(d: Deliverable): DocKind | null {
  const ext = d.name.split('.').pop()?.toLowerCase();
  return ext === 'docx' || ext === 'xlsx' || ext === 'pptx' ? ext : null;
}

export const isScreen = (d: Deliverable) => d.mime === 'text/html';
export const isApk = (d: Deliverable) => d.name.toLowerCase().endsWith('.apk');

/** 미리보기(문서 첫 페이지, 화면 캡처, 이미지)가 있어 썸네일을 보여 줄 수 있는지 */
export function hasThumb(d: Deliverable): boolean {
  if (d.preview) return d.preview.status === 'ready';
  return d.isBinary && d.mime.startsWith('image/');
}

/** 문서 미리보기의 n번째 페이지 이미지 */
export function pageSource(d: Deliverable, n: number, thumb = false) {
  return stableSource(`${serverBase(getSettings())}/v1/files/${d.id}/page/${n}${thumb ? '?v=thumb' : ''}`);
}

let siteBase = '';
/** 서버가 알려 준 화면 실행 주소의 앞부분 (/site/...) */
export function setSiteBase(base: string | undefined) {
  if (base) siteBase = base;
}

/** 퍼블리셔 화면을 앱 안에서 실행할 주소. 아직 서버와 연결 전이면 null */
export function siteUrl(d: Deliverable): string | null {
  const pid = currentIdStore.get();
  return siteBase && pid ? `${serverBase(getSettings())}${siteBase}/${pid}/${d.role}/${encodeURIComponent(d.name)}` : null;
}

export async function readText(d: Deliverable): Promise<string> {
  let file: File;
  try {
    // Word·Excel·PPT는 팀원이 쓴 Markdown 원본을 읽습니다.
    file = await localCopy(d, d.source ? 'source' : undefined);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(/404/.test(msg) ? '서버에서 파일을 찾지 못했어요.' : '서버에 연결하지 못해 파일을 열 수 없어요.');
  }
  const text = await file.text();
  return text.startsWith('\uFEFF') ? text.slice(1) : text;
}

/** 서버의 파일을 기기 캐시에 내려받습니다. 한 번 받은 파일은 다시 받지 않습니다. */
async function localCopy(d: Deliverable, kind?: 'pdf' | 'source'): Promise<File> {
  const dir = new Directory(Paths.cache, 'deliverables', d.id);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  const base = d.name.replace(/\.\w+$/, '');
  const name = kind === 'pdf' ? `${base}.pdf` : kind === 'source' ? `${base}.md` : d.name;
  const file = new File(dir, name);
  if (file.exists && (kind ? file.size > 0 : file.size === d.size)) return file;
  const url = kind === 'pdf' ? `${fileUrl(d)}/pdf` : kind === 'source' ? `${fileUrl(d)}?v=source` : fileUrl(d);
  return File.downloadFileAsync(url, file, { headers: fileHeaders(), idempotent: true });
}

/** APK를 내려받아 안드로이드 설치 화면을 엽니다. */
export async function installApk(d: Deliverable): Promise<void> {
  const file = await localCopy(d);
  const uri = await getContentUriAsync(file.uri);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: uri,
    flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
    type: 'application/vnd.android.package-archive',
  });
}

/** 문서를 PDF로 공유합니다 (다른 앱으로 열기). */
export async function sharePdf(d: Deliverable): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) throw new Error('이 기기에서는 공유를 사용할 수 없습니다.');
  const file = await localCopy(d, 'pdf');
  await Sharing.shareAsync(file.uri, { mimeType: 'application/pdf', dialogTitle: file.name });
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
