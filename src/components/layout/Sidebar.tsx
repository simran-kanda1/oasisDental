import React, { useState, useEffect, useMemo } from 'react';
import { cn } from '../../lib/utils';
import { GlobalPatientSearch } from '../GlobalPatientSearch';
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
    badge?: NavBadgeKind;
    queueId?: string;
};

const navItems: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'staffTasks', label: 'Checklist' },
    { id: 'appointments', label: 'Appointments' },
    { id: 'frontDeskQueues', label: 'No future appointments', badge: 'frontDesk' },
    { id: 'emerg_follow_up', label: 'Emerg patient follow up', badge: 'queue', queueId: 'emerg_follow_up' },
    { id: 'new_patient_follow_up', label: 'New patient follow up', badge: 'queue', queueId: 'new_patient_follow_up' },
    { id: GA_ALL_APPOINTMENTS_QUEUE_ID, label: 'GA appointments', badge: 'queue', queueId: GA_ALL_APPOINTMENTS_QUEUE_ID },
    { id: 'cbct', label: 'CBCT', badge: 'queue', queueId: 'cbct' },
    { id: 'followUpOutreach', label: 'Estimates', badge: 'estimates' },
    { id: 'inquiries', label: 'Inquiries', badge: 'inquiries' },
];

function NavCountBadge({
    count,
    tone = 'teal',
    loading = false,
}: {
    count: number;
    tone?: 'teal' | 'amber';
    loading?: boolean;
}) {
    if (loading) {
        return (
            <span className="ml-auto text-[10px] text-slate-400" aria-label="Loading">…</span>
        );
    }
    if (count <= 0) return null;
    return (
        <span
            className={cn(
                'ml-auto min-w-[1.25rem] px-1.5 py-0.5 rounded-lg text-[10px] font-semibold text-center leading-none',
                tone === 'amber' ? 'bg-amber-500 text-white' : 'bg-teal-700 text-white'
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
            <div className={cn("flex items-center px-5 py-5 border-b border-slate-100", collapsed && "px-3 justify-center")}>
                {!collapsed ? (
                    <div>
                        <h1 className="font-display text-lg text-slate-900 tracking-tight">Oasis Dental</h1>
                        <p className="text-[11px] text-slate-400 mt-0.5">Front desk</p>
                    </div>
                ) : (
                    <span className="text-xs font-semibold text-teal-700">OD</span>
                )}
            </div>

            <nav className="flex-1 px-3 py-5 space-y-0.5 overflow-y-auto">
                {navItems.map((item) => {
                    const isActive = isNavItemActive(item);
                    return (
                        <button
                            key={item.id}
                            onClick={() => handleNav(item)}
                            title={item.label}
                            className={cn(
                                "w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors",
                                isActive
                                    ? "bg-teal-50 text-teal-800"
                                    : "text-slate-600 hover:text-slate-900 hover:bg-slate-50",
                                collapsed && "justify-center px-2"
                            )}
                        >
                            {!collapsed ? (
                                <>
                                    <span className="flex-1 text-left leading-snug">{item.label}</span>
                                    <NavCountBadge
                                        count={navBadgeCount(item)}
                                        tone={item.badge === 'estimates' ? 'amber' : 'teal'}
                                        loading={item.badge === 'estimates' && !badges.estimatesReady}
                                    />
                                </>
                            ) : (
                                <span className="text-[10px] font-semibold">{item.label.slice(0, 2)}</span>
                            )}
                        </button>
                    );
                })}

                {isAdmin && (
                    <div className="pt-6">
                        {!collapsed && <p className="px-3 text-[11px] font-medium text-slate-400 mb-1">Admin</p>}
                        <button
                            onClick={() => {
                                onSectionChange('admin');
                                setMobileOpen(false);
                            }}
                            className={cn(
                                "w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors",
                                activeSection === 'admin' ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50",
                                collapsed && "justify-center px-2"
                            )}
                        >
                            {!collapsed && <span className="flex-1 text-left">Portal</span>}
                            {collapsed && <span className="text-[10px] font-semibold">AD</span>}
                        </button>
                    </div>
                )}
            </nav>

            <div className="px-3 pb-5 border-t border-slate-100 mt-auto pt-4 space-y-2">
                {!collapsed && (
                    <div className="px-3 py-2 rounded-xl bg-slate-50">
                        <p className="text-sm font-medium text-slate-900 truncate">{displayName}</p>
                        <p className="text-[11px] text-slate-400">{isAdmin ? 'Admin' : 'Staff'}</p>
                    </div>
                )}
                <button
                    onClick={() => onSectionChange('settings')}
                    className={cn(
                        "w-full text-left px-3 py-2 rounded-xl text-[13px] font-medium transition-colors",
                        activeSection === 'settings'
                            ? "bg-teal-50 text-teal-800"
                            : "text-slate-600 hover:bg-slate-50",
                        collapsed && "text-center px-2"
                    )}
                >
                    {collapsed ? 'Set' : 'Settings'}
                </button>
                <button
                    onClick={() => logout()}
                    className={cn(
                        "w-full text-left px-3 py-2 rounded-xl text-[13px] font-medium text-slate-500 hover:text-rose-700 hover:bg-rose-50 transition-colors",
                        collapsed && "text-center px-2"
                    )}
                >
                    {collapsed ? 'Out' : 'Log out'}
                </button>
            </div>
        </div>
    );

    return (
        <>
            <button
                onClick={() => setMobileOpen(!mobileOpen)}
                className="md:hidden fixed top-3 left-3 z-[60] px-3 py-2 rounded-xl bg-white text-sm font-medium text-slate-900 border border-slate-200"
            >
                {mobileOpen ? 'Close' : 'Menu'}
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
                    className="absolute -right-3 top-20 w-6 h-6 rounded-lg bg-white border border-slate-200 flex items-center justify-center text-[10px] text-slate-500 hover:bg-slate-50 z-40"
                    aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                >
                    {collapsed ? '>' : '<'}
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
        <header className="h-14 bg-white border-b border-slate-100 flex items-center px-4 md:px-8 justify-between sticky top-0 z-20 gap-4">
            <div className="min-w-0 shrink">
                <h2 className="text-sm font-semibold text-slate-800 truncate">{headerTitle}</h2>
                <p className="text-xs text-teal-700/80 mt-0.5">{today}</p>
            </div>

            <div className="flex items-center gap-3 md:gap-5 flex-1 justify-end min-w-0">
                <GlobalPatientSearch />

                <div className="relative shrink-0">
                    <button
                        type="button"
                        onClick={() => setShowNotifications(!showNotifications)}
                        className="relative hover:bg-slate-50 px-3 py-1.5 rounded-xl text-xs font-medium transition-colors border border-slate-200 text-slate-700"
                    >
                        Alerts{unreadCount > 0 ? ` (${unreadCount})` : ''}
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
