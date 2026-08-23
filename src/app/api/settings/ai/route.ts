import { NextRequest } from "next/server";
import { auth } from "@auth";
import { supabaseAdmin } from "@/lib/db/supabase";
import { invalidateRuntimeAIConfigCache, llmProvider, geminiModel, DEFAULT_GEMINI_MODEL } from "@/lib/ai/gemini";

async function requireAdmin() {
  // Demo mode: no OAuth → allow everyone
  if (!process.env.GOOGLE_CLIENT_ID?.trim()) return "demo@local";
  const session = await auth().catch(() => null);
  const email = session?.user?.email;
  if (!email) return null;
  const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!admins.length || admins.includes(email.toLowerCase())) return email;
  return null;
}

function mask(v: string | null | undefined): string | null {
  if (!v) return null;
  if (v.length <= 10) return "•••";
  return `${v.slice(0, 6)}…${v.slice(-4)}`;
}

// GET /api/settings/ai — current AI provider config (keys masked).
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { data } = await supabaseAdmin.from("app_settings").select("gemini_api_key, gemini_model, groq_api_key, groq_model, updated_at").eq("id", true).maybeSingle();
  return Response.json({
    provider: llmProvider(),
    default_gemini_model: DEFAULT_GEMINI_MODEL,
    default_groq_model: process.env.GROQ_MODEL ?? "openai/gpt-oss-20b",
    gemini_key_masked: mask((data as any)?.gemini_api_key),
    gemini_model: (data as any)?.gemini_model ?? null,
    groq_key_masked: mask((data as any)?.groq_api_key),
    groq_model: (data as any)?.groq_model ?? null,
    updated_at: (data as any)?.updated_at ?? null,
  });
}

// PATCH /api/settings/ai — { gemini_api_key?, gemini_model?, groq_api_key?, groq_model?, clear_*_key?: boolean }
export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));

  const patch: Record<string, unknown> = { id: true, updated_at: new Date().toISOString() };
  if (typeof body.gemini_api_key === "string" && body.gemini_api_key.trim()) patch.gemini_api_key = body.gemini_api_key.trim();
  if (body.clear_gemini_key === true) patch.gemini_api_key = null;
  if (typeof body.gemini_model === "string") patch.gemini_model = body.gemini_model.trim() || null;
  if (typeof body.groq_api_key === "string" && body.groq_api_key.trim()) patch.groq_api_key = body.groq_api_key.trim();
  if (body.clear_groq_key === true) patch.groq_api_key = null;
  if (typeof body.groq_model === "string") patch.groq_model = body.groq_model.trim() || null;

  await supabaseAdmin.from("app_settings").upsert(patch, { onConflict: "id" });
  invalidateRuntimeAIConfigCache();
  return Response.json({ ok: true });
}
