import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPermisos, puede } from '@/lib/auth'

/** AgroMétricas: menú de botones grandes (teléfono primero). Las partes se migran de AppSheet una por una. */
const PARTES = [
  { href: '/agrometricas/parametros', titulo: 'Parámetros de riego', detalle: 'Tensiómetros, agua y solución, suelo y clima', icono: '💧', lista: true },
  { href: '', titulo: 'Índice de crecimiento', detalle: 'Próximamente', icono: '🌱', lista: false },
  { href: '', titulo: 'Polinización', detalle: 'Próximamente', icono: '🐝', lista: false },
  { href: '', titulo: 'Análisis de extractor y savia', detalle: 'Próximamente', icono: '🧪', lista: false },
  { href: '', titulo: 'Registro de productos', detalle: 'Próximamente', icono: '📦', lista: false },
]

export default async function AgroMetricasPage() {
  const permisos = await getPermisos()
  if (!puede(permisos, 'agrometricas', 'ver')) redirect('/')
  return (
    <div className="anim-aparecer mx-auto flex max-w-2xl flex-col gap-3 p-4 lg:p-6">
      <h1 className="text-xl font-semibold text-[var(--c-texto,inherit)]">AgroMétricas</h1>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {PARTES.map((p) =>
          p.lista ? (
            <Link key={p.titulo} href={p.href} data-parte={p.href}
              className="flex min-h-24 items-center gap-4 rounded-2xl border border-emerald-600/30 bg-emerald-600/10 p-4 text-left shadow-sm transition active:scale-[.98] hover:bg-emerald-600/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-600">
              <span className="text-4xl" aria-hidden>{p.icono}</span>
              <span className="flex flex-col"><span className="text-lg font-semibold">{p.titulo}</span>
                <span className="text-sm opacity-75">{p.detalle}</span></span>
            </Link>
          ) : (
            <div key={p.titulo} aria-disabled="true"
              className="flex min-h-24 items-center gap-4 rounded-2xl border border-dashed border-gray-400/40 p-4 opacity-55">
              <span className="text-4xl grayscale" aria-hidden>{p.icono}</span>
              <span className="flex flex-col"><span className="text-lg font-semibold">{p.titulo}</span>
                <span className="text-sm">{p.detalle}</span></span>
            </div>
          ),
        )}
      </div>
    </div>
  )
}
