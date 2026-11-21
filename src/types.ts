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
  | 'done';

export interface Project {
  request: string;
  planSummary: string;
  tasks: Task[];
  phase: ProjectPhase;
  messages: ChatMessage[];
  deliverables: Deliverable[];
  createdAt: number;
}

export interface RoleModel {
  provider: Provider;
  model: string;
}

export interface Settings {
  anthropicKey: string;
  openaiKey: string;
  imageModel: string;
  stepApproval: boolean;
  /** Monthly token budget per provider; 0 means not set. */
  monthlyTokenBudget: Record<Provider, number>;
  roles: Record<RoleId, RoleModel>;
}
