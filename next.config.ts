import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: { bodySizeLimit: "4mb" }, // 上架照片（demo 模式以 data URL 暫存）
  },
};

export default nextConfig;
