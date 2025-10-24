/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          50: "#e6fffa",
          100: "#b2f5ea",
          200: "#81e6d9",
          300: "#4fd1c5",
          400: "#38b2ac",
          500: "#1abc9c",
          600: "#159a80",
          700: "#107d68",
          800: "#0b6150",
          900: "#06463a"
        },
        brand: {
          50: "#f5f7fb",
          100: "#e6ecf5",
          200: "#c1ccde",
          300: "#9badc7",
          400: "#58709b",
          500: "#3f587f",
          600: "#2f4564",
          700: "#1f3a5f",
          800: "#152740",
          900: "#0b1325"
        }
      }
    }
  },
  plugins: []
};
