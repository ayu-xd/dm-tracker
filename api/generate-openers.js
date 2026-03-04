import { createClient } from "@supabase/supabase-js";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  // CORS
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "authorization, content-type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const groqApiKey = process.env.GROQ_API_KEY;
    if (!groqApiKey) throw new Error("GROQ_API_KEY not set");

    const supabaseUrl = process.env.VITE_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseUrl || !supabaseServiceKey) throw new Error("Supabase env vars not set");

    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { userId } = req.body || {};

    // Get contacts in today's DM queue + any followed contacts needing openers
    const today = new Date().toISOString().slice(0, 10);
    let dmQueueQuery = supabase
      .from("daily_queues")
      .select("contact_id")
      .eq("queue_date", today)
      .eq("queue_type", "dm");
    if (userId) dmQueueQuery = dmQueueQuery.eq("user_id", userId);
    const { data: dmQueueEntries } = await dmQueueQuery;
    const dmContactIds = (dmQueueEntries || []).map((q) => q.contact_id);

    // Get DM queue contacts
    let dmContacts = [];
    if (dmContactIds.length > 0) {
      const { data } = await supabase
        .from("contacts")
        .select("id, user_id, full_name, biography")
        .in("id", dmContactIds);
      dmContacts = data || [];
    }

    // Also get followed contacts as fallback
    let followedQuery = supabase
      .from("contacts")
      .select("id, user_id, full_name, biography")
      .eq("status", "followed")
      .is("dmed_at", null);
    if (userId) followedQuery = followedQuery.eq("user_id", userId);
    const { data: followedContacts } = await followedQuery.limit(100);

    // Merge and deduplicate
    const seenIds = new Set();
    const contacts = [];
    for (const c of [...dmContacts, ...(followedContacts || [])]) {
      if (!seenIds.has(c.id)) { seenIds.add(c.id); contacts.push(c); }
    }
    const fetchError = null;

    if (!contacts || contacts.length === 0) {
      return res.status(200).json({ message: "No contacts need openers" });
    }

    // Check which already have openers
    const contactIds = contacts.map((c) => c.id);
    const { data: existingOpeners } = await supabase
      .from("openers")
      .select("contact_id")
      .in("contact_id", contactIds);

    const existingIds = new Set((existingOpeners || []).map((o) => o.contact_id));
    const needOpeners = contacts.filter((c) => !existingIds.has(c.id));

    if (needOpeners.length === 0) {
      return res.status(200).json({ message: "All contacts already have openers" });
    }

    // Generate openers using Groq
    const openers = [];

    for (let i = 0; i < needOpeners.length; i += 5) {
      const batch = needOpeners.slice(i, i + 5);

      const prompt = `You are a sales outreach assistant. For each contact below, pick the BEST opener from these two options ONLY:

Option A: "Are you taking on more clients atm?"
Option B: "Still running [BUSINESS NAME]?" (use this ONLY if their bio clearly mentions a business, brand, company, or clinic they own/founded - extract the actual business name)

Rules:
- If the bio mentions they are a founder, owner, CEO, or co-founder of a specific business/brand, use Option B with that business name
- Otherwise, always default to Option A
- Return ONLY the opener text, nothing else
- One line per contact

Contacts:
${batch.map((c, idx) => `${idx + 1}. Name: ${c.full_name}, Bio: ${c.biography || "No bio"}`).join("\n")}

Return exactly ${batch.length} lines, one opener per contact:`;

      const groqRes = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${groqApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
          max_tokens: 1000,
        }),
      });

      if (!groqRes.ok) {
        const errText = await groqRes.text();
        if (groqRes.status === 429) {
          // Rate limited — wait and retry
          await new Promise((r) => setTimeout(r, 10000));
          i -= 5;
          continue;
        }
        throw new Error(`Groq API error: ${errText}`);
      }

      const groqData = await groqRes.json();
      const lines = groqData.choices[0].message.content
        .trim()
        .split("\n")
        .map((l) => l.replace(/^\d+\.\s*/, "").trim())
        .filter((l) => l.length > 0);

      batch.forEach((contact, idx) => {
        openers.push({
          user_id: contact.user_id,
          contact_id: contact.id,
          opener_text: lines[idx] || "Are you taking on more clients atm?",
        });
      });

      // Delay between batches
      if (i + 5 < needOpeners.length) {
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    // Insert openers
    if (openers.length > 0) {
      const { error: insertError } = await supabase.from("openers").insert(openers);
      if (insertError) throw insertError;
    }

    return res.status(200).json({ message: `Generated ${openers.length} openers` });
  } catch (error) {
    console.error("generate-openers error:", error);
    return res.status(500).json({ error: error.message });
  }
}
