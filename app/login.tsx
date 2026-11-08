import { AuthScreen, ErrorText, Field, PrimaryButton, SwitchLine } from '@/components/AuthUI';
import { friendlyError, logIn, resetPassword } from '@/lib/auth';
import { C } from '@/lib/theme';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, Text } from 'react-native';
export default function Login() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setError('');
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Please enter your email address.');
    if (!password) return setError('Please enter your password.');
    setBusy(true);
    try {
      await logIn(email, password);
     router.replace('/(tabs)/classes');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function forgot() {
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      return Alert.alert('Type your email first', 'Enter your email above, then tap "Forgot password?" again.');
    }
    try {
      await resetPassword(email);
      Alert.alert('Check your email', 'We sent you a link to choose a new password.');
    } catch (e) {
      Alert.alert('Could not send', friendlyError(e));
    }
  }

  return (
    <AuthScreen title="Welcome back" subtitle="Log in to see your classes.">
      <ErrorText text={error} />
      <Field label="Email" icon="mail-outline" value={email} onChangeText={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder="you@riphah.edu.pk" />
      <Field label="Password" icon="lock-closed-outline" secure value={password} onChangeText={setPassword} placeholder="Your password" />
      <Pressable onPress={forgot} style={{ alignSelf: 'flex-end', marginBottom: 14 }}>
        <Text style={{ color: C.plum, fontWeight: '600' }}>Forgot password?</Text>
      </Pressable>
      <PrimaryButton title={busy ? "Loading your classes…" : "Log in"} onPress={submit} busy={busy} />
      <SwitchLine question="New here?" action="Sign up" onPress={() => router.replace('/signup')} />
    </AuthScreen>
  );
}
