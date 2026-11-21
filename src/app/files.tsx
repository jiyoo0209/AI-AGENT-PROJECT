import { ScrollView, StyleSheet, Text } from 'react-native';
import { FileCard } from '../FileCard';
import { ROLES } from '../roles';
import { useProject } from '../store';
import { colors } from '../ui';

export default function Files() {
  const { deliverables } = useProject();
  if (!deliverables.length) {
    return <Text style={styles.empty}>아직 산출물이 없습니다.</Text>;
  }
  return (
    <ScrollView contentContainerStyle={styles.container}>
      {ROLES.map((r) => {
        const list = deliverables
          .filter((d) => d.role === r.id)
          .sort((a, b) => a.createdAt - b.createdAt);
        if (!list.length) return null;
        return [
          <Text key={r.id} style={[styles.section, { color: r.color }]}>
            {r.name}
          </Text>,
          ...list.map((d) => <FileCard key={d.id} d={d} />),
        ];
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: 16, paddingBottom: 40 },
  section: { fontSize: 15, fontWeight: '700', marginTop: 16 },
  empty: { textAlign: 'center', color: colors.sub, marginTop: 40 },
});
