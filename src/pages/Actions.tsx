import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { ExternalLink, Copy, Zap, X, ThumbsDown, Clock, ChevronRight, RotateCcw } from "lucide-react";
import { toast } from "sonner";
import { format, subDays, previousFriday } from "date-fns";

type Contact = {
  id: string;
  full_name: string;
  username: string | null;
  profile_link: string;
  biography: string | null;
};

type QueueItem = {
  id: string;
  contact_id: string;
  completed: boolean;
  queue_type: string;
  contacts: Contact;
};

type Opener = {
  contact_id: string;
  opener_text: string;
};

type FollowUpContact = {
  id: string;
  full_name: string;
  username: string | null;
  profile_link: string;
  current_follow_up: string;
  last_follow_up_at: string;
  status: string;
};

const FOLLOW_LIMIT = 30;
const DM_LIMIT = 30;

const dayOfWeek = (d: Date) => d.getDay();
const isWeekday = (d: Date) => { const dow = dayOfWeek(d); return dow >= 1 && dow <= 5; };

const getPreviousWeekday = (d: Date): string => {
  const dow = dayOfWeek(d);
  if (dow === 1) return format(previousFriday(d), "yyyy-MM-dd");
  return format(subDays(d, 1), "yyyy-MM-dd");
};

const Actions = ({ userId }: { userId: string }) => {
  const [followQueue, setFollowQueue] = useState<QueueItem[]>([]);
  const [dmQueue, setDmQueue] = useState<QueueItem[]>([]);
  const [openers, setOpeners] = useState<Record<string, string>>({});
  const [followUps, setFollowUps] = useState<FollowUpContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [activeTab, setActiveTab] = useState<"follow" | "dm">("follow");
  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollKey = "actions-scroll-pos";

  const now = new Date();
  const today = format(now, "yyyy-MM-dd");
  const isWeekdayToday = isWeekday(now);

  const saveScroll = () => {
    if (scrollRef.current) sessionStorage.setItem(scrollKey, String(scrollRef.current.scrollTop));
  };
  const restoreScroll = () => {
    const saved = sessionStorage.getItem(scrollKey);
    if (saved && scrollRef.current) scrollRef.current.scrollTop = parseInt(saved, 10);
  };

  const fetchData = useCallback(async () => {
    setLoading(true);
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [followRes, dmRes, openersRes, followUpsRes] = await Promise.all([
      supabase
        .from("daily_queues")
        .select("id, contact_id, completed, queue_type, contacts(id, full_name, username, profile_link, biography)")
        .eq("user_id", userId).eq("queue_date", today).eq("queue_type", "follow").order("created_at"),
      supabase
        .from("daily_queues")
        .select("id, contact_id, completed, queue_type, contacts(id, full_name, username, profile_link, biography)")
        .eq("user_id", userId).eq("queue_date", today).eq("queue_type", "dm").order("created_at"),
      supabase.from("openers").select("contact_id, opener_text").eq("user_id", userId),
      supabase
        .from("contacts")
        .select("id, full_name, username, profile_link, current_follow_up, last_follow_up_at, status")
        .eq("user_id", userId)
        .not("current_follow_up", "is", null)
        .lte("last_follow_up_at", twentyFourHoursAgo)
        .in("status", ["initiated", "engaged", "calendly_sent"])
        .order("last_follow_up_at"),
    ]);

    const dmData = (dmRes.data as QueueItem[]) || [];
    setFollowQueue((followRes.data as any) || []);
    setDmQueue(dmData);
    const openerMap: Record<string, string> = {};
    (openersRes.data || []).forEach((o: Opener) => { openerMap[o.contact_id] = o.opener_text; });
    setOpeners(openerMap);
    setFollowUps((followUpsRes.data as FollowUpContact[]) || []);

    // Reconcile: fix any completed DM queue items whose contacts aren't marked 'dmed'
    const completedDmIds = dmData.filter(q => q.completed).map(q => q.contact_id);
    if (completedDmIds.length > 0) {
      const { data: dmedContacts } = await supabase
        .from("contacts")
        .select("id, status")
        .in("id", completedDmIds)
        .neq("status", "dmed");
      const needsFix = (dmedContacts || []).filter(c => c.status === "followed" || c.status === "not_started");
      for (const c of needsFix) {
        await supabase.from("contacts").update({ status: "dmed", dmed_at: new Date().toISOString() }).eq("id", c.id);
      }
    }

    setLoading(false);
    requestAnimationFrame(() => restoreScroll());
  }, [userId, today]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") saveScroll();
      else if (document.visibilityState === "visible") fetchData();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [fetchData]);

  const sortedFollowQueue = useMemo(() => [...followQueue].sort((a, b) => Number(a.completed) - Number(b.completed)), [followQueue]);
  const sortedDmQueue = useMemo(() => [...dmQueue].sort((a, b) => Number(a.completed) - Number(b.completed)), [dmQueue]);

  const toggleComplete = async (queueId: string, completed: boolean, queueType: string, contactId: string) => {
    if (!isWeekdayToday) return;
    saveScroll();
    const nowIso = new Date().toISOString();

    // Optimistic update
    if (queueType === "follow") {
      setFollowQueue(prev => prev.map(item => item.id === queueId ? { ...item, completed: !completed } : item));
    } else {
      setDmQueue(prev => prev.map(item => item.id === queueId ? { ...item, completed: !completed } : item));
    }

    const { error: queueErr } = await supabase.from("daily_queues").update({ completed: !completed, completed_at: !completed ? nowIso : null }).eq("id", queueId);
    if (queueErr) {
      toast.error(`Queue update failed: ${queueErr.message}`);
      // Rollback optimistic update
      if (queueType === "follow") {
        setFollowQueue(prev => prev.map(item => item.id === queueId ? { ...item, completed } : item));
      } else {
        setDmQueue(prev => prev.map(item => item.id === queueId ? { ...item, completed } : item));
      }
      return;
    }

    const contactUpdate = queueType === "follow"
      ? { status: !completed ? "followed" : "not_started", followed_at: !completed ? nowIso : null }
      : { status: !completed ? "dmed" : "followed", dmed_at: !completed ? nowIso : null };
    const { error: contactErr } = await supabase.from("contacts").update(contactUpdate).eq("id", contactId);
    if (contactErr) {
      toast.error(`Contact update failed: ${contactErr.message}`);
    }
    fetchData();
  };

  const handleProfileClick = (item: QueueItem) => {
    if (!isWeekdayToday) return;
    if (!item.completed) toggleComplete(item.id, item.completed, item.queue_type, item.contact_id);
  };

  const removeFromQueue = async (queueId: string, contactId: string, queueType: string) => {
    if (!isWeekdayToday) return;
    const confirmed = window.confirm("Remove this contact from the queue and delete them permanently?");
    if (!confirmed) return;
    saveScroll();

    // Optimistic removal
    if (queueType === "follow") {
      setFollowQueue(prev => prev.filter(item => item.id !== queueId));
    } else {
      setDmQueue(prev => prev.filter(item => item.id !== queueId));
    }

    await supabase.from("openers").delete().eq("contact_id", contactId);
    await supabase.from("daily_queues").delete().eq("contact_id", contactId);
    await supabase.from("contacts").delete().eq("id", contactId);

    if (queueType === "follow") {
      const { data: currentQueue } = await supabase
        .from("daily_queues").select("contact_id").eq("user_id", userId).eq("queue_date", today).eq("queue_type", "follow");
      const existingIds = new Set((currentQueue || []).map(q => q.contact_id));
      existingIds.add(contactId);
      const { data: replacement } = await supabase.from("contacts").select("id").eq("user_id", userId).eq("status", "not_started").limit(50);
      const available = (replacement || []).filter(c => !existingIds.has(c.id));
      if (available.length > 0) {
        await supabase.from("daily_queues").insert({ user_id: userId, contact_id: available[0].id, queue_date: today, queue_type: "follow" });
      }
    }
    toast.success("Removed & replaced");
    fetchData();
  };

  const autoQueue = async () => {
    if (!isWeekdayToday) return;

    const { data: existing } = await supabase
      .from("daily_queues").select("id, contact_id").eq("user_id", userId).eq("queue_date", today).eq("queue_type", "follow");
    const existingCount = existing?.length || 0;

    if (existingCount > FOLLOW_LIMIT) {
      const excess = existing!.slice(FOLLOW_LIMIT);
      await supabase.from("daily_queues").delete().in("id", excess.map(e => e.id));
      toast.info(`Trimmed queue to ${FOLLOW_LIMIT}`);
    } else if (existingCount < FOLLOW_LIMIT) {
      const needed = FOLLOW_LIMIT - existingCount;
      const existingIds = new Set((existing || []).map(q => q.contact_id));
      const { data: unfollowed } = await supabase.from("contacts").select("id").eq("user_id", userId).eq("status", "not_started").limit(needed + 20);
      const available = (unfollowed || []).filter(c => !existingIds.has(c.id)).slice(0, needed);
      if (available.length > 0) {
        await supabase.from("daily_queues").insert(available.map(c => ({ user_id: userId, contact_id: c.id, queue_date: today, queue_type: "follow" as const })));
        toast.success(`Added ${available.length} to follow queue`);
      } else {
        toast.info("No more unfollowed contacts available.");
      }
    } else {
      toast.info(`Already have ${FOLLOW_LIMIT} in today's follow queue.`);
    }

    const { data: unsentDms } = await supabase
      .from("daily_queues").select("contact_id, queue_date").eq("user_id", userId).eq("queue_type", "dm").eq("completed", false).lt("queue_date", today).order("queue_date", { ascending: true });
    const prevWeekday = getPreviousWeekday(now);
    const { data: yesterdayFollowed } = await supabase
      .from("daily_queues").select("contact_id").eq("user_id", userId).eq("queue_date", prevWeekday).eq("queue_type", "follow").eq("completed", true);
    const { data: existingDms } = await supabase
      .from("daily_queues").select("contact_id").eq("user_id", userId).eq("queue_date", today).eq("queue_type", "dm");

    const existingDmIds = new Set((existingDms || []).map(q => q.contact_id));
    const carryoverContactIds = (unsentDms || []).map(d => d.contact_id).filter(id => !existingDmIds.has(id));
    const newFollowContactIds = (yesterdayFollowed || []).map(f => f.contact_id).filter(id => !existingDmIds.has(id) && !carryoverContactIds.includes(id));
    const allNewDmContactIds = [...carryoverContactIds, ...newFollowContactIds].slice(0, DM_LIMIT - (existingDms?.length || 0));

    if (allNewDmContactIds.length > 0) {
      await supabase.from("daily_queues").insert(allNewDmContactIds.map(contactId => ({ user_id: userId, contact_id: contactId, queue_date: today, queue_type: "dm" as const })));
    }

    if (unsentDms && unsentDms.length > 0) {
      const carriedOverIds = carryoverContactIds.slice(0, allNewDmContactIds.length);
      if (carriedOverIds.length > 0) {
        await supabase.from("daily_queues").delete().eq("user_id", userId).eq("queue_type", "dm").eq("completed", false).lt("queue_date", today).in("contact_id", carriedOverIds);
      }
    }

    fetchData();
  };

  const generateOpeners = async () => {
    if (!isWeekdayToday) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/generate-openers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed to generate openers");
      toast.success(data?.message || "Openers generated!");
      fetchData();
    } catch (err: any) {
      toast.error(err.message || "Failed to generate openers");
    } finally {
      setGenerating(false);
    }
  };

  const copyOpener = (text: string) => { navigator.clipboard.writeText(text); toast.success("Copied!"); };

  const markFollowUpSent = async (contact: FollowUpContact) => {
    // Optimistic removal
    setFollowUps(prev => prev.filter(f => f.id !== contact.id));

    const nowIso = new Date().toISOString();
    const fu = contact.current_follow_up;
    const letter = fu.slice(-1);
    const num = parseInt(fu.slice(0, -1));

    const maxA = 1, maxB = 8, maxC = 8;

    if (letter === "A" && num >= maxA) {
      await sendToFlywheel(contact.id, "no_reply_1a");
    } else if (letter === "B" && num >= maxB) {
      await sendToFlywheel(contact.id, "no_reply_8b");
    } else if (letter === "C" && num >= maxC) {
      await sendToFlywheel(contact.id, "no_reply_8c");
    } else {
      const nextNum = num + 1;
      const nextFu = `${nextNum}${letter}`;
      await supabase.from("contacts").update({
        current_follow_up: nextFu,
        last_follow_up_at: nowIso,
      }).eq("id", contact.id);
    }

    toast.success(`Follow-up ${fu} sent`);
    fetchData();
  };

  const advanceFromFollowUp = async (contact: FollowUpContact) => {
    setFollowUps(prev => prev.filter(f => f.id !== contact.id));

    const nowIso = new Date().toISOString();
    const letter = contact.current_follow_up.slice(-1);

    if (letter === "A") {
      await supabase.from("contacts").update({
        status: "engaged",
        engaged_at: nowIso,
        current_follow_up: "1B",
        last_follow_up_at: nowIso,
      }).eq("id", contact.id);
      toast.success("Moved to Engaged");
    } else if (letter === "B") {
      await supabase.from("contacts").update({
        status: "calendly_sent",
        calendly_sent_at: nowIso,
        current_follow_up: "1C",
        last_follow_up_at: nowIso,
      }).eq("id", contact.id);
      toast.success("Moved to Calendly");
    } else if (letter === "C") {
      await supabase.from("contacts").update({
        status: "booked",
        booked_at: nowIso,
        current_follow_up: null,
        last_follow_up_at: null,
      }).eq("id", contact.id);
      toast.success("Booked!");
    }
    fetchData();
  };

  const sendToFlywheel = async (contactId: string, reason: string) => {
    const requeue = new Date();
    requeue.setDate(requeue.getDate() + 90);
    await supabase.from("contacts").update({
      status: "flywheel",
      flywheel_reason: reason,
      negative_reply: reason === "negative",
      requeue_after: format(requeue, "yyyy-MM-dd"),
      current_follow_up: null,
      last_follow_up_at: null,
    }).eq("id", contactId);
    toast.success("Sent to flywheel (90 days)");
    fetchData();
  };

  const negativeReply = async (contactId: string) => {
    setFollowUps(prev => prev.filter(f => f.id !== contactId));
    await sendToFlywheel(contactId, "negative");
  };

  const followCompleted = followQueue.filter(q => q.completed).length;
  const dmCompleted = dmQueue.filter(q => q.completed).length;
  const dmTotal = dmQueue.length;

  const followUpsA = followUps.filter(f => f.current_follow_up?.endsWith("A"));
  const followUpsB = followUps.filter(f => f.current_follow_up?.endsWith("B"));
  const followUpsC = followUps.filter(f => f.current_follow_up?.endsWith("C"));

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground">Loading...</div>;
  }

  return (
    <div
      ref={scrollRef}
      className="h-[calc(100vh-5rem)] md:h-[calc(100vh-2rem)] overflow-y-auto overflow-x-hidden scrollbar-hide pb-4"
      onScroll={saveScroll}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold md:text-2xl">Daily Actions</h1>
          <p className="text-sm text-muted-foreground">{format(now, "EEEE, MMM d")}</p>
        </div>
        <div className="flex gap-2">
          {followQueue.length === 0 && (
            <Button variant="outline" size="sm" onClick={autoQueue}>Load Queue</Button>
          )}
          <Button size="sm" onClick={generateOpeners} disabled={generating}>
            <Zap className="mr-1 h-3.5 w-3.5" />
            <span className="hidden sm:inline">{generating ? "..." : "Openers"}</span>
          </Button>
        </div>
      </div>

      {/* Section header with toggle */}
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {activeTab === "follow"
            ? `Follow (${followCompleted}/${FOLLOW_LIMIT})`
            : `DM (${dmCompleted}/${dmTotal})`}
        </h2>
        <div className="inline-flex items-center rounded-full border border-border p-0.5">
          <button
            onClick={() => setActiveTab("follow")}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
              activeTab === "follow"
                ? "bg-foreground text-background"
                : "text-muted-foreground"
            }`}
          >
            Follow
          </button>
          <button
            onClick={() => setActiveTab("dm")}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-all ${
              activeTab === "dm"
                ? "bg-foreground text-background"
                : "text-muted-foreground"
            }`}
          >
            DM
          </button>
        </div>
      </div>

      <Progress
        value={activeTab === "follow" ? (followCompleted / FOLLOW_LIMIT) * 100 : (dmTotal ? (dmCompleted / dmTotal) * 100 : 0)}
        className="h-2 mb-3"
      />

      {/* Follow Queue */}
      {activeTab === "follow" && (
        <div className="space-y-2">
          {followQueue.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">No follows queued. Hit "Load Queue" to start.</p>
          )}
          {sortedFollowQueue.map((item) => (
            <div
              key={item.id}
              className={`flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-3 transition-all ${
                item.completed ? "opacity-50" : ""
              }`}
            >
              <Checkbox
                checked={item.completed}
                onCheckedChange={() => toggleComplete(item.id, item.completed, "follow", item.contact_id)}
                className="h-5 w-5 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-medium ${item.completed ? "line-through" : ""}`}>
                  {item.contacts?.full_name || "Unknown"}
                </p>
                {item.contacts?.username && (
                  <p className="text-xs text-muted-foreground">@{item.contacts.username}</p>
                )}
              </div>
              {!item.completed && (
                <button
                  onClick={() => removeFromQueue(item.id, item.contact_id, "follow")}
                  className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-destructive/20 hover:text-destructive transition-colors"
                  title="Remove"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
              <a
                href={item.contacts?.profile_link}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => handleProfileClick(item)}
                className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
              >
                <ExternalLink className="h-4 w-4" />
              </a>
            </div>
          ))}
        </div>
      )}

      {/* DM Queue */}
      {activeTab === "dm" && (
        <div className="space-y-2">
          {dmQueue.length === 0 && (
            <p className="py-8 text-center text-sm text-muted-foreground">No DMs queued. Yesterday's completed follows will appear here.</p>
          )}
          {sortedDmQueue.map((item) => {
            const opener = openers[item.contact_id];
            return (
              <div
                key={item.id}
                className={`rounded-lg border border-border bg-card px-3 py-3 transition-all ${
                  item.completed ? "opacity-50" : ""
                }`}
              >
                <div className="flex items-center gap-3">
                  <Checkbox
                    checked={item.completed}
                    onCheckedChange={() => toggleComplete(item.id, item.completed, "dm", item.contact_id)}
                    className="h-5 w-5 shrink-0"
                  />
                  <div className="min-w-0 flex-1">
                    <p className={`text-sm font-medium ${item.completed ? "line-through" : ""}`}>
                      {item.contacts?.full_name || "Unknown"}
                    </p>
                    {item.contacts?.username && (
                      <p className="text-xs text-muted-foreground">@{item.contacts.username}</p>
                    )}
                  </div>
                  <a
                    href={item.contacts?.profile_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={() => handleProfileClick(item)}
                    className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                </div>
                {opener && !item.completed && (
                  <div className="mt-2 ml-8 flex items-center gap-2">
                    <p className="flex-1 min-w-0 rounded-md bg-secondary px-3 py-2 text-sm text-secondary-foreground break-words">
                      {opener}
                    </p>
                    <button
                      onClick={() => copyOpener(opener)}
                      className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Follow-ups Due Section */}
      {(followUpsA.length > 0 || followUpsB.length > 0 || followUpsC.length > 0) && (
        <section className="mt-6 space-y-3 border-t border-border pt-4">
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
              Follow-ups Due ({followUps.length})
            </h2>
          </div>

          {[
            { label: "Trojan Horse (A)", items: followUpsA, color: "text-orange-500", dotColor: "bg-orange-500" },
            { label: "VSL (B)", items: followUpsB, color: "text-yellow-500", dotColor: "bg-yellow-500" },
            { label: "Calendly (C)", items: followUpsC, color: "text-blue-500", dotColor: "bg-blue-500" },
          ].map(({ label, items, color, dotColor }) =>
            items.length > 0 ? (
              <div key={label} className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${dotColor}`} />
                  <p className={`text-xs font-medium ${color}`}>{label} ({items.length})</p>
                </div>
                {items.map((contact) => (
                  <div key={contact.id} className="rounded-lg border border-border bg-card px-3 py-3 space-y-2">
                    <div className="flex items-center gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-medium">{contact.full_name}</p>
                          <span className="text-[10px] rounded-md bg-primary/10 text-primary px-1.5 py-0.5 font-medium shrink-0">{contact.current_follow_up}</span>
                        </div>
                        {contact.username && <p className="text-xs text-muted-foreground">@{contact.username}</p>}
                      </div>
                      <a href={contact.profile_link} target="_blank" rel="noopener noreferrer" className="shrink-0 rounded-md p-2 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors">
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </div>
                    <div className="flex gap-1.5 items-center">
                      <Button size="sm" variant="outline" className="h-7 text-xs px-2.5 gap-1 flex-1 sm:flex-none" onClick={() => advanceFromFollowUp(contact)}>
                        <ChevronRight className="h-3 w-3" /> Replied
                      </Button>
                      <Button size="sm" variant="secondary" className="h-7 text-xs px-2.5 flex-1 sm:flex-none" onClick={() => markFollowUpSent(contact)}>
                        Sent
                      </Button>
                      <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:bg-destructive/10 shrink-0" onClick={() => negativeReply(contact.id)} title="Negative reply → Flywheel">
                        <ThumbsDown className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null
          )}
        </section>
      )}
    </div>
  );
};

export default Actions;
