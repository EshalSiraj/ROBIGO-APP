


import AuthGate from '@/components/AuthGate';
import StartupFlow from '@/components/StartupFlow';
import { C } from '@/lib/theme';
import { Stack } from 'expo-router';

export default function RootLayout() {
  return (
    <StartupFlow>
      <AuthGate>
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: C.ivory },
          }}
        >
          <Stack.Screen name="(tabs)" />
          <Stack.Screen
            name="add-class"
            options={{ presentation: 'modal' }}
          />
          <Stack.Screen name="class/[code]" />
          <Stack.Screen name="login" />
          <Stack.Screen name="signup" />
          <Stack.Screen name="scanner" />
<Stack.Screen name="folders" />
<Stack.Screen name="upload-files" />
        </Stack>
      </AuthGate>
    </StartupFlow>
  );
}


