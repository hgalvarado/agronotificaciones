import { createClient } from '@/lib/supabase/server'
import {
  LotesTemporada,
  type AsignacionLote,
  type LoteDisponible,
  type TemporadaOpcion,
} from '@/components/admin/LotesTemporada'
import { Alerta } from '@/components/ui/Primitivos'

type FilaAsignacion = {
  id: string
  lote_id: string
  zona_id: string | null
  area_bruta: number | null
  area_neta: number
  ciclo: number | null
  activo: boolean
  lotes:
    | { nomenclatura: string; nombre: string | null }
    | { nomenclatura: string; nombre: string | null }[]
    | null
}

export default async function LotesPage({
  searchParams,
}: {
  searchParams: Promise<{ temporada?: string }>
}) {
  const { temporada: temporadaParam } = await searchParams
  const supabase = await createClient()

  const { data: temporadasRaw } = await supabase
    .from('temporadas')
    .select('id, nombre, activa')
    .order('fecha_inicio', { ascending: false })

  const temporadas = (temporadasRaw as TemporadaOpcion[] | null) ?? []

  // La vista arranca siempre en la temporada ACTIVA; el parámetro sólo
  // gana si apunta a una temporada que existe, así que un enlace viejo
  // con una temporada borrada no deja la pantalla en blanco.
  const temporada =
    temporadas.find((t) => t.id === temporadaParam) ??
    temporadas.find((t) => t.activa) ??
    temporadas[0] ??
    null

  if (!temporada) {
    return (
      <div className="anim-aparecer mx-auto max-w-5xl p-4 lg:p-6">
        <Alerta tono="ambar">
          No hay temporadas creadas. Ve a Catálogos → Temporadas, crea una y actívala con el
          interruptor.
        </Alerta>
      </div>
    )
  }

  const [{ data: asignadosRaw }, { data: todosLotes }, { data: zonas }] = await Promise.all([
    supabase
      .from('lotes_temporada')
      .select('id, lote_id, zona_id, area_bruta, area_neta, ciclo, activo, lotes(nomenclatura, nombre)')
      .eq('temporada_id', temporada.id),
    supabase
      .from('lotes')
      .select('id, nomenclatura, nombre')
      .eq('activo', true)
      .order('nomenclatura'),
    supabase.from('zonas').select('*').eq('activo', true).order('nombre'),
  ])

  const asignados: AsignacionLote[] = ((asignadosRaw as FilaAsignacion[] | null) ?? [])
    .map((a) => {
      const lote = Array.isArray(a.lotes) ? a.lotes[0] : a.lotes
      return {
        id: a.id,
        lote_id: a.lote_id,
        zona_id: a.zona_id,
        area_bruta: a.area_bruta,
        area_neta: a.area_neta,
        ciclo: a.ciclo ?? 1,
        activo: a.activo,
        nomenclatura: lote?.nomenclatura ?? '—',
        nombre: lote?.nombre ?? null,
      }
    })
    .sort((a, b) => a.nomenclatura.localeCompare(b.nomenclatura))

  const yaAsignados = new Set(asignados.map((a) => a.lote_id))
  const disponibles: LoteDisponible[] = ((todosLotes as LoteDisponible[] | null) ?? []).filter(
    (l) => !yaAsignados.has(l.id)
  )

  return (
    <div className="anim-aparecer mx-auto flex max-w-5xl flex-col gap-4 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Lotes de la temporada</h1>
        <p className="text-sm text-slate-400">
          Qué lotes están en juego este ciclo, con qué área y en qué zona. Al abrir una temporada
          nueva, cópialos de la anterior en vez de volver a cargarlos.
        </p>
      </div>

      <LotesTemporada
        temporadaId={temporada.id}
        temporadaNombre={temporada.nombre}
        temporadaEsActiva={temporada.activa}
        temporadas={temporadas}
        asignados={asignados}
        disponibles={disponibles}
        zonas={zonas ?? []}
      />
    </div>
  )
}
