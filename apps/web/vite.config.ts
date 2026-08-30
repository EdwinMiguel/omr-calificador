import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // El navegador habla siempre con el mismo origen; el proxy evita CORS
    // y hace que la URL de la API sea un detalle de despliegue, no algo
    // que el código de la UI tenga que conocer.
    //
    // SIN `rewrite`: las rutas de Fastify están registradas CON el prefijo
    // /api (server.ts), justo para poder servir la web construida y la API
    // desde el mismo proceso en producción. Reescribir /api/batches a
    // /batches aquí lo desalinea con esas rutas — Fastify no encuentra
    // "/batches" y cae en el manejador de SPA, que devuelve el HTML de la
    // página con status 200 en vez de un 404 real. El cliente recibe HTML
    // donde esperaba JSON y falla en silencio, sin ningún error visible.
    proxy: { "/api": "http://localhost:3001" },
  },
});
