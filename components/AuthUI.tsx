import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { C, FONT, T } from '@/lib/theme';
import { Button } from '@/components/ui';

// The page frame shared by Log in and Sign up.
export function AuthScreen({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <SafeAreaView style={s.safe}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={s.body} keyboardShouldPersistTaps="handled">
          <View style={s.mark}><Text style={s.markText}>R</Text></View>
          <Text style={s.title}>{title}</Text>
          <Text style={s.sub}>{subtitle}</Text>
          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export function Field({ label, icon, secure, ...rest }: TextInputProps & { label: string; icon?: keyof typeof Ionicons.glyphMap; secure?: boolean }) {
  const [hidden, setHidden] = useState(!!secure);
  const [focus, setFocus] = useState(false);
  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={[T.small, { marginBottom: 2 }]}>{label}</Text>
      <View style={[s.wrap, { borderBottomColor: focus ? C.plum : C.border }]}>
        {icon ? <Ionicons name={icon} size={19} color={focus ? C.plum : C.muted} style={{ marginRight: 10 }} /> : null}
        <TextInput
          style={s.input} placeholderTextColor={C.faint} secureTextEntry={hidden}
          autoCapitalize={secure ? 'none' : rest.autoCapitalize} {...rest}
          onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}
        />
        {secure ? (
          <Pressable onPress={() => setHidden((h) => !h)} hitSlop={10}>
            <Text style={s.show}>{hidden ? 'Show' : 'Hide'}</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

export function PrimaryButton({ title, onPress, busy }: { title: string; onPress: () => void; busy?: boolean }) {
  return <Button title={title} onPress={onPress} busy={busy} style={{ marginTop: 10 }} />;
}

export function ErrorText({ text }: { text: string }) {
  return text ? <Text style={s.error}>{text}</Text> : null;
}

export function SwitchLine({ question, action, onPress }: { question: string; action: string; onPress: () => void }) {
  return (
    <View style={s.switchRow}>
      <Text style={{ color: C.muted, fontSize: 15 }}>{question} </Text>
      <Pressable onPress={onPress}><Text style={s.link}>{action}</Text></Pressable>
    </View>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.ivory },
  body: { paddingHorizontal: 28, paddingTop: 48, paddingBottom: 60 },
  mark: { width: 52, height: 52, borderRadius: 16, backgroundColor: C.plum, alignItems: 'center', justifyContent: 'center' },
  markText: { color: C.ivory, fontSize: 28, fontFamily: FONT.display, fontWeight: '600' },
  title: { ...T.h1, fontSize: 38, lineHeight: 44, marginTop: 36 },
  sub: { ...T.small, fontSize: 16, marginTop: 8, marginBottom: 36 },
  wrap: { flexDirection: 'row', alignItems: 'center', borderBottomWidth: 1.5 },
  input: { flex: 1, minWidth: 0, paddingVertical: 10, fontSize: 16, color: C.plum },
  show: { color: C.plum, fontWeight: '700', fontSize: 14 },
  error: { color: C.plum, fontWeight: '600', backgroundColor: C.lavender, padding: 14, borderRadius: 14, marginBottom: 20, fontSize: 14, lineHeight: 20 },
  switchRow: { flexDirection: 'row', justifyContent: 'center', marginTop: 28 },
  link: { color: C.plum, fontWeight: '700', fontSize: 15, textDecorationLine: 'underline' },
});
