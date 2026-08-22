import { NextRequest } from "next/server";
import { auth } from "@auth";

/**
 * Authorization for the internal agent tool gateway (/api/agent/*).
 * Allowed callers:
 *  - the Python ADK agent service, via `Authorization: Bearer $AGENT_SERVICE_TOKEN`
 *  - cron/ops triggers via CRON_SECRET (header or ?key=) — parity with legacy job endpoints
 *  - a signed-in app session (UI-driven tool invocations)
 *
 * This is the server-side policy boundary: agents can only act through these
 * endpoints, and every mutating endpoint re-checks campaign state itself.
 */
export async function authorizeAgent(req: NextRequest): Promise<{ ok: boolean; via: string }> {
  const header = req.headers.get("authorization") ?? "";
  const agentToken = process.env.AGENT_SERVICE_TOKEN;
  if (agentToken && header === `Bearer ${agentToken}`) return { ok: true, via: "agent-service" };

  const cron = process.env.CRON_SECRET;
  if (cron) {
    if (header === `Bearer ${cron}`) return { ok: true, via: "cron" };
    if (req.nextUrl.searchParams.get("key") === cron) return { ok: true, via: "cron" };
  }

  const session = await auth().catch(() => null);
  if (session?.user?.email) return { ok: true, via: "session" };
  return { ok: false, via: "none" };
}

export function unauthorized() {
  return Response.json({ error: "unauthorized" }, { status: 401 });
}

export function badRequest(msg: string) {
  return Response.json({ error: msg }, { status: 400 });
}
