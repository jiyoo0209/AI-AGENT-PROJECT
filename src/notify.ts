// 결재 알림
// 1) Firebase가 설정돼 있으면 서버가 FCM 푸시를 보냅니다 (바로 옴).
// 2) 아니면 앱이 백그라운드에서 15분 이상 간격으로 서버를 확인해 기기 알림을 띄웁니다.
// 이 파일은 앱 시작 지점(index.js)에서 불러야 백그라운드 작업이 등록됩니다.

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as BackgroundTask from 'expo-background-task';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { AppState } from 'react-native';
import { callServer } from './llm';
import { getSettings, loadSettings } from './settings';
import { setCurrentProject } from './store';

const TASK = 'office-check';
const CHANNEL = 'approval';
const SEEN_KEY = 'attention.seen';
const PUSH_KEY = 'push.ok';

interface AttentionOnly {
  attention: { id: string; title: string; body: string; projectId?: string; projectName?: string } | null;
}

Notifications.setNotificationHandler({
  handleNotification: async () => {
    const away = AppState.currentState !== 'active';
    return { shouldShowBanner: away, shouldShowList: true, shouldPlaySound: away, shouldSetBadge: false };
  },
});

export async function markAttentionSeen(id: string) {
  if ((await AsyncStorage.getItem(SEEN_KEY)) !== id) await AsyncStorage.setItem(SEEN_KEY, id);
}

TaskManager.defineTask(TASK, async () => {
  try {
    // 푸시가 되면 서버가 이미 알렸습니다.
    if ((await AsyncStorage.getItem(PUSH_KEY)) === '1') return BackgroundTask.BackgroundTaskResult.Success;
    await loadSettings();
    const settings = getSettings();
    if (!settings.serverUrl.trim() || !settings.serverToken) return BackgroundTask.BackgroundTaskResult.Success;
    const { attention } = await callServer<AttentionOnly>(settings, '/v1/state');
    if (attention && attention.id !== (await AsyncStorage.getItem(SEEN_KEY))) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: attention.projectName ? `[${attention.projectName}] ${attention.title}` : attention.title,
          body: attention.body,
          data: { attentionId: attention.id, projectId: attention.projectId ?? '' },
        },
        trigger: { channelId: CHANNEL },
      });
      await AsyncStorage.setItem(SEEN_KEY, attention.id);
    }
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

/** 알림 권한, 알림 채널, 백그라운드 확인, 푸시 토큰 등록. 실패해도 앱은 그대로 씁니다. */
export async function setupNotifications(): Promise<void> {
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL, {
      name: '결재 알림',
      importance: Notifications.AndroidImportance.HIGH,
    });
    const perm = await Notifications.getPermissionsAsync();
    if (!perm.granted && perm.canAskAgain) await Notifications.requestPermissionsAsync();
  } catch {
    // 알림 없이도 앱은 동작합니다.
  }
  try {
    if (!(await TaskManager.isTaskRegisteredAsync(TASK))) {
      await BackgroundTask.registerTaskAsync(TASK, { minimumInterval: 15 });
    }
  } catch {
    // 백그라운드 작업을 못 쓰는 기기
  }
  // 알림을 누르면 그 프로젝트를 엽니다.
  const open = (r: Notifications.NotificationResponse | null) => {
    const id = r?.notification.request.content.data?.projectId;
    if (typeof id === 'string' && id) setCurrentProject(id);
  };
  try {
    open(Notifications.getLastNotificationResponse());
    Notifications.addNotificationResponseReceivedListener(open);
  } catch {
    // 알림을 못 쓰는 기기
  }
  await registerPush();
}

/** Firebase(google-services.json)로 빌드된 앱이면 FCM 토큰을 서버에 등록합니다. */
export async function registerPush(): Promise<void> {
  const settings = getSettings();
  if (!settings.serverUrl.trim() || !settings.serverToken) return;
  try {
    const token = await Notifications.getDevicePushTokenAsync();
    const r = await callServer<{ push: boolean }>(settings, '/v1/push/register', { token: token.data });
    await AsyncStorage.setItem(PUSH_KEY, r.push ? '1' : '0');
  } catch {
    await AsyncStorage.setItem(PUSH_KEY, '0');
  }
}
