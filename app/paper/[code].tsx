import { Button, Rule } from '@/components/ui';
import { getPaper, savePaper, type Paper } from '@/lib/papers';
import { C, FONT, T } from '@/lib/theme';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// One student's paper: the photo on top, the marks that were read below. Fix a mark and save.
export default function PaperScreen() {
  const router = useRouter();
  const { code, quiz, sap } = useLocalSearchParams<{ code: string; quiz: string; sap: string }>();
  const assessment = `${code} ${quiz}`;
  const [paper, setPaper] = useState<Paper | undefined>();
  const [got, setGot] = useState<string[]>([]);
  const [error, setError] = useState('');

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const p = await getPaper(assessment, sap);
        if (!alive) return;
        setPaper(p);
        setGot((p?.marks ?? []).map((m) => String(m.got)));
      })();
      return () => { alive = false; };
    }, [assessment, sap]),
  );

  function change(i: number, text: string) {
  setError('');
  const clean = text.replace(/[^0-9.]/g, '').replace(/^(\d*\.?\d*).*$/, '$1');
  setGot((g) => g.map((v, j) => (j === i ? clean : v)));
}

  async function save() {
    if (!paper) return;
    const tooHigh = paper.marks.findIndex((m, i) => got[i] !== '' && Number(got[i]) > Number(m.max));
    if (tooHigh >= 0) {
      setError(`Q${paper.marks[tooHigh].q} is out of ${paper.marks[tooHigh].max} marks. Enter a smaller number.`);
      return;
    }
    await savePaper(assessment, { ...paper, marks: paper.marks.map((m, i) => ({ ...m, got: got[i] ?? '' })), savedAt: new Date().toISOString() });
    router.back();
  }

  const Back = (
    <Pressable onPress={() => router.back()} hitSlop={12} style={s.back}>
      <Ionicons name="chevron-back" size={20} color={C.plum} />
      <Text style={s.backText}>{quiz}</Text>
    </Pressable>
  );

  if (!paper) {
    return (
      <SafeAreaView style={s.safe}>
        <View style={{ padding: 24 }}>{Back}<Text style={T.small}>This paper was not found on this phone.</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          {Back}
          <Text style={[T.h1, { marginTop: 18 }]}>{paper.name || paper.sap_id}</Text>
          <Text style={[T.small, { marginTop: 6 }]}>SAP {paper.sap_id}, {quiz}</Text>

          <View style={s.photo}>
            {paper.photo ? (
              <Image source={{ uri: paper.photo }} style={{ width: '100%', height: '100%' }} resizeMode="contain" />
            ) : (
              <View style={{ flex: 1, justifyContent: 'center' }}>
                {[0, 1, 2, 3, 4, 5].map((i) => <View key={i} style={[s.line, i % 2 === 1 && { width: '60%' }]} />)}
                <Text style={[T.small, { textAlign: 'center', marginTop: 4 }]}>The photo appears here after scanning.</Text>
              </View>
            )}
          </View>

          <View style={{ marginTop: 14 }}>
            <Rule />
            {paper.marks.map((m, i) => {
              const empty = got[i] === '' || got[i] === undefined;
              return (
                <View key={String(m.q)}>
                  <View style={s.mark}>
                    <Text style={s.q}>Q{m.q}</Text>
                    <Text style={[T.small, { flex: 1 }]}>{m.clo || 'CLO?'}, out of {m.max}{empty ? ', please check' : ''}</Text>
                    <TextInput
                      value={got[i] ?? ''}
                      onChangeText={(t) => change(i, t)}
                      keyboardType="decimal-pad"
                      placeholder="?"
                      placeholderTextColor={C.faint}
                      maxLength={5}
                      style={[s.input, empty && { backgroundColor: C.lavender, borderTopLeftRadius: 8, borderTopRightRadius: 8 }]}
                    />
                  </View>
                  <Rule />
                </View>
              );
            })}
          </View>

          {!!error && <Text style={s.error}>{error}</Text>}
          <Button title="Save marks" onPress={save} style={{ marginTop: 26 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.ivory },
  body: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 48 },
  back: { flexDirection: 'row', alignItems: 'center', marginLeft: -4, marginBottom: 4 },
  backText: { color: C.plum, fontWeight: '600', fontSize: 15 },
  photo: { height: 250, borderRadius: 18, borderWidth: 1.5, borderColor: C.lavender, marginTop: 16, overflow: 'hidden', padding: 14 },
  line: { height: 2, backgroundColor: 'rgba(64,51,79,0.12)', marginBottom: 14 },
  mark: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  q: { width: 38, fontFamily: FONT.display, fontWeight: '700', fontSize: 20, color: C.plum },
  input: { width: 64, textAlign: 'center', fontSize: 18, fontWeight: '600', color: C.plum, paddingVertical: 6, borderBottomWidth: 1.5, borderBottomColor: C.plum },
  error: { fontSize: 13, lineHeight: 19, color: C.plum, backgroundColor: C.lavender, padding: 12, borderRadius: 14, marginTop: 14 },
});
