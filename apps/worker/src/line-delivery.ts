/**
 * LINE Push transport. A notification job ID is a persistent UUID and also the
 * LINE retry key: retransmitting an ambiguous 5xx/timeout cannot create a
 * second accepted LINE request within LINE's 24-hour deduplication window.
 *
 * LINE's 2xx/duplicate-409 means API accepted, NOT that a user read or received it.
 */
export class PermanentNotificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentNotificationError";
  }
}

export interface LineAccepted {
  provider: "line";
  detail: string;
}

export async function pushLineMessage(
  jobId: string,
  recipient: string | null,
  text: string,
  accessToken: string | undefined,
  request: typeof fetch = fetch,
): Promise<LineAccepted> {
  if (!accessToken) throw new PermanentNotificationError("LINE_CHANNEL_ACCESS_TOKEN is not configured on the worker");
  if (!recipient) throw new PermanentNotificationError("Missing LINE recipient (user id)");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
    throw new PermanentNotificationError("Notification job ID must be a UUID for LINE retry safety");
  }
  const response = await request("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
      "X-Line-Retry-Key": jobId,
    },
    body: JSON.stringify({ to: recipient, messages: [{ type: "text", text: text.slice(0, 4900) }] }),
    signal: AbortSignal.timeout(12_000),
  });
  if (response.status === 409 && response.headers.get("x-line-accepted-request-id")) {
    return { provider: "line", detail: "LINE already accepted this retry key (409)" };
  }
  if (!response.ok) {
    const description = (await response.text().catch(() => "")).slice(0, 180);
    const message = `LINE API ${response.status}: ${description}`;
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      throw new PermanentNotificationError(message);
    }
    throw new Error(message);
  }
  return { provider: "line", detail: "LINE push accepted (not delivery-confirmed)" };
}
