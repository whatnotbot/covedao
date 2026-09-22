import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{ts,tsx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#0a0a0f",
        surface: "#12121a",
        border: "#23232f",
        brand: {
          DEFAULT: "#7c5cff",
          bright: "#9d86ff",
        },
        accent: "#22d3ee",
        success: "#34d399",
        warning: "#fbbf24",
        danger: "#f87171",
      },
    },
  },
  plugins: [],
};

export default config;
