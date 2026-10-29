import { defineConfig, globalIgnores } from "eslint/config";
import next from "eslint-config-next";

export default defineConfig([
  ...next,
  globalIgnores([".next/**", ".next-e2e/**", "node_modules/**", "public/**", "scripts/**", "next-env.d.ts", "test-results/**", ".data/**"]),
  {
    rules: {
      // user-created pixel art must never be resampled or re-encoded by an image optimiser
      "@next/next/no-img-element": "off",
      // sign-in/out and post-payment redirects deliberately do a FULL page load so the server sees the new session cookie
      "@next/next/no-location-assign-relative-destination": "off",
    },
  },
]);
