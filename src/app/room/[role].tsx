import { Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { sendToRoom } from '../../engine';
import { FileCard } from '../../FileCard';
import { ROLES, roleInfo } from '../../roles';
import { useSettings, modelLabel } from '../../settings';
import { useBusy, useProject } from '../../store';
import { ChatMessage, RoleId } from '../../types';
import { Button, colors } from '../../ui';

export default function Room() {
  const params = useLocalSearchParams<{ role: string }>();
  const role = (ROLES.some((r) => r.id === params.role) ? params.role : 'pm') as RoleId;
  const info = roleInfo(role);
  const project = useProject();
  const busy = useBusy()[role];
  const model = useSettings().roles[role];
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const listRef = useRef<FlatList<ChatMessage>>(null);

  const messages = useMemo(() => project.messages.filter((m) => m.role === role), [project.messages, role]);
  const filesById = useMemo(
    () => new Map(project.deliverables.map((d) => [d.id, d])),
    [project.deliverables],
  );

  useEffect(() => {
    const t = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    return () => clearTimeout(t);
  }, [messages.length, busy]);

  const send = () => {
    const value = text.trim();
    if (!value || busy) return;
    setText('');
    sendToRoom(role, value);
  };

  const placeholder =
    role === 'pm'
      ? project.request
        ? 'PM에게 수정·추가 작업을 요청하세요'
        : '만들고 싶은 것을 설명하세요'
      : `${info.name}에게 수정 요청이나 질문을 보내세요`;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={insets.top + 56}>
      <Stack.Screen options={{ title: `${info.name} 채팅방` }} />
      <FlatList
        ref={listRef}
        data={messages}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={
          <Text style={styles.intro}>
            {info.description}
            {'\n'}
            {model.provider === 'claude' ? 'Claude' : 'ChatGPT'} · {modelLabel(model)}
          </Text>
        }
        ListFooterComponent={
          busy ? (
            <View style={styles.typing}>
              <ActivityIndicator color={info.color} />
              <Text style={styles.typingText}>{info.name}이(가) 작성 중입니다…</Text>
            </View>
          ) : undefined
        }
        renderItem={({ item }) => {
          if (item.from === 'system') {
            return (
              <View style={styles.system}>
                <Text style={styles.systemText}>{item.text}</Text>
              </View>
            );
          }
          const mine = item.from === 'user';
          const files = (item.files ?? []).map((id) => filesById.get(id)).filter((d) => !!d);
          return (
            <View style={[styles.bubbleRow, mine && { justifyContent: 'flex-end' }]}>
              <View
                style={[
                  styles.bubble,
                  mine ? styles.mine : styles.theirs,
                  item.error && styles.error,
                ]}
              >
                {!mine && <Text style={[styles.author, { color: info.color }]}>{info.name}</Text>}
                <Text selectable style={[styles.text, mine && { color: '#fff' }]}>
                  {item.text}
                </Text>
                {files.map((d) => (
                  <FileCard key={d.id} d={d} />
                ))}
              </View>
            </View>
          );
        }}
      />
      <View style={[styles.inputBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder={placeholder}
          multiline
        />
        <Button title="보내기" onPress={send} disabled={!text.trim() || !!busy} small />
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  list: { padding: 12, gap: 10 },
  intro: { textAlign: 'center', color: colors.sub, fontSize: 12, marginBottom: 6, lineHeight: 18 },
  system: {
    alignSelf: 'center',
    backgroundColor: '#EEF2FF',
    borderRadius: 10,
    padding: 10,
    maxWidth: '92%',
  },
  systemText: { fontSize: 13, color: '#3730A3', lineHeight: 19 },
  bubbleRow: { flexDirection: 'row' },
  bubble: { borderRadius: 14, padding: 12, maxWidth: '90%' },
  mine: { backgroundColor: colors.primary },
  theirs: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, width: '90%' },
  error: { borderColor: colors.danger, backgroundColor: '#FEF2F2' },
  author: { fontSize: 12, fontWeight: '700', marginBottom: 4 },
  text: { fontSize: 14, color: colors.text, lineHeight: 21 },
  typing: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8 },
  typingText: { color: colors.sub, fontSize: 13 },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 12,
    paddingTop: 8,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  input: {
    flex: 1,
    maxHeight: 120,
    minHeight: 40,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
    color: colors.text,
  },
});
