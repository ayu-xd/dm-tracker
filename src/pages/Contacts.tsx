import { useEffect, useState, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Trash2, ExternalLink, Search, Users } from "lucide-react";
import { toast } from "sonner";
import CsvUpload from "@/components/CsvUpload";

type Contact = {
  id: string;
  full_name: string;
  username: string | null;
  profile_link: string;
  followers: number | null;
  biography: string | null;
  status: string;
  category: string | null;
};

const statusColors: Record<string, string> = {
  not_started: "bg-secondary text-secondary-foreground",
  followed: "bg-primary/15 text-primary",
  dmed: "bg-primary text-primary-foreground",
  initiated: "bg-orange-500/15 text-orange-500",
  engaged: "bg-yellow-500/15 text-yellow-600",
  calendly_sent: "bg-blue-500/15 text-blue-500",
  booked: "bg-emerald-500/15 text-emerald-500",
  flywheel: "bg-destructive/15 text-destructive",
};

const Contacts = ({ userId }: { userId: string }) => {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchContacts = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("contacts")
      .select("id, full_name, username, profile_link, followers, biography, status, category")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    setContacts(data || []);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    fetchContacts();
  }, [fetchContacts]);

  const deleteContact = async (id: string) => {
    setContacts(prev => prev.filter(c => c.id !== id));
    await supabase.from("contacts").delete().eq("id", id);
    toast.success("Contact deleted");
  };

  const filtered = useMemo(() =>
    contacts.filter(
      (c) =>
        c.full_name.toLowerCase().includes(search.toLowerCase()) ||
        (c.username || "").toLowerCase().includes(search.toLowerCase()) ||
        (c.category || "").toLowerCase().includes(search.toLowerCase())
    ),
    [contacts, search]
  );

  /* Group counts for stats */
  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    contacts.forEach(c => { counts[c.status] = (counts[c.status] || 0) + 1; });
    return counts;
  }, [contacts]);

  return (
    <div className="space-y-4">
      {/* Header row: title + import button */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Contacts</h1>
          <span className="text-xs text-muted-foreground">{contacts.length} total</span>
        </div>
        <CsvUpload userId={userId} onComplete={fetchContacts} />
      </div>

      {/* Status summary pills */}
      <div className="flex flex-wrap gap-1.5">
        {Object.entries(statusCounts).sort((a, b) => b[1] - a[1]).map(([status, count]) => (
          <span key={status} className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-medium ${statusColors[status] || "bg-secondary text-secondary-foreground"}`}>
            {status.replace("_", " ")} <span className="font-semibold">{count}</span>
          </span>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search by name, username, or category..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-10 h-9"
        />
      </div>

      {/* Contact list */}
      {loading ? (
        <p className="py-12 text-center text-muted-foreground text-sm">Loading...</p>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center">
          <Users className="h-8 w-8 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">
            {contacts.length === 0 ? "No contacts yet. Import a CSV to get started." : "No contacts match your search."}
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {filtered.map((contact) => (
            <div key={contact.id} className="flex items-center gap-3 rounded-lg bg-card border border-border/40 px-3 py-2.5 hover:border-primary/20 transition-colors group">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-[13px] font-medium truncate">{contact.full_name}</p>
                  <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${statusColors[contact.status] || "bg-secondary text-secondary-foreground"}`}>
                    {contact.status.replace("_", " ")}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  {contact.username && (
                    <span className="text-[11px] text-muted-foreground">@{contact.username}</span>
                  )}
                  {contact.followers != null && (
                    <span className="text-[11px] text-muted-foreground">{contact.followers.toLocaleString()} followers</span>
                  )}
                  {contact.category && (
                    <span className="text-[10px] rounded bg-secondary px-1.5 py-0.5 text-secondary-foreground">{contact.category}</span>
                  )}
                </div>
              </div>
              <a
                href={contact.profile_link}
                target="_blank"
                rel="noopener noreferrer"
                className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <button
                onClick={() => deleteContact(contact.id)}
                className="shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive transition-colors opacity-60 md:opacity-0 md:group-hover:opacity-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default Contacts;
