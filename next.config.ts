import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    // Prefer AVIF (smaller than WebP) for the heavier photographic assets.
    formats: ["image/avif", "image/webp"],
  },
};

export default nextConfig;
