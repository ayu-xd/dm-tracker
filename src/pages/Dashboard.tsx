import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { RefreshCw, Users, MessageSquare, Clock, ChevronRight, ThumbsDown, ExternalLink, GripVertical } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { useNavigate } from "react-router-dom";
import { usePullRefresh } from "@/hooks/use-pull-refresh";

/* ─── Types ─── */
type FollowUpContact = {
  id: string;
  full_name: string;
  username: string | null;
  profile_link: string;
  current_follow_up: string;
  last_follow_up_at: string;
  status: string;
};

type ColumnDef = {
  key: string;
  label: string;
  sublabel: string;
  color: string;
  dotColor: string;
};

const ALL_COLUMNS: ColumnDef[] = [
  { key: "A", label: "Trojan Horse", sublabel: "Stage A", color: "text-orange-600", dotColor: "bg-orange-500" },
  { key: "B", label: "VSL", sublabel: "Stage B", color: "text-amber-600", dotColor: "bg-amber-500" },
  { key: "C", label: "Calendly", sublabel: "Stage C", color: "text-blue-600", dotColor: "bg-blue-500" },
];

const COLUMN_ORDER_KEY = "dashboard-followup-col-order";

const Dashboard = ({ userId }: { userId: string }) => {
  const navigate = useNavigate();
  const now = new Date();
  const today = format(now, "yyyy-MM-dd");

  const [followCount, setFollowCount] = useState({ done: 0, total: 0 });
  const [dmCount, setDmCount] = useState({ done: 0, total: 0 });
  const [followUps, setFollowUps] = useState<FollowUpContact[]>([]);
  const [pipelineCounts, setPipelineCounts] = useState({ dmed: 0, initiated: 0, engaged: 0, calendly: 0, booked: 0 });
  const [loading, setLoading] = useState(true);

  // Column order (draggable)
  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem(COLUMN_ORDER_KEY);
      if (saved) { const p = JSON.parse(saved); if (Array.isArray(p)) return p; }
    } catch {}
    return ALL_COLUMNS.map(c => c.key);
  });

  const dragCol = useRef<string | null>(null);
  const dragOverCol = useRef<string | null>(null);

  /* ─── Pull-to-refresh hook ─── */
  const { containerRef, pullDistance, refreshing } = usePullRefresh({
    onRefresh: async () => { await fetchData(true); },
  });

  /* ─── Data fetch ─── */
  const fetchData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [followRes, dmRes, followUpsRes, pipelineRes] = await Promise.all([
      supabase.from("daily_queues").select("id, completed").eq("user_id", userId).eq("queue_date", today).eq("queue_type", "follow"),
      supabase.from("daily_queues").select("id, completed").eq("user_id", userId).eq("queue_date", today).eq("queue_type", "dm"),
      supabase.from("contacts").select("id, full_name, username, profile_link, current_follow_up, last_follow_up_at, status")
        .eq("user_id", userId).not("current_follow_up", "is", null).lte("last_follow_up_at", twentyFourHoursAgo)
        .in("status", ["initiated", "engaged", "calendly_sent"]).order("last_follow_up_at"),
      supabase.from("contacts").select("id, status").eq("user_id", userId).in("status", ["dmed", "initiated", "engaged", "calendly_sent", "booked"]),
    ]);

    const follows = followRes.data || [];
    setFollowCount({ done: follows.filter(f => f.completed).length, total: follows.length });
    const dms = dmRes.data || [];
    setDmCount({ done: dms.filter(d => d.completed).length, total: dms.length });
    setFollowUps((followUpsRes.data as FollowUpContact[]) || []);
    const pipeline = pipelineRes.data || [];
    setPipelineCounts({
      dmed: pipeline.filter(p => p.status === "dmed").length,
      initiated: pipeline.filter(p => p.status === "initiated").length,
      engaged: pipeline.filter(p => p.status === "engaged").length,
      calendly: pipeline.filter(p => p.status === "calendly_sent").length,
      booked: pipeline.filter(p => p.status === "booked").length,
    });
    setLoading(false);
  }, [userId, today]);

  useEffect(() => { fetchData(); }, [fetchData]);

  /* ─── Optimistic helper: remove contact from local list instantly ─── */
  const removeContactOptimistic = (contactId: string) => {
    setFollowUps(prev => prev.filter(c => c.id !== contactId));
  };

  /* ─── Follow-up actions — optimistic (remove card immediately, fire DB in background) ─── */
  const markFollowUpSent = async (contact: FollowUpContact) => {
    const fu = contact.current_follow_up;
    const letter = fu.slice(-1);
    const num = parseInt(fu.slice(0, -1));
    const maxA = 1, maxB = 8, maxC = 8;

    // Optimistic: remove from board right away (it either advances or goes to flywheel)
    removeContactOptimistic(contact.id);
    toast.success(`Follow-up ${fu} sent`);

    const nowIso = new Date().toISOString();
    if ((letter === "A" && num >= maxA) || (letter === "B" && num >= maxB) || (letter === "C" && num >= maxC)) {
      const reason = letter === "A" ? "no_reply_1a" : letter === "B" ? "no_reply_8b" : "no_reply_8c";
      const requeue = new Date(); requeue.setDate(requeue.getDate() + 90);
      await supabase.from("contacts").update({
        status: "flywheel", flywheel_reason: reason, negative_reply: false,
        requeue_after: format(requeue, "yyyy-MM-dd"), current_follow_up: null, last_follow_up_at: null,
      }).eq("id", contact.id);
    } else {
      const nextFu = `${num + 1}${letter}`;
      await supabase.from("contacts").update({ current_follow_up: nextFu, last_follow_up_at: nowIso }).eq("id", contact.id);
    }
    // Silent background refresh to sync counts
    fetchData(true);
  };

  const advanceFromFollowUp = async (contact: FollowUpContact) => {
    const letter = contact.current_follow_up.slice(-1);
    removeContactOptimistic(contact.id);

    const nowIso = new Date().toISOString();
    if (letter === "A") {
      toast.success("Moved to Engaged → VSL sent");
      await supabase.from("contacts").update({ status: "engaged", engaged_at: nowIso, current_follow_up: "1B", last_follow_up_at: nowIso }).eq("id", contact.id);
    } else if (letter === "B") {
      toast.success("Moved to Calendly → Link sent");
      await supabase.from("contacts").update({ status: "calendly_sent", calendly_sent_at: nowIso, current_follow_up: "1C", last_follow_up_at: nowIso }).eq("id", contact.id);
    } else if (letter === "C") {
      toast.success("Booked! 🎉");
      await supabase.from("contacts").update({ status: "booked", booked_at: nowIso, current_follow_up: null, last_follow_up_at: null }).eq("id", contact.id);
    }
    fetchData(true);
  };

  const sendToFlywheel = async (contactId: string, reason: string) => {
    removeContactOptimistic(contactId);
    toast.success("Sent to flywheel (90 days)");

    const requeue = new Date(); requeue.setDate(requeue.getDate() + 90);
    await supabase.from("contacts").update({
      status: "flywheel", flywheel_reason: reason, negative_reply: reason === "negative",
      requeue_after: format(requeue, "yyyy-MM-dd"), current_follow_up: null, last_follow_up_at: null,
    }).eq("id", contactId);
    fetchData(true);
  };

  /* ─── Drag reorder ─── */
  const handleDragStart = (colKey: string) => { dragCol.current = colKey; };
  const handleDragOver = (e: React.DragEvent, colKey: string) => { e.preventDefault(); dragOverCol.current = colKey; };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (!dragCol.current || !dragOverCol.current || dragCol.current === dragOverCol.current) return;
    const newOrder = [...columnOrder];
    const from = newOrder.indexOf(dragCol.current);
    const to = newOrder.indexOf(dragOverCol.current);
    newOrder.splice(from, 1);
    newOrder.splice(to, 0, dragCol.current);
    setColumnOrder(newOrder);
    localStorage.setItem(COLUMN_ORDER_KEY, JSON.stringify(newOrder));
    dragCol.current = null; dragOverCol.current = null;
  };
  const handleDragEnd = () => { dragCol.current = null; dragOverCol.current = null; };

  /* ─── Derived ─── */
  const followUpsByLetter: Record<string, FollowUpContact[]> = {
    A: followUps.filter(f => f.current_follow_up?.endsWith("A")),
    B: followUps.filter(f => f.current_follow_up?.endsWith("B")),
    C: followUps.filter(f => f.current_follow_up?.endsWith("C")),
  };
  const totalFollowUpsDue = followUps.length;
  const totalPipeline = pipelineCounts.dmed + pipelineCounts.initiated + pipelineCounts.engaged + pipelineCounts.calendly + pipelineCounts.booked;

  // Only show columns that have contacts — empty ones are hidden, remaining ones expand
  const visibleColumns = columnOrder
    .map(key => ALL_COLUMNS.find(c => c.key === key)!)
    .filter(col => (followUpsByLetter[col.key] || []).length > 0);

  const pipelineStages = [
    { label: "DM'd", count: pipelineCounts.dmed, color: "bg-blue-100 text-blue-700", bar: "bg-blue-500" },
    { label: "Initiated", count: pipelineCounts.initiated, color: "bg-orange-100 text-orange-700", bar: "bg-orange-500" },
    { label: "Engaged", count: pipelineCounts.engaged, color: "bg-amber-100 text-amber-700", bar: "bg-amber-500" },
    { label: "Calendly", count: pipelineCounts.calendly, color: "bg-purple-100 text-purple-700", bar: "bg-purple-500" },
    { label: "Booked", count: pipelineCounts.booked, color: "bg-emerald-100 text-emerald-700", bar: "bg-emerald-500" },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[60vh]">
        <div className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
      </div>
    );
  }

  /* ─── Pull-to-refresh (mobile) ─── */
  const PullIndicator = () => (
    <div
      className="flex items-center justify-center transition-all duration-200 overflow-hidden pointer-events-none"
      style={{ height: pullDistance > 0 || refreshing ? `${Math.max(pullDistance, refreshing ? 40 : 0)}px` : "0px" }}
    >
      <RefreshCw
        className={`h-5 w-5 text-muted-foreground transition-transform ${refreshing ? "animate-spin" : ""}`}
        style={{ transform: `rotate(${pullDistance * 3}deg)`, opacity: Math.min(pullDistance / 60, 1) }}
      />
    </div>
  );

  return (
    <div ref={containerRef} className="space-y-6 pull-to-refresh -mt-2">
      <PullIndicator />
      {/* ── Header ── */}
      <div className="space-y-3">
        <div className="flex items-center gap-3 min-w-0">
          <span className="text-2xl leading-none">☀️</span>
          <div className="min-w-0">
            <h1 className="text-lg font-semibold tracking-tight text-foreground leading-none">
              Good morning
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {format(now, "EEEE, MMMM d")}
            </p>
          </div>
        </div>

        {/* Stat pills — horizontal scroll on mobile */}
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide pb-1 -mx-1 px-1">
          <button onClick={() => navigate("/actions")} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium notion-hover transition-all whitespace-nowrap shrink-0">
            <Users className="h-3 w-3 text-blue-500" strokeWidth={2} />
            <span className="text-foreground">{followCount.done}</span>
            <span className="text-muted-foreground">/ {followCount.total || 30}</span>
          </button>
          <button onClick={() => navigate("/actions")} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium notion-hover transition-all whitespace-nowrap shrink-0">
            <MessageSquare className="h-3 w-3 text-purple-500" strokeWidth={2} />
            <span className="text-foreground">{dmCount.done}</span>
            <span className="text-muted-foreground">/ {dmCount.total} DMs</span>
          </button>
          {totalFollowUpsDue > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium whitespace-nowrap shrink-0">
              <Clock className="h-3 w-3 text-amber-600" strokeWidth={2} />
              <span className="text-amber-700">{totalFollowUpsDue} due</span>
            </span>
          )}
          <button onClick={() => navigate("/pipeline")} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium notion-hover transition-all whitespace-nowrap shrink-0">
            <span className="text-foreground">{totalPipeline}</span>
            <span className="text-muted-foreground">pipeline</span>
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          </button>
        </div>
      </div>

      {/* ── Pipeline bar — scrollable on mobile ── */}
      <div className="rounded-lg border border-border overflow-hidden">
        <div className="flex divide-x divide-border bg-muted/30 overflow-x-auto scrollbar-hide">
          {pipelineStages.map((stage) => (
            <div key={stage.label} className="flex-1 min-w-[64px] px-2 py-2.5 text-center">
              <span className={`inline-flex items-center rounded px-1 py-0.5 text-[9px] sm:text-[10px] font-medium ${stage.color}`}>{stage.label}</span>
              <p className="mt-1 text-lg sm:text-xl font-bold tracking-tight">{stage.count}</p>
            </div>
          ))}
        </div>
        <div className="flex h-1.5">
          {pipelineStages.map((stage) => {
            const maxCount = Math.max(...pipelineStages.map(s => s.count), 1);
            const opacity = stage.count > 0 ? Math.max(0.2, stage.count / maxCount) : 0.05;
            return <div key={stage.label} className={`flex-1 ${stage.bar}`} style={{ opacity }} />;
          })}
        </div>
      </div>

      {/* ════════════════════════════════════════════════════════
          FOLLOW-UPS BOARD — takes up the full remaining space
          Only columns with contacts are shown; they expand to fill
         ════════════════════════════════════════════════════════ */}
      {totalFollowUpsDue > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Follow-ups — {totalFollowUpsDue} due
            </h2>
            {visibleColumns.length > 1 && (
              <span className="text-[10px] text-muted-foreground/60">drag to reorder</span>
            )}
          </div>

          <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
            {visibleColumns.map((col) => {
              const items = followUpsByLetter[col.key] || [];
              return (
                <div
                  key={col.key}
                  draggable={visibleColumns.length > 1}
                  onDragStart={() => handleDragStart(col.key)}
                  onDragOver={e => handleDragOver(e, col.key)}
                  onDrop={handleDrop}
                  onDragEnd={handleDragEnd}
                  className="group/col rounded-lg border border-border bg-muted/20 flex flex-col transition-shadow hover:shadow-sm"
                >
                  {/* Column header */}
                  <div className="flex items-center gap-2 px-4 py-3 border-b border-border cursor-grab active:cursor-grabbing select-none">
                    {visibleColumns.length > 1 && (
                      <GripVertical className="h-3.5 w-3.5 text-muted-foreground/30 opacity-0 group-hover/col:opacity-100 transition-opacity" />
                    )}
                    <span className={`h-2.5 w-2.5 rounded-full ${col.dotColor}`} />
                    <span className={`text-sm font-semibold ${col.color}`}>{col.label}</span>
                    <span className="ml-auto text-xs text-muted-foreground font-medium">{items.length}</span>
                  </div>

                  {/* Cards */}
                  <div className="flex-1 p-2 space-y-1.5 overflow-y-auto max-h-[calc(100vh-320px)] scrollbar-thin">
                    {items.map((contact) => (
                      <div key={contact.id} className="rounded-lg border border-border bg-card p-3 notion-hover group/card transition-all">
                        <div className="flex items-start gap-2.5">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium leading-tight truncate">{contact.full_name}</p>
                            <div className="flex items-center gap-1.5 mt-1">
                              {contact.username && <span className="text-xs text-muted-foreground">@{contact.username}</span>}
                              <span className="text-[10px] rounded bg-muted px-1.5 py-0.5 font-mono font-semibold text-muted-foreground">{contact.current_follow_up}</span>
                            </div>
                          </div>
                          <a href={contact.profile_link} target="_blank" rel="noopener noreferrer"
                            className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors opacity-0 group-hover/card:opacity-100">
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        </div>
                        {/* Actions */}
                        <div className="flex gap-1.5 mt-3 pt-2.5 border-t border-border">
                          <button
                            onClick={() => advanceFromFollowUp(contact)}
                            className="flex-1 rounded-md bg-foreground/5 px-2.5 py-1.5 text-[11px] font-semibold text-foreground hover:bg-foreground/10 active:scale-[0.97] transition-all"
                          >
                            Replied ✓
                          </button>
                          <button
                            onClick={() => markFollowUpSent(contact)}
                            className="flex-1 rounded-md bg-muted px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground hover:bg-foreground/10 hover:text-foreground active:scale-[0.97] transition-all"
                          >
                            Sent
                          </button>
                          <button
                            onClick={() => sendToFlywheel(contact.id, "negative")}
                            className="rounded-md bg-muted px-2 py-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive active:scale-[0.97] transition-all"
                            title="Negative → flywheel"
                          >
                            <ThumbsDown className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* All caught up */}
      {totalFollowUpsDue === 0 && (
        <div className="rounded-lg border border-dashed border-border py-12 text-center">
          <p className="text-sm text-muted-foreground">No follow-ups due right now — you're all caught up ✓</p>
        </div>
      )}

      {/* Flywheel — managed on Analytics page */}
    </div>
  );
};

export default Dashboard;
