import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ExternalLink, ChevronRight, RotateCcw, ThumbsDown, Check, Eye, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { format, differenceInDays } from "date-fns";

type PipelineContact = {
  id: string;
  full_name: string;
  username: string | null;
  profile_link: string;
  status: string;
  media_seen: boolean;
  current_follow_up: string | null;
  last_follow_up_at: string | null;
  a2_notes: string;
  b_notes: string;
  dmed_at: string | null;
  initiated_at: string | null;
  engaged_at: string | null;
  calendly_sent_at: string | null;
  booked_at: string | null;
};

const STAGES = [
  { key: "dmed", label: "DM'd", color: "text-primary", dotColor: "bg-primary", tsField: "dmed_at" },
  { key: "initiated", label: "Initiated", color: "text-orange-400", dotColor: "bg-orange-400", tsField: "initiated_at" },
  { key: "engaged", label: "Engaged", color: "text-yellow-400", dotColor: "bg-yellow-400", tsField: "engaged_at" },
  { key: "calendly_sent", label: "Calendly", color: "text-blue-400", dotColor: "bg-blue-400", tsField: "calendly_sent_at" },
  { key: "booked", label: "Booked", color: "text-emerald-400", dotColor: "bg-emerald-400", tsField: "booked_at" },
];

const Pipeline = ({ userId }: { userId: string }) => {
  const [contacts, setContacts] = useState<PipelineContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedContact, setSelectedContact] = useState<PipelineContact | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [openerText, setOpenerText] = useState("");
  const [a2Notes, setA2Notes] = useState("");
  const [bNotes, setBNotes] = useState("");
  const [stageSearch, setStageSearch] = useState<Record<string, string>>({});

  const fetchContacts = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const { data, error } = await supabase
      .from("contacts")
      .select("id, full_name, username, profile_link, status, media_seen, current_follow_up, last_follow_up_at, a2_notes, b_notes, dmed_at, initiated_at, engaged_at, calendly_sent_at, booked_at")
      .eq("user_id", userId)
      .in("status", ["dmed", "initiated", "engaged", "calendly_sent", "booked"])
      .order("dmed_at", { ascending: true });

    if (error) toast.error(error.message);
    setContacts((data as PipelineContact[]) || []);
    if (!silent) setLoading(false);
  }, [userId]);

  useEffect(() => { fetchContacts(); }, [fetchContacts]);

  const contactsByStage = (stage: string) => {
    const q = (stageSearch[stage] || "").toLowerCase().trim();
    return contacts.filter(c => c.status === stage && (!q || c.full_name.toLowerCase().includes(q) || (c.username || "").toLowerCase().includes(q)));
  };

  /* Ghost contacts: passed through this stage but are now in a later stage */
  const stageTimestampField = (stageKey: string): keyof PipelineContact | null => {
    const s = STAGES.find(s => s.key === stageKey);
    return s ? s.tsField as keyof PipelineContact : null;
  };

  const ghostContactsForStage = (stageKey: string) => {
    const tsField = stageTimestampField(stageKey);
    if (!tsField) return [];
    const q = (stageSearch[stageKey] || "").toLowerCase().trim();
    return contacts.filter(c =>
      c.status !== stageKey &&         // not currently in this stage
      c[tsField] != null &&            // has passed through this stage
      (!q || c.full_name.toLowerCase().includes(q) || (c.username || "").toLowerCase().includes(q))
    );
  };

  const getStageLabelForStatus = (status: string) => {
    const s = STAGES.find(s => s.key === status);
    return s ? s.label : status;
  };

  /* Optimistic advance: remove card instantly, then sync */
  const advanceStage = async (contactId: string, newStatus: string) => {
    setContacts(prev => prev.map(c => c.id === contactId ? { ...c, status: newStatus } : c));
    if (selectedContact?.id === contactId) { setDrawerOpen(false); setSelectedContact(null); }

    const nowIso = new Date().toISOString();
    const updates: Record<string, any> = { status: newStatus };

    if (newStatus === "initiated") {
      updates.initiated_at = nowIso;
      updates.current_follow_up = "1A";
      updates.last_follow_up_at = nowIso;
      // If they reached Initiated, they must have seen media
      updates.media_seen = true;
      updates.media_seen_at = nowIso;
    } else if (newStatus === "engaged") {
      updates.engaged_at = nowIso;
      updates.current_follow_up = "1B";
      updates.last_follow_up_at = nowIso;
    } else if (newStatus === "calendly_sent") {
      updates.calendly_sent_at = nowIso;
      updates.current_follow_up = "1C";
      updates.last_follow_up_at = nowIso;
    } else if (newStatus === "booked") {
      updates.booked_at = nowIso;
      updates.current_follow_up = null;
      updates.last_follow_up_at = null;
    }

    await supabase.from("contacts").update(updates).eq("id", contactId);
    // Clean up any lingering uncompleted DM queue entries for this contact
    await supabase.from("daily_queues").delete().eq("contact_id", contactId).eq("queue_type", "dm").eq("completed", false);
    toast.success(`Moved to ${newStatus.replace("_", " ")}`);
    fetchContacts(true);
  };

  /* Toggle media_seen on a dmed contact */
  const toggleMediaSeen = async (contactId: string, current: boolean) => {
    const newVal = !current;
    setContacts(prev => prev.map(c => c.id === contactId ? { ...c, media_seen: newVal } : c));
    if (selectedContact?.id === contactId) setSelectedContact(prev => prev ? { ...prev, media_seen: newVal } : null);
    const updates: Record<string, any> = { media_seen: newVal };
    if (newVal) updates.media_seen_at = new Date().toISOString();
    else updates.media_seen_at = null;
    await supabase.from("contacts").update(updates).eq("id", contactId);
    toast.success(newVal ? "Marked as media seen" : "Media seen removed");
  };

  /* Optimistic flywheel: remove card instantly */
  const sendToFlywheel = async (contactId: string, reason: string) => {
    setContacts(prev => prev.filter(c => c.id !== contactId));
    if (selectedContact?.id === contactId) { setDrawerOpen(false); setSelectedContact(null); }

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
    // Clean up any lingering uncompleted queue entries for this contact
    await supabase.from("daily_queues").delete().eq("contact_id", contactId).eq("completed", false);
    toast.success("→ Flywheel (90d)");
    fetchContacts(true);
  };

  const openDrawer = async (contact: PipelineContact) => {
    setSelectedContact(contact);
    setA2Notes(contact.a2_notes || "");
    setBNotes(contact.b_notes || "");

    const { data: openerData } = await supabase.from("openers").select("opener_text").eq("contact_id", contact.id).limit(1).maybeSingle();
    setOpenerText(openerData?.opener_text || "");

    setDrawerOpen(true);
  };

  const saveA2Notes = async () => {
    if (!selectedContact) return;
    await supabase.from("contacts").update({ a2_notes: a2Notes }).eq("id", selectedContact.id);
  };
  const saveBNotes = async () => {
    if (!selectedContact) return;
    await supabase.from("contacts").update({ b_notes: bNotes }).eq("id", selectedContact.id);
  };

  const advanceFollowUp = async () => {
    if (!selectedContact) return;
    const fu = selectedContact.current_follow_up;
    if (!fu) return;
    const letter = fu.slice(-1);
    const num = parseInt(fu.slice(0, -1));
    const newFollowUp = (letter === "A" || num >= 8) ? null : `${num + 1}${letter}`;
    const nowIso = new Date().toISOString();
    // Optimistic update
    setSelectedContact(prev => prev ? { ...prev, current_follow_up: newFollowUp, last_follow_up_at: nowIso } : null);
    setContacts(prev => prev.map(c => c.id === selectedContact.id ? { ...c, current_follow_up: newFollowUp, last_follow_up_at: nowIso } : c));
    await supabase.from("contacts").update({ current_follow_up: newFollowUp, last_follow_up_at: nowIso }).eq("id", selectedContact.id);
    toast.success(newFollowUp ? `Advanced to ${newFollowUp}` : `All ${letter} follow-ups complete`);
  };

  const getNextStage = (contact: PipelineContact) => {
    if (contact.status === "dmed") return { label: "Initiated", status: "initiated" };
    if (contact.status === "initiated") return { label: "Engaged", status: "engaged" };
    if (contact.status === "engaged") return { label: "Calendly", status: "calendly_sent" };
    if (contact.status === "calendly_sent") return { label: "Booked", status: "booked" };
    return null;
  };

  const getDaysSince = (contact: PipelineContact) => {
    const dateStr = contact.last_follow_up_at || contact.initiated_at || contact.engaged_at || contact.dmed_at;
    if (!dateStr) return null;
    return differenceInDays(new Date(), new Date(dateStr));
  };

  /* How many follow-ups (B or C) are marked done for a contact */
  const getFollowUpProgress = (contact: PipelineContact) => {
    const fu = contact.current_follow_up;
    if (!fu) return null;
    const letter = fu.slice(-1);
    const num = parseInt(fu.slice(0, -1));
    if (letter === "A") return null; // A stage has only 1
    return { current: num, letter };
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20 text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="h-[calc(100vh-5rem)] md:h-[calc(100vh-2rem)] flex flex-col">
      {/* Compact header bar */}
      <div className="flex items-center justify-between pb-3 mb-3 border-b border-border gap-2">
        <div className="flex items-center gap-2 shrink-0">
          <h1 className="text-lg font-semibold">Pipeline</h1>
          <span className="text-xs text-muted-foreground">{contacts.length}</span>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
          {STAGES.map(({ key, label, color, dotColor }) => (
            <div key={key} className="flex items-center gap-1 shrink-0">
              <span className={`h-2 w-2 rounded-full ${dotColor}`} />
              <span className="text-[11px] text-muted-foreground hidden sm:inline">{label}</span>
              <span className="text-xs font-semibold text-foreground">{contactsByStage(key).length}</span>
            </div>
          ))}
        </div>
      </div>

      {/* 5-column board — scrollable on mobile */}
      <div className="flex-1 overflow-x-auto overflow-y-hidden scrollbar-hide">
        <div className="flex gap-3 min-w-[900px] md:min-w-0 md:grid md:grid-cols-5 h-full">
          {STAGES.map(({ key, label, color, dotColor }) => {
            const allStage = contacts.filter(c => c.status === key);
            const stageContacts = contactsByStage(key);
            const ghosts = ghostContactsForStage(key);
            const allVisible = allStage.length + ghosts.length;
            return (
              <div key={key} className="flex flex-col min-h-0 w-[200px] md:w-auto shrink-0 md:shrink">
                <div className="flex items-center gap-2 pb-2">
                  <span className={`h-2 w-2 rounded-full ${dotColor}`} />
                  <span className={`text-[11px] font-semibold uppercase tracking-wider ${color}`}>{label}</span>
                  <span className="text-[10px] text-muted-foreground ml-auto">{stageContacts.length}{ghosts.length > 0 ? <span className="text-muted-foreground/40"> +{ghosts.length}</span> : null}</span>
                </div>
                {allVisible > 0 && (
                  <div className="relative mb-2">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground/50" />
                    <input
                      type="text"
                      placeholder="Search..."
                      value={stageSearch[key] || ""}
                      onChange={e => setStageSearch(prev => ({ ...prev, [key]: e.target.value }))}
                      className="w-full rounded-md border border-border bg-secondary/50 pl-7 pr-2 py-1.5 text-[11px] placeholder:text-muted-foreground/40 focus:outline-none focus:ring-1 focus:ring-primary/30 transition-all"
                    />
                  </div>
                )}
              <div className="flex-1 overflow-y-auto space-y-1.5" style={{ scrollbarWidth: 'thin' }}>
                {stageContacts.length === 0 && ghosts.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border/50 p-4 text-center text-[11px] text-muted-foreground/50">{allStage.length > 0 ? "No matches" : "Empty"}</div>
                ) : (
                  <>
                  {stageContacts.map((contact) => {
                    const days = getDaysSince(contact);
                    const next = getNextStage(contact);
                    const progress = getFollowUpProgress(contact);
                    return (
                      <div
                        key={contact.id}
                        className="rounded-lg bg-card border border-border/40 p-3 cursor-pointer hover:border-primary/30 hover:shadow-sm transition-all group relative"
                        onClick={() => openDrawer(contact)}
                      >
                        {/* Name + username */}
                        <p className="text-[13px] font-medium truncate leading-tight">{contact.full_name}</p>
                        {contact.username && (
                          <p className="text-[11px] text-muted-foreground truncate mt-0.5">@{contact.username}</p>
                        )}

                        {/* Meta: media seen + follow-up badge + days ago */}
                        <div className="flex items-center gap-1.5 mt-1.5">
                          {key === "dmed" && (
                            <button
                              onClick={e => { e.stopPropagation(); toggleMediaSeen(contact.id, contact.media_seen); }}
                              className={`inline-flex items-center gap-0.5 text-[10px] rounded-md px-1.5 py-0.5 font-medium transition-colors ${
                                contact.media_seen
                                  ? "bg-purple-500/15 text-purple-500"
                                  : "bg-secondary text-muted-foreground hover:text-purple-500 hover:bg-purple-500/10"
                              }`}
                              title={contact.media_seen ? "Media seen ✓" : "Mark as media seen"}
                            >
                              <Eye className="h-3 w-3" />
                              {contact.media_seen ? "Seen" : "MS"}
                            </button>
                          )}
                          {contact.current_follow_up && (
                            <span className="text-[10px] rounded-md bg-primary/10 text-primary px-1.5 py-0.5 font-medium">{contact.current_follow_up}</span>
                          )}
                          {days !== null && days > 0 && (
                            <span className={`text-[10px] ${days >= 3 ? "text-destructive" : "text-muted-foreground"}`}>{days}d ago</span>
                          )}
                          {progress && (
                            <span className="text-[10px] text-muted-foreground ml-auto">{progress.current}/{8}</span>
                          )}
                        </div>

                        {/* Action buttons — always visible on mobile, hover on desktop */}
                        {key !== "booked" && (
                          <div className="flex items-center gap-1 mt-2 opacity-100 md:opacity-0 md:group-hover:opacity-100 transition-opacity">
                            <a
                              href={contact.profile_link}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={e => e.stopPropagation()}
                              className="inline-flex items-center gap-1 text-[10px] rounded-md bg-secondary px-2 py-1 text-secondary-foreground hover:bg-secondary/80 transition-colors"
                            >
                              <ExternalLink className="h-3 w-3" /> Profile
                            </a>
                            {next && (
                              <button
                                className="inline-flex items-center gap-0.5 text-[10px] rounded-md bg-primary/10 text-primary px-2 py-1 hover:bg-primary/20 transition-colors font-medium"
                                onClick={e => { e.stopPropagation(); advanceStage(contact.id, next.status); }}
                              >
                                <ChevronRight className="h-3 w-3" /> {next.label}
                              </button>
                            )}
                            <button
                              className="inline-flex items-center text-[10px] rounded-md bg-destructive/10 text-destructive px-1.5 py-1 hover:bg-destructive/20 transition-colors ml-auto"
                              onClick={e => { e.stopPropagation(); sendToFlywheel(contact.id, "no_reply"); }}
                              title="No reply → Flywheel"
                            >
                              <RotateCcw className="h-3 w-3" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {/* Ghost cards — contacts that passed through this stage */}
                  {ghosts.map((contact) => (
                    <div
                      key={`ghost-${contact.id}`}
                      className="rounded-lg bg-card/40 border border-dashed border-border/30 px-2.5 py-2 cursor-pointer hover:border-border/50 transition-all opacity-40"
                      onClick={() => openDrawer(contact)}
                    >
                      <div className="flex items-center gap-1.5">
                        <p className="text-[11px] font-medium truncate flex-1 leading-tight">{contact.full_name}</p>
                        <span className={`text-[9px] rounded px-1 py-0.5 font-medium ${
                          contact.status === "booked" ? "bg-emerald-500/15 text-emerald-500"
                          : contact.status === "calendly_sent" ? "bg-blue-500/15 text-blue-500"
                          : contact.status === "engaged" ? "bg-yellow-500/15 text-yellow-600"
                          : contact.status === "initiated" ? "bg-orange-500/15 text-orange-500"
                          : contact.status === "flywheel" ? "bg-destructive/15 text-destructive"
                          : "bg-primary/15 text-primary"
                        }`}>{getStageLabelForStatus(contact.status)}</span>
                      </div>
                    </div>
                  ))}
                  </>
                )}
              </div>
            </div>
          );
        })}
        </div>
      </div>

      {/* Contact Detail Drawer */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent className="w-full sm:max-w-md overflow-y-auto">
          {selectedContact && (
            <>
              <SheetHeader className="pb-4 border-b border-border">
                <SheetTitle className="text-left text-base">
                  {selectedContact.full_name}
                </SheetTitle>
                <div className="flex items-center gap-2 mt-1">
                  {selectedContact.username && (
                    <span className="text-xs text-muted-foreground">@{selectedContact.username}</span>
                  )}
                  <a
                    href={selectedContact.profile_link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <ExternalLink className="h-3 w-3" /> Open Profile
                  </a>
                </div>

                {/* Action buttons right in header */}
                {selectedContact.status !== "booked" && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {(() => {
                      const next = getNextStage(selectedContact);
                      return next ? (
                        <Button size="sm" className="h-8 text-xs" onClick={() => advanceStage(selectedContact.id, next.status)}>
                          <ChevronRight className="h-3.5 w-3.5 mr-1" /> {next.label}
                        </Button>
                      ) : null;
                    })()}
                    <Button variant="outline" size="sm" className="h-8 text-xs" onClick={() => sendToFlywheel(selectedContact.id, "no_reply")}>
                      <RotateCcw className="h-3.5 w-3.5 mr-1" /> No Reply
                    </Button>
                    <Button variant="destructive" size="sm" className="h-8 text-xs" onClick={() => sendToFlywheel(selectedContact.id, "negative")}>
                      <ThumbsDown className="h-3.5 w-3.5 mr-1" /> -ve Reply
                    </Button>
                  </div>
                )}
              </SheetHeader>

              <div className="mt-5 space-y-5">
                {/* Media Seen toggle (DM'd stage only) */}
                {selectedContact.status === "dmed" && (
                  <div className="space-y-1.5">
                    <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Media Seen</h3>
                    <button
                      onClick={() => toggleMediaSeen(selectedContact.id, selectedContact.media_seen)}
                      className={`flex items-center gap-2 rounded-md border px-3 py-2 text-xs font-medium transition-all ${
                        selectedContact.media_seen
                          ? "border-purple-500/50 bg-purple-500/10 text-purple-500"
                          : "border-border bg-secondary/60 text-muted-foreground hover:border-purple-500/30 hover:text-purple-500"
                      }`}
                    >
                      <Eye className="h-3.5 w-3.5" />
                      {selectedContact.media_seen ? "Media seen ✓" : "Mark as media seen"}
                    </button>
                  </div>
                )}

                {/* Opener */}
                {openerText && (
                  <div className="space-y-1.5">
                    <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Opener</h3>
                    <div className="rounded-lg bg-secondary/60 px-3 py-2.5 text-sm text-secondary-foreground leading-relaxed">{openerText}</div>
                  </div>
                )}

                {/* Notes */}
                <div className="space-y-1.5">
                  <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Notes</h3>
                  <Textarea value={a2Notes} onChange={e => setA2Notes(e.target.value)} onBlur={saveA2Notes} placeholder="Add notes about this contact..." className="min-h-[60px] text-sm resize-none" />
                </div>

                {/* B Notes (visible for engaged/calendly/booked) */}
                {(selectedContact.status === "engaged" || selectedContact.status === "calendly_sent" || selectedContact.status === "booked") && (
                  <div className="space-y-1.5">
                    <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">B Notes</h3>
                    <Textarea value={bNotes} onChange={e => setBNotes(e.target.value)} onBlur={saveBNotes} placeholder="VSL follow-up notes..." className="min-h-[60px] text-sm resize-none" />
                  </div>
                )}

                {/* 1A follow-up (Initiated only) */}
                {selectedContact.status === "initiated" && (
                  <div className="space-y-0">
                    <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Follow-up 1A</h3>
                    {selectedContact.current_follow_up === "1A" ? (
                      <button
                        onClick={advanceFollowUp}
                        className="flex items-center gap-2 rounded-md border border-primary/50 bg-primary/10 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/20 transition-all"
                      >
                        <span className="h-2.5 w-2.5 rounded-full bg-primary animate-pulse" />
                        Mark 1A complete
                      </button>
                    ) : (
                      <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary/15 px-3 py-2 text-xs font-medium text-primary">
                        <Check className="h-3 w-3" />
                        1A completed
                      </div>
                    )}
                  </div>
                )}

                {/* B sequential follow-ups (Engaged only) */}
                {selectedContact.status === "engaged" && (() => {
                  const fu = selectedContact.current_follow_up;
                  const fuLetter = fu?.slice(-1);
                  const fuNum = fu ? parseInt(fu.slice(0, -1)) : 9;
                  return (
                    <div className="space-y-0">
                      <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Follow-ups 1B – 8B</h3>
                      <div className="grid grid-cols-4 gap-1.5">
                        {[1,2,3,4,5,6,7,8].map(num => {
                          const isDone = fuLetter !== "B" || num < fuNum;
                          const isCurrent = fuLetter === "B" && num === fuNum;
                          return (
                            <button
                              key={num}
                              onClick={isCurrent ? advanceFollowUp : undefined}
                              disabled={!isCurrent}
                              className={`flex items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-all ${
                                isDone
                                  ? "bg-primary/15 border-primary/30 text-primary"
                                  : isCurrent
                                    ? "bg-primary/10 border-primary text-primary cursor-pointer hover:bg-primary/20 shadow-sm"
                                    : "bg-card border-border/50 text-muted-foreground/40"
                              }`}
                            >
                              {isDone ? <Check className="h-3 w-3" /> : isCurrent ? <span className="h-2 w-2 rounded-full bg-primary animate-pulse" /> : <span className="h-3 w-3" />}
                              {num}B
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}

                {/* C sequential follow-ups (Calendly only) */}
                {selectedContact.status === "calendly_sent" && (() => {
                  const fu = selectedContact.current_follow_up;
                  const fuLetter = fu?.slice(-1);
                  const fuNum = fu ? parseInt(fu.slice(0, -1)) : 9;
                  return (
                    <div className="space-y-0">
                      <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">Follow-ups 1C – 8C</h3>
                      <div className="grid grid-cols-4 gap-1.5">
                        {[1,2,3,4,5,6,7,8].map(num => {
                          const isDone = fuLetter !== "C" || num < fuNum;
                          const isCurrent = fuLetter === "C" && num === fuNum;
                          return (
                            <button
                              key={num}
                              onClick={isCurrent ? advanceFollowUp : undefined}
                              disabled={!isCurrent}
                              className={`flex items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-xs font-medium transition-all ${
                                isDone
                                  ? "bg-blue-500/15 border-blue-500/30 text-blue-500"
                                  : isCurrent
                                    ? "bg-blue-500/10 border-blue-500 text-blue-500 cursor-pointer hover:bg-blue-500/20 shadow-sm"
                                    : "bg-card border-border/50 text-muted-foreground/40"
                              }`}
                            >
                              {isDone ? <Check className="h-3 w-3" /> : isCurrent ? <span className="h-2 w-2 rounded-full bg-blue-500 animate-pulse" /> : <span className="h-3 w-3" />}
                              {num}C
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })()}
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
};

export default Pipeline;
