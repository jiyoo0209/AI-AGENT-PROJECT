// 산출물 문서 만들기
// 팀원은 Markdown으로 쓰고, 서버가 Word(docx)·Excel(xlsx)·PowerPoint(pptx)로 바꿉니다.
// 앱에서 보기 위해 PDF로 변환한 뒤 페이지를 이미지(WebP)로 만들어 둡니다.
// 퍼블리셔 HTML 화면은 Chrome으로 캡처합니다.
//
// 필요한 프로그램 (없으면 해당 기능만 꺼짐):
//   pandoc (Word), LibreOffice(soffice, PDF 변환), poppler(pdftoppm, 페이지 이미지), Google Chrome(화면 캡처)

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { marked, type Token, type Tokens } from 'marked';
import PptxGenJS from 'pptxgenjs';

const run = promisify(execFile);

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
  bullets: { runs: Run[]; level: number }[];
  table?: string[][];
  notes: string[];
}

/**
 * 슬라이드는 '---' 줄이나 #, ## 제목으로 나눕니다.
 * 슬라이드 안의 ![](파일명) 이미지는 왼쪽에, 목록·표·문단은 오른쪽(이미지가 없으면 전체)에 둡니다.
 */
function slidesFrom(md: string, fallbackTitle: string): SlideSpec[] {
  const slides: SlideSpec[] = [];
  let cur: SlideSpec | null = null;
  const empty = (s: SlideSpec) => !s.bullets.length && !s.image && !s.table;
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
    } else if (t.type === 'blockquote') {
      const text = plain((t as Tokens.Blockquote).tokens);
      if (text) ensure().notes.push(text);
    }
  }
  for (const s of slides) if (!s.title) s.title = fallbackTitle;
  return slides.filter((s) => !empty(s) || s.title !== fallbackTitle);
}

async function buildPptx(md: string, out: string, title: string, resolveImage: (ref: string) => Promise<string | null>) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE'; // 13.33 x 7.5 in
  pptx.title = title;
  const font = 'Malgun Gothic';
  const W = 13.33;
  const slides = slidesFrom(md, title);
  let index = 0;
  for (const s of slides) {
    index++;
    const slide = pptx.addSlide();
    slide.background = { color: 'FFFFFF' };
    slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.12, fill: { color: '2563EB' }, line: { color: '2563EB' } });
    slide.addText(s.title, { x: 0.5, y: 0.3, w: W - 1, h: 0.7, fontFace: font, fontSize: 24, bold: true, color: '111827' });
    slide.addShape(pptx.ShapeType.line, { x: 0.5, y: 1.05, w: W - 1, h: 0, line: { color: 'D1D5DB', width: 1 } });

    let textX = 0.5;
    let textW = W - 1;
    if (s.image) {
      const path = await resolveImage(s.image).catch(() => null);
      if (path) {
        // 이미지 비율을 지켜 왼쪽 상자(5.6 x 5.6in) 가운데에 놓습니다.
        const box = 5.6;
        let w = box;
        let h = box;
        try {
          const sharp = (await import('sharp')).default;
          const m = await sharp(path).metadata();
          if (m.width && m.height) {
            const r = m.width / m.height;
            if (r >= 1) h = box / r;
            else w = box * r;
          }
        } catch {
          // 크기를 모르면 상자에 맞춤
        }
        slide.addImage({ path, x: 0.5 + (box - w) / 2, y: 1.25 + (box - h) / 2, w, h });
      } else {
        slide.addShape(pptx.ShapeType.rect, { x: 0.5, y: 1.25, w: 5.6, h: 5.6, fill: { color: 'F3F4F6' }, line: { color: 'D1D5DB', dashType: 'dash' } });
        slide.addText(`화면 이미지 없음\n${s.image}`, { x: 0.5, y: 1.25, w: 5.6, h: 5.6, align: 'center', fontFace: font, fontSize: 12, color: '6B7280' });
      }
      textX = 6.4;
      textW = W - 6.9;
    }

    let y = 1.3;
    if (s.table?.length) {
      const rows = s.table.map((r, i) =>
        r.map((c) => ({ text: c, options: i === 0 ? { bold: true, fill: { color: 'DBEAFE' } } : {} })),
      );
      const h = Math.min(5.5, 0.4 * rows.length);
      slide.addTable(rows, { x: textX, y, w: textW, fontFace: font, fontSize: 11, border: { type: 'solid', color: '9CA3AF', pt: 0.75 }, autoPage: false });
      y += h + 0.2;
    }
    if (s.bullets.length) {
      // pptxgenjs는 한 문단 안에서 굵기가 섞이면 글머리표가 깨져서, 글머리표 문자를 직접 붙입니다.
      const items = s.bullets.flatMap((b) => {
        const lead = b.level >= 0 ? `${'      '.repeat(b.level)}${b.level === 0 ? '•' : '–'} ` : '';
        return b.runs.map((r, j) => ({
          text: (j === 0 ? lead : '') + r.text,
          options: { bold: r.bold, italic: r.italic, breakLine: j === b.runs.length - 1 },
        }));
      });
      slide.addText(items, { x: textX, y, w: textW, h: Math.max(1, 7.0 - y), valign: 'top', fontFace: font, fontSize: 14, color: '1F2937', paraSpaceAfter: 6 });
    }
    if (s.notes.length) slide.addNotes(s.notes.join('\n'));
    slide.addText(`${title}  ·  ${index}/${slides.length}`, { x: 0.5, y: 7.05, w: W - 1, h: 0.3, fontFace: font, fontSize: 9, color: '9CA3AF', align: 'right' });
  }
  if (!slides.length) pptx.addSlide().addText(title, { x: 0.5, y: 3, w: W - 1, h: 1, fontSize: 28, bold: true, align: 'center' });
  await pptx.writeFile({ fileName: out });
}

// ---------- 바깥에 여는 함수 ----------

export function createDocuments(dataDir: string) {
  const work = join(dataDir, 'work');
  const previews = join(dataDir, 'previews');
  mkdirSync(work, { recursive: true });
  mkdirSync(previews, { recursive: true });

  const pandoc = findTool(['pandoc']);
  const soffice = findTool(['soffice', 'libreoffice'], ['/Applications/LibreOffice.app/Contents/MacOS/soffice']);
  const pdftoppm = findTool(['pdftoppm']);
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
      if (kind === 'pptx') return withTimeout(buildPptx(md, out, opts.title, opts.resolveImage), 120_000, 'PPT 만들기');
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
            ['--headless', '--norestore', `-env:UserInstallation=file://${join(work, 'lo-profile')}`, '--convert-to', 'pdf', '--outdir', dir, input],
            { timeout: 120_000 },
          ),
        );
        const pdf = join(dir, 'doc.pdf');
        if (!existsSync(pdf)) throw new Error('PDF 변환 결과가 없어요.');
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

  async function takeShot(id: string, htmlFile: string): Promise<string | null> {
    const b = await getBrowser();
    if (!b) return null;
    const out = shotPath(id);
    if (existsSync(out)) return out;
    const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
    try {
      await withTimeout(page.goto(pathToFileURL(htmlFile).href, { waitUntil: 'load' }), 20_000, '화면 열기');
      await page.waitForTimeout(500);
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
