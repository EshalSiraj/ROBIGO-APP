import { Platform, type TextStyle, type ViewStyle } from 'react-native';

// Robigo: paper and ink. Core palette: Lavender, Mint, Plum, Warm ivory.
export const C = {
  lavender: '#DCD4F5',   // highlight, lines, warnings
  mint: '#CDEBDD',       // done
  plum: '#40334F',       // ink: text and main buttons
  ivory: '#F8F7F4',      // paper: backgrounds and sheets
  // Everything below is one of the four colours at a lower strength. No other colours are used.
  white: '#F8F7F4',
  muted: 'rgba(64,51,79,0.62)',
  faint: 'rgba(64,51,79,0.35)',
  border: '#DCD4F5',
  good: '#40334F',
  warn: '#40334F',
  warnBg: '#DCD4F5',
  danger: '#40334F',
};

// Serif for big headings (Georgia on iPhone, the system serif on Android).
export const FONT = {
  display: (Platform.OS === 'ios' ? 'Georgia' : 'serif') as string,
};

export const T = {
  h1: { fontFamily: FONT.display, fontSize: 34, lineHeight: 40, letterSpacing: -0.5, color: C.plum, fontWeight: '600' } as TextStyle,
  h2: { fontFamily: FONT.display, fontSize: 22, lineHeight: 28, letterSpacing: -0.2, color: C.plum, fontWeight: '600' } as TextStyle,
  body: { fontSize: 16, lineHeight: 23, color: C.plum } as TextStyle,
  small: { fontSize: 14, lineHeight: 20, color: C.muted } as TextStyle,
};

// The one raised surface in the app: a white sheet with a soft plum shadow.
export const SHEET: ViewStyle = {
  backgroundColor: C.ivory,
  borderWidth: 1,
  borderColor: C.lavender,
  borderRadius: 28,
  shadowColor: C.plum,
  shadowOpacity: 0.12,
  shadowRadius: 26,
  shadowOffset: { width: 0, height: 10 },
  elevation: 3,
};
