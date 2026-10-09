import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["audry-qualifiable-lita.ngrok-free.dev"],
  experimental: {
    viewTransition: true,
  },
};

export default nextConfig;
