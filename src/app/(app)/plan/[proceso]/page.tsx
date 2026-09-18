import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getPermisos, puede } from '@/lib/auth'
import { hoyIso, sumarDias } from '@/lib/fechas'
import { PlanProceso } from '@/components/plan/PlanProceso'
import type {
  AvanceRow,
  FilaPlan,
  FilaProveedor,
  FilaProveedorLote,
  LaborDelProceso,
  LineaDiaria,
  Proceso,
  Temporada,
  ZonaRow,
} from '@/components/plan/tipos'
import { Alerta } from '@/components/ui/Primitivos'

type LoteTemporadaRow = {
  id: string
  area_bruta: number | null
  area_neta: number
  lotes: { nomenclatura: string; nombre: string | null } | null
  zonas: { nombre: string; responsable: string | null } | null
}

type PlanRow = {
  id: string
  lote_temporada_id: string
  etapa: number
  area_plan: number
  con_moto: boolean | null
}

/**
 * Permiso de pantalla que corresponde a cada proceso.
 *
 * Sólo APS. El plan por proceso nació pensando en tres (APS, LEV, COS) y
 * los otros dos nunca se usaron: la siembra acabó teniendo su propio
 * módulo, con su plan, su captura y su reporte, y la cosecha no se
 * planifica así. Una ruta que nadie abre pero que sigue compilando es la
 * que alguien encuentra dentro de un año y cree que funciona.
 */
const PANTALLA: Record<string, string> = { APS: 'plan_aps' }

function haceUnMes() {
  return sumarDias(hoyIso(), -30)
}

export default async function PlanProcesoPage({
  params,
  searchParams,
}: {
  params: Promise<{ proceso: string }>
  searchParams: Promise<{ temporada?: string; desde?: string; hasta?: string }>
}) {
  const [{ proceso: codigoProceso }, sp] = await Promise.all([params, searchParams])
  const supabase = await createClient()
  const permisos = await getPermisos()

  const codigo = codigoProceso.toUpperCase()
  const pantalla = PANTALLA[codigo]
  if (!pantalla) notFound()

  if (!puede(permisos, pantalla, 'ver') && !puede(permisos, 'plan', 'ver')) {
    return (
      <div className="mx-auto max-w-5xl p-4 lg:p-6">
        <Alerta tono="ambar">
          No tienes acceso a este plan. Pídeselo al Administrador desde Permisos.
        </Alerta>
      </div>
    )
  }

  const [{ data: procesoData, error: errorProceso }, { data: temporadas }] = await Promise.all([
    supabase
      .from('procesos_sap')
      .select('id, codigo, nombre, descripcion, momento')
      .eq('codigo', codigo)
      .maybeSingle(),
    supabase.from('temporadas').select('id, nombre, activa, fecha_inicio').order('fecha_inicio', {
      ascending: false,
    }),
  ])

  if (errorProceso) {
    return (
      <div className="mx-auto max-w-5xl p-4 lg:p-6">
        <Alerta>
          No se pudo leer el catálogo de procesos: {errorProceso.message}. Si dice que no existe
          «procesos_sap», falta ejecutar la migración 13 en el SQL Editor de Supabase.
        </Alerta>
      </div>
    )
  }

  const proceso = procesoData as Proceso | null
  if (!proceso) notFound()

  const listaTemporadas = (temporadas as Temporada[] | null) ?? []
  const temporadaId =
    sp.temporada ?? listaTemporadas.find((t) => t.activa)?.id ?? listaTemporadas[0]?.id ?? null

  if (!temporadaId) {
    return (
      <div className="mx-auto max-w-5xl p-4 lg:p-6">
        <Alerta tono="ambar">No hay temporadas creadas. Ve a Catálogos → Temporadas.</Alerta>
      </div>
    )
  }

  const desde = sp.desde ?? haceUnMes()
  const hasta = sp.hasta ?? hoyIso()

  // Qué labores han trabajado en este proceso. Ya no se pregunta cuál
  // medir: el plan y las etapas son sólo del emplasticado, así que se
  // toma la labor que lleva la bandera. Si ninguna la tiene todavía
  // (migración 21 sin correr), se usa la de más manzanas, que es lo que
  // hacía antes el valor por defecto del selector.
  const { data: laboresData } = await supabase.rpc('fn_labores_del_proceso', {
    p_temporada_id: temporadaId,
    p_proceso_id: proceso.id,
  })
  const labores = (laboresData as LaborDelProceso[] | null) ?? []
  const laborId = labores.find((l) => l.seguimiento)?.labor_id ?? labores[0]?.labor_id ?? null

  const [
    { data: lotesTemporada },
    { data: planes },
    { data: avance },
    { data: porZona },
    { data: diario },
    { data: proveedores },
    { data: proveedorLote },
  ] = await Promise.all([
    supabase
      .from('lotes_temporada')
      .select('id, area_bruta, area_neta, lotes(nomenclatura, nombre), zonas(nombre, responsable)')
      .eq('temporada_id', temporadaId)
      .eq('activo', true),
    supabase
      .from('planes')
      .select('id, lote_temporada_id, etapa, area_plan, con_moto')
      .eq('temporada_id', temporadaId)
      .eq('proceso_id', proceso.id),
    supabase.rpc('fn_plan_avance_lote', {
      p_temporada_id: temporadaId,
      p_proceso_id: proceso.id,
      p_labor_id: laborId,
    }),
    supabase.rpc('fn_avance_por_zona_etapa', {
      p_temporada_id: temporadaId,
      p_proceso_id: proceso.id,
      p_labor_id: laborId,
    }),
    supabase
      .from('v_avance_diario')
      .select('*')
      .eq('temporada_id', temporadaId)
      .eq('proceso_id', proceso.id)
      // El módulo es sólo de emplasticado: sin este filtro el detalle
      // diario mezclaba el arado y los subtotales no cuadraban con las
      // métricas de arriba, que sí son de una sola labor.
      .eq('labor_id', laborId ?? '')
      .gte('fecha', desde)
      .lte('fecha', hasta)
      .order('fecha', { ascending: false })
      .limit(3000),
    supabase.rpc('fn_avance_por_proveedor', {
      p_temporada_id: temporadaId,
      p_proceso_id: proceso.id,
      p_labor_id: laborId,
    }),
    supabase.rpc('fn_proveedor_por_lote', {
      p_temporada_id: temporadaId,
      p_proceso_id: proceso.id,
      p_labor_id: laborId,
    }),
  ])

  const porLote = new Map<string, PlanRow>()
  for (const p of (planes as PlanRow[] | null) ?? []) porLote.set(p.lote_temporada_id, p)

  const filas: FilaPlan[] = ((lotesTemporada as unknown as LoteTemporadaRow[] | null) ?? [])
    .map((lt) => {
      const lote = Array.isArray(lt.lotes) ? lt.lotes[0] : lt.lotes
      const zona = Array.isArray(lt.zonas) ? lt.zonas[0] : lt.zonas
      const plan = porLote.get(lt.id)
      return {
        id: lt.id,
        plan_id: plan?.id ?? null,
        ut: lote?.nomenclatura ?? '—',
        nombre: lote?.nombre ?? null,
        zona: zona?.nombre ?? null,
        encargado: zona?.responsable ?? null,
        area_bruta: lt.area_bruta,
        area_neta: lt.area_neta,
        etapa: plan?.etapa ?? null,
        area_plan: plan?.area_plan ?? null,
        con_moto: plan?.con_moto ?? null,
      }
    })
    .sort((a, b) => a.ut.localeCompare(b.ut, 'es', { numeric: true }))

  return (
    <div className="anim-aparecer mx-auto flex max-w-6xl flex-col gap-4 p-4 lg:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-slate-900">Emplasticado</h1>
        <p className="text-sm text-slate-400">
          {proceso.nombre} · proceso {proceso.codigo} de SAP. Cuántas manzanas se van a emplasticar,
          en qué etapa, y cuánto se lleva avanzado.
        </p>
      </div>

      <PlanProceso
        proceso={proceso}
        temporadas={listaTemporadas}
        temporadaId={temporadaId}
        labores={labores}
        laborId={laborId}
        filas={filas}
        avance={(avance as AvanceRow[] | null) ?? []}
        porZona={(porZona as ZonaRow[] | null) ?? []}
        diario={(diario as LineaDiaria[] | null) ?? []}
        proveedores={(proveedores as FilaProveedor[] | null) ?? []}
        proveedorLote={(proveedorLote as FilaProveedorLote[] | null) ?? []}
        desde={desde}
        hasta={hasta}
        puedeEditar={puede(permisos, pantalla, 'editar') || puede(permisos, 'plan', 'editar')}
        puedeCrear={puede(permisos, pantalla, 'crear') || puede(permisos, 'plan', 'crear')}
        puedeEliminar={puede(permisos, pantalla, 'eliminar') || puede(permisos, 'plan', 'eliminar')}
        puedeDescargar={
          // «descargar» pasó a llamarse «exportar» en la migración 44:
          // una sola palabra para una sola casilla.
          puede(permisos, pantalla, 'exportar') || puede(permisos, 'plan', 'exportar')
        }
      />
    </div>
  )
}
