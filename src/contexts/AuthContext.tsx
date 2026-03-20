import React, { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import {
    type User,
    signInWithEmailAndPassword,
    signOut,
    onAuthStateChanged,
} from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';

export interface UserProfile {
    uid: string;
    email: string;
    displayName: string;
    role: 'admin' | 'staff';
    photoURL?: string;
}

interface AuthContextType {
    user: User | null;
    userProfile: UserProfile | null;
    loading: boolean;
    login: (email: string, password: string) => Promise<void>;
    logout: () => Promise<void>;
    isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | null>(null);

// Hardcoded admin emails — add more as needed
const ADMIN_EMAILS = [
    'admin@oasisdental.ca',
    'simran@oasisdental.ca',
    'simrankanda@gmail.com',
    // add any email here to grant admin access
];

async function ensureUserProfile(user: User): Promise<UserProfile> {
    const ref = doc(db, 'users', user.uid);
    const snap = await getDoc(ref);

    if (snap.exists()) {
        return snap.data() as UserProfile;
    }

    // Create profile for first-time users
    const isAdmin = ADMIN_EMAILS.includes(user.email?.toLowerCase() ?? '');
    const profile: UserProfile = {
        uid: user.uid,
        email: user.email ?? '',
        displayName: user.displayName ?? user.email?.split('@')[0] ?? 'User',
        role: isAdmin ? 'admin' : 'staff',
    };

    await setDoc(ref, { ...profile, createdAt: serverTimestamp() });
    return profile;
}

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [user, setUser] = useState<User | null>(null);
    const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
            if (firebaseUser) {
                setUser(firebaseUser);
                const profile = await ensureUserProfile(firebaseUser);
                setUserProfile(profile);
            } else {
                setUser(null);
                setUserProfile(null);
            }
            setLoading(false);
        });
        return unsub;
    }, []);

    const login = async (email: string, password: string) => {
        await signInWithEmailAndPassword(auth, email, password);
    };

    const logout = async () => {
        await signOut(auth);
    };

    const isAdmin = userProfile?.role === 'admin' || ADMIN_EMAILS.includes(user?.email?.toLowerCase() ?? '');

    return (
        <AuthContext.Provider value={{ user, userProfile, loading, login, logout, isAdmin }}>
            {children}
        </AuthContext.Provider>
    );
};

export const useAuth = () => {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
    return ctx;
};
