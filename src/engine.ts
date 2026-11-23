// AI 팀 운영은 서버(server/office.ts)에서 합니다. 앱은 지시와 결재만 보냅니다.

import { Alert } from 'react-native';
import { act, Action } from './sync';
import { RoleId, Task } from './types';

export function statusLabel(s: Task['status']): string {
  return { pending: '대기', running: '진행 중', done: '완료', failed: '실패' }[s];
}

async function send(action: Action) {
  try {
    await act(action);
  } catch (e) {
    Alert.alert('요청하지 못했어요', e instanceof Error ? e.message : String(e));
  }
}

export const startProject = (request: string) => send({ type: 'start', request });
export const runTasks = () => send({ type: 'run' });
export const replan = () => send({ type: 'replan' });
export const resetProject = () => send({ type: 'reset' });
export const sendToRoom = (role: RoleId, text: string) => send({ type: 'room', role, text });
