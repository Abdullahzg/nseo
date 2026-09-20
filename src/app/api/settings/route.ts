import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { identifyCaller } from "@/lib/auth/service";
import { getUserEmailConfig, upsertUserEmailConfig, getUserAppPasswordEnc, getOwnerKeys } from "@/lib/db/queries";
import { encryptSecret, decryptSecret } from "@/lib/crypto";
import { ping } from "@/lib/ai/nebius";
import { PLATFORM_KEY_FOR_OWNERS } from "@/lib/ai/context";

export const dynamic = "force-dynamic";

function view(cfg: Awaited<ReturnType<typeof getUserEmailConfig>>) {
  // Owners bring their own keys. The platform key (if any) covers them only when the deployment allows it.
  return { ...cfg, platform_nebius: PLATFORM_KEY_FOR_OWNERS && !!process.env.NEBIUS_API_KEY?.trim(), platform_tavily: !!process.env.TAVILY_API_KEY?.trim() };
}

export async function GET(req: NextRequest) {
  const caller = await identifyCaller(req);
  if (caller?.kind !== "owner") return NextResponse.json({ error: "owner only" }, { status: 403 });
  return NextResponse.json(view(await getUserEmailConfig(caller.email)));
}

/**
 * Owner credentials, all encrypted at rest with AUTH_SECRET: Gmail app password + sender name,
 * Nebius Token Factory key, Tavily key. ?test=gmail|nebius|tavily verifies the saved one.
 */
export async function POST(req: NextRequest) {
  const caller = await identifyCaller(req);
  if (caller?.kind !== "owner") return NextResponse.json({ error: "owner only" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const test = req.nextUrl.searchParams.get("test");
  if (test === "1" || test === "gmail") {
    const pass = decryptSecret(await getUserAppPasswordEnc(caller.email));
    if (!pass) return NextResponse.json({ ok: false, error: "no app password saved" }, { status: 400 });
    try {
      await nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: caller.email, pass } }).verify();
      return NextResponse.json({ ok: true });
    } catch (e: any) { return NextResponse.json({ ok: false, error: e?.message }, { status: 400 }); }
  }
  if (test === "nebius") {
    const keys = await getOwnerKeys(caller.email);
    const key = keys.nebius ?? (PLATFORM_KEY_FOR_OWNERS ? process.env.NEBIUS_API_KEY?.trim() : undefined);
    if (!key) return NextResponse.json({ ok: false, error: "no Nebius key saved" }, { status: 400 });
    const r = await ping(key);
    return NextResponse.json({ ok: r.ok, models: r.models, missing: r.missing, error: r.error }, { status: r.ok ? 200 : 400 });
  }
  if (test === "tavily") {
    const keys = await getOwnerKeys(caller.email);
    const key = keys.tavily ?? process.env.TAVILY_API_KEY?.trim();
    if (!key) return NextResponse.json({ ok: false, error: "no Tavily key saved" }, { status: 400 });
    try {
      // /usage is free; a search would spend a credit just to say hello.
      const res = await fetch("https://api.tavily.com/usage", { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(8000) });
      const text = await res.text();
      if (!res.ok) return NextResponse.json({ ok: false, error: `Tavily HTTP ${res.status}: ${text.slice(0, 120)}` }, { status: 400 });
      let usage: any = null; try { usage = JSON.parse(text); } catch { /* fine */ }
      const used = usage?.key?.usage ?? usage?.account?.current_plan_usage, limit = usage?.key?.limit ?? usage?.account?.plan_limit;
      return NextResponse.json({ ok: true, usage: used, limit });
    } catch (e: any) { return NextResponse.json({ ok: false, error: e?.message }, { status: 400 }); }
  }

  const patch: Record<string, unknown> = {};
  if (typeof body?.from_name === "string") patch.from_name = body.from_name.trim().slice(0, 80);
  if (typeof body?.app_password === "string" && body.app_password.trim()) patch.app_password_enc = encryptSecret(body.app_password.replace(/\s+/g, ""));
  if (typeof body?.nebius_api_key === "string") patch.nebius_api_key_enc = body.nebius_api_key.trim() ? encryptSecret(body.nebius_api_key.trim()) : null;
  if (typeof body?.tavily_api_key === "string") patch.tavily_api_key_enc = body.tavily_api_key.trim() ? encryptSecret(body.tavily_api_key.trim()) : null;
  if (typeof body?.timezone === "string") patch.timezone = body.timezone;
  await upsertUserEmailConfig(caller.email, patch);
  return NextResponse.json(view(await getUserEmailConfig(caller.email)));
}
