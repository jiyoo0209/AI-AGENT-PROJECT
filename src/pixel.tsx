import { ActivityIndicator, Pressable, StyleSheet, Text, View, ViewStyle } from 'react-native';

/** 도트 사무실 화면의 색 */
export const px = {
  bg: '#191C2E',
  panel: '#23284A',
  ink: '#0E1020',
  line: '#3A4170',
  cream: '#FFF4DC',
  sub: '#B9B4D6',
  gold: '#F5C04A',
  mint: '#5FD3A6',
  sky: '#6CB6F0',
  coral: '#F07A63',
  grey: '#8C8FA8',
  dark: '#1E2238',
};

export function Panel(props: { children: React.ReactNode; style?: ViewStyle; accent?: boolean }) {
  return (
    <View style={[styles.panelOuter, props.style]}>
      <View style={[styles.panelInner, props.accent && { borderColor: '#F3E6C8' }]}>{props.children}</View>
    </View>
  );
}

export function PxButton(props: {
  title: string;
  onPress: () => void;
  variant?: 'gold' | 'dark';
  disabled?: boolean;
  loading?: boolean;
  style?: ViewStyle;
}) {
  const gold = (props.variant ?? 'gold') === 'gold';
  const disabled = props.disabled || props.loading;
  return (
    <Pressable
      onPress={props.onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.btn,
        { backgroundColor: gold ? px.gold : px.panel, opacity: disabled ? 0.5 : 1 },
        pressed && { transform: [{ translateX: 1 }, { translateY: 1 }] },
        props.style,
      ]}
    >
      {props.loading ? (
        <ActivityIndicator color={gold ? px.dark : px.cream} />
      ) : (
        <Text style={[styles.btnText, { color: gold ? px.dark : px.cream }]}>{props.title}</Text>
      )}
    </Pressable>
  );
}

/** 칸으로 나뉜 에너지 바 */
export function EnergyBar(props: { pct?: number; color: string; cells?: number; height?: number }) {
  const cells = props.cells ?? 10;
  const filled = props.pct === undefined ? 0 : Math.round((props.pct / 100) * cells);
  return (
    <View style={styles.bar}>
      {Array.from({ length: cells }, (_, i) => (
        <View
          key={i}
          style={{ flex: 1, height: props.height ?? 9, backgroundColor: i < filled ? props.color : px.line }}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  panelOuter: { borderWidth: 2, borderColor: px.ink, backgroundColor: px.panel },
  panelInner: { borderWidth: 2, borderColor: px.line, padding: 10 },
  btn: {
    minHeight: 44,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: px.ink,
  },
  btnText: { fontSize: 14, fontWeight: '800' },
  bar: { flexDirection: 'row', gap: 2 },
});
