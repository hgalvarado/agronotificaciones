import type { NextConfig } from "next";

/* El build también cuenta los días en Honduras: sin esto, una página
   estática generada de noche en un servidor UTC nace fechada al día
   siguiente. En tiempo de ejecución lo vuelve a fijar `instrumentation`. */
process.env.TZ = process.env.TZ ?? "America/Tegucigalpa";

const nextConfig: NextConfig = {
  /* El Manual del estacionero se lee del disco en /fertirriego (botón «¿Cómo se usa?»): que viaje al despliegue. */
  outputFileTracingIncludes: {
    "/fertirriego": ["./docs/manuales/01-estacionero-fertirriego.md"],
  },
  /* El service worker de Fertirriego (public/sw.js) nunca se guarda en caché del navegador: así una versión
     nueva llega en la siguiente visita. Solo afecta a ese archivo. */
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
};

export default nextConfig;
