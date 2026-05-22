import React, { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { sendPasswordResetEmail, updateProfile } from 'firebase/auth';
import { Settings, Shield } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { auth, db } from '../lib/firebase';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { cn } from '../lib/utils';

const SettingsPage: React.FC = () => {
  const { user, userProfile, isAdmin } = useAuth();
  const [displayName, setDisplayName] = useState(userProfile?.displayName ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSaveProfile = async () => {
    if (!user) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const name = displayName.trim() || user.email?.split('@')[0] || 'User';
      await updateProfile(user, { displayName: name });
      await updateDoc(doc(db, 'users', user.uid), { displayName: name });
      setMessage('Profile updated.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save profile');
    } finally {
      setSaving(false);
    }
  };

  const handleResetPassword = async () => {
    if (!user?.email) return;
    setMessage(null);
    setError(null);
    try {
      await sendPasswordResetEmail(auth, user.email);
      setMessage(`Password reset email sent to ${user.email}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not send reset email');
    }
  };

  const roleLabel = isAdmin ? 'Admin' : 'Staff';

  return (
    <div className="p-4 space-y-4 max-w-xl mx-auto bg-[#f1f5f9] min-h-screen font-sans">
      <div className="bg-white border border-slate-200 rounded-md p-4 flex items-center gap-4">
        <div className="w-10 h-10 rounded bg-slate-800 flex items-center justify-center">
          <Settings className="text-white" size={20} />
        </div>
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight">Settings</h1>
          <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-0.5">Your account</p>
        </div>
      </div>

      {message && (
        <div className="rounded-md border border-teal-200 bg-teal-50 px-4 py-2 text-xs text-teal-800">{message}</div>
      )}
      {error && (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-800">{error}</div>
      )}

      <div className="bg-white border border-slate-200 rounded-md p-5 space-y-5">
        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Display name</label>
          <Input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="mt-1.5 h-9"
            placeholder="Your name"
          />
        </div>

        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Email</label>
          <Input value={user?.email ?? ''} disabled className="mt-1.5 h-9 bg-slate-50 text-slate-600" />
          <p className="text-[10px] text-slate-400 mt-1">Email is managed by your login account and cannot be changed here.</p>
        </div>

        <div>
          <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Role</label>
          <div
            className={cn(
              'mt-1.5 flex items-center gap-2 h-9 px-3 rounded-md border text-sm font-bold',
              isAdmin ? 'border-teal-200 bg-teal-50 text-teal-800' : 'border-slate-200 bg-slate-50 text-slate-600'
            )}
          >
            <Shield size={14} />
            {roleLabel}
          </div>
          <p className="text-[10px] text-slate-400 mt-1">
            {isAdmin
              ? 'You have admin access to the portal and user management.'
              : 'Only an admin can change roles. Contact your office manager if you need access updated.'}
          </p>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 pt-2 border-t border-slate-100">
          <Button
            type="button"
            className="h-9 text-[10px] font-bold uppercase bg-teal-600"
            disabled={saving}
            onClick={() => void handleSaveProfile()}
          >
            {saving ? 'Saving…' : 'Save name'}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="h-9 text-[10px] font-bold uppercase"
            onClick={() => void handleResetPassword()}
          >
            Send password reset email
          </Button>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
