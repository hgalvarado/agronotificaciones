'use client'

/**
 * Pestaña 4 · El tablero de desinfección.
 *
 * Sustituye al reporte de lista por un panel que contesta cuatro
 * preguntas de un vistazo —cuánto, cuántas manzanas, cuántas horas y a
 * cuánto la manzana— y dos de un segundo vistazo: qué turno salió caro y
 * de qué está hecho ese costo.
 *
 * ── De dónde sale cada número, porque NO todos salen del mismo sitio ──
 *
 * Esto importa al leerlo y por eso está escrito aquí y en la pantalla:
 *
 *   · Las tarjetas, los dos gráficos y el rango de fechas salen de las
 *     EJECUCIONES y de la LOGÍSTICA, que son las dos cosas que tienen
 *     fecha. Por eso se pueden filtrar por día.
 *   · La tabla de auditoría sale de `v_desinfeccion_costos`, que reparte
 *     el costo por LOTE —químico y mano de obra entre los lotes de su
 *     ejecución, y la bolsa de acarreo entre las manzanas de su zona en
 *     la TEMPORADA—. Ese reparto es de temporada completa, así que la
 *     tabla no se recorta por fecha: hacerlo repartiría una bolsa entre
 *     una parte de las manzanas y daría un costo por manzana inflado.
 *
 * Las dos lecturas son correctas y responden a preguntas distintas. Lo
 * que sería un error es enseñarlas juntas sin decir cuál es cuál.
 *
 * La reja ABAC la ponen las VISTAS (migración 66): aquí no se filtra por
 * permiso, se filtra por lo que el usuario eligió. Lo que no puede ver,
 * la base no se lo manda.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alerta, Campo, Selector, Entrada, Tarjeta } from '@/components/ui/Primitivos'
import { DataGrid } from '@/components/ui/DataGrid'
import type { ColumnaGrid } from '@/lib/grid/tipos'
import { n2 } from '@/lib/trasplante/formato'
import { canExecuteAction, type Reglas } from '@/lib/permisos/clientABAC'
import {
  AVISO_SIN_MIGRACION,
  leerCostos,
  leerEjecuciones,
  leerLogistica,
} from '@/lib/desinfeccion/repositorioCliente'
import { diagnosticarLectura } from '@/lib/supabase/instalacion'
import type {
  CatalogosDesinfeccion,
  FilaCosto,
  FilaEjecucion,
  FilaLogistica,
} from '@/lib/desinfeccion/tipos'
import {
  COLORES_COMPOSICION,
  GraficoComposicionCosto,
  GraficoCostoPorTurno,
} from './GraficosDashboard'

type FilaAuditoria = FilaCosto & { id: string }

export function DesinfeccionDashboard({
  temporadaId,
  zonas,
  reglas,
  onSinMigracion,
}: {
  /** La temporada manda sobre todo el módulo; se elige arriba, no aquí. */
  temporadaId: string
  zonas: CatalogosDesinfeccion['zonas']
  reglas: Reglas
  onSinMigracion: (falta: boolean, causa?: string | null) => void
}) {
  const [ejecuciones, setEjecuciones] = useState<FilaEjecucion[]>([])
  const [logistica, setLogistica] = useState<FilaLogistica[]>([])
  const [costos, setCostos] = useState<FilaAuditoria[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /* ----------------------------- Filtros ----------------------------- */
  const [zonaId, setZonaId] = useState('')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')

  const avisar = useCallback(
    (falta: boolean, causa: string | null = null) => onSinMigracion(falta, causa),
    [onSinMigracion]
  )

  useEffect(() => {
    let vivo = true
    async function cargar() {
      setCargando(true)
      const [e, l, c] = await Promise.all([
        leerEjecuciones(temporadaId || null),
        leerLogistica(temporadaId || null),
        leerCostos(temporadaId || null),
      ])
      if (!vivo) return
      setCargando(false)

      /*
       * **Un error NO es, por sí solo, una migración que falta.**
       *
       * Decía «casi siempre es falta la migración» y contestaba eso a
       * todo: a un permiso, a un `select` sin conceder, a la caché de
       * esquema de PostgREST sin recargar. Quien ya las tenía puestas
       * las volvía a correr, no pasaba nada, y la pantalla seguía
       * amarilla. Ahora se mira el CÓDIGO, y lo que no es una relación
       * ausente se enseña con su texto.
       *
       * Los tres se piden juntos porque las tarjetas no significan nada
       * sin los tres.
       */
      const malo = [e, l, c].find((r) => r.error)
      if (malo) {
        const d = diagnosticarLectura(AVISO_SIN_MIGRACION, {
          message: malo.error,
          code: malo.codigo,
        })
        avisar(d.falta, d.avisoModulo)
        setError(d.mensaje)
        setEjecuciones([])
        setLogistica([])
        setCostos([])
        return
      }
      avisar(false, null)
      setError(null)
      setEjecuciones(e.datos)
      setLogistica(l.datos)
      setCostos(c.datos)
    }
    void cargar()
    return () => {
      vivo = false
    }
  }, [temporadaId, avisar])

  /* ------------------------- Lo que se filtra ------------------------ */

  /**
   * La fecha con la que se recorta una ejecución.
   *
   * Es la de APLICACIÓN, que es el día del gasto; si todavía no hay
   * —el turno va por el preriego—, la del preriego. Sin ninguna de las
   * dos, el turno no entra en un rango de fechas: no se sabe cuándo fue.
   */
  const fechaDe = (f: FilaEjecucion) => f.fecha_aplicacion ?? f.fecha_preriego ?? ''

  const enRango = useCallback(
    (fecha: string) => {
      if (!fecha) return !desde && !hasta
      if (desde && fecha < desde) return false
      if (hasta && fecha > hasta) return false
      return true
    },
    [desde, hasta]
  )

  const ejecucionesFiltradas = useMemo(
    () =>
      ejecuciones.filter(
        (f) => (!zonaId || f.zona_id === zonaId) && enRango(fechaDe(f))
      ),
    [ejecuciones, zonaId, enRango]
  )

  const logisticaFiltrada = useMemo(
    () => logistica.filter((f) => (!zonaId || f.zona_id === zonaId) && enRango(f.fecha)),
    [logistica, zonaId, enRango]
  )

  // La tabla de auditoría NO se recorta por fecha: su reparto es de
  // temporada completa. Ver la cabecera del archivo.
  const costosFiltrados = useMemo(
    () => costos.filter((f) => !zonaId || f.zona_id === zonaId),
    [costos, zonaId]
  )

  /* ------------------------------ Cuentas ---------------------------- */

  const kpis = useMemo(() => {
    const mz = ejecucionesFiltradas.reduce((a, f) => a + Number(f.mz_regadas ?? 0), 0)
    const horas = ejecucionesFiltradas.reduce((a, f) => a + Number(f.total_horas_riego ?? 0), 0)
    const quimico = ejecucionesFiltradas.reduce((a, f) => a + Number(f.costo_quimico ?? 0), 0)
    const personal = ejecucionesFiltradas.reduce((a, f) => a + Number(f.costo_personal ?? 0), 0)
    const acarreo = logisticaFiltrada.reduce((a, f) => a + Number(f.costo_total ?? 0), 0)
    const total = quimico + personal + acarreo
    return {
      mz,
      horas,
      quimico,
      personal,
      acarreo,
      total,
      // Sin manzanas no es cero: es que todavía no se sabe entre cuántas
      // se reparte. Un cero ahí se leería como «salió gratis».
      costoMz: mz > 0 ? total / mz : null,
      turnos: ejecucionesFiltradas.length,
    }
  }, [ejecucionesFiltradas, logisticaFiltrada])

  /**
   * El costo por manzana de cada turno.
   *
   * Sólo químico y mano de obra: el acarreo se reparte por ZONA y por
   * temporada, no por turno, así que cargárselo a un turno sería
   * inventar un reparto que la base no hace.
   */
  const porTurno = useMemo(
    () =>
      ejecucionesFiltradas
        .map((f) => {
          const mz = Number(f.mz_regadas ?? 0)
          const costo = Number(f.costo_quimico ?? 0) + Number(f.costo_personal ?? 0)
          return {
            etiqueta: `${f.turno_codigo ?? f.turno_nombre ?? '—'} · C${f.ciclo}`,
            valor: mz > 0 ? costo / mz : 0,
            detalle: `${n2(mz)} mz · ${fechaDe(f) || 'sin fecha'}`,
          }
        })
        .filter((b) => b.valor > 0),
    [ejecucionesFiltradas]
  )

  const composicion = useMemo(
    () => [
      { etiqueta: 'Químicos', valor: kpis.quimico, color: COLORES_COMPOSICION.quimico },
      { etiqueta: 'Mano de obra', valor: kpis.personal, color: COLORES_COMPOSICION.personal },
      { etiqueta: 'Acarreo', valor: kpis.acarreo, color: COLORES_COMPOSICION.logistica },
    ],
    [kpis]
  )

  /* ------------------------ La tabla de auditoría -------------------- */

  const columnas = useMemo<ColumnaGrid<FilaAuditoria>[]>(
    () => [
      { campo: 'lote_nomenclatura', label: 'Lote', tipo: 'texto', valor: (f) => f.lote_nomenclatura },
      { campo: 'lote_nombre', label: 'Nombre', tipo: 'texto', valor: (f) => f.lote_nombre ?? '' },
      { campo: 'zona_nombre', label: 'Zona', tipo: 'texto', valor: (f) => f.zona_nombre ?? '' },
      {
        campo: 'mz_regadas',
        label: 'Mz',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.mz_regadas ?? 0),
        etiqueta: (f) => n2(f.mz_regadas),
      },
      {
        campo: 'costo_quimico',
        label: 'Químicos',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.costo_quimico ?? 0),
        etiqueta: (f) => n2(f.costo_quimico),
      },
      {
        campo: 'costo_personal',
        label: 'M. obra',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.costo_personal ?? 0),
        etiqueta: (f) => n2(f.costo_personal),
      },
      {
        campo: 'costo_logistica',
        label: 'Acarreo',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.costo_logistica ?? 0),
        etiqueta: (f) => n2(f.costo_logistica),
      },
      {
        campo: 'costo_total',
        label: 'Costo total',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.costo_total ?? 0),
        etiqueta: (f) => n2(f.costo_total),
      },
      {
        campo: 'costo_mz',
        label: 'Costo / mz',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.costo_mz ?? 0),
        etiqueta: (f) => n2(f.costo_mz),
      },
    ],
    []
  )

  const hayFiltro = Boolean(zonaId || desde || hasta)

  return (
    <div className="flex flex-col gap-3">
      {error && <Alerta>{error}</Alerta>}

      {/* Los filtros, en UNA fila encima de todo: es donde se buscan. */}
      <Tarjeta className="p-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Campo etiqueta="Zona">
            <Selector value={zonaId} onChange={(e) => setZonaId(e.target.value)}>
              <option value="">Todas las zonas</option>
              {zonas.map((z) => (
                <option key={z.id} value={z.id}>
                  {z.nombre}
                </option>
              ))}
            </Selector>
          </Campo>
          <Campo etiqueta="Desde">
            <Entrada type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
          </Campo>
          <Campo etiqueta="Hasta">
            <Entrada type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} />
          </Campo>
        </div>
        <p className="mt-2 text-[11px] text-slate-400">
          La temporada se elige arriba y manda sobre todo el módulo. El rango de fechas recorta
          las tarjetas y los gráficos; la tabla de auditoría no, porque su reparto es de la
          temporada completa.
        </p>
      </Tarjeta>

      {/* Las cuatro tarjetas. Son lo primero que se mira, así que van
          antes de los gráficos y no después. */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Kpi
          etiqueta="Costo / mz"
          valor={kpis.costoMz === null ? '—' : `L ${n2(kpis.costoMz)}`}
          pie={kpis.costoMz === null ? 'Faltan manzanas regadas' : 'Promedio del periodo'}
          destacado
        />
        <Kpi etiqueta="Manzanas tratadas" valor={n2(kpis.mz)} pie={`${kpis.turnos} turno(s)`} />
        <Kpi etiqueta="Horas de riego" valor={`${n2(kpis.horas)} h`} pie="Presurización + inyección + lavado" />
        <Kpi etiqueta="Costo total" valor={`L ${n2(kpis.total)}`} pie="Químicos + obra + acarreo" />
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Tarjeta className="p-4">
          <h3 className="text-sm font-semibold text-slate-900">Costo por manzana, turno a turno</h3>
          <p className="mb-2 text-xs text-slate-400">
            Químico y mano de obra del turno entre sus manzanas. El acarreo no entra: se reparte
            por zona, no por turno.
          </p>
          {cargando ? (
            <p className="py-6 text-center text-xs text-slate-400">Cargando…</p>
          ) : (
            <GraficoCostoPorTurno filas={porTurno} />
          )}
        </Tarjeta>

        <Tarjeta className="p-4">
          <h3 className="text-sm font-semibold text-slate-900">De qué está hecho el costo</h3>
          <p className="mb-3 text-xs text-slate-400">
            Las tres piezas del periodo filtrado.
          </p>
          {cargando ? (
            <p className="py-6 text-center text-xs text-slate-400">Cargando…</p>
          ) : (
            <GraficoComposicionCosto porciones={composicion} />
          )}
        </Tarjeta>
      </div>

      <DataGrid<FilaAuditoria>
        filas={costosFiltrados}
        cargando={cargando}
        columnas={columnas}
        titulo="Auditoría por lote"
        nombreArchivo="desinfeccion-auditoria"
        ordenInicial={{ campo: 'costo_total', direccion: 'desc' }}
        minAncho="1100px"
        seleccionable={false}
        puedeExportar={canExecuteAction(reglas, 'desinfeccion_reporte', 'exportar')}
        vacio={{
          titulo: 'Sin costos todavía',
          descripcion:
            'Aparecen en cuanto haya una ejecución con sus lotes y sus manzanas capturadas.',
        }}
        resumen={(visibles) => (
          <span className="text-xs text-slate-500">
            <strong className="text-slate-900">{n2(visibles.reduce((a, f) => a + Number(f.mz_regadas ?? 0), 0))}</strong>{' '}
            mz · L{' '}
            <strong className="text-slate-900">{n2(visibles.reduce((a, f) => a + Number(f.costo_total ?? 0), 0))}</strong>{' '}
            de la temporada completa
            {hayFiltro ? ' (la zona recorta; la fecha no)' : ''}
          </span>
        )}
      />
    </div>
  )
}

/**
 * Una tarjeta de resumen.
 *
 * Un número grande con su nombre encima y su matiz debajo. El matiz no
 * es decoración: «promedio del periodo» y «faltan manzanas» son dos
 * cosas muy distintas que se verían igual sin él.
 */
function Kpi({
  etiqueta,
  valor,
  pie,
  destacado = false,
}: {
  etiqueta: string
  valor: string
  pie: string
  destacado?: boolean
}) {
  return (
    <Tarjeta className="p-3">
      <p className="truncate text-[11px] font-semibold uppercase tracking-wide text-slate-400">
        {etiqueta}
      </p>
      <p
        className={`mt-0.5 text-xl font-bold tabular-nums ${
          destacado ? 'text-brand-700' : 'text-slate-900'
        }`}
      >
        {valor}
      </p>
      <p className="mt-0.5 truncate text-[11px] text-slate-400">{pie}</p>
    </Tarjeta>
  )
}
