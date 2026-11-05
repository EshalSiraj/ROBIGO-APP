import { N8N_BASE } from './config';
import { listClasses, loadStudents, markSynced, saveClassLocal } from './classes';
import { loadProfile } from './profile';

const TIMEOUT_MS = 15000;

async function getJson(url: string): Promise<any> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) throw new Error(String(res.status));
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

// Sign-up: puts the teacher in the Teachers tab of your Google Sheet. Never blocks sign-up if it fails.
export async function registerTeacher(name: string, email: string, reportEmail?: string): Promise<boolean> {
  try {
    const res = await fetch(`${N8N_BASE}/tmate-teacher`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, reportEmail: reportEmail || email }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Log-in on a new phone: brings back every class and its students (SAP ID + name) from the sheet.
// Returns the teacher's saved report email (if any) and how many classes came back.
export async function restoreFromServer(email: string): Promise<{ added: number; reportEmail: string; name: string }> {
  try {
    const data = await getJson(`${N8N_BASE}/tmate-restore?email=${encodeURIComponent(email.trim().toLowerCase())}`);
    const have = new Set((await listClasses()).map((c) => c.code));
    let added = 0;
    for (const c of data.courses ?? []) {
      if (have.has(c.code)) continue;
      const students = data.students?.[c.code] ?? [];
      await saveClassLocal(
        {
          code: c.code, subject: c.name, program: c.program, semester: c.semester, section: c.section,
          studentCount: students.length, synced: true, createdAt: new Date().toISOString(),
        },
        students,
      );
      added++;
    }
    return { added, reportEmail: data.teacher?.reportEmail || data.reportEmail || '', name: data.teacher?.name ?? '' };
  } catch {
    return { added: 0, reportEmail: '', name: '' }; // offline: the teacher starts with what is on this phone
  }
}

// Classes saved while offline are sent to the sheet later, automatically.
export async function syncPending(): Promise<void> {
  const profile = await loadProfile();
  if (!profile?.email) return;
  for (const c of (await listClasses()).filter((x) => !x.synced)) {
    try {
      const students = await loadStudents(c.code);
      const res = await fetch(`${N8N_BASE}/tmate-setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teacher: { name: profile.name, email: profile.email },
          course: {
            code: c.code, name: c.subject, program: c.program, semester: c.semester,
            section: c.section, passThreshold: 50, classTarget: 60, recipients: profile.reportEmail || profile.email,
          },
          roster: students,
        }),
      });
      if (res.ok) await markSynced(c.code);
    } catch {
      // still offline; try again next time the home screen opens
    }
  }
}
