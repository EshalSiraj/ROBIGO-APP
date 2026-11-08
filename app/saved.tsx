
import { Button } from '@/components/ui';
import { loadStudents } from '@/lib/classes';
import { listPapers, type Paper } from '@/lib/papers';
import { C, T } from '@/lib/theme';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// Shown right after each student paper is scanned and saved.
export default function Saved() {
  const router = useRouter();

  const { code, quiz, sap } = useLocalSearchParams<{
    code: string;
    quiz: string;
    sap: string;
  }>();

  const assessment = `${code} ${quiz}`;

  const [paper, setPaper] = useState<Paper | undefined>();
  const [scanned, setScanned] = useState(0);
  const [total, setTotal] = useState(0);

  const toQuiz = useCallback(() => {
    router.dismissTo({
      pathname: '/quiz/[code]',
      params: { code, quiz },
    });
  }, [router, code, quiz]);

  // Load saved paper and scanning progress.
  useFocusEffect(
    useCallback(() => {
      let alive = true;

      (async () => {
        const all = await listPapers(assessment);
        const studentCount = (await loadStudents(code)).length;

        if (alive) {
          setPaper(all.find((p) => p.sap_id === sap));
          setScanned(all.length);
          setTotal(studentCount);
        }
      })();

      return () => {
        alive = false;
      };
    }, [assessment, sap, code]),
  );

  // Handle Android physical Back button.
  useFocusEffect(
    useCallback(() => {
      const sub = BackHandler.addEventListener(
        'hardwareBackPress',
        () => {
          toQuiz();
          return true;
        },
      );

      return () => sub.remove();
    }, [toQuiz]),
  );

  const finished = total > 0 && scanned >= total;

  return (
    <SafeAreaView style={s.safe}>
      <View style={s.body}>
        <View style={s.ring}>
          <Ionicons name="checkmark" size={40} color={C.plum} />
        </View>

        <Text style={[T.h1, { textAlign: 'center' }]}>
          Paper saved
        </Text>

        <Text style={[T.small, s.center]}>
          {paper
            ? `${paper.name || 'Student'} (${sap}) is in ${quiz}.`
            : `${sap} is in ${quiz}.`}
          {'\n'}
          {finished
            ? `All ${total} papers are scanned.`
            : `${scanned} of ${total} papers scanned.`}
        </Text>

        {total > 0 && (
          <View style={s.track}>
            <View
              style={[
                s.fill,
                {
                  width: `${Math.min(100, (scanned / total) * 100)}%`,
                },
              ]}
            />
          </View>
        )}

        <View style={s.foot}>
          {finished ? (
            <Button
              title={`Back to ${quiz}`}
              onPress={toQuiz}
            />
          ) : (
            <>
              <Button
                title="Scan next paper"
                onPress={() =>
                  router.replace({
                    pathname: '/scanner',
                    params: {
                      mode: 'students',
                      code,
                      assessment,
                    },
                  })
                }
              />

              <Button
                title="Review this paper"
                kind="soft"
                onPress={() =>
                  router.replace({
                    pathname: '/paper/[code]',
                    params: { code, quiz, sap },
                  })
                }
              />

              <Pressable
                onPress={toQuiz}
                hitSlop={10}
                style={{ alignItems: 'center', paddingVertical: 10 }}
              >
                <Text style={s.link}>Back to {quiz}</Text>
              </Pressable>
            </>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: C.ivory,
  },
  body: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 80,
    paddingBottom: 28,
  },
  ring: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: C.mint,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 24,
  },
  center: {
    textAlign: 'center',
    marginTop: 10,
    lineHeight: 22,
  },
  track: {
    height: 8,
    borderRadius: 4,
    backgroundColor: C.lavender,
    overflow: 'hidden',
    marginTop: 26,
  },
  fill: {
    height: 8,
    borderRadius: 4,
    backgroundColor: C.plum,
  },
  foot: {
    marginTop: 'auto',
    gap: 10,
  },
  link: {
    color: C.plum,
    fontSize: 16,
    fontWeight: '600',
    textDecorationLine: 'underline',
  },
});
