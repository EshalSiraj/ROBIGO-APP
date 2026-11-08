
import { C } from '@/lib/theme';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Image,
  StatusBar,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const ONBOARDING_KEY = 'robigo.onboarding.completed.v1';

const slides = [
  {
    icon: 'scanner',
    title: 'Capture marks.\nSave your time.',
    description:
      'Photograph marks sheets and let Robigo handle repetitive manual data entry.',
    label: 'SMART MARKS CAPTURE',
    color: C.lavender,
    iconColor: C.plum,
  },
  {
    icon: 'account-school',
    title: 'Every mark.\nThe right student.',
    description:
      'Automatically connect marks with the correct student name and SAP ID.',
    label: 'INTELLIGENT STUDENT MATCHING',
    color: C.mint,
    iconColor: C.plum,
  },
  {
    icon: 'shield-check',
    title: 'Accurate records.\nFewer mistakes.',
    description:
      'Detect duplicate entries, flag uncertain matches and keep records accurate.',
    label: 'SMART DUPLICATE DETECTION',
    color: '#EADFEF',
    iconColor: C.plum,
  },
] as const;

type Props = {
  children: React.ReactNode;
};

export default function StartupFlow({ children }: Props) {
  const [stage, setStage] = useState<'splash' | 'onboarding' | 'done'>('splash');
  const [current, setCurrent] = useState(0);
  const [showOnboarding, setShowOnboarding] = useState(true);

  const floatAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const iconScale = useRef(new Animated.Value(0.7)).current;

  // Show the animated splash on every launch.
  // Show onboarding only if it has not been completed before.
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;

    async function prepare() {
      let completed = false;

      try {
        completed = (await AsyncStorage.getItem(ONBOARDING_KEY)) === '1';
      } catch {
        completed = false;
      }

      if (!alive) return;

      setShowOnboarding(!completed);

      timer = setTimeout(() => {
        if (!alive) return;
        setStage(completed ? 'done' : 'onboarding');
      }, 2400);
    }

    prepare();

    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  // Floating logo animation.
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(floatAnim, {
          toValue: 0,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    animation.start();
    return () => animation.stop();
  }, [floatAnim]);

  // Soft glowing animation.
  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(glowAnim, {
          toValue: 1,
          duration: 1300,
          useNativeDriver: true,
        }),
        Animated.timing(glowAnim, {
          toValue: 0,
          duration: 1300,
          useNativeDriver: true,
        }),
      ])
    );

    animation.start();
    return () => animation.stop();
  }, [glowAnim]);

  const finishOnboarding = useCallback(async () => {
    try {
      await AsyncStorage.setItem(ONBOARDING_KEY, '1');
    } catch {
      // The app can still open if local storage is unavailable.
    }

    setStage('done');
  }, []);

  // Animate each onboarding slide and advance automatically.
  useEffect(() => {
    if (stage !== 'onboarding') return;

    fadeAnim.setValue(0);
    iconScale.setValue(0.7);

    Animated.parallel([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 650,
        useNativeDriver: true,
      }),
      Animated.spring(iconScale, {
        toValue: 1,
        friction: 5,
        tension: 65,
        useNativeDriver: true,
      }),
    ]).start();

    const timer = setTimeout(() => {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 400,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (!finished) return;

        if (current < slides.length - 1) {
          setCurrent((previous) => previous + 1);
        } else {
          finishOnboarding();
        }
      });
    }, 4500);

    return () => clearTimeout(timer);
  }, [stage, current, fadeAnim, iconScale, finishOnboarding]);

  // Once startup is complete, show the original app.
  if (stage === 'done') {
    return <>{children}</>;
  }

  const logoTranslate = floatAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [7, -7],
  });

  const logoScale = floatAnim.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [1, 1.04, 1],
  });

  const glowOpacity = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.15, 0.55],
  });

  const glowScale = glowAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.85, 1.2],
  });

  const slide = slides[current];

  return (
    <SafeAreaView style={styles.container}>
   
      <StatusBar barStyle="dark-content" />

      {stage === 'splash' ? (
        <View style={styles.splash}>
          <Animated.View
            style={[
              styles.glow,
              {
                opacity: glowOpacity,
                transform: [{ scale: glowScale }],
              },
            ]}
          />

          <Animated.Image
            source={require('../assets/images/logo.png')}
            resizeMode="contain"
            style={[
              styles.splashLogo,
              {
                transform: [
                  { translateY: logoTranslate },
                  { scale: logoScale },
                ],
              },
            ]}
          />

          <Text style={styles.brand}>ROBIGO</Text>

          <Text style={styles.tagline}>
            Your intelligent teaching companion
          </Text>
        </View>
      ) : (
        <View style={styles.onboarding}>
          <View style={styles.top}>
            <Image
              source={require('../assets/images/logo.png')}
              style={styles.smallLogo}
              resizeMode="contain"
            />

            <Text style={styles.brand}>ROBIGO</Text>
          </View>

          <View style={styles.middle}>
            <Animated.View
              style={[
                styles.iconCard,
                {
                  backgroundColor: slide.color,
                  opacity: fadeAnim,
                  transform: [{ scale: iconScale }],
                },
              ]}
            >
              <View style={styles.iconInner}>
                <MaterialCommunityIcons
                  name={slide.icon}
                  size={100}
                  color={slide.iconColor}
                />
              </View>

              <View style={styles.decoration} />
            </Animated.View>

            <Animated.View
              style={[styles.textContent, { opacity: fadeAnim }]}
            >
              <Text style={styles.eyebrow}>{slide.label}</Text>

              <Text style={styles.title}>{slide.title}</Text>

              <Text style={styles.description}>
                {slide.description}
              </Text>
            </Animated.View>
          </View>

          <View style={styles.bottom}>
            <View style={styles.dots}>
              {slides.map((item, index) => (
                <View
                  key={index}
                  style={[
                    styles.dot,
                    current === index && styles.activeDot,
                  ]}
                />
              ))}
            </View>

            <Text style={styles.footer}>
              Making teaching simpler, smarter and easier.
            </Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.ivory,
  },

  splash: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },

  glow: {
    position: 'absolute',
    width: 230,
    height: 230,
    borderRadius: 115,
    backgroundColor: C.lavender,
  },

  splashLogo: {
    width: 220,
    height: 230,
  },

  brand: {
    marginTop: 15,
    fontSize: 14,
    color: C.plum,
    fontWeight: '800',
    letterSpacing: 4,
  },

  tagline: {
    marginTop: 9,
    fontSize: 12,
    color: C.muted,
  },

  onboarding: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 24,
    paddingBottom: 24,
    justifyContent: 'space-between',
    alignItems: 'center',
  },

  top: {
    alignItems: 'center',
  },

  smallLogo: {
    width: 65,
    height: 65,
  },

  middle: {
    width: '100%',
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },

  iconCard: {
    width: 210,
    height: 210,
    borderRadius: 55,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 38,
    shadowColor: C.plum,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.17,
    shadowRadius: 18,
    elevation: 9,
  },

  iconInner: {
    width: 155,
    height: 155,
    borderRadius: 45,
    backgroundColor: C.ivory,
    justifyContent: 'center',
    alignItems: 'center',
  },

  decoration: {
    position: 'absolute',
    width: 15,
    height: 15,
    borderRadius: 8,
    top: 24,
    right: 25,
    backgroundColor: C.plum,
    opacity: 0.3,
  },

  textContent: {
    width: '100%',
    alignItems: 'center',
  },

  eyebrow: {
    color: C.plum,
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 2,
    textAlign: 'center',
    marginBottom: 17,
  },

  title: {
    fontSize: 30,
    lineHeight: 39,
    fontWeight: '800',
    color: C.plum,
    textAlign: 'center',
    marginBottom: 16,
  },

  description: {
    fontSize: 14,
    lineHeight: 24,
    color: C.muted,
    textAlign: 'center',
    paddingHorizontal: 4,
  },

  bottom: {
    alignItems: 'center',
    gap: 17,
  },

  dots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 9,
  },

  dot: {
    width: 8,
    height: 8,
    borderRadius: 5,
    backgroundColor: C.lavender,
  },

  activeDot: {
    width: 25,
    backgroundColor: C.plum,
  },

  footer: {
    fontSize: 10,
    color: C.muted,
    textAlign: 'center',
  },
});

