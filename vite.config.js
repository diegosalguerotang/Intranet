import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { microfrontends } from '@vercel/microfrontends/experimental/vite'

// App default del grupo de microfrontends de la intranet GrupoER.
// Las plataformas futuras (Portal del Trabajador, Admin del Sistema) se
// agregan como proyectos hijos con su propio patrón de rutas en
// microfrontends.json.
export default defineConfig({
  plugins: [react(), tailwindcss(), microfrontends()],
})
