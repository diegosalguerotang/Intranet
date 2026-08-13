import { defineConfig } from "vite";
import preact from "@preact/preset-vite";
import tailwindcss from "@tailwindcss/vite";

// El portal vive bajo /portal del dominio principal (microfrontend).
// Preact en lugar de React: mismo código JSX, ~40KB gzip menos — el
// presupuesto es < 60KB para celulares de gama baja con datos limitados.
export default defineConfig({
  base: "/portal/",
  plugins: [preact(), tailwindcss()],
});
