import React, { useMemo, useState } from 'react';
import {
  Alert, KeyboardAvoidingView, Platform, Pressable,
  ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import * as XLSX from 'xlsx';
import { N8N_BASE } from '@/lib/config';
import { loadProfile } from '@/lib/profile';
import { saveClassLocal, markSynced } from '@/lib/classes';
import { Ionicons } from '@expo/vector-icons';
import { C, FONT, T } from '@/lib/theme';
import { Button, Rule } from '@/components/ui';

// ---------------------------------------------------------------- types and small helpers
type Student = { sap_id: string; name: string };
type Parsed = {
  students: Student[];
  skipped: number;      // non-empty rows that had no SAP ID (the header row counts here)
  noName: number;       // students found without a name
  oddLength: number;    // SAP IDs whose length differs from the most common length
};

const NAVY = C.plum;
const BLUE = C.plum;

// BSCS + 7 + CS402 + A  ->  BSCS-S7-CS402-A (the class ID; the course code is its third part)
function makeCourseCode(program: string, semester: string, courseCode: string, section: string): string {
  const clean = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const parts = [clean(program), 'S' + clean(semester), clean(courseCode)];
  if (clean(section)) parts.push(clean(section));
  return parts.join('-');
}

// Turns a cell into a SAP ID if it looks like one: 55232, "55 232", "55,232", "55232.0", "SAP-55232".
function asSapId(cell: string): string | null {
  let c = cell.trim();
  if (!c) return null;
  c = c.replace(/^[A-Za-z]{2,6}[\s:#\-]*(?=\d)/, '');   // SAP-55232, ID: 55232
  c = c.replace(/\.0+$/, '');                              // 55232.0
  c = c.replace(/[\s,\-]/g, '');                           // 55 232, 55,232
  return /^\d{4,12}$/.test(c) ? c : null;
}

const BAD_NAME_HEADER = /father|mother|guardian|parent|email|mail|phone|mobile|contact|cnic|address|city|section|program|course|campus/i;
const BAD_ID_HEADER = /phone|mobile|contact|cell|cnic|marks|total|percent|cgpa|gpa/i;
const PHONE_LIKE = /^(0|92)3\d{9}$/;

// A cell that looks like a person's name: mostly letters, not an email, not a number.
function looksLikeName(cell: string): boolean {
  const c = cell.trim();
  if (c.length < 3 || c.length > 60 || c.includes('@')) return false;
  const letters = (c.match(/\p{L}/gu) ?? []).length;
  return letters >= 3 && letters / c.length >= 0.7;
}

// Reads the rows of the sheet WITHOUT trusting the column titles. It looks at the data itself:
//  - the SAP ID column is the column with the most different ID-like numbers,
//  - the name column is the first column of name-like text next to those rows.
// Only unique SAP IDs are kept, each with its name.
function parseStudents(rows: any[][]): Parsed {
  const grid = rows.map((r) => (r ?? []).map((c) => String(c ?? '').trim()));
  const width = Math.max(0, ...grid.map((r) => r.length));
  const empty: Parsed = { students: [], skipped: 0, noName: 0, oddLength: 0 };
  if (width === 0) return empty;

  // 1. Pick the SAP ID column.
  let idCol = -1;
  let bestScore = 0;
  for (let c = 0; c < width; c++) {
    const ids = new Set<string>();
    let firstRow = -1;
    for (let r = 0; r < grid.length; r++) {
      const id = asSapId(grid[r][c] ?? '');
      if (id && !PHONE_LIKE.test(id)) { ids.add(id); if (firstRow < 0) firstRow = r; }
    }
    if (ids.size === 0) continue;
    const header = firstRow > 0 ? (grid[firstRow - 1][c] ?? '') : '';
    let score = ids.size * 1000;
    if (/sap/i.test(header)) score += 500;
    else if (/\bid\b|reg|roll/i.test(header)) score += 100;
    if (BAD_ID_HEADER.test(header)) score -= 5000;
    if (score > bestScore) { bestScore = score; idCol = c; }
  }
  if (idCol < 0) return empty;

  // 2. Rows that have a valid ID in that column (first time each ID appears).
  const seen = new Set<string>();
  const dataRows: { id: string; row: string[] }[] = [];
  let skipped = 0;
  for (const row of grid) {
    if (row.every((c) => !c)) continue;
    const id = asSapId(row[idCol] ?? '');
    if (!id || PHONE_LIKE.test(id)) { skipped++; continue; }
    if (seen.has(id)) { skipped++; continue; }
    seen.add(id);
    dataRows.push({ id, row });
  }

  // 3. Pick the name column: name-like text in most rows, skipping father name, email, phone and so on.
  let nameCol = -1;
  let nameScore = 0;
  for (let c = 0; c < width; c++) {
    if (c === idCol) continue;
    const hits = dataRows.filter((d) => looksLikeName(d.row[c] ?? '')).length;
    if (hits === 0) continue;
    const first = grid.findIndex((r) => r === dataRows[0].row);
    const header = first > 0 ? (grid[first - 1][c] ?? '') : '';
    let score = hits * 1000 - Math.abs(c - idCol) * 10;
    if (/name/i.test(header)) score += 300;
    if (BAD_NAME_HEADER.test(header)) score -= 5000;
    if (score > nameScore) { nameScore = score; nameCol = c; }
  }

  const students: Student[] = dataRows.map((d) => ({
    sap_id: d.id,
    name: nameCol >= 0 && looksLikeName(d.row[nameCol] ?? '') ? d.row[nameCol].replace(/\s+/g, ' ').trim() : '',
  }));
  const noName = students.filter((s) => !s.name).length;
  const lengths: Record<number, number> = {};
  students.forEach((s) => { lengths[s.sap_id.length] = (lengths[s.sap_id.length] ?? 0) + 1; });
  const common = Object.keys(lengths).map(Number).sort((a, b) => lengths[b] - lengths[a])[0];
  const oddLength = students.filter((s) => s.sap_id.length !== common).length;
  return { students, skipped, noName, oddLength };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => { const s = String(r.result); resolve(s.substring(s.indexOf(',') + 1)); };
    r.onerror = () => reject(new Error('Could not read the file'));
    r.readAsDataURL(blob);
  });
}

// ---------------------------------------------------------------- the screen
export default function AddClass() {
  const router = useRouter();
  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [subject, setSubject] = useState('');
  const [courseCode, setCourseCode] = useState('');
  const [program, setProgram] = useState('');
  const [semester, setSemester] = useState('');
  const [section, setSection] = useState('');     // '' = no section (optional)
  const [busy, setBusy] = useState(false);

  // One card, fields top to bottom. Upload Excel is the last option; Save appears once the list is added.
  const hasStudents = (parsed?.students.length ?? 0) > 0;
  const formReady = subject.trim().length > 0 && courseCode.trim().length > 0 && program.trim().length > 0 && semester.trim().length > 0;
  const canSave = hasStudents && formReady && !busy;

  const preview = useMemo(
    () => (parsed ? (showAll ? parsed.students : parsed.students.slice(0, 5)) : []),
    [parsed, showAll],
  );

  async function pickExcel() {
    try {
      const res = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (res.canceled || !res.assets?.length) return;
      const asset = res.assets[0];
      if (!/\.(xlsx|xls|csv)$/i.test(asset.name ?? '')) {
        return Alert.alert('Wrong file type', 'Please choose an Excel file (.xlsx or .xls) or a .csv file.');
      }
      const blob = await (await fetch(asset.uri)).blob();
      const b64 = await blobToBase64(blob);
      const wb = XLSX.read(b64, { type: 'base64' });
      // Try every sheet in the file and keep the one with the most students.
      let out: Parsed | null = null;
      let firstRow = '';
      for (const sheetName of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json<any[]>(wb.Sheets[sheetName], { header: 1, raw: false, blankrows: false, defval: '' });
        if (!firstRow && rows.length) firstRow = (rows[0] ?? []).map((c) => String(c)).filter(Boolean).slice(0, 4).join(' | ');
        const p = parseStudents(rows);
        if (!out || p.students.length > out.students.length) out = p;
      }
      if (!out || out.students.length === 0) {
        return Alert.alert(
          'No students found',
          `The file needs a column of SAP IDs (numbers, at least 4 digits) and a column of names.\n\nFirst row I saw: ${firstRow || '(empty)'}`,
        );
      }
      setFileName(asset.name ?? 'students');
      setParsed(out);
      setShowAll(false);
    } catch {
      Alert.alert('Could not read the file', 'Check that it is a normal Excel file and try again.');
    }
  }

  function removeFile() {
    setParsed(null);
    setFileName('');
  }

  async function save() {
    const profile = await loadProfile();
    if (!profile?.email) {
      return Alert.alert('One step first', 'Enter your name and email in the setup before adding a class.');
    }
    const code = makeCourseCode(program, semester, courseCode, section);
    const students = parsed!.students;
    const programUp = program.trim().toUpperCase();
    const recipients = profile.reportEmail || profile.email;
    setBusy(true);

    // 1) Keep the class and ALL its students (SAP ID + name) on the phone first.
    //    This is the memory the app uses later, even without internet.
    try {
      await saveClassLocal(
        {
          code, subject: subject.trim(), program: programUp, semester, section,
          studentCount: students.length, synced: false, createdAt: new Date().toISOString(),
        },
        students,
      );
    } catch {
      setBusy(false);
      return Alert.alert('Could not save', 'The phone could not store the class. Free some space and try again.');
    }

    // 2) Send the same list to the server (your Google Sheet). If this fails, the phone copy is still safe.
    try {
      const res = await fetch(`${N8N_BASE}/tmate-setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          teacher: { name: profile.name, email: profile.email },
          course: {
            code, name: subject.trim(), program: programUp, semester,
            section, passThreshold: 50, classTarget: 60, recipients,
          },
          roster: students,
        }),
      });
      if (!res.ok) throw new Error(`Server answered ${res.status}`);
      await markSynced(code);
      Alert.alert('Class saved', `${subject.trim()} · ${students.length} students saved.`);
    } catch {
      Alert.alert(
        'Saved on this phone',
        `${students.length} students are saved. The server could not be reached, so it is not in your Google Sheet yet.`,
      );
    } finally {
      setBusy(false);
    }
    if (router.canGoBack()) router.back(); else router.replace('/');
  }


  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} hitSlop={10} style={s.back}>
            <Ionicons name="chevron-back" size={18} color={C.plum} />
            <Text style={s.backText}>Back</Text>
          </Pressable>
          <Text style={s.title}>Add a class</Text>
          <Text style={s.sub}>Two quick steps. Your students are found from the Excel file.</Text>

          {/* Step 1 */}
          <View style={s.card}>
            <View style={s.cardHead}><View style={s.num}><Text style={s.numText}>1</Text></View><Text style={s.cardTitle}>Class details</Text></View>
            <BoxField label="Subject" value={subject} onChangeText={setSubject} placeholder="e.g. Database Systems" />
            <View style={s.two}>
              <View style={{ flex: 1 }}>
                <BoxField label="Course code" value={courseCode} onChangeText={setCourseCode} placeholder="e.g. CS402" autoCapitalize="characters" autoCorrect={false} />
              </View>
              <View style={{ flex: 1 }}>
                <BoxField label="Program" value={program} onChangeText={setProgram} placeholder="e.g. BSCS" autoCapitalize="characters" autoCorrect={false} />
              </View>
            </View>
            <View style={s.two}>
              <View style={{ flex: 1 }}>
                <BoxField
                  label="Semester" value={semester} onChangeText={(v) => setSemester(v.replace(/\D/g, '').slice(0, 2))}
                  placeholder="e.g. 7" keyboardType="number-pad" maxLength={2} last
                />
              </View>
              <View style={{ flex: 1 }}>
                <BoxField
                  label="Section (optional)" value={section} onChangeText={(v) => setSection(v.toUpperCase().slice(0, 3))}
                  placeholder="e.g. A" autoCapitalize="characters" autoCorrect={false} maxLength={3} last
                />
              </View>
            </View>
          </View>

          {/* Step 2 */}
          <View style={s.card}>
            <View style={s.cardHead}><View style={s.num}><Text style={s.numText}>2</Text></View><Text style={s.cardTitle}>Student list</Text></View>
            {!parsed ? (
              <Pressable style={s.drop} onPress={pickExcel}>
                <View style={s.dropIcon}><Ionicons name="arrow-up" size={24} color={C.plum} /></View>
                <Text style={s.dropTitle}>Choose your Excel file</Text>
                <Text style={s.dropNote}>Robigo finds the SAP IDs and names by itself. Column titles do not matter.</Text>
              </Pressable>
            ) : (
              <View>
                <View style={s.fileRow}>
                  <Text style={[T.small, { flex: 1, marginRight: 12 }]} numberOfLines={1}>{fileName}</Text>
                  <Pressable onPress={removeFile} hitSlop={10}><Text style={s.link}>Remove</Text></Pressable>
                </View>
                <Text style={s.count}>{parsed.students.length} students found</Text>
                {preview.map((st) => (
                  <View key={st.sap_id}>
                    <Rule />
                    <View style={s.tr}>
                      <Text style={s.td0}>{st.sap_id}</Text>
                      <Text style={[T.body, { flex: 1 }, !st.name && { fontWeight: '700' }]}>{st.name || 'Name missing'}</Text>
                    </View>
                  </View>
                ))}
                {parsed.students.length > 5 && (
                  <Pressable onPress={() => setShowAll((v) => !v)}>
                    <Text style={[s.link, { marginTop: 10 }]}>
                      {showAll ? 'Show fewer' : `Show all ${parsed.students.length} students`}
                    </Text>
                  </Pressable>
                )}
                {parsed.noName > 0 && <Text style={s.warn}>{parsed.noName} students have no name in the file.</Text>}
                {parsed.oddLength > 0 && <Text style={s.warn}>{parsed.oddLength} SAP IDs have a different length from the rest. Please check them.</Text>}
                {parsed.skipped > 1 && <Text style={s.warn}>{parsed.skipped} rows were ignored (no SAP ID, or a repeated one).</Text>}
                <Text style={[T.small, { marginTop: 14 }]}>Saved on this phone and in your sheet, so scanned quizzes are checked against it.</Text>
              </View>
            )}
          </View>

          <Button title="Save class" busy={busy} disabled={!canSave} onPress={save} />
          {!canSave && !busy && (
            <Text style={s.hint}>{!formReady ? 'Fill in the class details, then add the student list.' : 'Add the student list to save.'}</Text>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Boxed input with its label above (used on this screen).
function BoxField({ label, last, ...rest }: TextInputProps & { label: string; last?: boolean }) {
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ marginBottom: last ? 0 : 14 }}>
      <Text style={s.fieldLabel}>{label}</Text>
      <TextInput
        {...rest}
        onFocus={(e) => { setFocus(true); rest.onFocus?.(e); }}
        onBlur={(e) => { setFocus(false); rest.onBlur?.(e); }}
        placeholderTextColor={C.faint}
        style={[s.field, { borderColor: focus ? C.plum : C.lavender }, rest.style]}
      />
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.ivory },
  body: { paddingHorizontal: 20, paddingTop: 14, paddingBottom: 48 },
  back: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', marginBottom: 10 },
  backText: { fontSize: 15, fontWeight: '600', color: C.plum },
  title: { ...T.h1, fontSize: 32, lineHeight: 38 },
  sub: { fontSize: 15, lineHeight: 21, color: C.muted, marginTop: 6, marginBottom: 20 },
  card: { backgroundColor: C.ivory, borderWidth: 1.5, borderColor: C.lavender, borderRadius: 22, padding: 18, marginBottom: 14, shadowColor: C.plum, shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 5 }, elevation: 2 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 },
  num: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.plum, alignItems: 'center', justifyContent: 'center' },
  numText: { color: C.ivory, fontWeight: '700', fontSize: 14 },
  cardTitle: { fontFamily: FONT.display, fontSize: 19, fontWeight: '700', color: C.plum },
  two: { flexDirection: 'row', gap: 12 },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: C.muted, marginBottom: 6 },
  field: { fontSize: 16, color: C.plum, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1.5, borderRadius: 14, backgroundColor: C.ivory },
  drop: { borderWidth: 2, borderStyle: 'dashed', borderColor: C.faint, backgroundColor: 'rgba(220,212,245,0.4)', borderRadius: 20, paddingVertical: 24, paddingHorizontal: 18, alignItems: 'center' },
  dropIcon: { width: 52, height: 52, borderRadius: 26, backgroundColor: C.mint, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  dropTitle: { fontFamily: FONT.display, fontSize: 17, fontWeight: '700', color: C.plum },
  dropNote: { fontSize: 13, lineHeight: 19, color: C.muted, marginTop: 4, textAlign: 'center' },
  fileRow: { flexDirection: 'row', alignItems: 'center' },
  link: { color: C.plum, fontWeight: '700', fontSize: 14, textDecorationLine: 'underline' },
  count: { fontFamily: FONT.display, fontSize: 24, fontWeight: '700', color: C.plum, marginTop: 8, marginBottom: 14 },
  tr: { flexDirection: 'row', paddingVertical: 11 },
  td0: { width: 92, fontSize: 15, color: C.muted, fontVariant: ['tabular-nums'] },
  warn: { marginTop: 12, fontSize: 13, lineHeight: 19, color: C.plum, backgroundColor: C.lavender, padding: 12, borderRadius: 14 },
  hint: { fontSize: 13, color: C.muted, textAlign: 'center', marginTop: 12 },
});
