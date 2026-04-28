import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';

const required = (name: string): string => {
  const value = import.meta.env[name as keyof ImportMetaEnv];
  if (!value || typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value.trim();
};

const firebaseConfig = {
  apiKey: required('VITE_FIREBASE_API_KEY'),
  authDomain: required('VITE_FIREBASE_AUTH_DOMAIN'),
  projectId: required('VITE_FIREBASE_PROJECT_ID'),
  storageBucket: required('VITE_FIREBASE_STORAGE_BUCKET'),
  messagingSenderId: required('VITE_FIREBASE_MESSAGING_SENDER_ID'),
  appId: required('VITE_FIREBASE_APP_ID'),
};

const app = initializeApp(firebaseConfig);
const functionsRegion = (import.meta.env.VITE_FIREBASE_FUNCTIONS_REGION as string | undefined)?.trim() || 'us-central1';
export const auth = getAuth(app);
export const db = getFirestore(app);
export const functions = getFunctions(app, functionsRegion);
export default app;
