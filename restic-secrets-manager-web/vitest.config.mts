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
    // common-web ships raw .vue/.ts sources that must go through Vite's
    // transform pipeline in tests too.
    server: {
      deps: {
        inline: ["@devopsplaybook.io/common-web"],
      },
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "clover"],
    },
  },
});
