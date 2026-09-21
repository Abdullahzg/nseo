import { NextRequest, NextResponse } from "next/server";
import { identifyCaller } from "@/lib/auth/service";
import { supabaseAdmin } from "@/lib/db/supabase";

export const dynamic = "force-dynamic";

// "Never contact": domains and addresses the Scout skips and the Writer refuses. Editors who said
// no are added automatically; owners add their own here. Platform-wide (one deployment, one list).

function norm(v: string): { type: "domain" | "email"; value: string } | null {
  const s = v.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  if (!s) return null;
  if (s.includes("@")) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? { type: "email", value: s } : null;
  return s.includes(".") ? { type: "domain", value: s } : null;
}

export async function GET(req: NextRequest) {
  const caller = await identifyCaller(req);
  if (caller?.kind !== "owner") return NextResponse.json({ error: "owner only" }, { status: 403 });
  const { data } = await supabaseAdmin.from("suppression").select("id, type, value, reason, created_at").order("created_at", { ascending: false }).limit(500);
  return NextResponse.json({ entries: data ?? [] });
}

export async function POST(req: NextRequest) {
  const caller = await identifyCaller(req);
  if (caller?.kind !== "owner") return NextResponse.json({ error: "owner only" }, { status: 403 });
  const b = await req.json().catch(() => ({}));
  const n = norm(String(b?.value ?? ""));
  if (!n) return NextResponse.json({ error: "Enter a domain (publication.com) or an email address." }, { status: 400 });
  await supabaseAdmin.from("suppression").upsert({ type: n.type, value: n.value, reason: `added by ${caller.email}` }, { onConflict: "value", ignoreDuplicates: true });
  return NextResponse.json({ ok: true, ...n });
}

export async function DELETE(req: NextRequest) {
  const caller = await identifyCaller(req);
  if (caller?.kind !== "owner") return NextResponse.json({ error: "owner only" }, { status: 403 });
  const value = String(req.nextUrl.searchParams.get("value") ?? "").trim().toLowerCase();
  if (!value) return NextResponse.json({ error: "value required" }, { status: 400 });
  await supabaseAdmin.from("suppression").delete().eq("value", value);
  return NextResponse.json({ ok: true });
}
