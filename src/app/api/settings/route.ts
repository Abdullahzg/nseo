import { NextRequest, NextResponse } from "next/server";
import nodemailer from "nodemailer";
import { identifyCaller } from "@/lib/auth/service";
import { getUserEmailConfig, upsertUserEmailConfig, getUserAppPasswordEnc } from "@/lib/db/queries";
import { encryptSecret, decryptSecret } from "@/lib/crypto";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const caller = await identifyCaller(req);
  if (caller?.kind !== "owner") return NextResponse.json({ error: "owner only" }, { status: 403 });
  return NextResponse.json(await getUserEmailConfig(caller.email));
}

/** Owner's Gmail app password (encrypted at rest with AUTH_SECRET) + sender name. ?test=1 verifies the SMTP login. */
export async function POST(req: NextRequest) {
  const caller = await identifyCaller(req);
  if (caller?.kind !== "owner") return NextResponse.json({ error: "owner only" }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  if (req.nextUrl.searchParams.get("test") === "1") {
    const pass = decryptSecret(await getUserAppPasswordEnc(caller.email));
    if (!pass) return NextResponse.json({ ok: false, error: "no app password saved" }, { status: 400 });
    try {
      await nodemailer.createTransport({ host: "smtp.gmail.com", port: 465, secure: true, auth: { user: caller.email, pass } }).verify();
      return NextResponse.json({ ok: true });
    } catch (e: any) { return NextResponse.json({ ok: false, error: e?.message }, { status: 400 }); }
  }
  const patch: Record<string, unknown> = {};
  if (typeof body?.from_name === "string") patch.from_name = body.from_name.trim().slice(0, 80);
  if (typeof body?.app_password === "string" && body.app_password.trim()) patch.app_password_enc = encryptSecret(body.app_password.replace(/\s+/g, ""));
  if (typeof body?.timezone === "string") patch.timezone = body.timezone;
  await upsertUserEmailConfig(caller.email, patch);
  return NextResponse.json(await getUserEmailConfig(caller.email));
}
