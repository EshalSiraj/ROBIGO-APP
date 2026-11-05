import AsyncStorage from '@react-native-async-storage/async-storage';

export type CourseInfo = {
  code: string;
  name: string;
  section: string;
  passThreshold: number;
  classTarget: number;
  recipients: string;
};

export type Profile = {
  name: string;
  email: string;
  reportEmail?: string;   // where result reports are sent (defaults to email)
  courses: CourseInfo[];
  isNew?: boolean;        // true only for an account created on this phone (shows the Welcome screen)
};

const KEY = 'tmate.profile.v1';

export async function loadProfile(): Promise<Profile | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Profile) : null;
  } catch {
    return null;
  }
}

export async function saveProfile(p: Profile): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // The setup is also saved in n8n, so the app can rebuild this later.
  }
}

// Add or replace one course in the saved profile.
export async function upsertCourse(name: string, email: string, course: CourseInfo): Promise<Profile> {
  const old = await loadProfile();
  const others = (old?.courses ?? []).filter((c) => c.code !== course.code);
  const next: Profile = { name, email, courses: [...others, course] };
  await saveProfile(next);
  return next;
}