import React, { useState } from 'react';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Textarea } from '../components/ui/textarea';
import { Input } from '../components/ui/input';
import { cn } from '../lib/utils';

interface BlogPost {
    id: string;
    title: string;
    content: string;
    topic: string;
    date: string;
    status: 'draft' | 'published';
}

const BlogCard: React.FC<{ post: BlogPost; onUpdate: (id: string, updates: Partial<BlogPost>) => void }> = ({ post, onUpdate }) => {
    const [expanded, setExpanded] = useState(false);
    const [editing, setEditing] = useState(false);
    const [editTitle, setEditTitle] = useState(post.title);
    const [editContent, setEditContent] = useState(post.content);
    const [copied, setCopied] = useState(false);

    const copyContent = () => {
        navigator.clipboard.writeText(`Title: ${post.title}\n\n${post.content}`);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <Card className="bg-white border-slate-100 hover:border-teal-300 transition-all duration-300 shadow-sm rounded-[2rem] overflow-hidden group">
            <CardContent className="p-0">
                <div
                    className="flex items-center gap-6 p-8 cursor-pointer hover:bg-slate-50 transition-colors"
                    onClick={() => setExpanded(!expanded)}
                >
                    <div className="w-12 h-12 rounded-2xl bg-teal-50 flex items-center justify-center flex-shrink-0 border border-teal-100 group-hover:bg-teal-600 group-hover:text-white transition-all shadow-sm">
                        <div className="w-2 h-2 rounded-full bg-current" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-3 mb-2">
                            <p className="text-lg font-black text-slate-900 tracking-tighter uppercase leading-none truncate">{post.title}</p>
                            <Badge variant={post.status === 'published' ? 'default' : 'outline'} className="text-[9px] h-5 px-3 rounded-full font-black uppercase tracking-widest leading-none">
                                {post.status}
                            </Badge>
                        </div>
                        <p className="text-[10px] font-black text-slate-400 border-l-2 border-slate-100 pl-3 uppercase tracking-widest leading-none">{post.date} · {post.topic}</p>
                    </div>
                    <div className="text-[10px] font-black text-slate-300 uppercase tracking-widest">
                        {expanded ? 'Close' : 'View'}
                    </div>
                </div>

                {expanded && (
                    <div className="border-t border-slate-100 p-10 space-y-8 bg-slate-50/20 animate-in slide-in-from-top-2 duration-300">
                        {editing ? (
                            <div className="space-y-6">
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] ml-1">Title</label>
                                    <Input
                                        value={editTitle}
                                        onChange={e => setEditTitle(e.target.value)}
                                        className="h-14 rounded-2xl border-slate-100 font-black bg-white text-base shadow-sm px-6 focus:ring-teal-500/10 focus:border-teal-500"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-[10px] font-black text-slate-300 uppercase tracking-[0.2em] ml-1">Content</label>
                                    <Textarea
                                        value={editContent}
                                        onChange={e => setEditContent(e.target.value)}
                                        rows={18}
                                        className="rounded-3xl border-slate-100 font-bold bg-white leading-relaxed text-sm shadow-sm p-8 focus:ring-teal-500/10 focus:border-teal-500"
                                    />
                                </div>
                                <div className="flex gap-4 pt-4">
                                    <Button
                                        onClick={() => { onUpdate(post.id, { title: editTitle, content: editContent }); setEditing(false); }}
                                        className="bg-teal-600 hover:bg-teal-700 text-white font-black h-12 px-10 rounded-2xl shadow-xl shadow-teal-500/10 uppercase text-[11px] tracking-widest transition-all active:scale-[0.98]"
                                    >
                                        Save Draft
                                    </Button>
                                    <Button variant="ghost" onClick={() => setEditing(false)} className="h-12 px-8 text-slate-400 font-black uppercase text-[10px] tracking-widest hover:bg-white rounded-2xl">Cancel</Button>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-10">
                                <article className="prose prose-slate max-w-none text-slate-600 font-sans">
                                    <div className="bg-white rounded-[2.5rem] border border-slate-100 p-12 shadow-sm max-h-[700px] overflow-y-auto scrollbar-none leading-relaxed text-slate-800 text-[15px] font-medium selection:bg-teal-100">
                                        <div className="whitespace-pre-wrap space-y-8">
                                            {post.content}
                                        </div>
                                    </div>
                                </article>

                                <div className="flex flex-wrap gap-4 pt-8 border-t border-slate-50 items-center justify-between">
                                    <div className="flex gap-3">
                                        <button
                                            onClick={() => setEditing(true)}
                                            className="h-10 px-6 rounded-xl border border-slate-100 text-[10px] font-black uppercase tracking-widest bg-white hover:bg-slate-50 transition-all text-slate-400 hover:text-slate-900 active:scale-[0.98]"
                                        >
                                            Edit
                                        </button>
                                        <button
                                            onClick={copyContent}
                                            className="h-10 px-6 rounded-xl border border-slate-100 text-[10px] font-black uppercase tracking-widest bg-white hover:bg-slate-50 transition-all text-slate-400 hover:text-slate-900 active:scale-[0.98]"
                                        >
                                            {copied ? 'Copied' : 'Copy'}
                                        </button>
                                    </div>
                                    <Button
                                        onClick={() => onUpdate(post.id, { status: post.status === 'published' ? 'draft' : 'published' })}
                                        className={cn(
                                            "h-12 px-10 rounded-2xl font-black shadow-xl transition-all text-[11px] uppercase tracking-widest active:scale-[0.98]",
                                            post.status === 'published' ? "bg-slate-100 text-slate-400 hover:bg-slate-200" : "bg-slate-900 text-white hover:bg-slate-800 shadow-slate-900/10"
                                        )}
                                    >
                                        {post.status === 'published' ? 'Recall' : 'Broadcast'}
                                    </Button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
};

const NewsletterBlogPage: React.FC = () => {
    const [posts, setPosts] = useState<BlogPost[]>([]);
    const [topic, setTopic] = useState('');
    const [generating, setGenerating] = useState(false);

    const handleUpdate = (id: string, updates: Partial<BlogPost>) => {
        setPosts(prev => prev.map(p => p.id === id ? { ...p, ...updates } : p));
    };

    const generateContent = async () => {
        if (!topic) return;
        setGenerating(true);
        await new Promise(r => setTimeout(r, 2500));

        const content = `Maintaining optimal oral health is more than just about a white smile—it's about whole-body wellness. Today, we're diving deep into ${topic} and how it impacts your daily health.\n\nAt Oasis Dental, we prioritize patient education. Research consistently shows that oral hygiene directly correlates with systemic health. Specifically regarding ${topic}, our clinical team has observed that early intervention is the best strategy.\n\nOur approach follows a rigorous protocol:\n1. Precision Analysis: We begin with a high-resolution scan of your oral architecture.\n2. Individualized Planning: No two smiles are the same. We tailor our treatments to your specific biology.\n3. Advanced Biocompatibility: We utilize materials that are designed to integrate seamlessly with your body.\n\nYours in Wellness,\nThe Oasis Dental Clinical Team`;

        const newPost: BlogPost = {
            id: `blog-${Date.now()}`,
            title: `Guide to ${topic}`,
            content: content,
            topic: topic,
            date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
            status: 'draft',
        };

        setPosts(prev => [newPost, ...prev]);
        setGenerating(false);
        setTopic('');
    };

    return (
        <div className="p-12 space-y-16 max-w-full mx-auto bg-slate-50/50 font-sans pb-20">
            <div className="flex flex-col md:flex-row items-center justify-between gap-6 px-2">
                <div className="space-y-4">
                    <h1 className="text-4xl font-black text-slate-900 tracking-tighter uppercase leading-none">Intelligence</h1>
                    <p className="text-[10px] font-black text-slate-300 uppercase tracking-[0.4em] leading-none opacity-60">Insight Generation Node</p>
                </div>
                <div className="bg-teal-50 px-6 py-2 rounded-full border border-teal-100 text-[10px] font-black text-teal-600 uppercase tracking-widest shadow-sm">
                    {posts.length} Nodes in Archive
                </div>
            </div>

            <Card className="bg-white border border-slate-100 shadow-2xl rounded-[3rem] overflow-hidden group shadow-teal-500/5">
                <CardContent className="p-12 space-y-10">
                    <div className="space-y-4">
                        <label className="text-[10px] font-black text-slate-300 uppercase tracking-[0.3em] ml-2 opacity-60 font-sans">Focus / Topic Signature</label>
                        <div className="flex flex-col sm:flex-row gap-6">
                            <Input
                                value={topic}
                                onChange={(e) => setTopic(e.target.value)}
                                placeholder="Enter Clinical Topic..."
                                className="h-16 px-8 rounded-3xl text-xl border-slate-100 font-bold bg-slate-50/50 focus:ring-teal-500/10 focus:border-teal-500 focus:bg-white transition-all shadow-inner"
                            />
                            <Button
                                onClick={generateContent}
                                disabled={!topic || generating}
                                className="h-16 px-12 bg-slate-900 hover:bg-slate-800 text-white rounded-3xl font-black text-sm uppercase tracking-[0.2em] shadow-xl shadow-slate-900/10 active:scale-[0.98] transition-all flex items-center gap-4 shrink-0"
                            >
                                {generating ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : 'Synthesize'}
                            </Button>
                        </div>
                    </div>
                </CardContent>
            </Card>

            <div className="space-y-10">
                <div className="flex items-center justify-between border-b border-slate-100 pb-6 px-4">
                    <h4 className="text-[10px] font-black text-slate-300 uppercase tracking-[0.4em] flex items-center gap-4">
                        <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
                        Insight Registry
                    </h4>
                </div>

                {posts.length === 0 ? (
                    <div className="p-32 text-center rounded-[3rem] bg-white/50 border-2 border-dashed border-slate-100 flex flex-col items-center justify-center space-y-6">
                        <p className="text-slate-200 text-lg font-black uppercase tracking-widest leading-none">Archive Clean</p>
                    </div>
                ) : (
                    <div className="grid gap-6">
                        {posts.map(p => (
                            <BlogCard key={p.id} post={p} onUpdate={handleUpdate} />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

// Simple Badge component
const Badge: React.FC<{ children: React.ReactNode; variant?: 'default' | 'outline'; className?: string }> = ({ children, variant = 'default', className }) => (
    <span className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-[0.1em]",
        variant === 'default' ? "bg-slate-900 text-white" : "bg-white border border-slate-200 text-slate-400",
        className
    )}>
        {children}
    </span>
);

export default NewsletterBlogPage;
