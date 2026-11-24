// 도트 스타일 콤보박스: 누르면 아래에서 목록이 열립니다.
import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { px } from './pixel';

export function PxSelect(props: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  disabled?: boolean;
  hint?: string;
}) {
  const [open, setOpen] = useState(false);
  const insets = useSafeAreaInsets();
  return (
    <View style={{ gap: 6, flex: 1, minWidth: 0 }}>
      <Text style={styles.label}>{props.label}</Text>
      <Pressable
        onPress={() => setOpen(true)}
        disabled={props.disabled}
        accessibilityRole="button"
        accessibilityLabel={`${props.label}, 현재 ${props.value}`}
        style={[styles.field, props.disabled && { opacity: 0.6 }]}
      >
        <Text style={styles.value} numberOfLines={1}>
          {props.value}
        </Text>
        <Text style={styles.arrow}>▼</Text>
      </Pressable>
      {!!props.hint && <Text style={styles.hint}>{props.hint}</Text>}
      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setOpen(false)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={() => {}}>
            <Text style={styles.sheetTitle}>{props.label}</Text>
            <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 6 }}>
              {props.options.map((o) => {
                const selected = o === props.value;
                return (
                  <Pressable
                    key={o}
                    onPress={() => {
                      props.onChange(o);
                      setOpen(false);
                    }}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    style={[styles.option, selected && styles.optionOn]}
                  >
                    <Text style={[styles.optionText, selected && { color: px.dark }]}>{o}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { color: px.cream, fontSize: 13, fontWeight: '800' },
  hint: { color: px.sub, fontSize: 11, lineHeight: 16 },
  field: {
    minHeight: 46,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    backgroundColor: px.bg,
    borderWidth: 2,
    borderColor: px.line,
  },
  value: { flex: 1, color: px.cream, fontSize: 14 },
  arrow: { color: px.gold, fontSize: 11 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: px.panel, borderTopWidth: 3, borderColor: px.ink, padding: 16, gap: 10 },
  sheetTitle: { color: px.gold, fontSize: 14, fontWeight: '800' },
  option: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 14, backgroundColor: px.bg, borderWidth: 2, borderColor: px.line },
  optionOn: { backgroundColor: px.gold, borderColor: px.ink },
  optionText: { color: px.cream, fontSize: 15, fontWeight: '700' },
});
