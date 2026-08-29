import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  preprocess: vitePreprocess(),
  compilerOptions: {
    // No runtime accessors, no dev-mode instrumentation in production builds.
    accessors: false,
  },
};
