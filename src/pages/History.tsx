import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, startOfMonth, endOfMonth, setMonth } from "date-fns";
import { ChevronDown, ChevronRight, RotateCcw } from "lucide-react";
import { toast } from "sonner";

type Contact = {
  id: string;
  full_name: string;
  username: string | null;
  status: string;
  followed_back: boolean;
  media_seen: boolean;
  followed_at: string | null;
  dmed_at: string | null;
  initiated_at: string | null;
  engaged_at: string | null;
  calendly_sent_at: string | null;
  booked_at: string | null;
  created_at: string;
};

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

const History = ({ userId }: { userId: string }) => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [flywheelCount, setFlywheelCount] = useState(0);
  const [metricView, setMetricView] = useState<"overall" | "stage">("overall");
  const [funnelOpen, setFunnelOpen] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [{ data }, { data: fwData }] = await Promise.all([
      supabase.from("contacts")
        .select("id, full_name, username, status, followed_back, media_seen, followed_at, dmed_at, initiated_at, engaged_at, calendly_sent_at, booked_at, created_at")
        .eq("user_id", userId).neq("status", "not_started"),
      supabase.from("contacts").select("id").eq("user_id", userId).eq("status", "flywheel"),
    ]);

    // Reconcile: fix contacts with downstream status but dmed_at = null
    const downstreamStatuses = ["dmed", "initiated", "engaged", "calendly_sent", "booked"];
    const missingDmedAt = (data || []).filter((c: any) => downstreamStatuses.includes(c.status) && !c.dmed_at);
    if (missingDmedAt.length > 0) {
      // Try to recover dates from completed DM queue entries
      const missingIds = missingDmedAt.map((c: any) => c.id);
      const { data: queueEntries } = await supabase
        .from("daily_queues").select("contact_id, completed_at, queue_date")
        .in("contact_id", missingIds).eq("queue_type", "dm").eq("completed", true);
      const queueMap: Record<string, string> = {};
      (queueEntries || []).forEach((q: any) => {
        if (!queueMap[q.contact_id]) queueMap[q.contact_id] = q.completed_at || q.queue_date;
      });
      for (const c of missingDmedAt as any[]) {
        // Use queue completed_at, or initiated_at (they were DMed before initiated), or now
        const recoveredDate = queueMap[c.id] || c.initiated_at || c.engaged_at || new Date().toISOString();
        await supabase.from("contacts").update({ dmed_at: recoveredDate }).eq("id", c.id);
        c.dmed_at = recoveredDate; // fix local data too
      }
    }

    setContacts((data as Contact[]) || []);
    setFlywheelCount((fwData || []).length);
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const monthlyMetrics = useMemo(() => {
    const year = new Date().getFullYear();
    const start = startOfMonth(setMonth(new Date(year, 0), selectedMonth));
    const end = endOfMonth(start);

    const inMonth = (dateStr: string | null) => {
      if (!dateStr) return false;
      const d = new Date(dateStr);
      return d >= start && d <= end;
    };

    // A1 cohort: contacts whose dmed_at falls in the selected month
    const a1Contacts = contacts.filter(c => inMonth(c.dmed_at));
    const a1 = a1Contacts.length;
    const ms = a1Contacts.filter(c => c.media_seen).length;
    const a2 = a1Contacts.filter(c => c.initiated_at).length;
    const b = a1Contacts.filter(c => c.engaged_at).length;
    const cCount = a1Contacts.filter(c => c.calendly_sent_at).length;
    const d = a1Contacts.filter(c => c.booked_at).length;

    // FBR: contacts whose followed_at falls in the selected month
    const followedContacts = contacts.filter(c => inMonth(c.followed_at));
    const totalFollowed = followedContacts.length;
    const followedBack = followedContacts.filter(c => c.followed_back).length;

    const pct = (num: number, den: number) => den ? ((num / den) * 100).toFixed(1) + "%" : "—";

    return {
      cards: [
        { label: "MSR", overall: pct(ms, a1), overallLabel: "÷A1", stage: pct(ms, a1), stageLabel: "→MS", raw: `${ms}/${a1}`, accent: "text-purple-500" },
        { label: "IR", overall: pct(a2, a1), overallLabel: "÷A1", stage: pct(a2, ms), stageLabel: "MS→A2", raw: `${a2}/${a1}`, accent: "text-primary" },
        { label: "PRR", overall: pct(b, a1), overallLabel: "÷A1", stage: pct(b, a2), stageLabel: "A2→B", raw: `${b}/${a1}`, accent: "text-orange-500" },
        { label: "CSR", overall: pct(cCount, a1), overallLabel: "÷A1", stage: pct(cCount, b), stageLabel: "B→C", raw: `${cCount}/${a1}`, accent: "text-yellow-500" },
        { label: "ABR", overall: pct(d, a1), overallLabel: "÷A1", stage: pct(d, cCount), stageLabel: "C→D", raw: `${d}/${a1}`, accent: "text-emerald-500" },
        { label: "FBR", overall: pct(followedBack, totalFollowed), overallLabel: "÷Fol", stage: pct(followedBack, totalFollowed), stageLabel: "→FB", raw: `${followedBack}/${totalFollowed}`, accent: "text-pink-500" },
      ],
      funnel: [
        { label: "Fol", count: totalFollowed },
        { label: "A1", count: a1 },
        { label: "MS", count: ms },
        { label: "A2", count: a2 },
        { label: "B", count: b },
        { label: "C", count: cCount },
        { label: "D", count: d },
      ],
    };
  }, [contacts, selectedMonth]);

  const funnelColors = [
    { bg: "bg-blue-500", text: "text-blue-500", light: "bg-blue-500/15" },
    { bg: "bg-indigo-500", text: "text-indigo-500", light: "bg-indigo-500/15" },
    { bg: "bg-purple-500", text: "text-purple-500", light: "bg-purple-500/15" },
    { bg: "bg-violet-500", text: "text-violet-500", light: "bg-violet-500/15" },
    { bg: "bg-orange-500", text: "text-orange-500", light: "bg-orange-500/15" },
    { bg: "bg-amber-500", text: "text-amber-500", light: "bg-amber-500/15" },
    { bg: "bg-emerald-500", text: "text-emerald-500", light: "bg-emerald-500/15" },
  ];

  const funnelMax = Math.max(...monthlyMetrics.funnel.map(s => s.count), 1);

  if (loading) return <div className="flex items-center justify-center py-20 text-muted-foreground">Loading...</div>;

  return (
    <div className="space-y-4 overflow-x-hidden max-w-full">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-lg font-semibold shrink-0">Analytics</h1>
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center rounded-full border border-border p-0.5">
            <button
              onClick={() => setMetricView("overall")}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-all ${
                metricView === "overall" ? "bg-foreground text-background" : "text-muted-foreground"
              }`}
            >
              Overall
            </button>
            <button
              onClick={() => setMetricView("stage")}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-all ${
                metricView === "stage" ? "bg-foreground text-background" : "text-muted-foreground"
              }`}
            >
              Stage
            </button>
          </div>
          <Select value={String(selectedMonth)} onValueChange={v => setSelectedMonth(parseInt(v))}>
            <SelectTrigger className="w-[100px] h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => (
                <SelectItem key={i} value={String(i)}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* ─── Conversion Rates (always visible) ─── */}
      <div className="grid grid-cols-3 gap-1.5">
        {monthlyMetrics.cards.map(m => (
          <div key={m.label} className="rounded-lg border border-border bg-card px-2 py-2 text-center">
            <p className={`text-[10px] font-semibold uppercase tracking-wide ${m.accent}`}>{m.label}</p>
            <p className="text-lg font-bold leading-tight mt-0.5">
              {metricView === "overall" ? m.overall : m.stage}
            </p>
          </div>
        ))}
      </div>

      {/* ─── Funnel Shutter ─── */}
      <button
        onClick={() => setFunnelOpen(!funnelOpen)}
        className="w-full flex items-center justify-center gap-1.5 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider hover:text-foreground transition-colors"
      >
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${funnelOpen ? "rotate-180" : ""}`} />
        Funnel
      </button>

      {funnelOpen && (
        <div className="rounded-lg border border-border bg-card p-3 space-y-1.5">
          {monthlyMetrics.funnel.map((step, i) => {
            const color = funnelColors[i];
            const widthPct = funnelMax > 0 ? Math.max((step.count / funnelMax) * 100, 8) : 8;
            return (
              <div key={step.label} className="flex items-center gap-2">
                <span className={`text-[11px] font-semibold w-6 text-right ${color.text}`}>{step.label}</span>
                <div className="flex-1 min-w-0">
                  <div
                    className={`${color.bg} rounded-full h-5 flex items-center justify-end pr-1.5 transition-all`}
                    style={{ width: `${widthPct}%`, minWidth: "28px" }}
                  >
                    <span className="text-[11px] font-bold text-white leading-none">{step.count}</span>
                  </div>
                </div>
              </div>
            );
          })}
          {/* Flywheel row */}
          <div className="flex items-center gap-2 pt-1 mt-1 border-t border-border/50">
            <span className="text-[11px] font-semibold w-6 text-right text-red-500">FW</span>
            <div className="flex-1 min-w-0">
              <div
                className="bg-red-500 rounded-full h-5 flex items-center justify-end pr-1.5 transition-all"
                style={{ width: `${funnelMax > 0 ? Math.max((flywheelCount / funnelMax) * 100, 8) : 8}%`, minWidth: "28px" }}
              >
                <span className="text-[11px] font-bold text-white leading-none">{flywheelCount}</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ─── Flywheel Management ─── */}
      <FlywheelSection userId={userId} />
    </div>
  );
};

/* ─── Recovery stage options ─── */
const RECOVER_STAGES = [
  { key: "dmed", label: "DM'd", follow_up: null, dateField: "dmed_at" },
  { key: "initiated", label: "Initiated", follow_up: "1A", dateField: "initiated_at" },
  { key: "engaged", label: "Engaged", follow_up: "1B", dateField: "engaged_at" },
  { key: "calendly_sent", label: "Calendly Sent", follow_up: "1C", dateField: "calendly_sent_at" },
  { key: "booked", label: "Booked", follow_up: null, dateField: "booked_at" },
];

type FWContact = { id: string; full_name: string; username: string | null; requeue_after: string };

const FlywheelSection = ({ userId }: { userId: string }) => {
  const today = format(new Date(), "yyyy-MM-dd");
  const [readyContacts, setReadyContacts] = useState<FWContact[]>([]);
  const [waitingContacts, setWaitingContacts] = useState<FWContact[]>([]);
  const [showWaiting, setShowWaiting] = useState(true);
  const [openPicker, setOpenPicker] = useState<string | null>(null);

  const fetchFlywheel = useCallback(async () => {
    const [readyRes, waitingRes] = await Promise.all([
      supabase.from("contacts").select("id, full_name, username, requeue_after")
        .eq("user_id", userId).eq("status", "flywheel").lte("requeue_after", today).order("requeue_after"),
      supabase.from("contacts").select("id, full_name, username, requeue_after")
        .eq("user_id", userId).eq("status", "flywheel").gt("requeue_after", today).order("requeue_after"),
    ]);
    setReadyContacts((readyRes.data as FWContact[]) || []);
    setWaitingContacts((waitingRes.data as FWContact[]) || []);
  }, [userId, today]);

  useEffect(() => { fetchFlywheel(); }, [fetchFlywheel]);

  const removeOptimistic = (contactId: string) => {
    setReadyContacts(prev => prev.filter(c => c.id !== contactId));
    setWaitingContacts(prev => prev.filter(c => c.id !== contactId));
    setOpenPicker(null);
  };

  const recoverToStage = async (contactId: string, stageKey: string) => {
    const stage = RECOVER_STAGES.find(s => s.key === stageKey)!;
    removeOptimistic(contactId);
    toast.success(`Recovered → ${stage.label}`);
    const nowIso = new Date().toISOString();
    const updates: Record<string, any> = {
      status: stageKey, requeue_after: null, negative_reply: false, flywheel_reason: null,
      current_follow_up: stage.follow_up,
      last_follow_up_at: stage.follow_up ? nowIso : null,
      [stage.dateField]: nowIso,
    };
    await supabase.from("contacts").update(updates).eq("id", contactId);
  };

  const reinitiate = async (contactId: string) => {
    removeOptimistic(contactId);
    toast.success("Re-initiated — back in follow queue");
    await supabase.from("contacts").update({
      status: "not_started", requeue_after: null, current_follow_up: null,
      last_follow_up_at: null, initiated_at: null, negative_reply: false,
      flywheel_reason: null, engaged_at: null, calendly_sent_at: null, booked_at: null,
    }).eq("id", contactId);
    // Clean up any existing queue entries for this contact, then insert into today's follow queue
    await supabase.from("daily_queues").delete().eq("contact_id", contactId).eq("completed", false);
    // Only insert if not already in today's follow queue
    const { data: existing } = await supabase.from("daily_queues").select("id")
      .eq("user_id", userId).eq("contact_id", contactId).eq("queue_date", today).eq("queue_type", "follow");
    if (!existing || existing.length === 0) {
      await supabase.from("daily_queues").insert({
        user_id: userId, contact_id: contactId, queue_date: today, queue_type: "follow",
      });
    }
  };

  const totalFlywheel = readyContacts.length + waitingContacts.length;

  const ContactRow = ({ c, showDaysLeft }: { c: FWContact; showDaysLeft?: boolean }) => {
    const isPickerOpen = openPicker === c.id;
    const daysLeft = c.requeue_after
      ? Math.max(0, Math.ceil((new Date(c.requeue_after).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))
      : 0;
    return (
      <div key={c.id} className="rounded-lg border border-border/40 bg-card p-3 space-y-2">
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{c.full_name}</p>
            {c.username && <p className="text-[11px] text-muted-foreground">@{c.username}</p>}
          </div>
          {showDaysLeft && (
            <span className="text-[10px] text-muted-foreground/60 tabular-nums shrink-0">{daysLeft}d left</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setOpenPicker(isPickerOpen ? null : c.id)}
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 rounded-md border border-primary/30 bg-primary/5 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 transition-colors">
            Move to stage
          </button>
          <button onClick={() => reinitiate(c.id)}
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1 rounded-md border border-border px-2 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
            title="Full reset — back to follow queue">
            <RotateCcw className="h-3 w-3" /> Reset
          </button>
        </div>
        {isPickerOpen && (
          <div className="flex flex-wrap gap-1.5 pt-1 border-t border-border/50">
            {RECOVER_STAGES.map(s => (
              <button key={s.key} onClick={() => recoverToStage(c.id, s.key)}
                className="rounded-md border border-border bg-secondary/60 px-2.5 py-1.5 text-[11px] font-medium text-foreground hover:bg-primary/10 hover:border-primary/30 hover:text-primary transition-all">
                {s.label}
              </button>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4 border-t border-border pt-5">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          🔄 Flywheel {totalFlywheel > 0 ? `— ${totalFlywheel} contacts` : ""}
        </h2>
      </div>

      {totalFlywheel === 0 && (
        <div className="rounded-lg border border-dashed border-border py-6 text-center">
          <p className="text-xs text-muted-foreground">No contacts in flywheel. When you send someone to flywheel from Pipeline, they’ll appear here.</p>
        </div>
      )}

      {/* Ready — 90 days passed */}
      {readyContacts.length > 0 && (
        <div className="space-y-2">
          <h3 className="text-[11px] font-semibold text-green-600 uppercase tracking-wider">
            {readyContacts.length} ready to re-initiate
          </h3>
          {readyContacts.map(c => <ContactRow key={c.id} c={c} />)}
        </div>
      )}

      {/* Waiting — still in 90-day cooldown */}
      {waitingContacts.length > 0 && (
        <div className="space-y-2">
          <button onClick={() => setShowWaiting(!showWaiting)}
            className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/60 hover:text-muted-foreground transition-colors">
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${showWaiting ? "rotate-90" : ""}`} />
            Waiting — {waitingContacts.length} contacts
          </button>
          {showWaiting && (
            <div className="space-y-2 ml-5">
              {waitingContacts.map(c => <ContactRow key={c.id} c={c} showDaysLeft />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default History;
