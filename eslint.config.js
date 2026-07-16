// With no build step, a syntax error or stale reference in the viewer only
// surfaces when that code path runs in a browser; linting every file is the
// safety net.
import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/", "tools/"] },
  js.configs.recommended,
  {
    files: ["js/**/*.js", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: globals.browser,
    },
  },
];
