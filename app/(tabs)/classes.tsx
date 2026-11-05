import React, { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { listClasses, type ClassRecord } from '@/lib/classes';
import { C, FONT, T } from '@/lib/theme';
import { Button, Meta, Rule, classInitials } from '@/components/ui';

// Every class this teacher has, as a simple list.
export default function MyClasses() {
  const router = useRouter();
  const [classes, setClasses] = useState<ClassRecord[]>([]);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      listClasses().then((l) => alive && setClasses(l));
      return () => { alive = false; };
    }, []),
  );

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <ScrollView contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <Text style={T.h1}>My classes</Text>
        <Text style={[T.small, { marginTop: 6, marginBottom: 24 }]}>
          {classes.length === 0 ? 'Nothing here yet.' : classes.length === 1 ? 'One class' : `${classes.length} classes`}
        </Text>

        {classes.length === 0 && (
          <Text style={[T.body, { marginBottom: 28, color: C.muted }]}>
            Add a class with its student list, and it will appear here.
          </Text>
        )}

        {classes.map((c, i) => (
          <View key={c.code}>
            {i === 0 && <Rule />}
            <Pressable
              style={({ pressed }) => [s.row, pressed && { backgroundColor: C.lavender + '55' }]}
              onPress={() => router.push({ pathname: '/class/[code]', params: { code: c.code } })}
            >
              <View style={s.badge}><Text style={s.badgeText}>{classInitials(c.subject)}</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={[T.h2, { fontSize: 20 }]} numberOfLines={1}>{c.subject}</Text>
                <View style={{ marginTop: 3 }}><Meta c={c} /></View>
                <Text style={[T.small, { marginTop: 2, color: C.good, fontWeight: '600' }]}>{c.studentCount} students</Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={C.muted} style={{ marginLeft: 8 }} />
            </Pressable>
            <Rule />
          </View>
        ))}

        <Button title="Add class" onPress={() => router.push('/add-class')} style={{ marginTop: 32 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.ivory },
  body: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 48 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 18, paddingHorizontal: 4 },
  badge: { width: 50, height: 50, borderRadius: 25, backgroundColor: C.lavender, alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  badgeText: { color: C.plum, fontFamily: FONT.display, fontWeight: '600', fontSize: 18 },
  count: { fontFamily: FONT.display, fontWeight: '600', fontSize: 22, color: C.plum },
});
