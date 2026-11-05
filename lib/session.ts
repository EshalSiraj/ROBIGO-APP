import AsyncStorage from '@react-native-async-storage/async-storage';

// What has happened so far for one quiz of one class (kept on the phone).
export type PaperQ = { q: number | string; clo: string; max: number | string };

export type Session = {
  paper?: { questions: PaperQ[]; flags: string[] };
  scanned: Record<string, string>; // SAP ID -> name, one entry per student scanned
  pages: number;                   // pages sent
  flaggedPages: number;            // pages that need a quick look
};

export const emptySession = (): Session => ({ scanned: {}, pages: 0, flaggedPages: 0 });
const key = (assessment: string) => `tmate.session.v1.${assessment}`;

export async function loadSession(assessment: string): Promise<Session> {
  try {
    const raw = await AsyncStorage.getItem(key(assessment));
    return raw ? { ...emptySession(), ...(JSON.parse(raw) as Session) } : emptySession();
  } catch {
    return emptySession();
  }
}

export async function saveSession(assessment: string, s: Session): Promise<void> {
  try {
    await AsyncStorage.setItem(key(assessment), JSON.stringify(s));
  } catch {
    // Not critical: the data is also in the Google Sheet.
  }
}

export type QuizInfo = { name: string; scanned: number; hasPaper: boolean; flagged: number };

// Every quiz that has been started for one class, newest name last (Quiz 1, Quiz 2, ...).
export async function listQuizzes(code: string): Promise<QuizInfo[]> {
  try {
    const prefix = `tmate.session.v1.${code} `;
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(prefix));
    const out: QuizInfo[] = [];
    for (const k of keys) {
      const sess = await loadSession(k.slice('tmate.session.v1.'.length));
      out.push({ name: k.slice(prefix.length), scanned: Object.keys(sess.scanned).length, hasPaper: !!sess.paper, flagged: sess.flaggedPages });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  } catch {
    return [];
  }
}

export async function removeSessions(code: string): Promise<void> {
  try {
    const prefix = `tmate.session.v1.${code} `;
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(prefix));
    if (keys.length) await AsyncStorage.multiRemove(keys);
  } catch {
    // Not critical.
  }
}
