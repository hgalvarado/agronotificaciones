import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPermisos, getUsuarioActual, puede } from '@/lib/auth'
import { Alerta } from '@/components/ui/Primitivos'
import { IconChevronLeft } from '@/components/ui/Icons'
import { SiembraForm } from '@/components/trasplante/SiembraForm'
import { leerCatalogos } from '@/lib/trasplante/repositorio'

type Temporada = { id: string; nombre: string; activa: boolean }

export default async function NuevaSiembraPage({
  searchParams,
}: {
  searchParams: Promise<{ temporada?: string }>
}) {
  const permisos = await getPermisos()
  if (!puede(permisos, 'trasplante', 'crear')) redirect('/trasplante')

  const sp = await searchParams
  const supabase = await createClient()
  const usuario = await getUsuarioActual()

  const { data: temporadas } = await supabase
    .from('temporadas')
    .select('id, nombre, activa')
    .order('fecha_inicio', { ascending: false })

  const lista = (temporadas as Temporada[] | null) ?? []
  const temporada = lista.find((t) => t.id === sp.temporada) ?? lista.find((t) => t.activa) ?? lista[0]

  if (!temporada || !usuario) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Alerta tono="ambar">Falta crear la temporada antes de capturar siembras.</Alerta>
      </div>
    )
  }

  const catalogos = await leerCatalogos(temporada.id)

  return (
    <div className="anim-aparecer mx-auto flex max-w-3xl flex-col gap-4 p-4 lg:p-6">
      <Link
        href="/trasplante"
        className="inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-800"
      >
        <IconChevronLeft className="h-4 w-4" />
        Volver a trasplante
      </Link>

      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Siembra diaria</h1>
        <p className="text-sm text-slate-400">
          {temporada.nombre} · la semana, el cultivo y las plantas por manzana se calculan solos.
        </p>
      </div>

      {catalogos.variedades.length === 0 ? (
        <Alerta tono="ambar">
          No hay variedades en el catálogo. Créalas en Catálogos → Variedades antes de capturar.
        </Alerta>
      ) : (
        <SiembraForm
          temporadaId={temporada.id}
          usuarioId={usuario.id}
          variedades={catalogos.variedades}
          materiales={catalogos.materiales}
          lotes={catalogos.lotes}
        />
      )}
    </div>
  )
}
