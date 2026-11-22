import { redirect } from 'next/navigation'
import { getPermisos, puede } from '@/lib/auth'
import { FormulaIC } from '@/components/agrometricas/FormulaIC'

/** Administración › Fórmula del índice de crecimiento (migración 127). Solo quien tiene «Configurar rangos» en AgroMétricas. */
export default async function FormulaICPage() {
  const permisos = await getPermisos()
  if (!puede(permisos, 'agrometricas', 'configurar_rangos')) redirect('/')
  return (
    <div className="anim-aparecer mx-auto flex max-w-3xl flex-col gap-4 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Fórmula del índice de crecimiento (IC)</h1>
        <p className="text-sm text-slate-400">
          IC = hojas ÷ DDT^exponente ÷ divisor, y el plan por DDT. Cambiarla no recalcula lo ya registrado salvo que se pida.
        </p>
      </div>
      <FormulaIC />
    </div>
  )
}
