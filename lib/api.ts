import { N8N_BASE } from './config';
import type { CourseInfo } from './profile';

export type RosterRow = { sap_id: string; name: string };

export type SetupPayload = {
  teacher: { name: string; email: string };
  course: {
    code: string;
    name: string;
    section: string;
    passThreshold: number;
    classTarget: number;
    recipients: string;
  };
  roster: RosterRow[];
};

async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

// One-time setup: saves teacher, course settings and the class list in n8n.
export async function postSetup(payload: SetupPayload): Promise<{ ok: boolean; course: string; students: number }> {
  const res = await fetch(`${N8N_BASE}/tmate-setup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await readJson(res);
  if (!res.ok) throw new Error(data?.message || `Setup failed (${res.status})`);
  return data;
}

// Lets the app refill itself on a new phone: everything this teacher already saved.
export async function fetchCourses(email: string): Promise<CourseInfo[]> {
  const res = await fetch(`${N8N_BASE}/tmate-courses?email=${encodeURIComponent(email.trim().toLowerCase())}`);
  if (!res.ok) throw new Error(`Could not load courses (${res.status})`);
  return (await readJson(res)) as CourseInfo[];
}
