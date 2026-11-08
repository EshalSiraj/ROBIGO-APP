import AsyncStorage from '@react-native-async-storage/async-storage';
import { loadStudents } from './classes';
import { loadSession, saveSession } from './session';

// One scanned student paper of one quiz: who it belongs to, the photo, and the marks that were read.
// Kept on the phone. Marks that could not be read are saved as an empty string and shown as "Check".
export type Mark = { q: number | string; clo: string; max: number | string; got: string };
export type Paper = { sap_id: string; name: string; photo?: string; marks: Mark[]; savedAt: string };

const key = (assessment: string) => `tmate.papers.v1.${assessment}`;

export async function listPapers(assessment: string): Promise<Paper[]> {
  try {
    const raw = await AsyncStorage.getItem(key(assessment));
    return raw ? (JSON.parse(raw) as Paper[]) : [];
  } catch {
    return [];
  }
}

export async function getPaper(assessment: string, sapId: string): Promise<Paper | undefined> {
  return (await listPapers(assessment)).find((p) => p.sap_id === sapId);
}

export const needsCheck = (p: Paper) => p.marks.some((m) => String(m.got).trim() === '');

// "Q1 to Q4 read" when everything was read, otherwise "Q3 unclear".
export function readNote(p: Paper): string {
  const bad = p.marks.filter((m) => String(m.got).trim() === '').map((m) => `Q${m.q}`);
  if (bad.length) return `${bad.join(', ')} unclear`;
  if (p.marks.length === 0) return 'No marks read';
  if (p.marks.length === 1) return `Q${p.marks[0].q} read`;
  return `Q${p.marks[0].q} to Q${p.marks[p.marks.length - 1].q} read`;
}

// Saves (or replaces) one paper and keeps the quiz progress on Home in step with it.
export async function savePaper(assessment: string, paper: Paper): Promise<void> {
  const others = (await listPapers(assessment)).filter((p) => p.sap_id !== paper.sap_id);
  const all = [...others, paper].sort((a, b) => a.sap_id.localeCompare(b.sap_id, undefined, { numeric: true }));
  try {
    await AsyncStorage.setItem(key(assessment), JSON.stringify(all));
  } catch {
    // Not critical.
  }
  const sess = await loadSession(assessment);
  sess.scanned = { ...sess.scanned, [paper.sap_id]: paper.name };
  sess.flaggedPages = all.filter(needsCheck).length;
  await saveSession(assessment, sess);
}

export async function removePapers(code: string): Promise<void> {
  try {
    const prefix = `tmate.papers.v1.${code} `;
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(prefix));
    if (keys.length) await AsyncStorage.multiRemove(keys);
  } catch {
    // Not critical.
  }
}

// For trying the screens before the camera is ready: four sample papers from the real class list.
export async function addSamplePapers(code: string, quiz: string): Promise<void> {
  const assessment = `${code} ${quiz}`;
  const sess = await loadSession(assessment);
  if (!sess.paper) {
    sess.paper = {
      questions: [
        { q: 1, clo: 'CLO 1', max: 5 }, { q: 2, clo: 'CLO 1', max: 5 },
        { q: 3, clo: 'CLO 2', max: 5 }, { q: 4, clo: 'CLO 3', max: 5 },
      ],
      flags: [],
    };
    await saveSession(assessment, sess);
  }
  const roster = (await loadStudents(code)).slice(0, 4);
  const grades = [['4', '5', '3', '5'], ['5', '4', '4', '2'], ['4', '5', '', '3'], ['3', '3', '4', '4']];
  for (let i = 0; i < roster.length; i++) {
    await savePaper(assessment, {
      sap_id: roster[i].sap_id,
      name: roster[i].name,
      marks: sess.paper.questions.map((q, j) => ({ q: q.q, clo: String(q.clo), max: q.max, got: grades[i][j] })),
      savedAt: new Date().toISOString(),
    });
  }
}
