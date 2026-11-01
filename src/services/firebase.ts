import { initializeApp, getApps, getApp, FirebaseApp } from 'firebase/app';
import {
  initializeAuth,
  getReactNativePersistence,
  getAuth,
  Auth,
  signInAnonymously,
  onAuthStateChanged,
  User,
} from 'firebase/auth';
import { getFirestore, Firestore } from 'firebase/firestore';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Firebase configuration derived from google-services.json
export const firebaseConfig = {
  apiKey: 'AIzaSyCdga9LVJRZRfoXlTMGrFXYUsExVrV3k98',
  authDomain: 'nearu-962eb.firebaseapp.com',
  projectId: 'nearu-962eb',
  storageBucket: 'nearu-962eb.firebasestorage.app',
  messagingSenderId: '457551855372',
  appId: '1:457551855372:android:971447a97ea989c9e7d329',
};

// Safe singleton initialization avoiding duplicate app instances during Hot Reloading
const app: FirebaseApp = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();

// Safe Auth initialization with React Native AsyncStorage persistence
let auth: Auth;
try {
  auth = initializeAuth(app, {
    persistence: getReactNativePersistence(AsyncStorage),
  });
} catch {
  // If already initialized during HMR or multiple imports
  auth = getAuth(app);
}

// Cloud Firestore instance
const db: Firestore = getFirestore(app);

export { app, auth, db };

let initAuthPromise: Promise<User | null> | null = null;

/**
 * Attempts to ensure the user has an anonymous Firebase session.
 * Awaits authStateReady() to allow AsyncStorage persistence to restore an existing session first.
 * Deduplicates in-flight initialization attempts.
 */
export async function initializeAnonymousSession(): Promise<User | null> {
  if (auth.currentUser) {
    return auth.currentUser;
  }
  if (initAuthPromise) {
    return initAuthPromise;
  }

  initAuthPromise = (async () => {
    try {
      // 1. Wait for persisted session to be restored from AsyncStorage
      if (typeof auth.authStateReady === 'function') {
        await auth.authStateReady();
      }
      if (auth.currentUser) {
        return auth.currentUser;
      }

      // 2. No persisted user; sign in anonymously
      const userCredential = await signInAnonymously(auth);
      return userCredential.user;
    } catch (error) {
      console.warn(
        '[Nearu Firebase] Anonymous authentication not yet ready or offline:',
        error
      );
      return auth.currentUser || null;
    } finally {
      initAuthPromise = null;
    }
  })();

  return initAuthPromise;
}

/**
 * Returns current authenticated user or attempts initialization.
 * Throws an informative error if unauthenticated or offline.
 */
export async function ensureAuthenticatedUser(): Promise<User> {
  let user = auth.currentUser;
  if (!user) {
    user = await initializeAnonymousSession();
  }
  if (!user) {
    throw new Error('AUTH_UNAVAILABLE');
  }
  return user;
}

/**
 * Listener helper for auth state changes
 */
export function subscribeToAuthChanges(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}

export interface FirebaseConnectionStatus {
  isInitialized: boolean;
  projectId: string;
  authReady: boolean;
  firestoreReady: boolean;
  currentUserId: string | null;
}

export function getFirebaseConnectionStatus(): FirebaseConnectionStatus {
  return {
    isInitialized: getApps().length > 0,
    projectId: firebaseConfig.projectId,
    authReady: !!auth,
    firestoreReady: !!db,
    currentUserId: auth.currentUser?.uid || null,
  };
}
