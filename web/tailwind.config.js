/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        sigil: {
          bg: "#0a0a0f",
          surface: "#12121a",
          border: "#1e1e2e",
          accent: "#7ff0c4",
          "accent-dim": "rgba(127, 240, 196, 0.15)",
          muted: "#6b6b8a",
          text: "#d9d9ef",
          warn: "#ffc15c",
          danger: "#ff7b9c",
        },
      },
    },
  },
  plugins: [],
};
