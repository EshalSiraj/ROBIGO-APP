import React from 'react';
import { Redirect, usePathname } from 'expo-router';
import { useAuthUser } from '@/lib/auth';

// Wrap your app with this inside src/app/_layout.tsx, around your existing <Stack /> or <Slot />:
//
//   <AuthGate>
//     <Stack />        // whatever your layout already renders
//   </AuthGate>
//
// Not logged in -> Login. Logged in -> Home (never shows Login again).
export default function AuthGate({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuthUser();
  const path = usePathname();
  if (loading) return null; // splash is still showing for this moment
  const onAuthScreen = path === '/login' || path === '/signup';
  if (!user && !onAuthScreen) return <Redirect href="/login" />;
  if (user && onAuthScreen) return <Redirect href="/" />;
  return <>{children}</>;
}
