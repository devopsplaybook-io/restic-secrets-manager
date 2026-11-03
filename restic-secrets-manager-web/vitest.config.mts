import { defineConfig } from "vitest/config";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  test: {
    environment: "happy-dom",
    environmentOptions: {
      happyDOM: {
        url: "http://localhost/",
      },
    },
    setupFiles: ["tests/setup.ts"],
    include: ["**/*.spec.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "clover"],
    },
  },
});
