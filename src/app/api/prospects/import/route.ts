import { NextRequest, NextResponse } from "next/server";
import { identifyCaller } from "@/lib/auth/service";
import { supabaseAdmin } from "@/lib/db/supabase";

// POST /api/prospects/import — bulk import prospects from CSV
// Body: { campaign_id: string, csv: string } (csv is the raw CSV text)
export async function POST(req: NextRequest) {
  const caller = await identifyCaller(req);
  if (!caller) return NextResponse.json({ error: "not signed in" }, { status: 401 });

  const { campaign_id, csv } = await req.json().catch(() => ({}));
  if (!campaign_id || !csv) {
    return NextResponse.json({ error: "campaign_id and csv are required" }, { status: 400 });
  }

  // Verify campaign exists
  const { data: camp } = await supabaseAdmin.from("campaigns").select("id").eq("id", campaign_id).maybeSingle();
  if (!camp) return NextResponse.json({ error: "campaign not found" }, { status: 404 });

  // Parse CSV
  const lines = csv.split("\n").map((l: string) => l.trim()).filter(Boolean);
  if (lines.length < 2) return NextResponse.json({ error: "CSV must have a header row and at least one data row" }, { status: 400 });

  const header = lines[0].toLowerCase().split(",").map((h: string) => h.trim());
  const urlIdx = header.findIndex((h: string) => h === "url" || h === "prospect_url" || h === "article_url");
  const nameIdx = header.findIndex((h: string) => h === "name" || h === "author" || h === "author_name");
  const emailIdx = header.findIndex((h: string) => h === "email" || h === "contact_email");
  const domainIdx = header.findIndex((h: string) => h === "domain" || h === "publication");

  if (urlIdx === -1 && domainIdx === -1) {
    return NextResponse.json({ error: "CSV must have a 'url' or 'domain' column" }, { status: 400 });
  }

  let imported = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",").map((c: string) => c.trim());
    try {
      const url = urlIdx >= 0 ? cols[urlIdx] : "";
      const domain = domainIdx >= 0 ? cols[domainIdx] : "";
      const authorName = nameIdx >= 0 ? cols[nameIdx] : "";
      const email = emailIdx >= 0 ? cols[emailIdx] : "";

      // Derive domain from URL if not provided
      let domainHost = domain;
      if (!domainHost && url) {
        try { domainHost = new URL(url).hostname.replace(/^www\./, ""); } catch { domainHost = ""; }
      }
      if (!domainHost) { skipped++; continue; }

      // Check for duplicate in this campaign
      const { data: existing } = await supabaseAdmin
        .from("prospects")
        .select("id")
        .eq("campaign_id", campaign_id)
        .eq("domain_host", domainHost)
        .limit(1)
        .maybeSingle();
      if (existing) { skipped++; continue; }

      // Insert prospect
      const { error } = await supabaseAdmin.from("prospects").insert({
        campaign_id,
        domain_host: domainHost,
        title: url ? `Imported from ${domainHost}` : `Imported ${domainHost}`,
        prospect_url: url || null,
        status: "discovered",
        notes: { imported: true, author_name: authorName || null, contact_email: email || null },
      });
      if (error) { errors.push(`Row ${i + 1}: ${error.message}`); skipped++; continue; }

      // If email provided, create contact record
      if (email) {
        try {
          await supabaseAdmin.from("contacts").insert({
            email,
            domain_host: domainHost,
            full_name: authorName || null,
            source: "csv-import",
            confidence: 100,
          });
        } catch { /* non-fatal */ }
      }

      imported++;
    } catch (e: any) {
      errors.push(`Row ${i + 1}: ${e?.message ?? "parse error"}`);
      skipped++;
    }
  }

  return NextResponse.json({ imported, skipped, errors: errors.slice(0, 10) });
}
