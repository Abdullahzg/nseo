// Best-effort trigger of the legacy burst send processor (real SMTP delivery).
// The agent service calls it directly; in fallback mode we fire-and-forget the
// local endpoint so scheduled outreach goes out without waiting for cron.
export function runSendProcessorHint(): void {
  const url = process.env.APP_URL || "http://localhost:3000";
  const secret = process.env.CRON_SECRET;
  void fetch(`${url}/api/emails/process`, {
    method: "POST",
    headers: secret ? { Authorization: `Bearer ${secret}` } : {},
    signal: AbortSignal.timeout(300_000),
  }).catch(() => {});
}
