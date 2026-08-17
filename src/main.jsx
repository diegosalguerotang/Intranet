import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";

// Tras un deploy, una pestaña abierta con la versión anterior pide chunks
// cuyo hash ya no existe (y el catch-all del SPA responde HTML): el import
// dinámico falla con "Failed to fetch dynamically imported module". Se
// recarga la página para tomar la versión nueva; el guard de 30 s evita un
// bucle si el fallo persistiera por otra causa.
window.addEventListener("vite:preloadError", (evento) => {
  const CLAVE = "recarga-por-deploy";
  const ultima = Number(sessionStorage.getItem(CLAVE) ?? 0);
  if (Date.now() - ultima < 30_000) return; // deja ver el error real
  sessionStorage.setItem(CLAVE, String(Date.now()));
  evento.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
