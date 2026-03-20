import React, { useState, useEffect } from 'react';
import { cn } from '../../lib/utils';
import {
    LayoutDashboard, Calendar, MessageSquare, PhoneCall, Mail,
    Link2, Menu, X, ChevronRight, LogOut, Bell,
    ClipboardList, ShieldCheck, Stethoscope, ListTodo,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { format } from 'date-fns';

interface SidebarProps {
    activeSection: string;
    onSectionChange: (section: string) => void;
}

const navItems = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'staffTasks', label: 'Checklist', icon: ListTodo },
    { id: 'appointments', label: 'Appointments', icon: Calendar },
    { id: 'followups', label: 'Follow-Ups', icon: PhoneCall },
    { id: 'inquiries', label: 'Inquiries', icon: MessageSquare },
    { id: 'estimates', label: 'Estimates', icon: ClipboardList },
    { id: 'newsletter', label: 'News', icon: Mail },
];

export const Sidebar: React.FC<SidebarProps> = ({ activeSection, onSectionChange }) => {
    const { userProfile, user, logout, isAdmin } = useAuth();
    const [collapsed, setCollapsed] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);

    const displayName = userProfile?.displayName ?? user?.email?.split('@')[0] ?? 'User';
    const initials = displayName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();

    const handleNav = (id: string) => {
        onSectionChange(id);
        setMobileOpen(false);
    };

    const SidebarContent = () => (
        <div className="flex flex-col h-full bg-white">
            <div className={cn("flex items-center gap-3 px-6 py-6 border-b", collapsed && "px-4 justify-center")}>
                <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center shadow-lg shadow-teal-600/20 shrink-0">
                    <Stethoscope className="w-4 h-4 text-white" />
                </div>
                {!collapsed && (
                    <h1 className="text-sm font-black text-slate-900 uppercase tracking-tight">Oasis Dental</h1>
                )}
            </div>

            <nav className="flex-1 px-3 py-6 space-y-1 overflow-y-auto">
                {navItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = activeSection === item.id;
                    return (
                        <button
                            key={item.id}
                            onClick={() => handleNav(item.id)}
                            className={cn(
                                "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-tight transition-all",
                                isActive
                                    ? "bg-teal-50 text-teal-600 shadow-sm border border-teal-100"
                                    : "text-slate-400 hover:text-slate-600 hover:bg-slate-50",
                                collapsed && "justify-center px-2"
                            )}
                        >
                            <Icon size={18} className={isActive ? "text-teal-600" : "text-slate-300"} />
                            {!collapsed && <span className="flex-1 text-left">{item.label}</span>}
                        </button>
                    );
                })}

                {isAdmin && (
                    <div className="pt-8">
                        {!collapsed && <p className="px-4 text-[8px] font-black text-slate-300 uppercase tracking-[0.3em] mb-2">Admin</p>}
                        <button
                            onClick={() => handleNav('admin')}
                            className={cn(
                                "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-[11px] font-black uppercase tracking-tight transition-all",
                                activeSection === 'admin' ? "bg-slate-900 text-white shadow-xl" : "text-slate-400 hover:text-slate-600 hover:bg-slate-50",
                                collapsed && "justify-center px-2"
                            )}
                        >
                            <ShieldCheck size={18} className={activeSection === 'admin' ? "text-teal-400" : "text-slate-300"} />
                            {!collapsed && <span className="flex-1 text-left">Portal</span>}
                        </button>
                    </div>
                )}
            </nav>

            <div className="px-3 pb-6 border-t mt-auto pt-6 space-y-4">
                {!collapsed && (
                    <div className="flex items-center gap-3 p-2 bg-slate-50 rounded-xl border border-slate-100">
                        <div className="w-8 h-8 rounded-lg bg-teal-600 flex items-center justify-center text-[10px] font-black text-white shrink-0 shadow-sm">
                            {initials}
                        </div>
                        <div className="min-w-0">
                            <p className="text-[10px] font-black text-slate-900 uppercase truncate">{displayName}</p>
                            <p className="text-[8px] text-slate-400 font-bold uppercase tracking-widest leading-none mt-1 opacity-60">Staff</p>
                        </div>
                    </div>
                )}
                <button
                    onClick={() => logout()}
                    className={cn(
                        "w-full flex items-center gap-3 px-3 py-2 text-[10px] font-black text-slate-300 hover:text-rose-600 transition-all uppercase tracking-widest leading-none",
                        collapsed && "justify-center px-2"
                    )}
                >
                    <LogOut size={16} className="shrink-0" />
                    {!collapsed && <span>Logout</span>}
                </button>
            </div>
        </div>
    );

    return (
        <>
            <button
                onClick={() => setMobileOpen(!mobileOpen)}
                className="md:hidden fixed top-3 left-3 z-[60] p-2 rounded-xl bg-white text-slate-900 shadow-xl border border-slate-100"
            >
                {mobileOpen ? <X size={18} /> : <Menu size={18} />}
            </button>
            {mobileOpen && (
                <div className="md:hidden fixed inset-0 bg-slate-900/10 z-50" onClick={() => setMobileOpen(false)} />
            )}
            <aside className={cn(
                "md:hidden fixed left-0 top-0 bottom-0 z-50 w-64 bg-white border-r border-slate-100 transition-transform duration-300",
                mobileOpen ? "translate-x-0" : "-translate-x-full"
            )}>
                <SidebarContent />
            </aside>
            <aside className={cn(
                "hidden md:flex flex-col fixed left-0 top-0 bottom-0 z-30 bg-white border-r border-slate-100 transition-all duration-300",
                collapsed ? "w-20" : "w-64"
            )}>
                <SidebarContent />
                <button
                    onClick={() => setCollapsed(!collapsed)}
                    className="absolute -right-3 top-20 w-6 h-6 rounded-full bg-white border border-slate-100 flex items-center justify-center shadow-md hover:bg-slate-50 transition-colors z-40"
                >
                    <ChevronRight size={10} className={cn("text-slate-300 transition-transform duration-300", collapsed && "rotate-180")} />
                </button>
            </aside>
            <div className={cn("hidden md:block shrink-0 transition-all duration-300", collapsed ? "w-20" : "w-64")} />
        </>
    );
};

export const TopBar: React.FC<{ section: string }> = ({ section }) => {
    const { userProfile, user, isAdmin } = useAuth();
    const [notifications, setNotifications] = useState<any[]>([]);
    const [showNotifications, setShowNotifications] = useState(false);

    const displayName = userProfile?.displayName ?? user?.email?.split('@')[0] ?? 'User';

    useEffect(() => {
        const todayStr = format(new Date(), 'yyyy-MM-dd');
        const qTasks = query(collection(db, 'tasks'), where('status', '!=', 'completed'));
        const unsubTasks = onSnapshot(qTasks, (snap) => {
            const items: any[] = [];
            snap.docs.forEach(doc => {
                const data = doc.data();
                if ((data.type === 'directive' && data.assignedTo === user?.email) || (data.type === 'protocol' && data.date === todayStr)) {
                    items.push({ id: doc.id, title: data.title, type: 'task' });
                }
            });
            setNotifications(items);
        });
        return unsubTasks;
    }, [user?.email]);

    const sectionLabels: Record<string, string> = {
        dashboard: 'Dashboard',
        staffTasks: 'Checklist',
        appointments: 'Appointments',
        followups: 'Follow-Ups',
        inquiries: 'Inquiries',
        estimates: 'Estimates',
        newsletter: 'News',
        admin: 'Admin',
    };

    const today = format(new Date(), 'EEEE, MMMM d');

    return (
        <header className="h-14 bg-white/80 backdrop-blur-md border-b border-slate-100 flex items-center px-8 justify-between sticky top-0 z-20">
            <div>
                <h2 className="text-sm font-black text-slate-900 tracking-tight uppercase leading-none">{sectionLabels[section] ?? section}</h2>
                <p className="text-[9px] font-black text-teal-600/50 mt-1 uppercase tracking-widest leading-none">{today}</p>
            </div>

            <div className="flex items-center gap-6">
                <div
                    onClick={() => setShowNotifications(!showNotifications)}
                    className="relative cursor-pointer hover:bg-slate-50 p-2 rounded-lg transition-colors border border-transparent hover:border-slate-100"
                >
                    <div className="flex items-center gap-2">
                        <Bell size={16} className={cn("transition-colors", notifications.length > 0 ? "text-teal-600" : "text-slate-200")} />
                        {notifications.length > 0 && (
                            <span className="w-4 h-4 bg-rose-500 rounded-full text-[8px] flex items-center justify-center text-white font-black">
                                {notifications.length}
                            </span>
                        )}
                    </div>
                    {showNotifications && (
                        <>
                            <div className="fixed inset-0 z-40" onClick={() => setShowNotifications(false)} />
                            <div className="absolute right-0 mt-3 w-72 bg-white rounded-2xl shadow-2xl border border-slate-100 p-2 z-50">
                                <h4 className="p-3 border-b text-[10px] font-black text-slate-900 uppercase tracking-widest">Active Alerts</h4>
                                <div className="max-h-60 overflow-y-auto scrollbar-none p-1 space-y-1">
                                    {notifications.length === 0 ? (
                                        <div className="p-8 text-center opacity-30 text-[9px] font-black uppercase tracking-widest">Clear</div>
                                    ) : (
                                        notifications.map(n => (
                                            <div key={n.id} className="p-3 rounded-xl hover:bg-slate-50 text-[11px] font-bold text-slate-800 uppercase tracking-tight truncate border border-transparent hover:border-slate-100 transition-all">
                                                {n.title}
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </div>

                <div className="h-6 w-px bg-slate-100" />

                <div className="flex items-center gap-3">
                    <div className="text-right hidden sm:block">
                        <p className="text-[10px] font-black text-slate-900 uppercase leading-none">{displayName}</p>
                        <p className={cn("text-[8px] font-black uppercase tracking-widest mt-1 opacity-60 leading-none", isAdmin ? "text-teal-600" : "text-slate-400")}>
                            {isAdmin ? 'Admin' : 'Staff'}
                        </p>
                    </div>
                </div>
            </div>
        </header>
    );
};
