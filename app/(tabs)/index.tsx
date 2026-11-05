import React, { useCallback, useMemo, useState } from 'react';
import {
  Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { N8N_BASE, SHEET_URL } from '@/lib/config';
import { loadProfile } from '@/lib/profile';
import { checkAgainstClass, listClasses, loadStudents, type ClassRecord, type Student } from '@/lib/classes';
import { emptySession, loadSession, type Session } from '@/lib/session';
import { sayFlags } from '@/lib/upload';
import { restoreFromServer, syncPending } from '@/lib/sync';
import { getSelection, setSelection } from '@/lib/selection';
import { Ionicons } from '@expo/vector-icons';
import { C, T } from '@/lib/theme';
import { Button, Meta, Rule, Sheet, UField } from '@/components/ui';
import Welcome, { NoClasses } from '@/components/Welcome';

// HOME: pick a class, scan the question paper, scan the student papers, get results.
export default function Home() {
  const router = useRouter();
  const [teacherName, setTeacherName] = useState('');
  const [teacherEmail, setTeacherEmail] = useState('');
  const [reportEmail, setReportEmail] = useState('');
  const [loaded, setLoaded] = useState(false); // true once classes are read from the phone
  const [isNew, setIsNew] = useState(false);     // true only for an account created on this phone
  const [classes, setClasses] = useState<ClassRecord[]>([]);
  const [selectedCode, setSelectedCode] = useState<string>('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [quizName, setQuizName] = useState('Quiz 1');
  const [session, setSession] = useState<Session>(emptySession());
  const [students, setStudents] = useState<Student[]>([]);
  const [missing, setMissing] = useState<Student[]>([]);
  const [unknown, setUnknown] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const current = useMemo(() => classes.find((c) => c.code === selectedCode), [classes, selectedCode]);
  const assessment = `${selectedCode} ${quizName.trim() || 'Quiz 1'}`;

  // Reads the phone. A teacher with an account but no classes gets one fresh try at the server.
  const load = useCallback(async (forceRestore = false) => {
    await syncPending(); // sends classes saved offline
    const profile = await loadProfile();
    let list = await listClasses();
    if (list.length === 0 && profile?.email && (forceRestore || !profile.isNew)) {
      await restoreFromServer(profile.email); // classes come back from n8n
      list = await listClasses();
    }
    const sel = await getSelection();
    const code = list.find((c) => c.code === sel.code) ? sel.code : list[0]?.code ?? '';
    setTeacherName(profile?.name ?? '');
    setTeacherEmail(profile?.email ?? '');
    setReportEmail(profile?.reportEmail || profile?.email || '');
    setIsNew(!!profile?.isNew);
    setClasses(list);
    setSelectedCode(code);
    setQuizName(code === sel.code ? sel.quiz : 'Quiz 1');
    setLoaded(true);
  }, []);

  // Reload each time this screen comes back into view (after adding a class or scanning).
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function retry() {
    setBusy(true);
    try { await load(true); } finally { setBusy(false); }
  }

  // Progress for the chosen class and quiz.
  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        if (!selectedCode) return;
        const sess = await loadSession(assessment);
        const roster = await loadStudents(selectedCode);
        const check = await checkAgainstClass(selectedCode, Object.keys(sess.scanned));
        if (!alive) return;
        setSession(sess);
        setStudents(roster);
        setMissing(check.missing);
        setUnknown(check.unknown);
      })();
      return () => { alive = false; };
    }, [selectedCode, assessment]),
  );

  async function chooseClass(code: string) {
    setSelectedCode(code);
    setQuizName('Quiz 1');
    setPickerOpen(false);
    await setSelection(code, 'Quiz 1');
  }

  function scan(mode: 'paper' | 'students') {
    router.push({ pathname: '/scanner', params: { mode, code: selectedCode, assessment } });
  }

  async function getResults() {
    setBusy(true);
    try {
      const res = await fetch(`${N8N_BASE}/tmate-finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assessment, course: selectedCode, teacherEmail: reportEmail || teacherEmail }),
      });
      if (!res.ok) throw new Error(String(res.status));
      Alert.alert('Results are on the way', `We are calculating the results. An email will arrive at ${reportEmail || teacherEmail || 'your inbox'} in a minute.`);
    } catch {
      Alert.alert('Could not start', 'Check your internet connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  const scannedCount = Object.keys(session.scanned).length;
  const total = students.length;
  const hasPaper = !!session.paper;
  const paperProblems = sayFlags(session.paper?.flags);

  // Which step is the current one.
  const currentStep = !hasPaper ? 1 : (total === 0 || scannedCount < total ? 2 : 3);
  const state1 = hasPaper ? 'done' : 'current';
  const state2 = !hasPaper ? 'locked' : currentStep === 2 ? 'current' : 'done';
  const state3 = scannedCount === 0 ? 'locked' : currentStep === 3 ? 'current' : 'open';
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const initial = (teacherName[0] ?? '?').toUpperCase();

  if (!loaded) return <View style={{ flex: 1, backgroundColor: C.ivory }} />;
  if (classes.length === 0) {
    return isNew
      ? <Welcome name={teacherName} onAdd={() => router.push('/add-class')} />
      : <NoClasses busy={busy} onRetry={retry} onAdd={() => router.push('/add-class')} />;
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <View style={s.top}>
          <Text style={s.wordmark}>Robigo</Text>
          <Pressable onPress={() => router.navigate('/profile')} style={s.avatar} hitSlop={8}>
            <Text style={s.avatarText}>{initial}</Text>
          </Pressable>
        </View>

        {/* The class you are working on */}
        <Pressable onPress={() => setPickerOpen((v) => !v)} style={s.classHead}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={T.small}>{greeting}{teacherName ? `, ${teacherName}` : ''}</Text>
            <Text style={[T.h1, { marginTop: 6 }]} numberOfLines={2}>{current?.subject ?? 'Choose a class'}</Text>
            {current && (
              <View style={{ marginTop: 8 }}>
                <Meta c={current} />
                <Text style={[T.small, { marginTop: 2 }]}>{current.studentCount} students</Text>
              </View>
            )}
          </View>
          <Ionicons name={pickerOpen ? 'chevron-up' : 'chevron-down'} size={22} color={C.muted} style={{ marginTop: 28 }} />
        </Pressable>

        {pickerOpen && (
          <Sheet style={{ padding: 6, marginTop: 14 }}>
            {classes.map((c, i) => (
              <View key={c.code}>
                {i > 0 && <Rule />}
                <Pressable style={s.pickRow} onPress={() => chooseClass(c.code)}>
                  <View style={{ flex: 1 }}>
                    <Text style={[T.h2, { fontSize: 18 }]}>{c.subject}</Text>
                    <View style={{ marginTop: 2 }}><Meta c={c} /></View>
                  </View>
                  {c.code === selectedCode && <Ionicons name="checkmark" size={20} color={C.plum} />}
                </Pressable>
              </View>
            ))}
            <Rule />
            <Pressable style={s.pickRow} onPress={() => { setPickerOpen(false); router.push('/add-class'); }}>
              <Ionicons name="add" size={20} color={C.plum} style={{ marginRight: 10 }} />
              <Text style={{ fontSize: 16, fontWeight: '600', color: C.plum }}>Add another class</Text>
            </Pressable>
          </Sheet>
        )}

        <View style={{ marginTop: 28 }}>
          <UField
            label="Quiz" value={quizName} onChangeText={setQuizName}
            onEndEditing={() => setSelection(selectedCode, quizName.trim() || 'Quiz 1')}
            placeholder="Quiz 1"
          />
        </View>

        {/* The three steps, as one thread */}
        <Step state={state1} title="Question paper">
          {hasPaper ? (
            <>
              <View style={s.tags}>
                {session.paper!.questions.map((q, i) => (
                  <View key={i} style={s.qTag}>
                    <Text style={{ fontWeight: '700', color: C.plum }}>Q{q.q}</Text>
                    <Text style={{ color: C.muted }}>  {q.clo || 'CLO?'}, {q.max || '?'} marks</Text>
                  </View>
                ))}
              </View>
              {!!paperProblems && <Text style={s.warn}>Please check: {paperProblems}</Text>}
              <Button title="Scan again" kind="soft" onPress={() => scan('paper')} style={{ marginTop: 14 }} />
            </>
          ) : (
            <>
              <Text style={[T.small, { marginBottom: 16 }]}>Photograph the printed question paper once. Robigo reads each question, its CLO and its marks.</Text>
              <Button title="Scan question paper" onPress={() => scan('paper')} />
            </>
          )}
        </Step>

        <Step state={state2} title="Student papers">
          {state2 === 'locked' ? (
            <Text style={T.small}>Opens after the question paper is read.</Text>
          ) : (
            <>
              <Text style={{ color: C.plum }}>
                <Text style={s.count}>{scannedCount}</Text>
                <Text style={T.small}>   of {total} students</Text>
              </Text>
              <View style={s.track}><View style={[s.fill, { width: `${total ? Math.min(100, (scannedCount / total) * 100) : 0}%` }]} /></View>
              {session.flaggedPages > 0 && (
                <Text style={[s.warn, { marginTop: 0, marginBottom: 14 }]}>
                  {session.flaggedPages === 1 ? '1 page needs' : `${session.flaggedPages} pages need`} a quick look in your sheet.
                </Text>
              )}
              <Button title="Scan student papers" kind={state2 === 'current' ? 'primary' : 'soft'} onPress={() => scan('students')} />
            </>
          )}
        </Step>

        <Step state={state3} title="Results" last>
          {state3 === 'locked' ? (
            <Text style={T.small}>Appears once you have scanned papers.</Text>
          ) : (
            <>
              <Text style={T.body}>
                {scannedCount} of {total} students scanned{missing.length === 0 ? ', everyone is in.' : ''}
              </Text>
              {missing.length > 0 && (
                <Text style={[T.small, { marginTop: 6 }]}>
                  Still missing: {missing.slice(0, 6).map((m) => m.name || m.sap_id).join(', ')}
                  {missing.length > 6 ? ` and ${missing.length - 6} more` : ''}
                </Text>
              )}
              {unknown.length > 0 && (
                <Text style={s.warn}>Not in your class list: {unknown.join(', ')}. Check these SAP IDs.</Text>
              )}
              <View style={s.row2}>
                <Button title="Email results" busy={busy} onPress={getResults} style={{ flex: 1 }} />
                <Button title="Open sheet" kind="soft" onPress={() => Linking.openURL(SHEET_URL)} style={{ flex: 1 }} />
              </View>
            </>
          )}
        </Step>
      </ScrollView>
    </SafeAreaView>
  );
}

// One stop on the thread: a node, a line down to the next stop, and the content.
function Step({ state, title, last, children }: { state: 'done' | 'current' | 'open' | 'locked'; title: string; last?: boolean; children: React.ReactNode }) {
  const done = state === 'done';
  return (
    <View style={{ flexDirection: 'row' }}>
      <View style={{ width: 34, alignItems: 'center' }}>
        <View style={[
          s.node,
          done && { backgroundColor: C.mint, borderColor: C.mint },
          state === 'current' && { backgroundColor: C.plum, borderColor: C.plum },
          state === 'open' && { borderColor: C.plum },
        ]}>
          {done && <Ionicons name="checkmark" size={14} color={C.good} />}
          {state === 'current' && <View style={s.dot} />}
        </View>
        {!last && <View style={[s.thread, done && { backgroundColor: C.mint }]} />}
      </View>
      <View style={{ flex: 1, paddingBottom: last ? 0 : 30, opacity: state === 'locked' ? 0.55 : 1 }}>
        <Text style={[T.h2, { marginBottom: 10 }]}>{title}</Text>
        {state === 'current' ? <Sheet style={{ padding: 18 }}>{children}</Sheet> : children}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.ivory },
  body: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 48 },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 28 },
  wordmark: { ...T.h2, fontSize: 20 },
  avatar: { width: 38, height: 38, borderRadius: 19, backgroundColor: C.lavender, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: C.plum, fontWeight: '700', fontSize: 16 },
  classHead: { flexDirection: 'row', alignItems: 'flex-start' },
  pickRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 14 },
  node: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: C.border, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.ivory },
  thread: { flex: 1, width: 2, backgroundColor: C.lavender, marginTop: 6, marginBottom: 2, borderRadius: 1 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  qTag: { flexDirection: 'row', backgroundColor: C.lavender, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  count: { fontSize: 40, lineHeight: 46, fontWeight: '600', color: C.plum, fontFamily: T.h1.fontFamily },
  track: { height: 8, borderRadius: 4, backgroundColor: C.lavender, overflow: 'hidden', marginTop: 10, marginBottom: 16 },
  fill: { height: 8, backgroundColor: C.plum, borderRadius: 4 },
  warn: { fontSize: 13, lineHeight: 19, color: C.warn, backgroundColor: C.warnBg, padding: 12, borderRadius: 14, marginTop: 12 },
  row2: { flexDirection: 'row', gap: 10, marginTop: 16 },
});