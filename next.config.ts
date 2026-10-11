import type { NextConfig } from "next";

// The Express server in server/ (port 4000 by default). Set HUDDLE_API_URL to
// point the site at a deployed backend instead.
const API_URL = process.env.HUDDLE_API_URL ?? "http://localhost:4000";

const nextConfig: NextConfig = {
  // The browser only ever calls /api/* on the site itself; Next forwards it to
  // the server, so there is no CORS setup and no backend URL in client code.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
