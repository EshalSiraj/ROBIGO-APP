import { useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword, onAuthStateChanged, sendPasswordResetEmail,
  signInWithEmailAndPassword, signOut, updateProfile, type User,
} from 'firebase/auth';
import { auth } from './firebase';
import { loadProfile, saveProfile } from './profile';
import { registerTeacher, restoreFromServer } from './sync';

// Who is logged in right now. `loading` is true for a moment while the app checks.
export function useAuthUser(): { user: User | null; loading: boolean } {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
  }, []);
  return { user, loading };
}

export async function signUp(name: string, email: string, password: string, reportEmail?: string): Promise<void> {
  const cleanEmail = email.trim().toLowerCase();
  const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
  await updateProfile(cred.user, { displayName: name.trim() });
  const old = await loadProfile();
  const report = (reportEmail || '').trim().toLowerCase() || cleanEmail;
  await saveProfile({ name: name.trim(), email: cleanEmail, reportEmail: report, courses: old?.courses ?? [], isNew: true });
  await registerTeacher(name.trim(), cleanEmail, report); // teacher appears in your Google Sheet
}

export async function logIn(email: string, password: string): Promise<void> {
  const cleanEmail = email.trim().toLowerCase();
  const cred = await signInWithEmailAndPassword(auth, cleanEmail, password);
  const old = await loadProfile();
  const back = await restoreFromServer(cleanEmail); // classes + students come back on a new phone
  await saveProfile({
    name: cred.user.displayName || back.name || old?.name || '',
    email: cleanEmail,
    reportEmail: back.reportEmail || old?.reportEmail || cleanEmail,
    courses: old?.courses ?? [],
    isNew: false, // an existing teacher never sees the Welcome screen
  });
}

export async function logOut(): Promise<void> {
  await signOut(auth);
}

export async function resetPassword(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim().toLowerCase());
}

// Turns Firebase error codes into plain sentences a teacher understands.
export function friendlyError(e: any): string {
  switch (e?.code) {
    case 'auth/invalid-email': return 'That email address does not look right.';
    case 'auth/email-already-in-use': return 'This email already has an account. Try logging in.';
    case 'auth/weak-password': return 'Password must be at least 6 characters.';
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found': return 'Email or password is not correct.';
    case 'auth/network-request-failed': return 'No internet connection. Please try again.';
    case 'auth/too-many-requests': return 'Too many tries. Please wait a few minutes and try again.';
    default: return 'Something went wrong. Please try again.';
  }
}