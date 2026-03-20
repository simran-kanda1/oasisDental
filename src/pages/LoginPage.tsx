import React, { useState } from 'react';
import { AlertCircle, ShieldCheck, Lock, Mail } from 'lucide-react';
import { Tooth } from '../components/ui/icons';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { useAuth } from '../contexts/AuthContext';

const LoginPage: React.FC = () => {
    const { login } = useAuth();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (!email || !password) {
            setError('Please fill in all fields.');
            return;
        }
        setLoading(true);
        try {
            await login(email.trim(), password);
        } catch (err: any) {
            setError('Invalid email or password.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen flex bg-slate-100 font-sans overflow-hidden">
            {/* Left Panel - Professional Branding */}
            <div className="hidden lg:flex flex-col w-[35%] relative bg-slate-900 overflow-hidden">
                <div className="absolute inset-0 overflow-hidden pointer-events-none opacity-20">
                    <div className="absolute top-[-20%] left-[-20%] w-[150%] h-[150%] bg-gradient-to-br from-teal-500/20 via-transparent to-transparent blur-3xl" />
                </div>

                <div className="relative z-10 flex flex-col h-full p-12">
                    <div className="flex items-center gap-3 mb-24">
                        <div className="w-10 h-10 rounded bg-teal-600 flex items-center justify-center shadow-2xl shadow-teal-500/20">
                            <Tooth className="text-white" size={20} />
                        </div>
                        <span className="text-lg font-bold text-white tracking-tight uppercase">Oasis Dental</span>
                    </div>

                    <div className="space-y-8">
                        <div className="space-y-4">
                            <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-teal-900/50 text-teal-400 border border-teal-800 text-[10px] font-bold uppercase tracking-widest">
                                <ShieldCheck size={12} />
                                Security Node
                            </div>
                            <h2 className="text-4xl font-bold text-white leading-[1.1] tracking-tight">
                                Integrated Clinical <br />
                                <span className="text-teal-500">Dashboard</span>
                            </h2>
                            <p className="text-slate-400 text-sm font-medium leading-relaxed max-w-xs uppercase tracking-tight opacity-80">
                                Login with your email and password to get started.
                            </p>
                        </div>
                    </div>

                    <div className="mt-auto pt-8 border-t border-slate-800">
                        <p className="text-[9px] font-bold text-slate-500 uppercase tracking-widest">
                            © 2026 Oasis Dental
                        </p>
                    </div>
                </div>
            </div>

            {/* Right Panel - Professional Form */}
            <div className="flex-1 flex items-center justify-center p-8 bg-slate-100 relative">
                <div className="w-full max-w-sm space-y-8 bg-white p-10 rounded-md border border-slate-200 shadow-xl">
                    <div className="text-left space-y-2">
                        <h1 className="text-2xl font-bold text-slate-900 tracking-tight uppercase leading-none">Sign In</h1>
                    </div>

                    <form onSubmit={handleSubmit} className="space-y-6">
                        {error && (
                            <div className="flex items-center gap-3 px-4 py-3 rounded bg-rose-50 border border-rose-100 text-rose-600 text-[10px] font-bold shadow-sm uppercase tracking-tight">
                                <AlertCircle size={14} className="shrink-0" />
                                {error}
                            </div>
                        )}

                        <div className="space-y-4">
                            <div className="space-y-1.5">
                                <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest ml-0.5">Email</label>
                                <div className="relative group">
                                    <Mail size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-teal-600" />
                                    <Input
                                        type="email"
                                        placeholder="Email Address"
                                        value={email}
                                        onChange={e => setEmail(e.target.value)}
                                        className="pl-10 h-11 bg-slate-50 border-slate-200 text-slate-900 font-medium focus:ring-0 focus:border-teal-500 focus:bg-white rounded-sm text-xs transition-all shadow-none"
                                        autoComplete="email"
                                    />
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <label className="text-[9px] font-bold text-slate-500 uppercase tracking-widest ml-0.5">Access Password</label>
                                <div className="relative group">
                                    <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-300 group-focus-within:text-teal-600" />
                                    <Input
                                        type="password"
                                        placeholder="••••••••"
                                        value={password}
                                        onChange={e => setPassword(e.target.value)}
                                        className="pl-10 h-11 bg-slate-50 border-slate-200 text-slate-900 font-medium focus:ring-0 focus:border-teal-500 focus:bg-white rounded-sm text-xs transition-all shadow-none"
                                        autoComplete="current-password"
                                    />
                                </div>
                            </div>
                        </div>

                        <Button
                            type="submit"
                            disabled={loading}
                            className="w-full h-11 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-sm shadow-md active:scale-[0.99] transition-all text-[11px] uppercase tracking-widest"
                        >
                            {loading ? (
                                <span className="flex items-center gap-2">
                                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    Authenticating...
                                </span>
                            ) : (
                                'Sign in to dashboard'
                            )}
                        </Button>
                    </form>

                    <div className="pt-6 text-center border-t border-slate-100">
                        <p className="text-[8px] font-bold text-slate-300 uppercase tracking-[0.3em]">
                            Designed and Developed by Simvana Digital Agency
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default LoginPage;
