import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { N8N_BASE } from './config';

// Shrinks the photo to about 1600 px wide (about 300-500 KB). Faster upload, and safely under Groq's size limit.
export async function shrink(uri: string): Promise<string> {
  try {
    const r = await manipulateAsync(uri, [{ resize: { width: 1600 } }], { compress: 0.8, format: SaveFormat.JPEG });
    return r.uri;
  } catch {
    return uri; // fall back to the original photo
  }
}

export type PageReply = {
  ok: boolean;
  flags?: string[];
  // student page
  sap_id?: string;
  student_name?: string;
  rows?: number;
  // question paper
  questions?: { q: number | string; clo: string; max: number | string }[];
};

// Sends one photo to n8n. Tries up to 3 times, so a weak connection does not lose a page.
export async function sendPage(
  kind: 'paper' | 'student',
  uri: string,
  assessment: string,
  pageId: string,
): Promise<PageReply> {
  const url = `${N8N_BASE}/${kind === 'paper' ? 'tmate-paper' : 'tmate-scan'}`;
  let lastError: any = new Error('Upload failed');
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const form = new FormData();
      form.append('page', { uri, name: `${pageId}.jpg`, type: 'image/jpeg' } as any);
      form.append('assessment', assessment);
      form.append('pageId', pageId);
      const res = await fetch(url, { method: 'POST', body: form }); // no Content-Type header: fetch adds it
      const text = await res.text();
      if (!res.ok) throw new Error(`Server answered ${res.status}`);
      return JSON.parse(text) as PageReply;
    } catch (e) {
      lastError = e;
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw lastError;
}

// Plain-language versions of the checks n8n reports.
const WORDS: Record<string, string> = {
  UNREADABLE_PAGE: 'the page could not be read',
  UNREADABLE_PAPER: 'the question paper could not be read',
  SAP_ID_MISSING: 'SAP ID not found',
  SAP_ID_LENGTH: 'SAP ID looks wrong',
  NO_QUESTIONS_FOUND: 'no questions found',
  PAPER_NOT_SETUP: 'scan the question paper first',
  Q_MISSING: 'a question number is missing',
  Q_NOT_IN_PAPER: 'a question is not in the question paper',
  MARKS_MISSING: 'a mark is missing',
  MARKS_OVER_MAX: 'a mark is above the maximum',
  PARTS_MISMATCH: 'part marks do not add up',
  CLO_MISSING: 'a CLO is missing',
  MAX_MISSING: 'marks for a question are missing',
  DUPLICATE_Q: 'a question appears twice',
};
export const sayFlags = (flags?: string[]) =>
  (flags ?? []).map((f) => WORDS[f] ?? f.toLowerCase().replace(/_/g, ' ')).join(', ');
