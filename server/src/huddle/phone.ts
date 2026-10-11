// Turns what people type ("(404) 555-0123", "404.555.0123", "+44 20 7946 0958")
// into E.164, the format iMessage and Photon use as a handle.
// Numbers without a country code are treated as US/Canada (+1).
export function toE164(input: string): string | undefined {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) {
    return /^[1-9]\d{7,14}$/.test(digits) ? `+${digits}` : undefined;
  }
  if (digits.length === 10 && /^[2-9]/.test(digits)) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1') && /^1[2-9]/.test(digits)) return `+${digits}`;
  return undefined;
}

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,255}\.[^\s@]{2,}$/;

export function isEmail(input: string): boolean {
  return EMAIL.test(input.trim());
}
