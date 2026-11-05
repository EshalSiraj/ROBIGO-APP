import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { AuthScreen, ErrorText, Field, PrimaryButton, SwitchLine } from '@/components/AuthUI';
import { friendlyError, signUp } from '@/lib/auth';
import { C, FONT } from '@/lib/theme';

export default function SignUp() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [sameEmail, setSameEmail] = useState(true); // send reports to the login email?
  const [reportEmail, setReportEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError('');
    if (!name.trim()) return setError('Please enter your name.');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Please enter a valid email address.');
    if (password.length < 6) return setError('Password must be at least 6 characters.');
    if (!sameEmail && !/^\S+@\S+\.\S+$/.test(reportEmail.trim())) return setError('Please enter the email where reports should go.');
    setBusy(true);
    try {
      await signUp(name, email, password, sameEmail ? email : reportEmail);
      router.replace('/'); // Home opens Add class by itself for a new teacher
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthScreen title="Create your account" subtitle="One minute, then your classes are ready.">
      <ErrorText text={error} />
      <Field label="Your name" icon="person-outline" value={name} onChangeText={setName} placeholder="e.g. Ms. Sara" autoCapitalize="words" />
      <Field label="Email" icon="mail-outline" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder="you@riphah.edu.pk" />
      <Field label="Password" icon="lock-closed-outline" secure value={password} onChangeText={setPassword} placeholder="6 or more characters" />

      <Text style={{ fontFamily: FONT.display, fontWeight: '700', fontSize: 19, color: C.plum, marginTop: 8, marginBottom: 10 }}>Send reports to</Text>
      <View style={{ flexDirection: 'row', backgroundColor: C.lavender, borderRadius: 999, padding: 4, marginBottom: 10 }}>
        <Segment on={sameEmail} label="My login email" onPress={() => setSameEmail(true)} />
        <Segment on={!sameEmail} label="Another email" onPress={() => setSameEmail(false)} />
      </View>
      {!sameEmail && (
        <View style={{ marginTop: 10 }}>
          <Field label="Report email" icon="paper-plane-outline" value={reportEmail} onChangeText={setReportEmail} keyboardType="email-address" autoCapitalize="none" placeholder="reports@riphah.edu.pk" />
        </View>
      )}
      <Text style={{ fontSize: 13, color: C.muted, marginBottom: 14 }}>You can change this later in Profile.</Text>

      <PrimaryButton title="Create account" onPress={submit} busy={busy} />
      <SwitchLine question="Already have an account?" action="Log in" onPress={() => router.replace('/login')} />
    </AuthScreen>
  );
}

function Segment({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 999, backgroundColor: on ? C.plum : 'transparent' }}>
      <Text style={{ fontSize: 15, fontWeight: '600', color: on ? C.ivory : C.plum }}>{label}</Text>
    </Pressable>
  );
}
