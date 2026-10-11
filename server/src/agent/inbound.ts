import { extractLatLng, type LatLng } from '../huddle/mapsLink.js';
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

// A tap on one of our polls comes back as poll_option content.
export function pollChoice(message: { content: { type: string; title?: string; selected?: boolean } }): string | undefined {
  const c = message.content;
  return c.type === 'poll_option' && c.selected !== false && c.title ? c.title : undefined;
}

// iMessage "Send My Current Location" / a shared pin is a vCard holding a
// maps.apple.com?ll=lat,lng link. Depending on how Photon delivers it, it
// shows up as contact content, a rich link, or a .vcf attachment.
export async function locationFrom(message: {
  content: {
    type: string;
    urls?: unknown;
    url?: string;
    name?: string;
    mimeType?: string;
    raw?: unknown;
    read?: () => Promise<Buffer | Uint8Array | ArrayBuffer>;
  };
}): Promise<LatLng | undefined> {
  const c = message.content;
  if (c.type === 'contact') {
    return extractLatLng(JSON.stringify([c.urls ?? null, c.raw ?? null]));
  }
  if (c.type === 'richlink') return extractLatLng(c.url);
  if (c.type === 'attachment' && c.read && (/vcard|vcf/i.test(c.mimeType ?? '') || /\.vcf$/i.test(c.name ?? ''))) {
    const bytes = await c.read();
    return extractLatLng(Buffer.from(bytes as ArrayBuffer).toString('utf8'));
  }
  return undefined;
}
