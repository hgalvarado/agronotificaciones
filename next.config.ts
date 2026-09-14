import type { NextConfig } from "next";

/* El build también cuenta los días en Honduras: sin esto, una página
   estática generada de noche en un servidor UTC nace fechada al día
   siguiente. En tiempo de ejecución lo vuelve a fijar `instrumentation`. */
process.env.TZ = process.env.TZ ?? "America/Tegucigalpa";

const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
