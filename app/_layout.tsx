import { Stack } from 'expo-router';
import AuthGate from '@/components/AuthGate';
import { C } from '@/lib/theme';

export default function RootLayout() {
  return (
    <AuthGate>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: C.ivory } }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="add-class" options={{ presentation: 'modal' }} />
        <Stack.Screen name="class/[code]" />
        <Stack.Screen name="quiz/[code]" />
        <Stack.Screen name="paper/[code]" />
        <Stack.Screen name="saved" options={{ gestureEnabled: false }} />
        <Stack.Screen name="login" />
        <Stack.Screen name="signup" />
      </Stack>
    </AuthGate>
  );
}
