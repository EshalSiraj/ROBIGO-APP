import AsyncStorage from '@react-native-async-storage/async-storage';

// Every class and its student list (SAP ID + name) is kept on the phone, so the app can use it
// later without internet: showing the student count, and checking scanned quizzes against it.
// The same list is also saved in your Google Sheet (Roster tab) through n8n.

export type Student = { sap_id: string; name: string };

export type ClassRecord = {
  code: string;          // e.g. BSCS-S7-DATABASESYSTEMS-A
  subject: string;
  program: string;
  semester: string;
  section: string;       // '' when there is no section
  studentCount: number;
  synced: boolean;       // true once the server (n8n) has the same list
  createdAt: string;
};

const CLASSES_KEY = 'tmate.classes.v1';
const rosterKey = (code: string) => `tmate.roster.v1.${code}`;

export async function listClasses(): Promise<ClassRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(CLASSES_KEY);
    return raw ? (JSON.parse(raw) as ClassRecord[]) : [];
  } catch {
    return [];
  }
}

export async function loadStudents(code: string): Promise<Student[]> {
  try {
    const raw = await AsyncStorage.getItem(rosterKey(code));
    return raw ? (JSON.parse(raw) as Student[]) : [];
  } catch {
    return [];
  }
}

// Saves (or replaces) one class together with all its students.
export async function saveClassLocal(rec: ClassRecord, students: Student[]): Promise<void> {
  const others = (await listClasses()).filter((c) => c.code !== rec.code);
  await AsyncStorage.setItem(rosterKey(rec.code), JSON.stringify(students));
  await AsyncStorage.setItem(CLASSES_KEY, JSON.stringify([...others, rec]));
}

export async function markSynced(code: string): Promise<void> {
  const all = await listClasses();
  await AsyncStorage.setItem(
    CLASSES_KEY,
    JSON.stringify(all.map((c) => (c.code === code ? { ...c, synced: true } : c))),
  );
}

// After scanning: which students of this class have a scanned quiz, and who is missing.
export async function checkAgainstClass(code: string, scannedSapIds: string[]) {
  const students = await loadStudents(code);
  const scanned = new Set(scannedSapIds);
  const known = new Set(students.map((s) => s.sap_id));
  return {
    present: students.filter((s) => scanned.has(s.sap_id)),
    missing: students.filter((s) => !scanned.has(s.sap_id)),
    unknown: scannedSapIds.filter((id) => !known.has(id)),
  };
}

// Removes a class and its student list from THIS phone only (your Google Sheet keeps its copy).
export async function deleteClassLocal(code: string): Promise<void> {
  const rest = (await listClasses()).filter((c) => c.code !== code);
  await AsyncStorage.setItem(CLASSES_KEY, JSON.stringify(rest));
  await AsyncStorage.removeItem(rosterKey(code));
}
