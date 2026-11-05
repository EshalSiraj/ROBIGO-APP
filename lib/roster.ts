import type { RosterRow } from './api';

// Accepts pasted text or a CSV: one student per line, "55232, Ali Khan" (tab or ; also work).
// The SAP ID can be in any column. Header lines and blank lines are skipped.
export function parseRoster(text: string): { rows: RosterRow[]; skipped: number } {
  const seen = new Set<string>();
  const rows: RosterRow[] = [];
  let skipped = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cells = line.split(/[,\t;]/).map((c) => c.trim().replace(/^"|"$/g, ''));
    const idCell = cells.find((c) => /^\d{4,}$/.test(c.replace(/\s/g, '')));
    if (!idCell) {
      skipped++;
      continue;
    }
    const sap = idCell.replace(/\s/g, '');
    if (seen.has(sap)) {
      skipped++;
      continue;
    }
    seen.add(sap);
    const name = cells.filter((c) => c !== idCell && c).join(' ');
    rows.push({ sap_id: sap, name });
  }
  return { rows, skipped };
}
