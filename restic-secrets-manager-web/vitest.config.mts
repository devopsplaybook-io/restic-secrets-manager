import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "happy-dom",
    environmentOptions: {
      happyDOM: {
        url: "http://localhost/",
      },
    },
    include: ["**/*.spec.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "clover"],
    },
  },
});
