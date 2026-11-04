import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@pmt/ui", "@pmt/shared"],
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${process.env.API_INTERNAL_URL || `http://127.0.0.1:${process.env.API_PORT || "4000"}`}/api/:path*`,
      },
    ];
  },
  poweredByHeader: false,
};
export default config;
