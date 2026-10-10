import 'dotenv/config';

export interface Config {
  googleApiKey: string;
  port: number;
  rateLimitPerMinute: number;
  cacheTtlMs: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const googleApiKey = env.GOOGLE_MAPS_API_KEY ?? '';
  if (!googleApiKey) {
    throw new Error('GOOGLE_MAPS_API_KEY is not set. Copy .env.example to .env and fill it in.');
  }
  return {
    googleApiKey,
    port: Number(env.PORT ?? 3000),
    rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE ?? 60),
    cacheTtlMs: Number(env.CACHE_TTL_SECONDS ?? 300) * 1000,
  };
}
