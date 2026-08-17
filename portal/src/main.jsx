import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App.jsx";

// Mismo guard que la app principal: tras un deploy, una pestaña con la
// versión anterior pide chunks que ya no existen — se recarga una vez.
window.addEventListener("vite:preloadError", (evento) => {
  const CLAVE = "recarga-por-deploy";
  const ultima = Number(sessionStorage.getItem(CLAVE) ?? 0);
  if (Date.now() - ultima < 30_000) return;
  sessionStorage.setItem(CLAVE, String(Date.now()));
  evento.preventDefault();
  window.location.reload();
});

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
