import React from 'react';

const WeaveConnectPage: React.FC = () => {
    return (
        <div className="p-8 space-y-12 max-w-full mx-auto bg-slate-50/50 font-sans min-h-[calc(100vh-64px)] flex flex-col items-center justify-center">
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-[-20%] left-[-20%] w-[150%] h-[150%] bg-gradient-to-br from-teal-50/20 via-white to-blue-50/10 blur-3xl opacity-50" />
            </div>

            <div className="text-center space-y-8 relative z-10 max-w-md animate-in slide-in-from-bottom-8 duration-500">
                <div className="w-24 h-24 rounded-[3rem] bg-teal-50 border border-teal-100 flex items-center justify-center mx-auto shadow-2xl shadow-teal-500/10">
                    <div className="w-3 h-3 rounded-full bg-teal-600 animate-pulse" />
                </div>

                <div className="space-y-4">
                    <h1 className="text-4xl font-black text-slate-900 uppercase tracking-tighter leading-none">Internal</h1>
                    <p className="text-[11px] font-black text-slate-300 uppercase tracking-[0.4em] leading-none opacity-60">Weave Backbone Registry</p>
                </div>

                <div className="h-px w-20 bg-slate-100 mx-auto" />

                <p className="text-xs font-black text-slate-400 uppercase tracking-widest leading-relaxed opacity-60">
                    Direct integration node under clinical construction. Cloud signal synchronization pending backend handshake.
                </p>

                <div className="pt-12">
                    <p className="text-[9px] font-black text-teal-600/30 uppercase tracking-[0.3em]">
                        Coming Soon to Oasis Dental
                    </p>
                </div>
            </div>
        </div>
    );
};

export default WeaveConnectPage;
