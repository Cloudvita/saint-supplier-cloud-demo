import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        saint: {
          50: "#eef4ff",
          100: "#d9e6ff",
          500: "#3b6fd4",
          600: "#2f59ab",
          700: "#264785",
          900: "#16294d",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
