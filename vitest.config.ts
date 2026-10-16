import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 對齊 tsconfig 的 "@/*" 路徑，讓測試可以直接 import app/ 底下的 route handler
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./", import.meta.url)) } },
});
