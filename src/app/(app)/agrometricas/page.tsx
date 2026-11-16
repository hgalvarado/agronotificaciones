import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getPermisos, puede } from '@/lib/auth'
import { Insignia, Tarjeta } from '@/components/ui/Primitivos'
import { IconoMenu } from '@/components/ui/iconosMenu'

/** AgroMétricas: menú de botones grandes (teléfono primero). Las partes se migran de AppSheet una por una. */
const PARTES = [
  { href: '/agrometricas/parametros', titulo: 'Parámetros de riego', detalle: 'Tensiómetros, agua y solución, suelo y clima', icono: 'gota' },
  { href: null, titulo: 'Índice de crecimiento', detalle: 'Curva de crecimiento del cultivo', icono: 'chart' },
  { href: null, titulo: 'Polinización', detalle: 'Colmenas y días de polinización', icono: 'plan' },
  { href: null, titulo: 'Análisis de extractor y savia', detalle: 'Ca, K, Na, NO3, pH, CE, P', icono: 'gauge' },
  { href: null, titulo: 'Registro de productos', detalle: 'Productos de inyección', icono: 'bandeja' },
]

function Contenido({ p }: { p: (typeof PARTES)[number] }) {
  return (
    <div className="flex min-h-20 items-center gap-4 p-4">
      <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${p.href ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400'}`}>
        <IconoMenu nombre={p.icono} className="h-6 w-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-base font-semibold text-slate-900">{p.titulo}</span>
        <span className="block text-sm text-slate-500">{p.detalle}</span>
      </span>
      {!p.href && <Insignia tono="gris">Próximamente</Insignia>}
    </div>
  )
}

export default async function AgroMetricasPage() {
  const permisos = await getPermisos()
  if (!puede(permisos, 'agrometricas', 'ver')) redirect('/')
  return (
    <div className="anim-aparecer mx-auto flex max-w-2xl flex-col gap-3 p-4 lg:p-6">
      <div>
        <h1 className="text-lg font-semibold text-slate-900">AgroMétricas</h1>
        <p className="text-sm text-slate-500">Registros de campo por turno. Los turnos y planes vienen de AGL.</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {PARTES.map((p) =>
          p.href ? (
            <Link key={p.titulo} href={p.href} className="block rounded-2xl transition active:scale-[.99] focus-visible:outline-2 focus-visible:outline-emerald-600">
              <Tarjeta className="h-full hover:border-emerald-300"><Contenido p={p} /></Tarjeta>
            </Link>
          ) : (
            <div key={p.titulo} aria-disabled="true" className="opacity-70"><Tarjeta className="h-full"><Contenido p={p} /></Tarjeta></div>
          ),
        )}
      </div>
    </div>
  )
}
