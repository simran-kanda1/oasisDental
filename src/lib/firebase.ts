import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
    apiKey: "AIzaSyCIlf3HYKUZIgWBqadjK5PjdelrDlUc2WQ",
    authDomain: "falls-dashboard.firebaseapp.com",
    projectId: "falls-dashboard",
    storageBucket: "falls-dashboard.firebasestorage.app",
    messagingSenderId: "358636364600",
    appId: "1:358636364600:web:606314560eb36caada17cd"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export default app;
