import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextInputProps, type ViewStyle } from 'react-native';
import { C, SHEET, T } from '@/lib/theme';
import type { ClassRecord } from '@/lib/classes';

// Pill-shaped button. primary = plum, soft = lavender, quiet = text only.
export function Button({ title, onPress, kind = 'primary', disabled, busy, style }: {
  title: string; onPress: () => void; kind?: 'primary' | 'soft' | 'quiet'; disabled?: boolean; busy?: boolean; style?: StyleProp<ViewStyle>;
}) {
  const bg = kind === 'primary' ? C.plum : kind === 'soft' ? C.lavender : 'transparent';
  const fg = kind === 'primary' ? C.ivory : C.plum;
  return (
    <Pressable
      onPress={onPress} disabled={disabled || busy}
      style={({ pressed }) => [b.btn, { backgroundColor: bg }, (disabled || busy) && { opacity: 0.4 }, pressed && { opacity: 0.8 }, style]}
    >
      {busy ? <ActivityIndicator color={fg} /> : <Text style={[b.btnText, { color: fg }]}>{title}</Text>}
    </Pressable>
  );
}

// Small status label in sentence case.
export function Tag({ text, tone = 'lavender' }: { text: string; tone?: 'lavender' | 'mint' | 'line' }) {
  const bg = tone === 'mint' ? C.mint : tone === 'lavender' ? C.lavender : 'transparent';
  const fg = tone === 'mint' ? C.good : C.plum;
  return (
    <View style={[b.tag, { backgroundColor: bg }, tone === 'line' && { borderWidth: 1, borderColor: C.border }]}>
      <Text style={[b.tagText, { color: fg }]}>{text}</Text>
    </View>
  );
}

export const Rule = () => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: C.border }} />;

export function Sheet({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[SHEET, { padding: 20 }, style]}>{children}</View>;
}

// Underlined input: a quiet, notebook-like field.
export function UField({ label, ...rest }: TextInputProps & { label: string }) {
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ marginBottom: 22 }}>
      <Text style={[T.small, { marginBottom: 2 }]}>{label}</Text>
      <TextInput
        {...rest}
        onFocus={(e) => { setFocus(true); rest.onFocus?.(e); }}
        onBlur={(e) => { setFocus(false); rest.onBlur?.(e); }}
        placeholderTextColor={C.faint}
        style={[b.field, { borderBottomColor: focus ? C.plum : C.border }, rest.style]}
      />
    </View>
  );
}

// Class details line: course code in bold, then program, semester and section in words.
export function Meta({ c, extra }: { c: ClassRecord; extra?: string }) {
  const code = c.code.split('-')[2] ?? '';
  return (
    <Text style={T.small}>
      {code ? <Text style={{ color: C.plum, fontWeight: '700' }}>{code}   </Text> : null}
      {c.program}, semester {c.semester}{c.section ? `, section ${c.section}` : ''}{extra ? `   ${extra}` : ''}
    </Text>
  );
}

export const classInitials = (s: string) =>
  s.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase()).join('') || '?';

const b = StyleSheet.create({
  btn: { height: 54, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  btnText: { fontSize: 16, fontWeight: '600', letterSpacing: 0.2 },
  tag: { alignSelf: 'flex-start', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5 },
  tagText: { fontSize: 13, fontWeight: '600' },
  field: { fontSize: 19, color: C.plum, paddingVertical: 10, borderBottomWidth: 1.5 },
});
