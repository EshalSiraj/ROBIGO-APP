import React, { useCallback, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { loadProfile, saveProfile } from '@/lib/profile';
import { listClasses } from '@/lib/classes';
import { logOut } from '@/lib/auth';
import { registerTeacher } from '@/lib/sync';
import { C, FONT, T } from '@/lib/theme';
import { Button, Rule, UField } from '@/components/ui';

// Name, where reports go, and log out.
export default function Profile() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [reportEmail, setReportEmail] = useState('');
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [classCount, setClassCount] = useState(0);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      (async () => {
        const p = await loadProfile();
        const n = (await listClasses()).length;
        if (!alive) return;
        setName(p?.name ?? ''); setEmail(p?.email ?? ''); setReportEmail(p?.reportEmail || p?.email || ''); setClassCount(n);
      })();
      return () => { alive = false; };
    }, []),
  );

  async function saveReport() {
    const v = draft.trim().toLowerCase();
    if (!/^\S+@\S+\.\S+$/.test(v)) return Alert.alert('Check the email', 'Please enter a valid email address.');
    const p = await loadProfile();
    if (p) await saveProfile({ ...p, reportEmail: v });
    setReportEmail(v);
    setEditing(false);
    registerTeacher(name, email, v); // keeps your Google Sheet in step; fine if it fails
  }

  function askLogout() {
    Alert.alert('Log out?', email, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log out', style: 'destructive', onPress: () => { logOut(); } },
    ]);
  }

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <View style={s.avatar}><Text style={s.avatarText}>{(name[0] ?? '?').toUpperCase()}</Text></View>
          <Text style={[T.h1, { marginTop: 18 }]}>{name || 'Teacher'}</Text>
          <Text style={[T.small, { marginTop: 4, marginBottom: 32 }]}>{email}</Text>

          <Rule />
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={T.small}>Reports go to</Text>
              {!editing && <Text style={s.value} numberOfLines={1}>{reportEmail}</Text>}
            </View>
            {!editing && (
              <Pressable onPress={() => { setDraft(reportEmail); setEditing(true); }} hitSlop={10}>
                <Text style={s.link}>Change</Text>
              </Pressable>
            )}
          </View>
          {editing && (
            <View style={{ marginBottom: 8 }}>
              <UField label="New report email" value={draft} onChangeText={setDraft} autoFocus keyboardType="email-address" autoCapitalize="none" placeholder="reports@riphah.edu.pk" />
              <View style={{ flexDirection: 'row', gap: 10 }}>
                <Button title="Cancel" kind="soft" onPress={() => setEditing(false)} style={{ flex: 1 }} />
                <Button title="Save" onPress={saveReport} style={{ flex: 1 }} />
              </View>
            </View>
          )}
          <Rule />
          <View style={s.row}>
            <Text style={[T.small, { flex: 1 }]}>Classes</Text>
            <Text style={s.value}>{classCount}</Text>
          </View>
          <Rule />

          <Pressable onPress={askLogout} style={{ marginTop: 40, alignItems: 'center', padding: 12 }}>
            <Text style={{ color: C.danger, fontSize: 16, fontWeight: '700' }}>Log out</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.ivory },
  body: { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 48 },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: C.lavender, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: C.plum, fontFamily: FONT.display, fontWeight: '600', fontSize: 32 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 18 },
  value: { fontSize: 17, fontWeight: '600', color: C.plum, marginTop: 2 },
  link: { color: C.plum, fontWeight: '700', fontSize: 15, textDecorationLine: 'underline' },
});
