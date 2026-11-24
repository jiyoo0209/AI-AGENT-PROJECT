// 이 기기를 구분하는 값. 프로젝트 목록의 "이 기기에서 만든 것"에 씁니다.
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';

const KEY = 'device.id';
let cached: { id: string; name: string } | null = null;

export async function thisDevice(): Promise<{ id: string; name: string }> {
  if (cached) return cached;
  let id = await AsyncStorage.getItem(KEY).catch(() => null);
  if (!id) {
    id = 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    await AsyncStorage.setItem(KEY, id).catch(() => {});
  }
  cached = { id, name: Device.deviceName || Device.modelName || '이 기기' };
  return cached;
}

/** 이미 읽어 둔 이 기기 id (앱 시작 때 thisDevice()가 불린 뒤부터 있음) */
export const deviceIdSync = () => cached?.id ?? '';
