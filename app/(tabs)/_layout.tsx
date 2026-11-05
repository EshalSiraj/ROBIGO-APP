import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { C } from '@/lib/theme';

// The three tabs every teacher sees at the bottom.
export default function TabsLayout() {
  const icon = (on: keyof typeof Ionicons.glyphMap, off: keyof typeof Ionicons.glyphMap) =>
    ({ color, size, focused }: { color: string; size: number; focused: boolean }) =>
      <Ionicons name={focused ? on : off} color={color} size={size} />;
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.plum,
        tabBarInactiveTintColor: C.muted,
        tabBarStyle: { backgroundColor: C.ivory, borderTopColor: C.border, borderTopWidth: 1, height: 64, paddingTop: 6, paddingBottom: 8 },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: icon('home', 'home-outline') }} />
      <Tabs.Screen name="classes" options={{ title: 'My classes', tabBarIcon: icon('school', 'school-outline') }} />
      <Tabs.Screen name="profile" options={{ title: 'Profile', tabBarIcon: icon('person', 'person-outline') }} />
    </Tabs>
  );
}
