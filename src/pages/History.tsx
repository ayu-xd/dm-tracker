import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { format, startOfMonth, endOfMonth, setMonth } from "date-fns";
import { BarChart3, ArrowRight, ChevronRight, RefreshCw, RotateCcw } from "lucide-react";
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

  const fetchAll = useCallback(async () => {
    setLoading(true);
    const [{ data }, { data: fwData }] = await Promise.all([
      supabase.from("contacts")
        .select("id, full_name, username, status, followed_back, media_seen, followed_at, dmed_at, initiated_at, engaged_at, calendly_sent_at, booked_at, created_at")
        .eq("user_id", userId).neq("status", "not_started"),
      supabase.from("contacts").select("id").eq("user_id", userId).eq("status", "flywheel"),
    ]);
    setContacts((data as Contact[]) || []);
    setFlywheelCount((fwData || []).length);
    setLoading(false);
  }, [userId]);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const metrics = useMemo(() => {
    const totalFollowed = contacts.filter(c => c.followed_at).length;
    const a1 = contacts.filter(c => c.dmed_at).length;           // A1 = text DM sent
    const ms = contacts.filter(c => c.media_seen).length;        // MS = they saw your media
    const a2 = contacts.filter(c => c.initiated_at).length;      // A2 = video sent
    const b  = contacts.filter(c => c.engaged_at).length;        // B  = positive reply
    const c  = contacts.filter(c => c.calendly_sent_at).length;  // C  = calendly sent
    const d  = contacts.filter(c => c.booked_at).length;         // D  = booked
    const followedBack = contacts.filter(ct => ct.followed_back).length;

    return [
      { label: "MSR", desc: "Media Seen Rate", formula: "MS ÷ A1", value: a1 ? ((ms / a1) * 100).toFixed(1) + "%" : "—", sub: `${ms} / ${a1}`, accent: "text-purple-500" },
      { label: "IR",  desc: "Initiation Rate", formula: "A2 ÷ MS", value: ms ? ((a2 / ms) * 100).toFixed(1) + "%" : "—", sub: `${a2} / ${ms}`, accent: "text-primary" },
      { label: "PRR", desc: "Positive Reply Rate", formula: "B ÷ A2", value: a2 ? ((b / a2) * 100).toFixed(1) + "%" : "—", sub: `${b} / ${a2}`, accent: "text-orange-500" },
      { label: "CSR", desc: "Calendly Send Rate", formula: "C ÷ B", value: b ? ((c / b) * 100).toFixed(1) + "%" : "—", sub: `${c} / ${b}`, accent: "text-yellow-500" },
      { label: "ABR", desc: "Appointment Book Rate", formula: "D ÷ C", value: c ? ((d / c) * 100).toFixed(1) + "%" : "—", sub: `${d} / ${c}`, accent: "text-emerald-500" },
      { label: "FBR", desc: "Follow-Back Rate", formula: "FB ÷ Followed", value: totalFollowed ? ((followedBack / totalFollowed) * 100).toFixed(1) + "%" : "—", sub: `${followedBack} / ${totalFollowed}`, accent: "text-pink-500" },
      { label: "FW",  desc: "In Flywheel", formula: "", value: String(flywheelCount), sub: "90-day re-queue", accent: "text-destructive" },
    ];
  }, [contacts, flywheelCount]);

  const monthlyCohort = useMemo(() => {
    const year = new Date().getFullYear();
    const start = startOfMonth(setMonth(new Date(year, 0), selectedMonth));
    const end = endOfMonth(start);
    const cohort = contacts.filter(c => { const d = new Date(c.followed_at || c.created_at); return d >= start && d <= end; });
    return {
      cohort,
      summary: {
        followed: cohort.filter(c => c.followed_at).length,
        dmed: cohort.filter(c => c.dmed_at).length,
        mediaSeen: cohort.filter(c => c.media_seen).length,
        initiated: cohort.filter(c => c.initiated_at).length,
        engaged: cohort.filter(c => c.engaged_at).length,
        calendlySent: cohort.filter(c => c.calendly_sent_at).length,
        booked: cohort.filter(c => c.booked_at).length,
      },
    };
  }, [contacts, selectedMonth]);

  if (loading) return <div className="flex items-center justify-center py-20 text-muted-foreground">Loading...</div>;

  const statusColor = (s: string) =>
    s === "booked" ? "bg-emerald-500/15 text-emerald-500"
    : s === "calendly_sent" ? "bg-blue-500/15 text-blue-500"
    : s === "engaged" ? "bg-yellow-500/15 text-yellow-600"
    : s === "initiated" ? "bg-orange-500/15 text-orange-500"
    : s === "dmed" ? "bg-primary/15 text-primary"
    : s === "flywheel" ? "bg-destructive/15 text-destructive"
    : "bg-secondary text-secondary-foreground";

  const funnelSteps = [
    { label: "Followed", count: monthlyCohort.summary.followed },
    { label: "A1 (DM)", count: monthlyCohort.summary.dmed },
    { label: "MS", count: monthlyCohort.summary.mediaSeen },
    { label: "A2 (Video)", count: monthlyCohort.summary.initiated },
    { label: "B (Reply)", count: monthlyCohort.summary.engaged },
    { label: "C (Cal.)", count: monthlyCohort.summary.calendlySent },
    { label: "D (Book)", count: monthlyCohort.summary.booked },
  ];

  return (
    <div className="space-y-5 overflow-x-hidden">
      {/* Header */}
      <div className="flex items-center gap-3">
        <BarChart3 className="h-5 w-5 text-primary shrink-0" />
        <div className="min-w-0">
          <h1 className="text-lg font-semibold">Analytics</h1>
          <p className="text-xs text-muted-foreground">Stage-to-stage conversion</p>
        </div>
      </div>

      {/* Metrics grid */}
      <div className="grid grid-cols-2 gap-1.5 md:grid-cols-4 md:gap-2">
        {metrics.map(m => (
          <div key={m.label} className="rounded-lg border border-border bg-card px-2.5 py-2 space-y-0.5">
            <div className="flex items-baseline justify-between gap-1">
              <p className="text-lg font-bold tracking-tight leading-tight">{m.value}</p>
              <span className={`text-[9px] font-semibold ${m.accent}`}>{m.label}</span>
            </div>
            <p className="text-[10px] text-muted-foreground leading-tight">{m.desc}</p>
            <p className="text-[9px] text-muted-foreground/60">{m.sub}</p>
            {m.formula && <p className="text-[8px] text-muted-foreground/40 font-mono">{m.formula}</p>}
          </div>
        ))}
      </div>

      {/* Monthly Cohort */}
      <div className="space-y-4 border-t border-border pt-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider shrink-0">Monthly Cohort</h2>
          <Select value={String(selectedMonth)} onValueChange={v => setSelectedMonth(parseInt(v))}>
            <SelectTrigger className="w-[130px] h-7 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => (
                <SelectItem key={i} value={String(i)}>{m}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Funnel visualization — wraps on mobile */}
        <div className="flex flex-wrap items-center gap-1 pb-1">
          {funnelSteps.map((step, i) => (
            <div key={step.label} className="flex items-center gap-1">
              <div className={`rounded-md px-2 py-1 text-center ${
                step.label === "D (Book)" ? "bg-primary/10 text-primary" : "bg-secondary"
              }`}>
                <p className="text-base font-bold leading-tight">{step.count}</p>
                <p className="text-[9px] text-muted-foreground whitespace-nowrap">{step.label}</p>
              </div>
              {i < funnelSteps.length - 1 && (
                <ArrowRight className="h-2.5 w-2.5 text-muted-foreground/40 shrink-0" />
              )}
            </div>
          ))}
        </div>

        {/* Cohort contact list */}
        <div className="space-y-1">
          {monthlyCohort.cohort.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">No contacts in {MONTHS[selectedMonth]}</p>
          ) : (
            monthlyCohort.cohort.map(c => (
              <div key={c.id} className="flex items-center gap-3 rounded-lg bg-card border border-border/40 px-3 py-2 hover:border-primary/20 transition-colors">
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium truncate">{c.full_name}</p>
                  {c.username && <p className="text-[11px] text-muted-foreground">@{c.username}</p>}
                </div>
                <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${statusColor(c.status)}`}>
                  {c.status.replace("_", " ")}
                </span>
              </div>
            ))
          )}
        </div>
      </div>

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
    await supabase.from("daily_queues").insert({
      user_id: userId, contact_id: contactId, queue_date: today, queue_type: "follow",
    });
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
