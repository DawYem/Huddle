// What arrives on Spectrum's app.messages: real texts, but also read receipts,
// typing indicators, reactions and group changes. Only real texts from a person
// get a reply. Answering a read receipt makes every reply produce another
// receipt, which loops forever.
export interface InboundLike {
  content: { type: string; text?: string };
  sender?: { id?: string; kind?: string };
  direction?: string;
}

export function textToAnswer(message: InboundLike): string | undefined {
  if (message.content.type !== 'text') return undefined;
  if (message.direction === 'outbound' || message.sender?.kind === 'agent') return undefined;
  const text = message.content.text?.trim();
  return text ? text : undefined;
}

// Safety net for any loop we haven't thought of: stop replying to a fan who
// has triggered more than `limit` replies in the last `windowMs`.
export class ReplyGuard {
  private readonly sent = new Map<string, number[]>();

  constructor(
    private readonly limit = 8,
    private readonly windowMs = 60_000,
  ) {}

  allow(handle: string, now = Date.now()): boolean {
    const recent = (this.sent.get(handle) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.limit) {
      this.sent.set(handle, recent);
      return false;
    }
    recent.push(now);
    this.sent.set(handle, recent);
    return true;
  }
}
