export default [
  { ignores: ["dist/**"] },
  {
    files: ["**/*.{js,jsx}"],
    languageOptions: { parserOptions: { ecmaFeatures: { jsx: true } } },
    rules: {
      "eqeqeq": "error",
      "no-undef": "error",
      "no-unreachable": "error",
    },
  },
  {
    files: ["src/**/*.{js,jsx}"],
    languageOptions: { globals: { document: "readonly", window: "readonly", URLSearchParams: "readonly", URL: "readonly", Blob: "readonly", crypto: "readonly", fetch: "readonly", globalThis: "readonly", AbortController: "readonly", setTimeout: "readonly", clearTimeout: "readonly" } },
  },
  {
    files: ["tests/**/*.{js,jsx}"],
    languageOptions: { globals: { URL: "readonly", structuredClone: "readonly" } },
  },
];
