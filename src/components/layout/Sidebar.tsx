import React, { useState, useEffect, useMemo } from 'react';
import { cn } from '../../lib/utils';
import {
    LayoutDashboard, Calendar, MessageSquare,
    Menu, X, ChevronRight, LogOut, Bell,
    ShieldCheck, ListTodo, UsersRound, LayoutList, Settings,
    Siren, UserPlus, Share2, HeartPulse,
} from 'lucide-react';
import { GlobalPatientSearch } from '../GlobalPatientSearch';
import { Tooth } from '../ui/icons';
import { useAuth } from '../../contexts/AuthContext';
import {
    type AppNotification,
    isNotificationRead,
    markAllNotificationsRead,
    markNotificationRead,
} from '../../lib/notifications';
import { navigateToSection } from '../../lib/navigation';
import { NO_APPT_BOOKED_QUEUE_ID, GA_ALL_APPOINTMENTS_QUEUE_ID, getFrontDeskQueueDef, isStandaloneFrontDeskQueue } from '../../data/queueRules';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../../lib/firebase';
import { format } from 'date-fns';
import { isRecallFollowUpDoc, isOpenOutreachItem } from '../../lib/followUpQueues';
import { isOpenWixInquiryDoc } from '../../lib/wixInquiryCounts';
import { useNavBadges } from '../../contexts/NavBadgeContext';

interface SidebarProps {
    activeSection: string;
    activeQueueId?: string;
    onSectionChange: (section: string, queueId?: string) => void;
}

type NavBadgeKind = 'inquiries' | 'frontDesk' | 'estimates' | 'queue';

type NavItem = {
    id: string;
    label: string;
    icon: typeof LayoutDashboard;
    badge?: NavBadgeKind;
    queueId?: string;
};

const navItems: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { id: 'staffTasks', label: 'Checklist', icon: ListTodo },
    { id: 'appointments', label: 'Appointments', icon: Calendar },
    { id: 'frontDeskQueues', label: 'No future appointments', icon: LayoutList, badge: 'frontDesk' },
    { id: 'emerg_follow_up', label: 'Emerg patient follow up', icon: Siren, badge: 'queue', queueId: 'emerg_follow_up' },
    { id: 'new_patient_follow_up', label: 'New patient follow up', icon: UserPlus, badge: 'queue', queueId: 'new_patient_follow_up' },
    { id: GA_ALL_APPOINTMENTS_QUEUE_ID, label: 'GA appointments', icon: HeartPulse, badge: 'queue', queueId: GA_ALL_APPOINTMENTS_QUEUE_ID },
    { id: 'referral_doctor_followup', label: 'Referrals', icon: Share2, badge: 'queue', queueId: 'referral_doctor_followup' },
    { id: 'followUpOutreach', label: 'Estimates', icon: UsersRound, badge: 'estimates' },
    { id: 'inquiries', label: 'Inquiries', icon: MessageSquare, badge: 'inquiries' },
];

function NavCountBadge({ count, tone = 'teal' }: { count: number; tone?: 'teal' | 'amber' }) {
    if (count <= 0) return null;
    return (
        <span
            className={cn(
                'ml-auto min-w-[1.25rem] px-1.5 py-0.5 rounded-full text-[9px] font-black text-center leading-none',
                tone === 'amber' ? 'bg-amber-500 text-white' : 'bg-teal-600 text-white'
            )}
        >
            {count > 99 ? '99+' : count}
        </span>
    );
}

export const Sidebar: React.FC<SidebarProps> = ({ activeSection, activeQueueId, onSectionChange }) => {
    const { userProfile, user, logout, isAdmin } = useAuth();
    const badges = useNavBadges();
    const [collapsed, setCollapsed] = useState(false);
    const [mobileOpen, setMobileOpen] = useState(false);

    const navBadgeCount = (item: NavItem) => {
        if (item.badge === 'inquiries') return badges.openInquiries;
        if (item.badge === 'frontDesk') return badges.frontDeskTotal;
        if (item.badge === 'estimates') return badges.estimatePredApproved + badges.estimatePredFollowUp;
        if (item.badge === 'queue' && item.queueId) return badges.frontDeskByQueue[item.queueId] ?? 0;
        return 0;
    };

    const isNavItemActive = (item: NavItem) => {
        if (item.queueId) {
            return activeSection === 'frontDeskQueues' && activeQueueId === item.queueId;
        }
        if (item.id === 'frontDeskQueues') {
            return (
                activeSection === 'frontDeskQueues' &&
                (!activeQueueId || activeQueueId === NO_APPT_BOOKED_QUEUE_ID || !isStandaloneFrontDeskQueue(activeQueueId))
            );
        }
        return activeSection === item.id;
    };

    const displayName = userProfile?.displayName ?? user?.email?.split('@')[0] ?? 'User';
    const initials = displayName.split(' ').map((n: string) => n[0]).join('').slice(0, 2).toUpperCase();

    const handleNav = (item: NavItem) => {
        if (item.queueId) {
            onSectionChange('frontDeskQueues', item.queueId);
        } else {
            onSectionChange(item.id);
        }
        setMobileOpen(false);
    };

    const SidebarContent = () => (
        <div className="flex flex-col h-full bg-white">
            <div className={cn("flex items-center gap-3 px-6 py-4 border-b", collapsed && "px-4 justify-center")}>
                <div className="w-8 h-8 rounded bg-teal-600 flex items-center justify-center shadow-lg shadow-teal-600/20 shrink-0">
                    <Tooth className="text-white" size={18} />
                </div>
                {!collapsed && (
                    <h1 className="text-sm font-black text-slate-900 uppercase tracking-tight">Oasis Dental</h1>
                )}
            </div>

            <nav className="flex-1 px-3 py-6 space-y-1 overflow-y-auto">
                {navItems.map((item) => {
                    const Icon = item.icon;
                    const isActive = isNavItemActive(item);
                    return (
                        <button
                            key={item.id}
                            onClick={() => handleNav(item)}
                            className={cn(
                                "w-full flex items-center gap-3 px-3 py-2 rounded-md text-[11px] font-bold uppercase tracking-tight transition-all",
                                isActive
                                    ? "bg-teal-50 text-teal-600 shadow-sm border border-teal-100"
                                    : "text-slate-400 hover:text-slate-600 hover:bg-slate-50",
                                collapsed && "justify-center px-2"
                            )}
                        >
                            <Icon size={16} className={isActive ? "text-teal-600" : "text-slate-300"} />
                            {!collapsed && (
                                <>
                                    <span className="flex-1 text-left">{item.label}</span>
                                    <NavCountBadge
                                        count={navBadgeCount(item)}
                                        tone={item.badge === 'estimates' ? 'amber' : 'teal'}
                                    />
                                </>
                            )}
                        </button>
                    );
                })}

                {isAdmin && (
                    <div className="pt-8">
                        {!collapsed && <p className="px-4 text-[8px] font-black text-slate-300 uppercase tracking-[0.3em] mb-2">Admin</p>}
                        <button
                            onClick={() => {
                                onSectionChange('admin');
                                setMobileOpen(false);
                            }}
                            className={cn(
                                "w-full flex items-center gap-3 px-3 py-2 rounded-md text-[11px] font-bold uppercase tracking-tight transition-all",
                                activeSection === 'admin' ? "bg-slate-900 text-white shadow-xl" : "text-slate-400 hover:text-slate-600 hover:bg-slate-50",
                                collapsed && "justify-center px-2"
                            )}
                        >
                            <ShieldCheck size={16} className={activeSection === 'admin' ? "text-teal-400" : "text-slate-300"} />
                            {!collapsed && <span className="flex-1 text-left">Portal</span>}
                        </button>
                    </div>
                )}
            </nav>

            <div className="px-3 pb-6 border-t mt-auto pt-6 space-y-4">
                {!collapsed && (
                    <div className="flex items-center gap-3 p-2 bg-slate-50 rounded-md border border-slate-100">
                        <div className="w-8 h-8 rounded bg-teal-600 flex items-center justify-center text-[10px] font-black text-white shrink-0 shadow-sm">
                            {initials}
                        </div>
                        <div className="min-w-0">
                            <p className="text-[10px] font-black text-slate-900 uppercase truncate">{displayName}</p>
                            <p className="text-[8px] text-slate-400 font-bold uppercase tracking-widest leading-none mt-1 opacity-60">{isAdmin ? 'Admin' : 'Staff'}</p>
                        </div>
                    </div>
                )}
                <button
                    onClick={() => onSectionChange('settings')}
                    className={cn(
                        "w-full flex items-center gap-3 px-3 py-2 rounded-md text-[10px] font-bold uppercase tracking-tight transition-all",
                        activeSection === 'settings'
                            ? "bg-teal-50 text-teal-600 border border-teal-100"
                            : "text-slate-400 hover:text-slate-600 hover:bg-slate-50",
                        collapsed && "justify-center px-2"
                    )}
                >
                    <Settings size={16} className="shrink-0" />
                    {!collapsed && <span>Settings</span>}
                </button>
                <button
                    onClick={() => logout()}
                    className={cn(
                        "w-full flex items-center gap-3 px-3 py-2 text-[10px] font-black text-slate-400 hover:text-rose-600 transition-all uppercase tracking-widest leading-none",
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
                className="md:hidden fixed top-3 left-3 z-[60] p-2 rounded bg-white text-slate-900 shadow-xl border border-slate-100"
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

export const TopBar: React.FC<{ section: string; queueId?: string }> = ({ section, queueId }) => {
    const { userProfile, user, isAdmin } = useAuth();
    const [notifications, setNotifications] = useState<AppNotification[]>([]);
    const [showNotifications, setShowNotifications] = useState(false);
    const [readTick, setReadTick] = useState(0);

    const displayName = userProfile?.displayName ?? user?.email?.split('@')[0] ?? 'User';

    useEffect(() => {
        const todayStr = format(new Date(), 'yyyy-MM-dd');

        const qTasks = query(collection(db, 'tasks'), where('status', '!=', 'completed'));
        const unsubTasks = onSnapshot(qTasks, (snap) => {
            const taskItems: AppNotification[] = [];
            snap.docs.forEach((docItem) => {
                const data = docItem.data();
                if ((data.type === 'directive' && data.assignedTo === user?.email) || (data.type === 'protocol' && data.date === todayStr)) {
                    taskItems.push({
                        id: `task-${docItem.id}`,
                        title: String(data.title ?? 'Task'),
                        kind: 'task',
                        href: '/checklist',
                    });
                }
            });
            setNotifications((prev) => {
                const rest = prev.filter((n) => n.kind !== 'task');
                return [...rest, ...taskItems];
            });
        });

        const unsubFollowups = onSnapshot(query(collection(db, 'followUps'), where('nextAppointmentBooked', '==', false)), (snap) => {
            let recall = 0;
            let outreach = 0;
            snap.docs.forEach((d) => {
                const data = d.data() as Record<string, unknown>;
                if (isOpenOutreachItem(data)) outreach += 1;
                else if (isRecallFollowUpDoc(data)) recall += 1;
            });
            setNotifications((prev) => {
                const rest = prev.filter((n) => n.kind !== 'recall' && n.kind !== 'outreach');
                const next = [...rest];
                if (recall > 0) {
                    next.push({
                        id: 'summary-recall',
                        title: `${recall} no follow-up appt booked`,
                        kind: 'recall',
                        href: `/queues/${NO_APPT_BOOKED_QUEUE_ID}`,
                    });
                }
                if (outreach > 0) {
                    next.push({
                        id: 'summary-outreach',
                        title: `${outreach} estimate follow-ups open`,
                        kind: 'outreach',
                        href: '/estimates',
                    });
                }
                return next;
            });
        });

        const unsubInquiries = onSnapshot(collection(db, 'wixInquiries'), (snap) => {
            const open = snap.docs.filter((d) => isOpenWixInquiryDoc(d.data() as Record<string, unknown>)).length;
            setNotifications((prev) => {
                const rest = prev.filter((n) => n.kind !== 'inquiry');
                if (open <= 0) return rest;
                return [
                    ...rest,
                    {
                        id: 'summary-inquiries',
                        title: `${open} open website inquiries`,
                        kind: 'inquiry',
                        href: '/inquiries',
                    },
                ];
            });
        });

        return () => {
            unsubTasks();
            unsubFollowups();
            unsubInquiries();
        };
    }, [user?.email]);

    const unreadCount = useMemo(() => {
        void readTick;
        return notifications.filter((n) => !isNotificationRead(n.id)).length;
    }, [notifications, readTick]);

    const grouped = useMemo(() => {
        const order: AppNotification['kind'][] = ['task', 'recall', 'outreach', 'inquiry'];
        const labels: Record<AppNotification['kind'], string> = {
            task: 'Your tasks',
            recall: 'No future appointments',
            outreach: 'Estimates',
            inquiry: 'Inquiries',
        };
        return order
            .map((kind) => ({
                kind,
                label: labels[kind],
                items: notifications.filter((n) => n.kind === kind),
            }))
            .filter((g) => g.items.length > 0);
    }, [notifications]);

    const handleOpenNotification = (n: AppNotification) => {
        markNotificationRead(n.id);
        setReadTick((t) => t + 1);
        setShowNotifications(false);
        navigateToSection(
            n.kind === 'task'
                ? 'staffTasks'
                : n.kind === 'recall'
                  ? 'frontDeskQueues'
                  : n.kind === 'outreach'
                    ? 'followUpOutreach'
                    : 'inquiries',
            n.kind === 'recall' ? NO_APPT_BOOKED_QUEUE_ID : undefined
        );
    };

    const sectionLabels: Record<string, string> = {
        dashboard: 'Dashboard',
        staffTasks: 'Checklist',
        appointments: 'Appointments',
        frontDeskQueues: 'No future appointments',
        followups: 'No future appointments',
        followUpOutreach: 'Estimate follow-up',
        inquiries: 'Inquiries',
        estimates: 'Estimate follow-up',
        admin: 'Admin',
        settings: 'Settings',
    };

    const headerTitle =
        section === 'frontDeskQueues' && queueId
            ? (getFrontDeskQueueDef(queueId)?.label ?? sectionLabels[section])
            : (sectionLabels[section] ?? section);

    const today = format(new Date(), 'EEEE, MMMM d');

    return (
        <header className="h-12 bg-white/80 backdrop-blur-md border-b border-slate-100 flex items-center px-4 md:px-8 justify-between sticky top-0 z-20 gap-4">
            <div className="min-w-0 shrink">
                <h2 className="text-xs font-bold text-slate-800 tracking-tight uppercase leading-none truncate">{headerTitle}</h2>
                <p className="text-[9px] font-bold text-teal-600/50 mt-1 uppercase tracking-widest leading-none">{today}</p>
            </div>

            <div className="flex items-center gap-3 md:gap-5 flex-1 justify-end min-w-0">
                <GlobalPatientSearch />

                <div className="relative shrink-0">
                    <button
                        type="button"
                        onClick={() => setShowNotifications(!showNotifications)}
                        className="relative hover:bg-slate-50 p-2 rounded transition-colors border border-transparent hover:border-slate-100"
                    >
                        <Bell size={14} className={cn('transition-colors', unreadCount > 0 ? 'text-teal-600' : 'text-slate-300')} />
                        {unreadCount > 0 && (
                            <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-rose-500 rounded-full text-[8px] flex items-center justify-center text-white font-black">
                                {unreadCount}
                            </span>
                        )}
                    </button>
                    {showNotifications && (
                        <>
                            <div className="fixed inset-0 z-40" onClick={() => setShowNotifications(false)} />
                            <div className="absolute right-0 mt-3 w-80 bg-white rounded-lg shadow-2xl border border-slate-200 z-50 overflow-hidden">
                                <div className="flex items-center justify-between px-3 py-2 border-b border-slate-100">
                                    <h4 className="text-[9px] font-bold text-slate-900 uppercase tracking-widest">Notifications</h4>
                                    {notifications.length > 0 && (
                                        <button
                                            type="button"
                                            className="text-[9px] font-bold text-teal-600 uppercase"
                                            onClick={() => {
                                                markAllNotificationsRead(notifications.map((n) => n.id));
                                                setReadTick((t) => t + 1);
                                            }}
                                        >
                                            Mark all read
                                        </button>
                                    )}
                                </div>
                                <div className="max-h-72 overflow-y-auto p-2">
                                    {grouped.length === 0 ? (
                                        <div className="p-8 text-center text-[10px] text-slate-400 font-bold uppercase tracking-widest">All clear</div>
                                    ) : (
                                        grouped.map((group) => (
                                            <div key={group.kind} className="mb-3 last:mb-0">
                                                <p className="px-2 py-1 text-[8px] font-black text-slate-400 uppercase tracking-[0.2em]">{group.label}</p>
                                                {group.items.map((n) => {
                                                    const unread = !isNotificationRead(n.id);
                                                    return (
                                                        <button
                                                            key={n.id}
                                                            type="button"
                                                            onClick={() => handleOpenNotification(n)}
                                                            className={cn(
                                                                'w-full text-left p-2.5 rounded-md text-[10px] font-bold text-slate-700 tracking-tight border transition-all',
                                                                unread
                                                                    ? 'bg-teal-50/50 border-teal-100 hover:bg-teal-50'
                                                                    : 'border-transparent hover:bg-slate-50 opacity-70'
                                                            )}
                                                        >
                                                            {n.title}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        </>
                    )}
                </div>

                <div className="h-5 w-px bg-slate-100 hidden sm:block shrink-0" />

                <div className="text-right hidden sm:block shrink-0">
                    <p className="text-[10px] font-bold text-slate-900 uppercase leading-none">{displayName}</p>
                    <p className={cn('text-[8px] font-bold uppercase tracking-widest mt-1 opacity-60 leading-none', isAdmin ? 'text-teal-600' : 'text-slate-400')}>
                        {isAdmin ? 'Admin' : 'Staff'}
                    </p>
                </div>
            </div>
        </header>
    );
};
