import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { N8N_BASE } from '@/lib/config';
import { listClasses, loadStudents, type ClassRecord, type Student } from '@/lib/classes';
import { addSamplePapers, listPapers, needsCheck, readNote, type Paper } from '@/lib/papers';
import { loadProfile } from '@/lib/profile';
import { setSelection } from '@/lib/selection';
import { emptySession, loadSession, saveSession, type Session } from '@/lib/session';
import { C, FONT, T } from '@/lib/theme';
import { Button, Rule } from '@/components/ui';

// One quiz of one class: how far the scanning is, and every student paper scanned so far.
export default function QuizScreen() {
  const router = useRouter();
  const { code, quiz } = useLocalSearchParams<{ code: string; quiz: string }>();
  const assessment = `${code} ${quiz}`;
  const [cls, setCls] = useState<ClassRecord | undefined>();
  const [students, setStudents] = useState<Student[]>([]);
  const [session, setSession] = useState<Session>(emptySession());
  const [papers, setPapers] = useState<Paper[]>([]);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!code || !quiz) return;
    await setSelection(code, quiz);
    const found = (await listClasses()).find((c) => c.code === code);
    const sess = await loadSession(assessment);
    await saveSession(assessment, sess); // a new quiz now shows in the class's quiz list
    const profile = await loadProfile();
    setCls(found);
    setStudents(await loadStudents(code));
    setSession(sess);
    setPapers(await listPapers(assessment));
    setEmail(profile?.reportEmail || profile?.email || '');
  }, [code, quiz, assessment]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const hasPaper = !!session.paper;
  const questions = session.paper?.questions ?? [];
  const totalMarks = questions.reduce((sum, q) => sum + (Number(q.max) || 0), 0);
  const scanned = Math.max(Object.keys(session.scanned).length, papers.length);
  const total = students.length;

  function scan() {
    router.push({ pathname: '/scanner', params: { mode: hasPaper ? 'students' : 'paper', code, assessment } });
  }

  async function emailResults() {
    setBusy(true);
    try {
      const res = await fetch(`${N8N_BASE}/tmate-finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment, course: code, teacherEmail: email }),
      });
      if (!res.ok) throw new Error(String(res.status));
      Alert.alert('Results are on the way', `An email will arrive at ${email || 'your inbox'} in a minute.`);
    } catch {
      Alert.alert('Could not start', 'Check your internet connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  async function sample() {
    await addSamplePapers(code, quiz);
    await load();
  }

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => router.back()} hitSlop={12} style={s.back}>
          <Ionicons name="chevron-back" size={20} color={C.plum} />
          <Text style={s.backText}>{cls?.subject ?? 'Class'}</Text>
        </Pressable>

        <Text style={[T.h1, { marginTop: 18 }]}>{quiz}</Text>
        <Text style={[T.small, { marginTop: 6 }]}>
          {hasPaper
            ? `Question paper read, ${questions.length} questions, ${totalMarks} marks`
            : 'Question paper not scanned yet'}
        </Text>

        {total > 0 && (
          <>
            <View style={s.track}><View style={[s.fill, { width: `${Math.min(100, (scanned / total) * 100)}%` }]} /></View>
            <Text style={T.small}>{scanned} of {total} papers scanned</Text>
          </>
        )}

        <Text style={[T.h2, { fontSize: 18, marginTop: 28, marginBottom: 6 }]}>Student papers</Text>
        {papers.length === 0 ? (
          <View>
            <Text style={[T.small, { marginBottom: 10 }]}>
              {hasPaper ? 'No student papers yet. Scan the first one.' : 'Scan the question paper first, then the student papers.'}
            </Text>
            {__DEV__ && (
              <Pressable onPress={sample} hitSlop={10}>
                <Text style={s.link}>Add sample papers to try this screen</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <>
            <Rule />
            {papers.map((p) => {
              const check = needsCheck(p);
              return (
                <View key={p.sap_id}>
                  <Pressable
                    style={s.row}
                    onPress={() => router.push({ pathname: '/paper/[code]', params: { code, quiz, sap: p.sap_id } })}
                  >
                    <View style={s.avatar}><Text style={s.avatarText}>{p.sap_id.slice(-4)}</Text></View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.name}>{p.name || p.sap_id}</Text>
                      <Text style={T.small}>{readNote(p)}</Text>
                    </View>
                    <View style={[s.tag, { backgroundColor: check ? C.lavender : C.mint }]}>
                      <Text style={s.tagText}>{check ? 'Check' : 'OK'}</Text>
                    </View>
                  </Pressable>
                  <Rule />
                </View>
              );
            })}
          </>
        )}

        <View style={{ marginTop: 32, gap: 10 }}>
          <Button title={hasPaper ? 'Scan more papers' : 'Scan question paper'} onPress={scan} />
          {papers.length > 0 && <Button title="Email results" kind="soft" busy={busy} onPress={emailResults} />}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.ivory },
  body: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 48 },
  back: { flexDirection: 'row', alignItems: 'center', marginLeft: -4, marginBottom: 4 },
  backText: { color: C.plum, fontWeight: '600', fontSize: 15 },
  track: { height: 8, borderRadius: 4, backgroundColor: C.lavender, overflow: 'hidden', marginTop: 14, marginBottom: 6 },
  fill: { height: 8, borderRadius: 4, backgroundColor: C.plum },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13 },
  avatar: { width: 44, height: 44, borderRadius: 12, backgroundColor: C.lavender, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontFamily: FONT.display, fontWeight: '700', fontSize: 13, color: C.plum },
  name: { fontSize: 16, fontWeight: '600', color: C.plum, marginBottom: 1 },
  tag: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  tagText: { fontSize: 13, fontWeight: '700', color: C.plum },
  link: { color: C.plum, fontSize: 14, fontWeight: '600', textDecorationLine: 'underline' },
});
