'use client'

/**
 * AgroMétricas › «Registros de la temporada». EN LÍNEA: pide a la base fn_agm_mis_registros (la base decide qué ve,
 * edita y elimina cada persona; aquí no se mira ningún rol). Tres vistas del mismo conjunto: Rápida (tarjetas),
 * Tabla (DataGrid) y Gráficas; más el Resumen (el de AGL: tarjetas, mapa de calor, líneas por DDT; ResumenRegistros). Lo capturado en este teléfono sin enviar sigue en Parámetros › Mis registros.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Alerta, Boton, BotonLink, EstadoVacio, Insignia, ListaEsqueleto } from '@/components/ui/Primitivos'
import { AvisoFlotante, useAvisoFlotante } from '@/components/ui/AvisoFlotante'
import type { OpcionSelector } from '@/components/ui/SelectorMultiple'
import { useMemoria } from '@/lib/memoria/useMemoria'
import { createClient } from '@/lib/supabase/client'
import type { Rango } from '@/lib/agrometricas/parametros'
import {
  FILTROS_VACIOS, POR_PAGINA, cambiosDeEdicion, filtrarLocal, nombreZona, paramsConsulta, unirPagina, validarEdicion,
  type FiltrosRegistros, type Registro,
} from '@/lib/agrometricas/registrosPura'
import { FiltrosRegistrosPanel } from './FiltrosRegistros'
import { TarjetasRegistros } from './TarjetasRegistros'
import { TablaRegistros } from './TablaRegistros'
import { GraficasRegistros } from './GraficasRegistros'
import { ResumenRegistros } from './ResumenRegistros'
import { DetalleRegistro } from './DetalleRegistro'
import { DetalleIC } from './DetalleIC'
import { GraficasIC, TablaIC, TarjetasIC } from './VistasIC'
import { validarHojas } from '@/lib/agrometricas/registrosIC'
import { ModalEliminar } from './ModalEliminar'
import { EncabezadoModulo } from '@/components/campo/EncabezadoModulo'

type Vista = 'resumen' | 'rapida' | 'tabla' | 'graficas'
type Datos = 'parametros' | 'ic'
const VISTAS: { clave: Vista; texto: string }[] = [
  { clave: 'resumen', texto: 'Resumen' }, { clave: 'rapida', texto: 'Vista rápida' }, { clave: 'tabla', texto: 'Tabla' }, { clave: 'graficas', texto: 'Gráficas' },
]
const DATOS: { clave: Datos; texto: string }[] = [{ clave: 'parametros', texto: 'Parámetros' }, { clave: 'ic', texto: 'Índice de crecimiento' }]
interface TurnoCatalogo { turno: string; temporada: string | null; zona_id: string | null; zona: string | null }
interface LoteVisible { lote: string; nombre: string | null; turnos: string[] }

const MSG_SIN_CONEXION = 'Esta pantalla necesita conexión. Lo que guardaste en este teléfono sin enviar sigue en Parámetros de riego › Mis registros.'
const mensaje = (e: unknown) => (e instanceof Error && e.message && !/failed to fetch|network/i.test(e.message) ? e.message : MSG_SIN_CONEXION)

export function RegistrosTemporada() {
  const [filtros, setFiltros, lista] = useMemoria<FiltrosRegistros>('agrometricas:registros:filtros', FILTROS_VACIOS)
  const [vistaGuardada, setVista, vistaLista] = useMemoria<Vista>('agrometricas:registros:vista', 'resumen')
  const [datos, setDatos, datosLista] = useMemoria<Datos>('agrometricas:registros:datos', 'parametros')
  const esIC = datos === 'ic'
  const vista: Vista = esIC && vistaGuardada === 'resumen' ? 'rapida' : vistaGuardada   // el Resumen es solo de parámetros
  const vistas = esIC ? VISTAS.filter((v) => v.clave !== 'resumen') : VISTAS
  const [registros, setRegistros] = useState<Registro[]>([])
  const [total, setTotal] = useState(0)
  const [recibidos, setRecibidos] = useState(0)
  const [pagina, setPagina] = useState(0)
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [catalogo, setCatalogo] = useState<TurnoCatalogo[]>([])
  const [rangos, setRangos] = useState<Map<string, Rango>>(new Map())
  const [lotes, setLotes] = useState<LoteVisible[]>([])
  const [abiertoId, setAbiertoId] = useState<string | null>(null)
  const [aEliminar, setAEliminar] = useState<{ registros: Registro[]; limpiar?: () => void } | null>(null)
  const { aviso, mostrar } = useAvisoFlotante()
  const lectura = useRef(0)

  const cargar = useCallback(async (pag: number, f: FiltrosRegistros, d: Datos) => {
    const mia = ++lectura.current
    setCargando(true); setError(null)
    try {
      if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new Error(MSG_SIN_CONEXION)
      const { data, error: e } = await createClient().rpc(d === 'ic' ? 'fn_agm_ic_mis_registros' : 'fn_agm_mis_registros', { p: paramsConsulta(f, pag) })
      if (mia !== lectura.current) return
      if (e) throw new Error(e.message)
      const r = data as { total: number; registros: Registro[] }
      setRegistros((previos) => (pag === 0 ? r.registros : unirPagina(previos, r.registros)))
      setRecibidos((n) => (pag === 0 ? r.registros.length : n + r.registros.length))
      setTotal(r.total); setPagina(pag)
    } catch (e) {
      if (mia !== lectura.current) return
      setError(mensaje(e))
    } finally {
      if (mia === lectura.current) setCargando(false)
    }
  }, [])

  // Cada cambio de filtros vuelve a la primera página (espera a que se lea lo recordado: una consulta, no dos)
  const clave = JSON.stringify(filtros)
  useEffect(() => {
    if (!lista || !vistaLista || !datosLista || vista === 'resumen') return   // el Resumen pide lo suyo (ResumenRegistros)
    const t = setTimeout(() => { cargar(0, JSON.parse(clave) as FiltrosRegistros, datos) }, 0)
    const alVolver = () => { cargar(0, JSON.parse(clave) as FiltrosRegistros, datos) }
    window.addEventListener('online', alVolver)
    return () => { clearTimeout(t); window.removeEventListener('online', alVolver) }
  }, [lista, vistaLista, datosLista, vista, datos, clave, cargar])

  // Catálogos para los selectores (turnos activos, rangos y lotes con sus turnos)
  useEffect(() => {
    const supabase = createClient()
    supabase.rpc('fn_agm_mis_turnos').then(({ data }) => {
      const d = data as { turnos?: TurnoCatalogo[]; rangos?: Rango[] } | null
      if (!d) return
      setCatalogo(d.turnos ?? [])
      setRangos(new Map((d.rangos ?? []).map((r) => [r.parametro, r])))
    }, () => {})
    supabase.rpc('fn_agm_lotes_visibles').then(({ data }) => { if (Array.isArray(data)) setLotes(data as LoteVisible[]) }, () => {})
  }, [])

  const opciones = useMemo(() => {
    const unicas = (pares: [string, string][]) => [...new Map(pares).entries()].map(([valor, etiqueta]) => ({ valor, etiqueta })).sort((a, b) => a.etiqueta.localeCompare(b.etiqueta))
    const temporadas: [string, string][] = []
    const zonas: [string, string][] = []
    const turnos: [string, string][] = []
    for (const t of catalogo) {
      if (t.temporada) temporadas.push([t.temporada, t.temporada])
      if (t.zona_id) zonas.push([t.zona_id, nombreZona(t.zona) || t.zona_id])
      turnos.push([t.turno, t.turno])
    }
    for (const r of registros) {
      if (r.temporada) temporadas.push([r.temporada, r.temporada])
      if (r.zona_id) zonas.push([r.zona_id, nombreZona(r.zona) || r.zona_id])
      turnos.push([r.turno, r.turno])
    }
    for (const v of filtros.temporada) temporadas.push([v, v])
    for (const v of filtros.turno) turnos.push([v, v])
    const lotesOp: OpcionSelector[] = lotes.map((l) => ({ valor: l.lote, etiqueta: `${l.lote}${l.nombre ? ` ${l.nombre}` : ''}` }))
    return { temporadas: unicas(temporadas), zonas: unicas(zonas), turnos: unicas(turnos), lotes: lotesOp }
  }, [catalogo, registros, lotes, filtros.temporada, filtros.turno])

  const turnosDeLotes = useMemo(
    () => [...new Set(lotes.filter((l) => filtros.lotes.includes(l.lote)).flatMap((l) => l.turnos))].sort(),
    [lotes, filtros.lotes])

  const visibles = useMemo(() => filtrarLocal(registros, filtros), [registros, filtros])
  const abierto = abiertoId ? registros.find((r) => r.id === abiertoId) ?? null : null
  const hayMas = recibidos < total

  const cambiar = (cambio: Partial<FiltrosRegistros>) => setFiltros((previos) => ({ ...previos, ...cambio }))
  const elegirDatos = (d: Datos) => {
    if (d === datos) return
    setRegistros([]); setRecibidos(0); setTotal(0); setPagina(0); setAbiertoId(null)   // no mezclar filas de parámetros con las de IC
    setDatos(d)
  }
  const parchar = useCallback((nuevo: Record<string, unknown>) => {
    setRegistros((previos) => previos.map((r) => (r.id === nuevo.id ? { ...r, ...nuevo } : r)))
  }, [])

  /** Edición en línea de una celda numérica: misma validación que el formulario; la base decide el permiso. */
  async function editarCelda(fila: Registro, campo: string, valor: unknown) {
    if (esIC) {   // IC: solo se editan las hojas; la base recalcula el IC con la fórmula que ya tenía el registro
      const h = validarHojas(valor === null || valor === undefined ? '' : String(valor))
      if (!h.ok) { mostrar(h.error, 'error'); throw new Error(h.error) }
      if (h.hojas === Number(fila.hojas)) return
      const { data, error: e } = await createClient().rpc('fn_agm_ic_editar', { p: { id: fila.id, hojas: h.hojas } })
      if (e) { mostrar(e.message, 'error'); throw new Error(e.message) }
      const nuevo = (data as { registro?: Record<string, unknown> } | null)?.registro
      if (nuevo) parchar(nuevo)
      mostrar('Cambio guardado.')
      return
    }
    const v = validarEdicion({ [campo]: valor === null || valor === undefined ? '' : String(valor) })
    if (!v.ok) { mostrar(v.errores[campo], 'error'); throw new Error(v.errores[campo]) }
    const cambios = cambiosDeEdicion(fila, v.numeros)
    if (!Object.keys(cambios).length) return
    const { data, error: e } = await createClient().rpc('fn_agm_editar_parametro', { p: { id: fila.id, ...cambios } })
    if (e) { mostrar(e.message, 'error'); throw new Error(e.message) }
    const nuevo = (data as { registro?: Record<string, unknown> } | null)?.registro
    if (nuevo) parchar(nuevo)
    mostrar('Cambio guardado.')
  }

  async function eliminar(motivo: string) {
    if (!aEliminar) return
    const hechos: string[] = []
    try {
      for (const r of aEliminar.registros) {
        const { error: e } = await createClient().rpc(esIC ? 'fn_agm_ic_eliminar' : 'fn_agm_eliminar_parametro', { p: { id: r.id, motivo } })
        if (e) throw new Error(hechos.length ? `${e.message} (se eliminaron ${hechos.length} antes del error).` : e.message)
        hechos.push(r.id)
      }
    } finally {
      if (hechos.length) {
        setRegistros((previos) => previos.filter((r) => !hechos.includes(r.id)))
        setTotal((t) => Math.max(0, t - hechos.length))
        setRecibidos((n) => Math.max(0, n - hechos.length))
      }
    }
    aEliminar.limpiar?.()
    setAEliminar(null); setAbiertoId(null)
    mostrar(hechos.length === 1 ? 'Registro eliminado.' : `${hechos.length} registros eliminados.`)
  }

  return (
    <div className="campo-legible flex flex-col gap-3" data-registros-temporada>
      <BotonLink href="/campo" variante="secundario" tamano="md" className="self-start">← Regresar a Campo</BotonLink>
      <EncabezadoModulo titulo="Registros de parámetros" icono="chart" subtitulo="Lo registrado en tus zonas, por turno y lote" />

      {vista !== 'resumen' && <FiltrosRegistrosPanel filtros={filtros} opciones={opciones} onCambiar={cambiar} turnosDeLotes={turnosDeLotes} />}

      <div role="tablist" aria-label="Qué registros" className="flex gap-1 self-start rounded-xl bg-slate-100 p-1" data-datos>
        {DATOS.map((d) => (
          <button key={d.clave} type="button" role="tab" aria-selected={datos === d.clave} onClick={() => elegirDatos(d.clave)} data-datos-opcion={d.clave}
            className={`min-h-11 rounded-lg px-4 text-sm font-semibold transition-colors ${datos === d.clave ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600'}`}>
            {d.texto}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div role="tablist" aria-label="Vista" className="flex gap-1 rounded-xl bg-slate-100 p-1" data-vistas>
          {vistas.map((v) => (
            <button key={v.clave} type="button" role="tab" aria-selected={vista === v.clave} onClick={() => setVista(v.clave)} data-vista={v.clave}
              className={`min-h-11 rounded-lg px-4 text-sm font-semibold transition-colors ${vista === v.clave ? 'bg-white text-brand-800 shadow-sm' : 'text-slate-600'}`}>
              {v.texto}
            </button>
          ))}
        </div>
        {vista !== 'resumen' && <Insignia tono="gris">{visibles.length} de {total} registros</Insignia>}
      </div>

      {vista === 'resumen' && vistaLista && <ResumenRegistros />}

      {vista !== 'resumen' && error && (
        <div className="flex flex-col gap-2" data-error>
          <Alerta tono="rojo">{error}</Alerta>
          <Boton type="button" variante="secundario" className="self-start" onClick={() => cargar(0, filtros, datos)}>Reintentar</Boton>
        </div>
      )}

      {vista !== 'resumen' && !error && cargando && !registros.length && <ListaEsqueleto filas={4} />}
      {vista !== 'resumen' && !error && !cargando && !visibles.length && (
        <EstadoVacio titulo="Sin registros" descripcion="No hay registros con estos filtros. Prueba otra temporada, turno o rango de fechas." />
      )}

      {vista !== 'resumen' && visibles.length > 0 && (
        <div className={cargando ? 'opacity-60 transition-opacity' : ''}>
          {vista === 'rapida' && (esIC ? <TarjetasIC registros={visibles} onAbrir={(r) => setAbiertoId(r.id)} /> : <TarjetasRegistros registros={visibles} onAbrir={(r) => setAbiertoId(r.id)} />)}
          {vista === 'tabla' && (() => {
            const Tabla = esIC ? TablaIC : TablaRegistros
            return (
              <Tabla registros={visibles} cargando={cargando} onEditarCelda={editarCelda} onAbrir={(r) => setAbiertoId(r.id)}
                onEliminarVarios={(ids, limpiar) => setAEliminar({ registros: registros.filter((r) => ids.includes(r.id)), limpiar })} />
            )
          })()}
          {vista === 'graficas' && (esIC ? <GraficasIC registros={visibles} /> : <GraficasRegistros registros={visibles} />)}
        </div>
      )}

      {vista !== 'resumen' && !error && hayMas && (
        <Boton type="button" variante="secundario" tamano="lg" disabled={cargando} onClick={() => cargar(pagina + 1, filtros, datos)} data-ver-mas>
          {cargando ? 'Cargando…' : `Ver más (${Math.min(POR_PAGINA, total - recibidos)} de ${total - recibidos} restantes)`}
        </Boton>
      )}

      {abierto && !aEliminar && (esIC
        ? <DetalleIC registro={abierto} onCerrar={() => setAbiertoId(null)} onGuardado={(n) => { parchar(n); mostrar('Cambio guardado.') }}
            onPedirEliminar={(r) => setAEliminar({ registros: [r] })} />
        : <DetalleRegistro registro={abierto} rangos={rangos} onCerrar={() => setAbiertoId(null)} onGuardado={(n) => { parchar(n); mostrar('Cambio guardado.') }}
            onPedirEliminar={(r) => setAEliminar({ registros: [r] })} />)}
      {aEliminar && <ModalEliminar registros={aEliminar.registros} onCerrar={() => setAEliminar(null)} onConfirmar={eliminar} />}
      <AvisoFlotante aviso={aviso} />
    </div>
  )
}
