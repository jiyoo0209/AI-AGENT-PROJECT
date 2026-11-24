// 키보드가 떠 있는지 알려 줍니다. (Android는 화면 끝까지 그리는 방식이라 창이 줄어들지 않아서 직접 처리합니다)
import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

export function useKeyboardShown(onShow?: () => void): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const a = Keyboard.addListener('keyboardDidShow', () => {
      setShown(true);
      onShow?.();
    });
    const b = Keyboard.addListener('keyboardDidHide', () => setShown(false));
    return () => {
      a.remove();
      b.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return shown;
}
