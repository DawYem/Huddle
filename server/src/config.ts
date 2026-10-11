import 'dotenv/config';

export interface Config {
  googleApiKey: string;
  port: number;
  rateLimitPerMinute: number;
  cacheTtlMs: number;
  // Optional. Without a key, /api/recommendations uses its nearest-open fallback.
  geminiApiKey?: string;
  geminiModel?: string;
  // The Huddle iMessage number, shown to fans after they sign up on the website.
  huddleNumber?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const googleApiKey = env.GOOGLE_MAPS_API_KEY ?? '';
  if (!googleApiKey) {
    throw new Error('GOOGLE_MAPS_API_KEY is not set. Copy .env.example to .env and fill it in.');
  }
  return {
    googleApiKey,
    // 4000 so it can run next to the Next.js site on 3000.
    port: Number(env.PORT || 4000),
    rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE ?? 60),
    cacheTtlMs: Number(env.CACHE_TTL_SECONDS ?? 300) * 1000,
    geminiApiKey: env.GEMINI_API_KEY || undefined,
    geminiModel: env.GEMINI_MODEL || 'gemini-3.8-flash',
    huddleNumber: env.HUDDLE_NUMBER || undefined,
  };
}
