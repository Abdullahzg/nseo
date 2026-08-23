import { NextRequest } from "next/server";

/**
 * Authorization for the internal agent tool gateway (/api/agent/*).
 * When GOOGLE_CLIENT_ID is not set, all requests are allowed (demo mode).
 */
export async function authorizeAgent(req: NextRequest): Promise<{ ok: boolean; via: string }> {
  // Demo mode: no OAuth configured → everything allowed
  if (!process.env.GOOGLE_CLIENT_ID?.trim()) return { ok: true, via: "demo" };

  const header = req.headers.get("authorization") ?? "";
  const agentToken = process.env.AGENT_SERVICE_TOKEN;
  if (agentToken && header === `Bearer ${agentToken}`) return { ok: true, via: "agent-service" };

  const cron = process.env.CRON_SECRET;
  if (cron) {
    if (header === `Bearer ${cron}`) return { ok: true, via: "cron" };
    if (req.nextUrl.searchParams.get("key") === cron) return { ok: true, via: "cron" };
  }

  try {
    const { auth } = await import("@auth");
    const session = await auth().catch(() => null);
    if (session?.user?.email) return { ok: true, via: "session" };
  } catch { /* auth not configured */ }
  return { ok: false, via: "none" };
}

export function unauthorized() {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

export function badRequest(msg: string) {
  return Response.json({ error: msg }, { status: 400 });
}
