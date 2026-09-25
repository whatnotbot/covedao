import type { Config } from "tailwindcss";

/**
 * Cove — "Ledger" design system.
 *
 * The product's whole claim is that its state is derivable and checkable by
 * anyone, so the interface is built like an instrument, not a landing page:
 * monospace throughout, 1px hairlines, zero border radius, bone panels laid on
 * ink. Colour is information — amber is the only accent, and the semantic
 * triad (verified / pending / rejected) is reserved for state, never decoration.
 */
const config: Config = {
  content: ["./src/**/*.{ts,tsx}", "../../packages/ui/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Ground
        ink: "#0B0B0C",
        "ink-2": "#121214",
        "ink-3": "#17171A",
        // Panel
        bone: "#E8E4DB",
        "bone-2": "#D6D1C6",
        "bone-dim": "#9A958A",
        // Hairlines
        rule: "#26262A",
        "rule-bright": "#33333A",
        "rule-bone": "#C2BCAE",
        // Single accent — signal amber
        signal: "#E08A2B",
        "signal-dim": "#8A5518",
        // Semantic: state, never decoration
        verified: "#5E9E76",
        pending: "#C79A3A",
        rejected: "#C4553F",

        // Back-compat aliases so existing pages keep rendering during migration
        bg: "#0B0B0C",
        surface: "#121214",
        border: "#26262A",
        brand: { DEFAULT: "#E08A2B", bright: "#F0A253" },
        accent: "#E08A2B",
        success: "#5E9E76",
        warning: "#C79A3A",
        danger: "#C4553F",
      },
      fontFamily: {
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "SF Mono",
          "Menlo",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
        sans: [
          "ui-monospace",
          "SFMono-Regular",
          "SF Mono",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      borderRadius: {
        none: "0",
        DEFAULT: "0",
        sm: "0",
        md: "0",
        lg: "0",
        xl: "0",
        "2xl": "0",
        full: "9999px", // kept for dots/pills only
      },
      letterSpacing: {
        label: "0.14em",
        wide2: "0.08em",
      },
      fontSize: {
        label: ["0.6875rem", { lineHeight: "1rem", letterSpacing: "0.14em" }],
        display: ["clamp(2.25rem, 6vw, 4rem)", { lineHeight: "1.02", letterSpacing: "-0.02em" }],
      },
    },
  },
  plugins: [],
};

export default config;
