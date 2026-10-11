import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Locally, forward /api/* to the Express server in server/ (port 4000), so
  // the browser only ever calls /api on the site itself: no CORS, no backend
  // URL in client code. On Vercel this is skipped: vercel.json routes /api/*
  // to the "server" service before a request ever reaches Next.js.
  async rewrites() {
    if (process.env.VERCEL) return [];
    const api = process.env.HUDDLE_API_URL ?? "http://localhost:4000";
    return [{ source: "/api/:path*", destination: `${api}/api/:path*` }];
  },
};

export default nextConfig;
