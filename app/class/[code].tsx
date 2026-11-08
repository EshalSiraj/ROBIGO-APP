import { Button, Meta, Rule } from '@/components/ui';
import { deleteClassLocal, listClasses, loadStudents, type ClassRecord, type Student } from '@/lib/classes';
import { removePapers } from '@/lib/papers';
import { setSelection } from '@/lib/selection';
import { listQuizzes, removeSessions, type QuizInfo } from '@/lib/session';
import { C, T } from '@/lib/theme';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// One class: its students and its quizzes. Open a quiz to see its scanned papers.
export default function ClassDetails() {
  const router = useRouter();
  const { code } = useLocalSearchParams<{ code: string }>();
  const [cls, setCls] = useState<ClassRecord | undefined>();
  const [students, setStudents] = useState<Student[]>([]);
  const [quizzes, setQuizzes] = useState<QuizInfo[]>([]);
  const [showList, setShowList] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        if (!code) return;
        const found = (await listClasses()).find((c) => c.code === code);
        const roster = await loadStudents(code);
        const qs = await listQuizzes(code);
        if (!alive) return;
        setCls(found); setStudents(roster); setQuizzes(qs);
      })();
      return () => { alive = false; };
    }, [code]),
  );

  async function openQuiz(name: string) {
    await setSelection(code, name);
    router.push({ pathname: '/quiz/[code]', params: { code, quiz: name } });
  }

  async function newQuiz() {
    const nums = quizzes.map((q) => Number(/(\d+)\s*$/.exec(q.name)?.[1] ?? 0));
    await openQuiz(`Quiz ${Math.max(0, ...nums) + 1}`);
  }

  function removeClass() {
    Alert.alert(
      'Remove this class from the phone?',
      'The class, its student list and its scanned papers are removed from this phone. Your Google Sheet keeps its copy.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove', style: 'destructive',
          onPress: async () => { await deleteClassLocal(code); await removeSessions(code); await removePapers(code); router.back(); },
        },
      ],
    );
  }

 /* const Back = (
    <Pressable onPress={() => router.back()} hitSlop={12} style={s.back}>
      <Ionicons name="chevron-back" size={20} color={C.plum} />
      <Text style={s.backText}>My classes</Text>
    </Pressable>
  );*/
  const Back = (
  <Pressable onPress={() => router.back()} hitSlop={12} style={s.back}>
    <Ionicons name="chevron-back" size={20} color={C.plum} />
    <Text style={s.backText}>My classes</Text>
  </Pressable>
);

  if (!cls) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={{ padding: 24 }}>{Back}<Text style={T.small}>This class was not found on this phone.</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        {Back}
        <Text style={[T.h1, { marginTop: 18 }]}>{cls.subject}</Text>
        <View style={{ marginTop: 8, marginBottom: 28 }}><Meta c={cls} /></View>

        <Pressable style={s.students} onPress={() => setShowList((v) => !v)}>
          <View style={{ flex: 1 }}>
            <Text style={[T.h2, { fontSize: 20 }]}>{students.length} students</Text>
            <Text style={T.small}>SAP IDs and names are saved</Text>
          </View>
          <Text style={s.link}>{showList ? 'Hide list' : 'See list'}</Text>
        </Pressable>

        {showList && (
          <View style={{ marginTop: 8 }}>
            {students.map((st) => (
              <View key={st.sap_id}>
                <View style={s.stRow}>
                  <Text style={s.stId}>{st.sap_id}</Text>
                  <Text style={[T.body, { flex: 1 }]}>{st.name || 'Name missing'}</Text>
                </View>
                <Rule />
              </View>
            ))}
          </View>
        )}

        <Text style={[T.h2, { marginTop: 36, marginBottom: 6 }]}>Quizzes</Text>
        {quizzes.length === 0 && <Text style={[T.small, { marginBottom: 8 }]}>No quiz yet. Add the first one below.</Text>}
        {quizzes.length > 0 && <Rule />}
        {quizzes.map((q) => {
         const flagged = (q.flagged ?? 0) > 0;
const done = students.length > 0 && q.scanned >= students.length && !flagged;
          return (
            <View key={q.name}>
              <Pressable style={s.quiz} onPress={() => openQuiz(q.name)}>
                <View style={{ flex: 1 }}>
                  <Text style={s.quizName}>{q.name}</Text>
                  <Text style={T.small}>
                    {q.hasPaper || q.scanned > 0 ? `${q.scanned} of ${students.length} papers` : 'Not started'}
                  </Text>
                </View>
                {(q.hasPaper || q.scanned > 0) && (
                  <View style={[s.tag, { backgroundColor: done ? C.mint : C.lavender }]}>
                 <Text style={s.tagText}>
  {done ? 'Done' : flagged ? 'Needs check' : 'Open'}
</Text>
                  </View>
                )}
                <Ionicons name="chevron-forward" size={18} color={C.muted} />
              </Pressable>
              <Rule />
            </View>
          );
        })}

        <Button title="Add a quiz" onPress={newQuiz} style={{ marginTop: 28 }} />
        <Pressable onPress={removeClass} style={{ marginTop: 28, alignItems: 'center' }}>
          <Text style={{ color: C.plum, fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' }}>Remove class from this phone</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.ivory },
  body: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 56 },
  back: { flexDirection: 'row', alignItems: 'center', marginLeft: -4, marginBottom: 4 },
  backText: { color: C.plum, fontWeight: '600', fontSize: 15 },
  students: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.lavender, borderRadius: 22, padding: 18 },
  link: { color: C.plum, fontWeight: '700', fontSize: 14, textDecorationLine: 'underline' },
  stRow: { flexDirection: 'row', paddingVertical: 11 },
  stId: { width: 92, fontSize: 15, color: C.muted, fontVariant: ['tabular-nums'] },
  quiz: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 15 },
  quizName: { fontSize: 16, fontWeight: '600', color: C.plum, marginBottom: 1 },
  tag: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  tagText: { fontSize: 13, fontWeight: '700', color: C.plum },
});
