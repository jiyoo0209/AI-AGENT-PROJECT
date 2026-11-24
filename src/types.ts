import type { ProjectBrief } from './brief';

export type RoleId =
  | 'pm'
  | 'planner'
  | 'designer'
  | 'publisher'
  | 'pl'
  | 'developer'
  | 'tester';

export type WorkerRoleId = Exclude<RoleId, 'pm'>;

export type Provider = 'claude' | 'openai';

export interface Deliverable {
  id: string;
  role: RoleId;
  name: string;
  mime: string;
  uri: string;
  isBinary: boolean;
  size: number;
  taskId?: string;
  createdAt: number;
  /** Word·Excel·PPT 산출물의 Markdown 원본 (서버 기준 경로). 팀원끼리는 이 원본을 참고합니다. */
  source?: string;
  /** 앱에서 볼 미리보기. 문서는 PDF 페이지 이미지, HTML 화면은 캡처 이미지 */
  preview?: { status: 'pending' | 'ready' | 'failed'; pages?: number; error?: string };
}

export interface ChatMessage {
  id: string;
  role: RoleId; // which room the message belongs to
  from: 'user' | 'agent' | 'system';
  text: string;
  files?: string[]; // deliverable ids
  error?: boolean;
  createdAt: number;
}

export type TaskStatus = 'pending' | 'running' | 'done' | 'failed';

export interface Task {
  id: string;
  role: WorkerRoleId;
  title: string;
  instructions: string;
  status: TaskStatus;
  error?: string;
}

export type ProjectPhase =
  | 'idle'
  | 'planning'
  | 'awaiting_approval'
  | 'running'
  | 'paused'
  /** 동시 실행 자리(3개)가 꽉 차서 차례를 기다리는 중 */
  | 'queued'
  | 'done';

export interface Project {
  request: string;
  planSummary: string;
  tasks: Task[];
  phase: ProjectPhase;
  messages: ChatMessage[];
  deliverables: Deliverable[];
  createdAt: number;
  /** 요청 폼으로 시작한 프로젝트의 요청서 */
  brief?: ProjectBrief;
  /** 이 프로젝트를 만든 기기 */
  device?: { id: string; name: string };
}

/** 프로젝트 목록에 보이는 요약 */
export interface ProjectSummary {
  id: string;
  name: string;
  kind: string;
  phase: ProjectPhase;
  /** 대기열 순서 (1부터). 대기열이 아니면 없음 */
  queuePos?: number;
  device?: { id: string; name: string };
  done: number;
  total: number;
  /** 지금 하는 일 한 줄 */
  activity: string;
  createdAt: number;
  updatedAt: number;
}

export interface RoleModel {
  provider: Provider;
  model: string;
}

export interface Settings {
  /** 맥미니 서버 주소. 모든 AI 호출은 이 서버(구독)로 갑니다. */
  serverUrl: string;
  serverToken: string;
  stepApproval: boolean;
  roles: Record<RoleId, RoleModel>;
}
