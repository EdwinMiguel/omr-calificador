import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // El navegador habla siempre con el mismo origen; el proxy evita CORS
    // y hace que la URL de la API sea un detalle de despliegue, no algo
    // que el código de la UI tenga que conocer.
    proxy: { "/api": { target: "http://localhost:3001", rewrite: (p) => p.replace(/^\/api/, "") } },
  },
});
