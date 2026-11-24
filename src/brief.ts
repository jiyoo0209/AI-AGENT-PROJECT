// 프로젝트 요청서 (요청 폼의 내용). 앱과 서버가 같이 씁니다.

export type ProjectKind = 'docs' | 'app' | 'web' | 'service' | 'both';
export type OutputId = 'req' | 'screen' | 'design' | 'proto' | 'table' | 'code' | 'test' | 'apk';

export interface ProjectBrief {
  kind: ProjectKind;
  name: string;
  goal: string;
  users: string;
  outputs: OutputId[];
  due: string;
  approval: 'step' | 'end';
  tech: {
    arch: string;
    frontend: string;
    backend: string;
    db: string;
    deploy: string;
    auth: string;
    etc: string;
  };
}

export const KINDS: { id: ProjectKind; mark: string; label: string; desc: string }[] = [
  { id: 'docs', mark: 'D', label: '문서만', desc: '요구사항정의서·화면설계서·테이블정의서만 받아요' },
  { id: 'app', mark: 'A', label: '모바일 앱', desc: '기획부터 디자인, 눌러 보는 화면, 설치 파일(APK)까지' },
  { id: 'web', mark: 'W', label: '웹페이지', desc: '회사·서비스 소개, 랜딩 페이지' },
  { id: 'service', mark: 'S', label: '웹 서비스', desc: '로그인과 관리자 화면이 있는 웹' },
  { id: 'both', mark: '+', label: '앱 + 웹', desc: '같은 서버를 쓰는 앱과 웹' },
];

export const OUTPUTS: { id: OutputId; label: string; fmt: string; file: string }[] = [
  { id: 'req', label: '요구사항정의서', fmt: 'Word', file: '요구사항정의서.docx (기획자)' },
  { id: 'screen', label: '화면설계서', fmt: 'PPT', file: '화면설계서.pptx (기획자)' },
  { id: 'design', label: '디자인 시안', fmt: '이미지', file: '디자인계획서.docx와 시안 이미지 (디자이너)' },
  { id: 'proto', label: '동작 화면', fmt: '눌러 보기', file: '휴대폰에서 눌러 보는 HTML 화면 (퍼블리셔)' },
  { id: 'table', label: '테이블정의서', fmt: 'Excel', file: '테이블정의서.xlsx (PL)' },
  { id: 'code', label: '소스 코드', fmt: '코드', file: '소스 코드 (개발자)' },
  { id: 'apk', label: '설치 파일', fmt: 'APK', file: '안드로이드 설치 파일 APK (개발자가 Expo 앱으로 작성, 서버가 빌드)' },
  { id: 'test', label: '테스트케이스', fmt: 'Excel', file: '테스트케이스.xlsx와 검수리포트.docx (테스터)' },
];

const ALL: OutputId[] = ['req', 'screen', 'design', 'proto', 'table', 'code', 'test'];

export const PRESET: Record<ProjectKind, OutputId[]> = {
  docs: ['req', 'screen', 'table'],
  app: [...ALL, 'apk'],
  web: ['req', 'screen', 'design', 'proto', 'code', 'test'],
  service: ALL,
  both: [...ALL, 'apk'],
};

/** 고를 수 있는 출력물 (APK는 앱일 때만) */
export function outputsFor(kind: ProjectKind) {
  return OUTPUTS.filter((o) => o.id !== 'apk' || kind === 'app' || kind === 'both');
}

export const RECOMMENDED = 'PM 추천';
export const EXPO = 'React Native (Expo)';

export const TECH_OPTIONS = {
  arch: [RECOMMENDED, '앱/웹 + API 서버', '모놀리식 (한 서버)', '서버리스', '서버 없음 (정적)'],
  frontend: [RECOMMENDED, EXPO, 'Flutter', 'Kotlin (안드로이드)', 'Swift (iOS)', 'React', 'Next.js', 'Vue', 'HTML/CSS/JS'],
  backend: [RECOMMENDED, 'Node.js', 'Spring (Java/Kotlin)', 'Python (FastAPI)', 'Firebase', '없음'],
  db: [RECOMMENDED, 'PostgreSQL', 'MySQL', 'Oracle', 'Firestore', '없음'],
  deploy: [RECOMMENDED, '사내 서버', 'AWS', 'Google Cloud', 'Azure', '앱스토어'],
  auth: [RECOMMENDED, '이메일/비밀번호', '사내 계정 (SSO)', '소셜 로그인', '로그인 없음'],
};

export const TECH_LABELS: Record<keyof ProjectBrief['tech'], string> = {
  arch: '아키텍처',
  frontend: '화면 (프론트)',
  backend: '서버 (백엔드)',
  db: '데이터베이스',
  deploy: '배포 환경',
  auth: '로그인',
  etc: '기타 기술 요구사항',
};

export const DUE_OPTIONS = ['정하지 않음', '1주 안', '2주 안', '1개월 안', '3개월 안'];

export function emptyBrief(): ProjectBrief {
  return {
    kind: 'app',
    name: '',
    goal: '',
    users: '',
    outputs: PRESET.app,
    due: DUE_OPTIONS[0],
    approval: 'step',
    tech: { arch: RECOMMENDED, frontend: RECOMMENDED, backend: RECOMMENDED, db: RECOMMENDED, deploy: RECOMMENDED, auth: RECOMMENDED, etc: '' },
  };
}

export const wantsApk = (b?: ProjectBrief | null) => !!b?.outputs?.includes('apk');

/** APK를 받으려면 화면 기술은 Expo로 고정합니다. */
export function effectiveFrontend(b: ProjectBrief): string {
  return wantsApk(b) ? EXPO : b.tech.frontend;
}

/** PM에게 보내는 요청 글. 팀원 모두가 이 글을 맥락으로 봅니다. */
export function briefToRequest(b: ProjectBrief): string {
  const kind = KINDS.find((k) => k.id === b.kind)?.label ?? b.kind;
  const outs = OUTPUTS.filter((o) => b.outputs.includes(o.id));
  const lines = [
    `[프로젝트 요청서]`,
    `- 이름: ${b.name.trim() || '(정하지 않음)'}`,
    `- 결과물 종류: ${kind}`,
    `- 목표와 배경: ${b.goal.trim() || '(적지 않음)'}`,
    `- 사용자: ${b.users.trim() || '(적지 않음)'}`,
    `- 희망 마감: ${b.due}`,
    `- 결재 방식: ${b.approval === 'step' ? '작업마다 대표 결재' : '끝까지 진행 후 보고'}`,
    ``,
    `[받을 산출물] (이 목록에 있는 것만 계획하세요)`,
    ...outs.map((o) => `- ${o.label}: ${o.file}`),
  ];
  const tech = (Object.keys(TECH_LABELS) as (keyof ProjectBrief['tech'])[])
    .map((k) => [k, k === 'frontend' ? effectiveFrontend(b) : b.tech[k]] as const)
    .filter(([, v]) => v && v.trim() && v !== RECOMMENDED);
  lines.push('', '[기술 스펙]');
  if (tech.length) lines.push(...tech.map(([k, v]) => `- ${TECH_LABELS[k]}: ${v.trim()}`), '- 나머지 항목: 요청에 맞게 PM과 PL이 정합니다.');
  else lines.push('- 정해진 것 없음: 요청에 맞게 PM과 PL이 정합니다.');
  if (b.kind === 'docs') lines.push('', '문서만 요청했습니다. 디자인·화면·코드 작업은 넣지 마세요.');
  if (wantsApk(b)) lines.push('', '안드로이드 설치 파일(APK)을 받아야 합니다. 개발자 작업은 Expo 앱 규칙대로 작성하게 지시하세요. 서버가 개발자 코드로 APK를 자동 빌드합니다.');
  return lines.join('\n');
}

/** 서버에서 받은 값이 요청서 모양인지 확인하고 빈 칸을 채웁니다. */
export function normalizeBrief(raw: unknown): ProjectBrief | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<ProjectBrief>;
  const base = emptyBrief();
  const kind = KINDS.some((k) => k.id === r.kind) ? (r.kind as ProjectKind) : base.kind;
  const str = (v: unknown, max = 4000) => (typeof v === 'string' ? v.slice(0, max) : '');
  const tech = { ...base.tech };
  for (const k of Object.keys(tech) as (keyof ProjectBrief['tech'])[]) {
    const v = str(r.tech?.[k], 1000);
    if (v) tech[k] = v;
  }
  return {
    kind,
    name: str(r.name, 200),
    goal: str(r.goal),
    users: str(r.users, 500),
    outputs: Array.isArray(r.outputs) ? r.outputs.filter((o): o is OutputId => OUTPUTS.some((x) => x.id === o)) : PRESET[kind],
    due: str(r.due, 50) || base.due,
    approval: 'step', // 결재는 항상 작업마다
    tech,
  };
}
