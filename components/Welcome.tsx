import React from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { C, FONT, T } from '@/lib/theme';

const STEPS = [
  { title: 'Class details', note: 'Subject, course code, semester' },
  { title: 'Student list', note: 'Choose your Excel file' },
  { title: 'Question paper', note: 'Scan it once for each quiz' },
];

// Shown on Home when a brand-new account has no class yet.
export default function Welcome({ name, onAdd }: { name: string; onAdd: () => void }) {
  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <View style={s.logoWrap}>
          <Image source={require('../assets/logo.png')} style={s.logo} resizeMode="contain" />
        </View>

        <Text style={s.title}>{name ? `Welcome, ${name}` : 'Welcome'}</Text>
        <Text style={s.sub}>Add your first class and Robigo takes care of the marking sheets.</Text>

        <View style={{ marginTop: 22 }}>
          {STEPS.map((st, i) => (
            <View key={st.title} style={[s.step, i === STEPS.length - 1 && { borderBottomWidth: 1 }]}>
              <Text style={s.num}>{i + 1}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.stepTitle}>{st.title}</Text>
                <Text style={s.stepNote}>{st.note}</Text>
              </View>
            </View>
          ))}
        </View>

        <View style={s.foot}>
          <Pressable onPress={onAdd} style={({ pressed }) => [s.btn, pressed && { opacity: 0.85 }]}>
            <Text style={s.btnText}>Add your first class</Text>
            <Ionicons name="arrow-forward" size={20} color={C.ivory} />
          </Pressable>
          <Text style={s.hint}>It takes about a minute.</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// Shown when a teacher who already has an account has no classes on this phone (for example, offline right after logging in).
export function NoClasses({ onRetry, onAdd, busy }: { onRetry: () => void; onAdd: () => void; busy?: boolean }) {
  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <View style={s.logoWrap}>
          <Image source={require('../assets/logo.png')} style={s.logo} resizeMode="contain" />
        </View>
        <Text style={s.title}>No classes yet</Text>
        <Text style={s.sub}>We could not find classes for this account. If you already added classes, check your internet and try again.</Text>
        <View style={s.foot}>
          <Pressable onPress={onRetry} disabled={busy} style={({ pressed }) => [s.btn, (pressed || busy) && { opacity: 0.7 }]}>
            <Text style={s.btnText}>{busy ? 'Loading your classes…' : 'Try again'}</Text>
          </Pressable>
          <Pressable onPress={onAdd} hitSlop={10} style={{ marginTop: 16 }}>
            <Text style={[s.btnText, { color: C.plum, textDecorationLine: 'underline' }]}>Add a class instead</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const HAIR = 'rgba(64,51,79,0.12)';
const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.ivory },
  body: { flexGrow: 1, paddingHorizontal: 26, paddingTop: 16, paddingBottom: 28 },
  logoWrap: { alignItems: 'center', justifyContent: 'center', height: 280 },
  logo: { width: 240, height: 241 },
  title: { ...T.h1, fontSize: 34, lineHeight: 40, marginTop: 6 },
  sub: { ...T.small, fontSize: 16, lineHeight: 23, marginTop: 8 },
  step: { flexDirection: 'row', alignItems: 'center', gap: 18, paddingVertical: 14, borderTopWidth: 1, borderColor: HAIR },
  num: { width: 22, fontFamily: FONT.display, fontSize: 26, fontWeight: '700', color: C.plum },
  stepTitle: { fontSize: 16, fontWeight: '600', color: C.plum },
  stepNote: { fontSize: 13, color: C.muted, marginTop: 1 },
  foot: { marginTop: 'auto', paddingTop: 28, alignItems: 'center' },
  btn: { alignSelf: 'stretch', height: 56, borderRadius: 999, backgroundColor: C.plum, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  btnText: { color: C.ivory, fontSize: 16, fontWeight: '600', letterSpacing: 0.2 },
  hint: { fontSize: 13, color: C.muted, marginTop: 12 },
});