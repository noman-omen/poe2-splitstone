// Minimal lint: eslint's recommended rules, mainly to catch unused and undefined names.
const js = require("@eslint/js");
const globals = require("globals");

// Browser modules attach themselves to window and use each other as globals.
const APP_GLOBALS = Object.fromEntries([
  "Run", "Timers", "Storage2", "Ghost", "Endgame", "AutoSplit", "Charts", "CustomRoute", "Gear",
  "Clean", "Icons", "Levels", "PoB", "CAMPAIGN", "CLASS_NOTES", "ENDGAME", "GEAR_CHECKPOINTS", "TOOLS",
].map(n => [n, "readonly"]));

const RULES = {
  "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }],
  "no-empty": ["error", { allowEmptyCatch: true }],
  // The sanitisers strip control characters on purpose.
  "no-control-regex": "off",
};

module.exports = [
  { ignores: ["**/node_modules/**", "desktop/dist/**", "test-output/**", "tests/output/**"] },
  js.configs.recommended,
  {
    files: ["js/**/*.js", "data/**/*.js", "desktop/overlay/**/*.js"],
    languageOptions: { sourceType: "script", globals: { ...globals.browser, ...APP_GLOBALS, module: "readonly", require: "readonly" } },
    rules: RULES,
  },
  {
    files: ["desktop/src/**/*.js", "desktop/tests/**/*.js", "tests/**/*.js", "eslint.config.js"],
    languageOptions: { sourceType: "commonjs", globals: { ...globals.node } },
    rules: RULES,
  },
];
