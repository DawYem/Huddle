import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadEnv } from 'dotenv';

// Read server/.env no matter which folder the process starts in (vercel dev
// starts it from the repo root). On Vercel itself, keys come from the
// project's Environment Variables instead and no .env file exists.
// Guarded: a bundler may rewrite import.meta.url, and that must never stop the server.
try {
  const serverDir = fileURLToPath(new URL(import.meta.url.includes('/dist/') ? '../../' : '../', import.meta.url));
  loadEnv({ path: [join(process.cwd(), '.env'), join(serverDir, '.env')], quiet: true });
} catch {
  loadEnv({ quiet: true });
}
import type { SpectrumCredentials } from './photon/users.js';

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
  // Photon project credentials. When set, website sign-ups are added to the
  // project's Users list so the agent can text them.
  spectrum?: SpectrumCredentials;
  // Signs the location links the agent texts. Defaults to the Photon secret.
  linkSecret?: string;
  // Public site that hosts /locate, e.g. https://huddling.vercel.app.
  siteUrl?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Missing keys don't crash the server: Google-backed routes answer 503 and
  // /api/health lists what's missing, so a deploy without its env vars is obvious.
  const googleApiKey = env.GOOGLE_MAPS_API_KEY ?? '';
  return {
    googleApiKey,
    // 4000 so it can run next to the Next.js site on 3000.
    port: Number(env.PORT || 4000),
    rateLimitPerMinute: Number(env.RATE_LIMIT_PER_MINUTE ?? 60),
    cacheTtlMs: Number(env.CACHE_TTL_SECONDS ?? 300) * 1000,
    geminiApiKey: env.GEMINI_API_KEY || undefined,
    geminiModel: env.GEMINI_MODEL || 'gemini-3.8-flash',
    huddleNumber: env.HUDDLE_NUMBER || undefined,
    linkSecret: env.HUDDLE_LINK_SECRET || env.SPECTRUM_PROJECT_SECRET || undefined,
    siteUrl: (env.HUDDLE_SITE_URL || 'https://huddling.vercel.app').replace(/\/$/, ''),
    spectrum:
      env.SPECTRUM_PROJECT_ID && env.SPECTRUM_PROJECT_SECRET
        ? {
            projectId: env.SPECTRUM_PROJECT_ID,
            projectSecret: env.SPECTRUM_PROJECT_SECRET,
            userType: env.SPECTRUM_USER_TYPE === 'dedicated' ? 'dedicated' : 'shared',
            dedicatedLine: env.HUDDLE_NUMBER || undefined,
          }
        : undefined,
  };
}
