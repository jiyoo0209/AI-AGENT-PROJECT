// 산출물 문서 만들기
// 팀원은 Markdown으로 쓰고, 서버가 Word(docx)·Excel(xlsx)·PowerPoint(pptx)로 바꿉니다.
// 앱에서 보기 위해 PDF로 변환한 뒤 페이지를 이미지(WebP)로 만들어 둡니다.
// 퍼블리셔 HTML 화면은 Chrome으로 캡처합니다.
//
// 필요한 프로그램 (없으면 해당 기능만 꺼짐):
//   pandoc (Word), LibreOffice(soffice, PDF 변환), poppler(pdftoppm, 페이지 이미지), Google Chrome(화면 캡처)

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { marked, type Token, type Tokens } from 'marked';
import PptxGenJS from 'pptxgenjs';

const run = promisify(execFile);
// 흐름도 도구(Mermaid). MERMAID_URL 환경 변수로 다른 주소(사내 미러 등)를 쓸 수 있습니다.
const MERMAID_URL = process.env.MERMAID_URL || 'https://cdn.jsdelivr.net/npm/mermaid@12/dist/mermaid.min.js';

export type DocKind = 'docx' | 'xlsx' | 'pptx';

export function docKind(name: string): DocKind | null {
  const ext = name.split('.').pop()?.toLowerCase();
  return ext === 'docx' || ext === 'xlsx' || ext === 'pptx' ? ext : null;
}

function findTool(names: string[], extra: string[] = []): string | null {
  const dirs = [...(process.env.PATH || '').split(':'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin'];
  for (const n of names) for (const d of dirs) if (d && existsSync(join(d, n))) return join(d, n);
  return extra.find((p) => existsSync(p)) ?? null;
}

function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${what} 시간 초과`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

// ---------- Markdown 도우미 ----------

interface Run {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

function runsOf(tokens: Token[] | undefined, style: { bold?: boolean; italic?: boolean } = {}): Run[] {
  const out: Run[] = [];
  for (const t of tokens ?? []) {
    switch (t.type) {
      case 'strong':
        out.push(...runsOf((t as Tokens.Strong).tokens, { ...style, bold: true }));
        break;
      case 'em':
        out.push(...runsOf((t as Tokens.Em).tokens, { ...style, italic: true }));
        break;
      case 'codespan':
        out.push({ text: (t as Tokens.Codespan).text, ...style });
        break;
      case 'br':
        out.push({ text: '\n', ...style });
        break;
      case 'link':
        out.push(...runsOf((t as Tokens.Link).tokens, style));
        break;
      case 'image':
        break;
      default: {
        const anyT = t as { tokens?: Token[]; text?: string };
        if (anyT.tokens?.length) out.push(...runsOf(anyT.tokens, style));
        else if (anyT.text) out.push({ text: decode(anyT.text), ...style });
      }
    }
  }
  return out;
}

function decode(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

function plain(tokens: Token[] | undefined): string {
  return runsOf(tokens)
    .map((r) => r.text)
    .join('')
    .trim();
}

function imagesIn(tokens: Token[] | undefined): string[] {
  const out: string[] = [];
  for (const t of tokens ?? []) {
    if (t.type === 'image') out.push((t as Tokens.Image).href);
    const anyT = t as { tokens?: Token[] };
    if (anyT.tokens) out.push(...imagesIn(anyT.tokens));
  }
  return out;
}

/** 한글은 영문 두 글자 폭으로 셉니다. */
function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) w += /[ᄀ-ᇿ　-鿿가-힯＀-￯]/.test(ch) ? 2 : 1;
  return w;
}

// ---------- Word ----------

let referenceDocx: Promise<string | null> | null = null;

/** pandoc 기본 양식에 표 테두리와 머리글 색을 넣은 양식 파일을 한 번 만들어 둡니다. */
function makeReferenceDocx(pandoc: string, dir: string): Promise<string | null> {
  referenceDocx ??= (async () => {
    const out = join(dir, 'reference.docx');
    if (existsSync(out)) return out;
    try {
      const raw = join(dir, 'reference.raw.docx');
      await run(pandoc, ['-o', raw, '--print-default-data-file', 'reference.docx']);
      const zip = await JSZip.loadAsync(readFileSync(raw));
      let styles = await zip.file('word/styles.xml')!.async('string');
      const start = styles.indexOf('w:styleId="Table"');
      const end = styles.indexOf('</w:style>', start);
      if (start > 0 && end > start) {
        const border = (side: string) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="9CA3AF"/>`;
        let block = styles.slice(start, end);
        block = block.replace(
          '<w:tblPr>',
          `<w:tblPr><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(border).join('')}</w:tblBorders>`,
        );
        block = block.replace(/<w:vAlign w:val="bottom"\s*\/>/, '<w:vAlign w:val="bottom"/><w:shd w:val="clear" w:color="auto" w:fill="DBEAFE"/>');
        styles = styles.slice(0, start) + block + styles.slice(end);
        // 글꼴: 테마 글꼴 대신 맑은 고딕
        styles = styles.replace(/<w:rFonts [^>]*Theme[^>]*\/>/g, '<w:rFonts w:ascii="Malgun Gothic" w:hAnsi="Malgun Gothic" w:eastAsia="Malgun Gothic" w:cs="Malgun Gothic"/>');
        zip.file('word/styles.xml', styles);
      }
      writeFileSync(out, await zip.generateAsync({ type: 'nodebuffer' }));
      rmSync(raw, { force: true });
      return out;
    } catch (e) {
      console.error('[docs] Word 양식 만들기 실패, 기본 양식 사용:', e instanceof Error ? e.message : e);
      return null;
    }
  })();
  return referenceDocx;
}

// ---------- Excel ----------

async function buildXlsx(md: string, out: string, title: string) {
  const tokens = marked.lexer(md);
  const used = new Set<string>();
  const sheetName = (want: string) => {
    const base = (want || '시트').replace(/[\\/*?:[\]]/g, ' ').trim().slice(0, 28) || '시트';
    let name = base;
    for (let i = 2; used.has(name); i++) name = `${base.slice(0, 26)} ${i}`;
    used.add(name);
    return name;
  };

  // 표는 바로 앞 제목을 시트 이름으로, 표 밖의 설명은 '개요' 시트로 모읍니다.
  const tables: { name: string; header: string[]; rows: string[][] }[] = [];
  const notes: { text: string; heading?: boolean }[] = [];
  let heading = title;
  for (const t of tokens) {
    if (t.type === 'heading') {
      heading = plain((t as Tokens.Heading).tokens);
      notes.push({ text: heading, heading: true });
    } else if (t.type === 'table') {
      const table = t as Tokens.Table;
      tables.push({
        name: heading,
        header: table.header.map((c) => plain(c.tokens)),
        rows: table.rows.map((r) => r.map((c) => plain(c.tokens))),
      });
    } else if (t.type === 'list') {
      for (const it of (t as Tokens.List).items) notes.push({ text: `• ${plain(it.tokens)}` });
    } else if (t.type === 'paragraph' || t.type === 'blockquote') {
      const text = plain((t as { tokens?: Token[] }).tokens);
      if (text) notes.push({ text });
    }
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = '나만의사무실';
  if (!tables.length || notes.some((n) => !n.heading)) {
    const ws = wb.addWorksheet(sheetName('개요'));
    ws.getColumn(1).width = 100;
    ws.addRow([title]).font = { bold: true, size: 14 };
    for (const n of notes) {
      const row = ws.addRow([n.text]);
      row.alignment = { wrapText: true, vertical: 'top' };
      if (n.heading) row.font = { bold: true };
    }
  }
  const border = { style: 'thin' as const, color: { argb: 'FF9CA3AF' } };
  for (const tb of tables) {
    const ws = wb.addWorksheet(sheetName(tb.name), {
      views: [{ state: 'frozen', ySplit: 1 }],
      pageSetup: { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
    });
    ws.addRow(tb.header);
    for (const r of tb.rows) ws.addRow(r);
    ws.eachRow((row, i) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        cell.border = { top: border, left: border, bottom: border, right: border };
        cell.alignment = { vertical: 'top', wrapText: true };
        cell.font = { name: 'Malgun Gothic', size: 10 };
        if (i === 1) {
          cell.font = { name: 'Malgun Gothic', size: 10, bold: true };
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBEAFE' } };
          cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
        }
      });
    });
    tb.header.forEach((h, i) => {
      const longest = Math.max(displayWidth(h), ...tb.rows.map((r) => displayWidth(r[i] ?? '')));
      ws.getColumn(i + 1).width = Math.min(60, Math.max(10, longest + 3));
    });
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: tb.header.length } };
  }
  await wb.xlsx.writeFile(out);
}

// ---------- PowerPoint ----------

interface SlideSpec {
  title: string;
  image?: string;
  diagram?: string; // ```mermaid 코드
  bullets: { runs: Run[]; level: number }[];
  table?: string[][];
  notes: string[];
}

/**
 * 슬라이드는 '---' 줄이나 #, ## 제목으로 나눕니다.
 * 슬라이드 안의 ![](파일명) 이미지나 ```mermaid 흐름도는 왼쪽에, 목록·표·문단은 오른쪽(이미지가 없으면 전체)에 둡니다.
 * 글이 없는 흐름도 슬라이드는 흐름도를 전체 폭으로 그립니다.
 */
function slidesFrom(md: string, fallbackTitle: string): SlideSpec[] {
  const slides: SlideSpec[] = [];
  let cur: SlideSpec | null = null;
  const empty = (s: SlideSpec) => !s.bullets.length && !s.image && !s.diagram && !s.table;
  const ensure = (): SlideSpec => {
    if (!cur) {
      cur = { title: '', bullets: [], notes: [] };
      slides.push(cur);
    }
    return cur;
  };
  const addList = (list: Tokens.List, level: number) => {
    const s = ensure();
    for (const item of list.items) {
      const own = item.tokens.filter((x) => x.type !== 'list');
      s.bullets.push({ runs: runsOf(own.flatMap((x) => (x as { tokens?: Token[] }).tokens ?? [x])), level });
      for (const sub of item.tokens.filter((x) => x.type === 'list')) addList(sub as Tokens.List, level + 1);
    }
  };

  for (const t of marked.lexer(md)) {
    if (t.type === 'hr') {
      cur = null;
    } else if (t.type === 'heading') {
      const h = t as Tokens.Heading;
      const text = plain(h.tokens);
      if (h.depth <= 2) {
        if (cur && !empty(cur)) cur = null;
        const s = ensure();
        if (!s.title) s.title = text;
        else s.bullets.push({ runs: [{ text, bold: true }], level: -1 });
      } else {
        ensure().bullets.push({ runs: [{ text, bold: true }], level: -1 });
      }
    } else if (t.type === 'list') {
      addList(t as Tokens.List, 0);
    } else if (t.type === 'table') {
      const table = t as Tokens.Table;
      ensure().table = [table.header.map((c) => plain(c.tokens)), ...table.rows.map((r) => r.map((c) => plain(c.tokens)))];
    } else if (t.type === 'paragraph') {
      const p = t as Tokens.Paragraph;
      const s = ensure();
      const imgs = imagesIn(p.tokens);
      if (imgs.length && !s.image) s.image = imgs[0];
      const text = runsOf(p.tokens);
      if (text.some((r) => r.text.trim())) s.bullets.push({ runs: text, level: -1 });
    } else if (t.type === 'code' && (t as Tokens.Code).lang?.trim().toLowerCase() === 'mermaid') {
      const s = ensure();
      if (!s.diagram) s.diagram = (t as Tokens.Code).text;
    } else if (t.type === 'blockquote') {
      const text = plain((t as Tokens.Blockquote).tokens);
      if (text) ensure().notes.push(text);
    }
  }
  for (const s of slides) if (!s.title) s.title = fallbackTitle;
  return slides.filter((s) => !empty(s) || s.title !== fallbackTitle);
}

// 글자 폭을 대략 셉니다 (인치). 한글·한자는 글자 크기만큼, 그 밖은 절반 남짓.
function textWidthIn(text: string, pt: number): number {
  let em = 0;
  for (const ch of text) em += /[\u1100-\u11ff\u3000-\u9fff\uac00-\ud7af\uff00-\uffef]/.test(ch) ? 1 : 0.56;
  return (em * pt) / 72;
}
const linesFor = (text: string, pt: number, widthIn: number) => Math.max(1, Math.ceil(textWidthIn(text, pt) / Math.max(0.5, widthIn)));

type Bullet = SlideSpec['bullets'][number];
const bulletLead = (b: Bullet) => (b.level >= 0 ? `${'      '.repeat(b.level)}${b.level === 0 ? '•' : '–'} ` : '');
const PARA_GAP = 6; // pt

/** 글머리표 하나가 차지하는 높이 (인치) */
function bulletHeight(b: Bullet, pt: number, widthIn: number): number {
  const text = bulletLead(b) + b.runs.map((r) => r.text).join('');
  return text.split('\n').reduce((h, line) => h + (linesFor(line, pt, widthIn) * pt * 1.2) / 72, 0) + PARA_GAP / 72;
}

/** 표의 높이 (인치) */
function tableHeight(table: string[][], pt: number, widthIn: number): number {
  const colW = widthIn / Math.max(1, table[0]?.length ?? 1) - 0.1;
  return table.reduce((h, row) => h + (Math.max(...row.map((c) => linesFor(c, pt, colW))) * pt * 1.25) / 72 + 0.1, 0);
}

async function buildPptx(
  md: string,
  out: string,
  title: string,
  resolveImage: (ref: string) => Promise<string | null>,
  renderDiagram: (code: string) => Promise<string | null>,
) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
  pptx.title = title;
  const font = 'Malgun Gothic';
  const W = 13.33;
  const BOTTOM = 6.95; // 이 아래는 쪽 번호 자리
  const made: ReturnType<typeof pptx.addSlide>[] = [];
  // 내용이 한 장에 다 들어가지 않으면 남은 글머리표를 "(계속)" 슬라이드로 넘깁니다.
  const queue = slidesFrom(md, title);
  while (queue.length) {
    const s = queue.shift()!;
    const slide = pptx.addSlide();
    made.push(slide);
    slide.background = { color: 'FFFFFF' };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.12, fill: { color: '2563EB' }, line: { color: '2563EB' } });
    slide.addText(s.title, { x: 0.5, y: 0.3, w: W - 1, h: 0.7, fontFace: font, fontSize: 24, bold: true, color: '111827', fit: 'shrink' });
    slide.addShape(pptx.ShapeType.line, { x: 0.5, y: 1.05, w: W - 1, h: 0, line: { color: 'D1D5DB', width: 1 } });

    let textX = 0.5;
    let textW = W - 1;
    if (s.image || s.diagram) {
      const path = s.image
        ? await resolveImage(s.image).catch(() => null)
        : await renderDiagram(s.diagram!).catch(() => null);
      // 글이 없는 흐름도는 전체 폭, 그 밖에는 왼쪽 5.6in 상자에 놓습니다.
      const fullWidth = !s.image && !s.bullets.length && !s.table;
      const boxW = fullWidth ? W - 1 : 5.6;
      const boxH = 5.6;
      if (path) {
        // 이미지 비율을 지켜 상자 가운데에 놓습니다.
        let w = boxW;
        let h = boxH;
        try {
          const sharp = (await import('sharp')).default;
          const m = await sharp(path).metadata();
          if (m.width && m.height) {
            const r = m.width / m.height;
            if (r >= boxW / boxH) h = boxW / r;
            else w = boxH * r;
          }
        } catch {
          // 크기를 모르면 상자에 맞춤
        }
        slide.addImage({ path, x: 0.5 + (boxW - w) / 2, y: 1.25 + (boxH - h) / 2, w, h });
      } else if (s.diagram) {
        slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 1.25, w: boxW, h: boxH, fill: { color: 'F3F4F6' }, line: { color: 'D1D5DB', dashType: 'dash' } });
        slide.addText('흐름도를 그리지 못했어요.\n원본은 슬라이드 노트에 있어요.', {
          x: 0.5, y: 1.25, w: boxW, h: boxH, align: 'center', fontFace: font, fontSize: 12, color: '6B7280',
        });
        s.notes.push(s.diagram);
      } else {
        slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 1.25, w: 5.6, h: 5.6, fill: { color: 'F3F4F6' }, line: { color: 'D1D5DB', dashType: 'dash' } });
        slide.addText(`화면 이미지 준비 중\n${s.image}\n(퍼블리셔가 화면을 만들면 자동으로 채워져요)`, {
          x: 0.5, y: 1.25, w: 5.6, h: 5.6, align: 'center', fontFace: font, fontSize: 12, color: '6B7280',
        });
      }
      if (!fullWidth) {
        textX = 6.4;
        textW = W - 6.9;
      }
    }

    let y = 1.3;
    if (s.table?.length) {
      // 표가 길면 글자를 줄입니다.
      let pt = 11;
      while (pt > 8 && y + tableHeight(s.table, pt, textW) > BOTTOM - (s.bullets.length ? 1.2 : 0)) pt--;
      const rows = s.table.map((r, i) =>
        r.map((c) => ({ text: c, options: i === 0 ? { bold: true, fill: { color: 'DBEAFE' } } : {} })),
      );
      slide.addTable(rows, { x: textX, y, w: textW, fontFace: font, fontSize: pt, border: { type: 'solid', color: '9CA3AF', pt: 0.75 }, autoPage: false });
      y += tableHeight(s.table, pt, textW) + 0.25;
    }
    if (s.bullets.length) {
      const room = BOTTOM - y;
      const innerW = textW - 0.25; // 글상자 안쪽 여백
      const total = (pt: number) => s.bullets.reduce((h, b) => h + bulletHeight(b, pt, innerW), 0);
      // 14pt에서 시작해 들어갈 때까지 줄이고, 10pt로도 넘치면 다음 슬라이드로 나눕니다.
      let pt = 14;
      while (pt > 10 && total(pt) > room) pt--;
      let shown = s.bullets;
      if (total(pt) > room) {
        let used = 0;
        let n = 0;
        while (n < s.bullets.length && used + bulletHeight(s.bullets[n], pt, innerW) <= room) used += bulletHeight(s.bullets[n++], pt, innerW);
        n = Math.max(1, n);
        shown = s.bullets.slice(0, n);
        const rest = s.bullets.slice(n);
        if (rest.length) queue.unshift({ title: s.title.endsWith('(계속)') ? s.title : `${s.title} (계속)`, bullets: rest, notes: [] });
      }
      // pptxgenjs는 한 문단 안에서 굵기가 섞이면 글머리표가 깨져서, 글머리표 문자를 직접 붙입니다.
      const items = shown.flatMap((b) =>
        b.runs.map((r, j) => ({
          text: (j === 0 ? bulletLead(b) : '') + r.text,
          options: { bold: r.bold, italic: r.italic, breakLine: j === b.runs.length - 1 },
        })),
      );
      slide.addText(items, { x: textX, y, w: textW, h: Math.max(0.5, BOTTOM - y), valign: 'top', fontFace: font, fontSize: pt, color: '1F2937', paraSpaceAfter: PARA_GAP });
    }
    if (s.notes.length) slide.addNotes(s.notes.join('\n'));
  }
  made.forEach((slide, i) =>
    slide.addText(`${title}  ·  ${i + 1}/${made.length}`, { x: 0.5, y: 7.05, w: W - 1, h: 0.3, fontFace: font, fontSize: 9, color: '9CA3AF', align: 'right' }),
  );
  if (!made.length) pptx.addSlide().addText(title, { x: 0.5, y: 3, w: W - 1, h: 1, fontSize: 28, bold: true, align: 'center' });
  await pptx.writeFile({ fileName: out });
}

// ---------- 바깥에 여는 함수 ----------

/** 이 컴퓨터에 있는 한글 글꼴 이름 (맑은 고딕이 있으면 null) */
function localKoreanFont(): string | null {
  const home = process.env.HOME ?? '';
  const has = (...files: string[]) => files.some((f) => existsSync(f));
  if (has('/Library/Fonts/malgun.ttf', join(home, 'Library/Fonts/malgun.ttf'), '/usr/share/fonts/truetype/malgun.ttf')) return null;
  // 나눔고딕은 PDF에 글꼴을 넣을 수 있어 가장 확실합니다 (brew install --cask font-nanum-gothic).
  // 맥 시스템 글꼴(Apple SD Gothic Neo)은 PDF에 들어가지 않아 미리보기 이미지에서 글자가 빠질 수 있어요.
  const nanum = [join(home, 'Library/Fonts'), '/Library/Fonts', '/usr/share/fonts/truetype/nanum'].some((d) => {
    try {
      return readdirSync(d).some((f) => /^NanumGothic(-Regular)?\.(ttf|otf)$/i.test(f));
    } catch {
      return false;
    }
  });
  if (nanum) return 'NanumGothic';
  if (has('/System/Library/Fonts/AppleSDGothicNeo.ttc')) return 'Apple SD Gothic Neo';
  if (has('/System/Library/Fonts/Supplemental/AppleGothic.ttf')) return 'AppleGothic';
  if (has('/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc', '/usr/share/fonts/noto-cjk/NotoSansCJK-Regular.ttc')) return 'Noto Sans CJK KR';
  return null;
}

/** LibreOffice 설정에 "맑은 고딕 → 이 컴퓨터의 한글 글꼴" 바꾸기를 넣습니다. */
function setupFontReplacement(profile: string, font = localKoreanFont()) {
  if (!font) return;
  try {
    const dir = join(profile, 'user');
    const file = join(dir, 'registrymodifications.xcu');
    const items =
      '<item oor:path="/org.openoffice.Office.Common/Font/Substitution"><prop oor:name="Replacement" oor:op="fuse"><value>true</value></prop></item>' +
      ['Malgun Gothic', '맑은 고딕']
        .map(
          (from, i) =>
            `<item oor:path="/org.openoffice.Office.Common/Font/Substitution/FontPairs"><node oor:name="_${i}" oor:op="replace">` +
            '<prop oor:name="Always" oor:op="fuse"><value>true</value></prop>' +
            '<prop oor:name="OnScreenOnly" oor:op="fuse"><value>false</value></prop>' +
            `<prop oor:name="ReplaceFont" oor:op="fuse"><value>${from}</value></prop>` +
            `<prop oor:name="SubstituteFont" oor:op="fuse"><value>${font}</value></prop></node></item>`,
        )
        .join('');
    mkdirSync(dir, { recursive: true });
    if (!existsSync(file)) {
      writeFileSync(
        file,
        '<?xml version="1.0" encoding="UTF-8"?>\n<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">\n' +
          items +
          '\n</oor:items>\n',
      );
    } else {
      const xml = readFileSync(file, 'utf8');
      // LibreOffice가 설정 파일을 다시 쓰면서 주석은 지우므로, 바꿀 글꼴 값으로 이미 넣었는지 봅니다.
      if (xml.includes(`<value>${font}</value>`)) return;
      writeFileSync(file, xml.replace('</oor:items>', items + '\n</oor:items>'));
    }
    console.log(`[docs] PDF 한글 글꼴: 맑은 고딕 → ${font}`);
  } catch (e) {
    console.error('[docs] 글꼴 설정 실패', e instanceof Error ? e.message : e);
  }
}

export function createDocuments(dataDir: string) {
  const work = join(dataDir, 'work');
  const previews = join(dataDir, 'previews');
  mkdirSync(work, { recursive: true });
  mkdirSync(previews, { recursive: true });

  const pandoc = findTool(['pandoc']);
  const soffice = findTool(['soffice', 'libreoffice'], ['/Applications/LibreOffice.app/Contents/MacOS/soffice']);
  const pdftoppm = findTool(['pdftoppm']);
  const pdffonts = findTool(['pdffonts']);
  console.log(
    `[docs] Word: ${pandoc ? '사용' : '없음 (brew install pandoc)'} · PDF 미리보기: ${
      soffice && pdftoppm ? '사용' : '없음 (brew install --cask libreoffice && brew install poppler)'
    }`,
  );

  type SharpFn = (typeof import('sharp'))['default'];
  let sharp: SharpFn | null = null;
  const sharpReady = import('sharp').then(
    (m) => (sharp = m.default),
    () => null,
  );

  // 문서는 윈도우 기본 글꼴(맑은 고딕)로 만듭니다. 맥미니에는 맑은 고딕이 없어 PDF에서 한글이 빠지므로
  // LibreOffice의 글꼴 바꾸기 표로 이 컴퓨터에 있는 한글 글꼴을 대신 쓰게 합니다.
  const loProfile = join(work, 'lo-profile');
  setupFontReplacement(loProfile);

  // LibreOffice는 한 번에 하나씩만 돌립니다.
  let officeQueue: Promise<unknown> = Promise.resolve();
  function serial<T>(job: () => Promise<T>): Promise<T> {
    const next = officeQueue.then(job, job);
    officeQueue = next.catch(() => {});
    return next;
  }

  let browser: Promise<import('playwright-core').Browser | null> | null = null;
  function getBrowser() {
    browser ??= (async () => {
      try {
        const { chromium } = await import('playwright-core');
        for (const opts of [{ channel: 'chrome' }, {}, { executablePath: findTool(['google-chrome', 'chromium', 'chromium-browser']) ?? undefined }]) {
          try {
            return await chromium.launch({ headless: true, ...opts });
          } catch {
            // 다음 방법
          }
        }
      } catch {
        // playwright-core 없음
      }
      console.log('[docs] Chrome을 찾지 못해 화면 캡처를 끕니다. (Google Chrome 설치 또는 npx playwright-core install chromium)');
      return null;
    })();
    return browser;
  }

  const shooting = new Map<string, Promise<string | null>>();
  const pagePath = (id: string, n: number, thumb = false) => join(previews, `${id}-p${n}${thumb ? '-t' : ''}.webp`);
  const pdfPath = (id: string) => join(previews, `${id}.pdf`);
  const shotPath = (id: string) => join(previews, `${id}-shot.png`);

  return {
    canWord: () => !!pandoc,
    canPreview: () => !!(soffice && pdftoppm),

    /** Markdown을 kind 형식 파일(out)로 만듭니다. */
    async build(
      kind: DocKind,
      md: string,
      out: string,
      opts: { title: string; resourceDirs: string[]; resolveImage: (ref: string) => Promise<string | null> },
    ) {
      if (kind === 'xlsx') return withTimeout(buildXlsx(md, out, opts.title), 60_000, 'Excel 만들기');
      if (kind === 'pptx') return withTimeout(buildPptx(md, out, opts.title, opts.resolveImage, renderDiagram), 180_000, 'PPT 만들기');
      if (!pandoc) throw new Error('맥미니에 pandoc이 없어 Word 파일을 만들 수 없어요. (brew install pandoc)');
      const ref = await makeReferenceDocx(pandoc, work);
      const src = join(work, `${basename(out)}.${Date.now()}.md`);
      writeFileSync(src, md);
      try {
        await run(
          pandoc,
          ['-f', 'gfm', '-t', 'docx', `--resource-path=${opts.resourceDirs.join(':')}`, ...(ref ? [`--reference-doc=${ref}`] : []), '-o', out, src],
          { timeout: 60_000 },
        );
      } finally {
        rmSync(src, { force: true });
      }
    },

    /** 문서를 PDF로 바꾸고 페이지 이미지를 만듭니다. 페이지 수를 돌려줍니다. */
    async preview(id: string, file: string): Promise<number> {
      if (!soffice || !pdftoppm) throw new Error('PDF 미리보기 도구가 없어요. (brew install --cask libreoffice && brew install poppler)');
      await sharpReady;
      if (!sharp) throw new Error('sharp가 없어요. (cd server && npm install)');
      const dir = join(work, id);
      mkdirSync(dir, { recursive: true });
      try {
        const ext = file.split('.').pop();
        const input = join(dir, `doc.${ext}`);
        writeFileSync(input, readFileSync(file));
        await serial(() =>
          run(
            soffice,
            ['--headless', '--norestore', `-env:UserInstallation=${pathToFileURL(loProfile).href}`, '--convert-to', 'pdf', '--outdir', dir, input],
            { timeout: 120_000 },
          ),
        );
        const pdf = join(dir, 'doc.pdf');
        if (!existsSync(pdf)) throw new Error('PDF 변환 결과가 없어요.');
        // PDF에 들어가지 않은 글꼴은 미리보기 이미지에서 글자가 빠집니다. 원인을 찾을 수 있게 로그에 남깁니다.
        if (pdffonts) {
          const { stdout } = await run(pdffonts, [pdf], { timeout: 30_000 }).catch(() => ({ stdout: '' }));
          const rows = stdout.split('\n').slice(2).filter((l) => l.trim());
          const missing = rows.filter((l) => / no +(yes|no) +(yes|no) +\d+/.test(l)).map((l) => l.split(/\s+/)[0]);
          console.log(`[docs] PDF 글꼴: ${rows.map((l) => l.split(/\s+/)[0]).join(', ') || '(없음)'}${missing.length ? ` · PDF에 안 들어간 글꼴: ${missing.join(', ')}` : ''}`);
        }
        await run(pdftoppm, ['-r', '110', '-png', '-l', '40', pdf, join(dir, 'page')], { timeout: 120_000 });
        const pages = readdirSync(dir)
          .filter((f) => /^page-\d+\.png$/.test(f))
          .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
        let n = 0;
        for (const p of pages) {
          n++;
          const png = join(dir, p);
          await sharp(png).resize(1400, 1400, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 80 }).toFile(pagePath(id, n));
          await sharp(png).resize(360, 360, { fit: 'inside' }).webp({ quality: 70 }).toFile(pagePath(id, n, true));
        }
        renameSync(pdf, pdfPath(id));
        return n;
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    },

    /** HTML 화면을 휴대폰 크기로 캡처합니다 (PNG). 실패하면 null. 같은 화면을 동시에 찍지 않습니다. */
    screenshot(id: string, htmlFile: string): Promise<string | null> {
      const out = shotPath(id);
      if (existsSync(out)) return Promise.resolve(out);
      if (!shooting.has(id)) shooting.set(id, takeShot(id, htmlFile).finally(() => shooting.delete(id)));
      return shooting.get(id)!;
    },

    pagePath,
    pdfPath,
    shotPath,
  };

  /** ```mermaid 흐름도를 Chrome으로 그려 PNG 경로를 돌려줍니다. 같은 내용은 다시 그리지 않습니다. */
  async function renderDiagram(code: string): Promise<string | null> {
    const dir = join(work, 'diagrams');
    mkdirSync(dir, { recursive: true });
    const out = join(dir, `${createHash('sha1').update(code).digest('hex')}.png`);
    if (existsSync(out)) return out;
    const b = await getBrowser();
    if (!b) return null;
    const page = await b.newPage({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 2 });
    try {
      await page.setContent('<!doctype html><html><body style="margin:0;background:#fff"><div id="c" style="display:inline-block;padding:16px"></div></body></html>');
      await withTimeout(page.addScriptTag({ url: MERMAID_URL }), 20_000, '흐름도 도구 받기');
      await withTimeout(
        page.evaluate(async (src) => {
          const m = (globalThis as unknown as { mermaid: { initialize(c: object): void; render(id: string, s: string): Promise<{ svg: string }> } }).mermaid;
          m.initialize({ startOnLoad: false, theme: 'neutral', fontFamily: '"Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans KR", sans-serif' });
          const { svg } = await m.render('flow', src);
          document.getElementById('c')!.innerHTML = svg;
        }, code),
        20_000,
        '흐름도 그리기',
      );
      await page.locator('#c').screenshot({ path: out + '.tmp.png' });
      renameSync(out + '.tmp.png', out);
      return out;
    } catch (e) {
      console.error('[docs] 흐름도 그리기 실패:', e instanceof Error ? e.message : e);
      return null;
    } finally {
      await page.close().catch(() => {});
    }
  }

  async function takeShot(id: string, htmlFile: string): Promise<string | null> {
    const b = await getBrowser();
    if (!b) return null;
    const out = shotPath(id);
    if (existsSync(out)) return out;
    const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    try {
      await withTimeout(page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load' }), 20_000, '화면 열기');
      // Tailwind·daisyUI·Alpine을 CDN에서 받아 스타일을 입힐 때까지 기다립니다.
      await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
      await page.waitForTimeout(700);
      await page.screenshot({ path: out + '.tmp.png' });
      renameSync(out + '.tmp.png', out);
      await sharpReady;
      if (sharp) {
        await sharp(out).resize(360, 780, { fit: 'inside' }).webp({ quality: 70 }).toFile(pagePath(id, 1, true));
        await sharp(out).resize(780, 1690, { fit: 'inside' }).webp({ quality: 80 }).toFile(pagePath(id, 1));
      }
      return out;
    } catch (e) {
      console.error('[docs] 화면 캡처 실패:', e instanceof Error ? e.message : e);
      return null;
    } finally {
      await page.close().catch(() => {});
    }
  }
}

export type Documents = ReturnType<typeof createDocuments>;
