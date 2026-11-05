
import React, { useEffect, useRef, useState } from "react";

import {
  View,
  Text,
  Image,
  StyleSheet,
  StatusBar,
  Animated,
  Easing,
} from "react-native";

import { MaterialCommunityIcons } from "@expo/vector-icons";

// ONBOARDING SCREENS
const slides = [
  {
    icon: "scanner",
    title: "Capture marks.\nSave your time.",
    description:
      "Take a photo of marks sheets and reduce hours of repetitive manual data entry.",
    label: "SMART MARKS CAPTURE",
    color: "#EAE1F8",
    iconColor: "#8463B2",
  },
  {
    icon: "account-school",
    title: "Every mark.\nThe right student.",
    description:
      "Automatically connect marks with the correct student name and SAP ID.",
    label: "INTELLIGENT STUDENT MATCHING",
    color: "#DDF0E6",
    iconColor: "#548C75",
  },
  {
    icon: "shield-check",
    title: "Accurate records.\nFewer mistakes.",
    description:
      "Detect duplicate entries, flag uncertain matches and let teachers verify results.",
    label: "SMART DUPLICATE DETECTION",
    color: "#F5E5EF",
    iconColor: "#A66D91",
  },
];

export default function App() {
  const [stage, setStage] = useState("splash");
  const [current, setCurrent] = useState(0);

  // ANIMATION VALUES
  const floatAnim = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const iconScale = useRef(new Animated.Value(0.65)).current;

  // LOGO FLOATING ANIMATION
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

  // LOGO GLOW ANIMATION
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

  // SPLASH SCREEN DURATION
  useEffect(() => {
    const timer = setTimeout(() => {
      setStage("onboarding");
    }, 2500);

    return () => clearTimeout(timer);
  }, []);

  // ONBOARDING ANIMATIONS AND AUTOMATIC SLIDE CHANGES
  useEffect(() => {
    if (stage !== "onboarding") return;

    fadeAnim.setValue(0);
    iconScale.setValue(0.65);

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

    // Keep the last screen visible
    if (current === slides.length - 1) return;

    const timer = setTimeout(() => {
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 450,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) {
          setCurrent((previous) => previous + 1);
        }
      });
    }, 4500);

    return () => clearTimeout(timer);
  }, [stage, current, fadeAnim, iconScale]);

  // LOGO ANIMATION VALUES
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
    <View style={styles.container}>
      <StatusBar
        backgroundColor="#F8F7F5"
        barStyle="dark-content"
      />

      {stage === "splash" ? (

        // =================================
        // SPLASH SCREEN
        // =================================

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
            source={require("./assets/logo.png")}
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

          <Text style={styles.brand}>
            SMART TEACHER
          </Text>

          <Text style={styles.tagline}>
            Your intelligent teaching companion
          </Text>

        </View>

      ) : (

        // =================================
        // ONBOARDING SCREENS
        // =================================

        <View style={styles.onboarding}>

          {/* TOP BRANDING */}

          <View style={styles.top}>

            <Image
              source={require("./assets/logo.png")}
              style={styles.smallLogo}
              resizeMode="contain"
            />

            <Text style={styles.brand}>
              SMART TEACHER
            </Text>

          </View>

          {/* MAIN CONTENT */}

          <View style={styles.middle}>

            {/* FEATURE ICON */}

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

              <View
                style={[
                  styles.iconDecoration,
                  { backgroundColor: slide.iconColor },
                ]}
              />

            </Animated.View>

            {/* TEXT CONTENT */}

            <Animated.View
              style={[
                styles.textContent,
                { opacity: fadeAnim },
              ]}
            >

              <Text style={styles.eyebrow}>
                {slide.label}
              </Text>

              <Text style={styles.title}>
                {slide.title}
              </Text>

              <Text style={styles.description}>
                {slide.description}
              </Text>

            </Animated.View>

          </View>

          {/* BOTTOM PROGRESS */}

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
              {current === 2
                ? "Your smarter teaching journey starts here."
                : "Making teaching simpler, smarter and easier."}
            </Text>

          </View>

        </View>

      )}

    </View>
  );
}

// =================================
// STYLES
// =================================

const styles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: "#F8F7F5",
  },

  // SPLASH SCREEN

  splash: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },

  glow: {
    position: "absolute",
    width: 230,
    height: 230,
    borderRadius: 115,
    backgroundColor: "#CDB5F2",
  },

  splashLogo: {
    width: 285,
    height: 295,
  },

  brand: {
    marginTop: 15,
    fontSize: 14,
    color: "#75658C",
    fontWeight: "800",
    letterSpacing: 3,
  },

  tagline: {
    marginTop: 9,
    fontSize: 12,
    color: "#A49AAA",
  },

  // ONBOARDING LAYOUT

  onboarding: {
    flex: 1,
    paddingHorizontal: 28,
    paddingTop: 55,
    paddingBottom: 35,
    justifyContent: "space-between",
    alignItems: "center",
  },

  top: {
    alignItems: "center",
  },

  smallLogo: {
    width: 65,
    height: 65,
  },

  middle: {
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
  },

  // ICON CARD

  iconCard: {
    width: 210,
    height: 210,
    borderRadius: 55,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 40,

    shadowColor: "#9671C5",
    shadowOffset: {
      width: 0,
      height: 12,
    },
    shadowOpacity: 0.17,
    shadowRadius: 18,
    elevation: 9,
  },

  iconInner: {
    width: 155,
    height: 155,
    borderRadius: 45,
    backgroundColor: "rgba(255,255,255,0.72)",
    justifyContent: "center",
    alignItems: "center",
  },

  iconDecoration: {
    position: "absolute",
    width: 15,
    height: 15,
    borderRadius: 8,
    top: 24,
    right: 25,
    opacity: 0.35,
  },

  // TEXT

  textContent: {
    width: "100%",
    alignItems: "center",
  },

  eyebrow: {
    color: "#9671C5",
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 2,
    textAlign: "center",
    marginBottom: 17,
  },

  title: {
    fontSize: 30,
    lineHeight: 39,
    fontWeight: "800",
    color: "#40354E",
    textAlign: "center",
    marginBottom: 16,
  },

  description: {
    fontSize: 14,
    lineHeight: 24,
    color: "#82788C",
    textAlign: "center",
    paddingHorizontal: 4,
  },

  // BOTTOM PROGRESS

  bottom: {
    alignItems: "center",
    gap: 17,
  },

  dots: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
  },

  dot: {
    width: 8,
    height: 8,
    borderRadius: 5,
    backgroundColor: "#D9D0E5",
  },

  activeDot: {
    width: 25,
    backgroundColor: "#9671C5",
  },

  footer: {
    fontSize: 10,
    color: "#A49AAA",
    textAlign: "center",
  },

});
