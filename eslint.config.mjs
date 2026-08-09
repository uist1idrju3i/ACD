import eslint from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["**/dist/**", "**/generated/**", "node_modules/**"],
  },
  {
    files: ["apps/web/**/*.ts"],
    languageOptions: {
      globals: {
        document: "readonly",
        EventSource: "readonly",
        HTMLCanvasElement: "readonly",
        HTMLDivElement: "readonly",
        HTMLParagraphElement: "readonly",
        HTMLUListElement: "readonly",
        MessageEvent: "readonly",
        URL: "readonly",
        window: "readonly",
      },
    },
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
);
