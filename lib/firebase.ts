import { getApp, getApps, initializeApp } from 'firebase/app';
import * as FirebaseAuth from 'firebase/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

const firebaseConfig = {
  apiKey: 'AIzaSyBbg3FCrXyVRsDL2DQ0WQR1kkvvqyYx-6s',
  authDomain: 'robigo-9c431.firebaseapp.com',
  projectId: 'robigo-9c431',
  storageBucket: 'robigo-9c431.firebasestorage.app',
  messagingSenderId: '581983765859',
  appId: '1:581983765859:web:1e8d321d156cb0f2fdff56',
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

// Keeps the teacher logged in after the app is closed.
const getRNPersistence = (FirebaseAuth as any).getReactNativePersistence as (s: typeof AsyncStorage) => any;

export const auth = (() => {
  try {
    return FirebaseAuth.initializeAuth(app, { persistence: getRNPersistence(AsyncStorage) });
  } catch {
    return FirebaseAuth.getAuth(app);
  }
})();
