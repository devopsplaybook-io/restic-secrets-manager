// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  ssr: false,
  experimental: {
    viteEnvironmentApi: true,
  },
  app: {
    head: {
      charset: "utf-16",
      viewport:
        "width=device-width, initial-scale=1, height=device-height, initial-scale=1.0, maximum-scale=1.0, user-scalable=no",
      title: "Restic Secrets Manager",
      meta: [
        { name: "description", content: "restic-secrets-manager" },
        { name: "theme-color", content: "#212121" },
      ],
      link: [{ rel: "icon", type: "image/svg+xml", href: "/images/logo.svg" }],
    },
  },
  css: [
    "bootstrap-icons/font/bootstrap-icons.css",
    "~/assets/css/tokens.css",
    "~/assets/css/base.css",
    "~/assets/css/main.css",
  ],
  modules: ["@pinia/nuxt", "@vite-pwa/nuxt"],
  imports: {
    dirs: ["./stores"],
  },
  pinia: {
    autoImports: ["defineStore", "acceptHMRUpdate"],
  },
  pwa: {
    registerType: "autoUpdate",
    workbox: {
      globPatterns: ["images/*.{png,svg}"],
      navigateFallback: undefined,
      skipWaiting: true,
      clientsClaim: true,
    },
    manifest: {
      name: "Restic Secrets Manager",
      short_name: "Restic Secrets Manager",
      lang: "en-US",
      start_url: "/",
      display: "standalone",
      background_color: "#12191f",
      theme_color: "#12191f",
      icons: [
        {
          src: "images/logo.svg",
          sizes: "512x512",
          type: "image/svg+xml",
        },
        {
          src: "images/logo-512.png",
          sizes: "512x512",
          type: "image/png",
        },
      ],
    },
  },
});
