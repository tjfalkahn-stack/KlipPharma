import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      "node_modules/**",
      "storage/**",
      ".npm-cache/**",
      "public/app.js",
      "public/campaigns.js",
      "server.js",
      "lib/youtube.js",
      "test/upload-sessions.test.js",
    ],
  },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      "no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
];
