import { redirect } from 'next/navigation'

/** AgroMétricas ya no tiene pantalla intermedia: Campo lleva directo a Parámetros de riego. */
export default function AgroMetricasPage() {
  redirect('/agrometricas/parametros')
}
