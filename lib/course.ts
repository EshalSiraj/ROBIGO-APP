// The teacher never types a course code. It is built from what they do enter,
// for example: BSCS, semester 7, "Database Systems", section A  ->  BSCS-S7-DATABASESYSTEMS-A
export function makeCourseCode(program: string, semester: string, subject: string, section?: string): string {
  const clean = (v: string) => v.toUpperCase().replace(/[^A-Z0-9]/g, '');
  const parts = [clean(program), 'S' + clean(semester), clean(subject)];
  if (section && clean(section)) parts.push(clean(section));
  return parts.join('-');
}
