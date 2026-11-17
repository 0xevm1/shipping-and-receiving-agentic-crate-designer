// Tailwind v4 through Next's built-in PostCSS support (#54). This replaces the scaffold's
// `@tailwindcss/turbopack` loader rule, which broke CSS modules and hot-reloaded globals.css one
// edit late. Tailwind only does work in files that `@import "tailwindcss"` (src/app/globals.css).
const config = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default config;
