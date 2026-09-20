export const money = (n: number | null | undefined, currency = "USD") =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(Number(n));

export const int = (n: number | null | undefined) => (n == null ? "—" : new Intl.NumberFormat("en-US").format(Number(n)));

export function ago(iso: string | null | undefined): string {
  if (!iso) return "";
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export const modelShort = (m: string | null | undefined) => {
  if (!m) return "";
  if (/super/i.test(m)) return "Nemotron 3 Super";
  if (/nano/i.test(m)) return "Nemotron 3 Nano";
  if (/lightning/i.test(m)) return "Nemotron 3.5 Lightning";
  if (/ultra/i.test(m)) return "Nemotron 3 Ultra";
  return m;
};

export const INTERVENTION_LABEL: Record<string, string> = {
  sync_contact: "Wants a call", scheduling: "Wants availability", asset_request: "Wants a file", identity_verification: "Wants proof",
  redirect: "Points elsewhere", process_portal: "Wants a form", legal_contract: "Wants a contract", payment_details: "Wants invoice details",
  factual_question: "Asks a fact", over_policy: "Beyond policy", inbound_attachment: "Sent a file", other_channel: "Wants another channel",
  thread_limit: "Long thread", budget_exception: "Over budget", other: "Needs a person",
};
