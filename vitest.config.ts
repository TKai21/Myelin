import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    // Vitest 5 exits non-zero when no test files exist yet. This repo has
    // no tests until Task 2+ adds them, so allow a clean "no tests found" run.
    passWithNoTests: true,
  },
});
