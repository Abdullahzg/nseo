import { NextRequest } from "next/server";
import { auth } from "@auth";
import { supabaseAdmin } from "@/lib/db/supabase";
import { invalidateRuntimeAIConfigCache, llmProvider, geminiModel, DEFAULT_GEMINI_MODEL } from "@/lib/ai/gemini";

async function requireAdmin() {
  const session = await auth().catch(() => null);
  const email = session?.user?.email;
  if (!email) return null;
  const admins = (process.env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  // No allow-list configured → any signed-in operator may manage settings (single-team tool).
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
  const { data } = await supabaseAdmin.from("app_settings").select("gemini_api_key, gemini_model, updated_at").eq("id", true).maybeSingle();
  return Response.json({
    provider: llmProvider(),
    env_model: geminiModel(),
    default_model: DEFAULT_GEMINI_MODEL,
    runtime_key_masked: mask((data as any)?.gemini_api_key),
    runtime_model: (data as any)?.gemini_model ?? null,
    updated_at: (data as any)?.updated_at ?? null,
  });
}

// PATCH /api/settings/ai — { gemini_api_key?, gemini_model?, clear_key?: boolean }
export async function PATCH(req: NextRequest) {
  const admin = await requireAdmin();
  if (!admin) return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));

  const patch: Record<string, unknown> = { id: true, updated_at: new Date().toISOString() };
  if (typeof body.gemini_api_key === "string" && body.gemini_api_key.trim()) patch.gemini_api_key = body.gemini_api_key.trim();
  if (body.clear_key === true) patch.gemini_api_key = null;
  if (typeof body.gemini_model === "string") patch.gemini_model = body.gemini_model.trim() || null;

  await supabaseAdmin.from("app_settings").upsert(patch, { onConflict: "id" });
  invalidateRuntimeAIConfigCache();
  const keySet = patch.gemini_api_key != null
    ? true
    : body.clear_key === true
      ? false
      : !!((await supabaseAdmin.from("app_settings").select("gemini_api_key").eq("id", true).maybeSingle()).data as any)?.gemini_api_key;
  return Response.json({ ok: true, key_set: keySet });
}
