'use client'

/**
 * Plan de siembra: qué se va a sembrar en cada lote, ciclo y variedad.
 *
 * Un lote puede repetirse con la misma variedad y el mismo ciclo —dos
 * fechas, dos distancias—, así que la lista es una tabla de líneas y no
 * una matriz: cada línea se edita y se elimina por su cuenta.
 *
 * La pantalla recoge y lista; validar está en `validacion`, escribir en
 * `repositorioCliente`, y la mecánica de la tabla en `DataGrid`.
 */

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Alerta, Boton, Campo, Entrada, Selector, Tarjeta } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { DataGrid } from '@/components/ui/DataGrid'
import { BotonFila } from '@/components/ui/BotonFila'
import type { ColumnaGrid } from '@/lib/grid/tipos'
import { mensajeDeError } from '@/lib/errores'
import { validarPlan } from '@/lib/trasplante/validacion'
import {
  CICLOS_SIEMBRA,
  type FilaPlanSiembra,
  type LoteOpcion,
  type Variedad,
} from '@/lib/trasplante/tipos'
import { n2 } from '@/lib/trasplante/formato'
import { EditarPlanModal } from './EditarPlanModal'
import { ImportarPlanSiembra } from './ImportarPlanSiembra'

export function PlanSiembra({
  temporadaId,
  filas,
  lotes,
  variedades,
  puedeEditar,
  puedeEliminar,
}: {
  temporadaId: string
  filas: FilaPlanSiembra[]
  lotes: LoteOpcion[]
  variedades: Variedad[]
  puedeEditar: boolean
  puedeEliminar: boolean
}) {
  const supabase = createClient()
  const router = useRouter()

  const [loteId, setLoteId] = useState('')
  const [variedadId, setVariedadId] = useState('')
  const [ciclo, setCiclo] = useState('1')
  const [area, setArea] = useState('')
  const [fecha, setFecha] = useState('')
  const [distancia, setDistancia] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [importar, setImportar] = useState(false)
  const [editando, setEditando] = useState<FilaPlanSiembra | null>(null)
  const [enMasa, setEnMasa] = useState<string[] | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const columnas = useMemo<ColumnaGrid<FilaPlanSiembra>[]>(
    () => [
      {
        campo: 'ut',
        label: 'UT',
        tipo: 'seleccion',
        valor: (f) => f.ut,
        render: (f) => <span className="font-semibold text-slate-800">{f.ut}</span>,
      },
      { campo: 'lote_nombre', label: 'Lote', tipo: 'seleccion', valor: (f) => f.lote_nombre },
      { campo: 'zona', label: 'Zona', tipo: 'seleccion', valor: (f) => f.zona },
      { campo: 'ciclo', label: 'Ciclo', tipo: 'seleccion', numero: true, valor: (f) => f.ciclo },
      { campo: 'variedad', label: 'Variedad', tipo: 'seleccion', valor: (f) => f.variedad },
      {
        campo: 'area_plan',
        label: 'Área plan',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.area_plan),
        etiqueta: (f) => n2(f.area_plan),
        render: (f) => <span className="font-semibold text-slate-900">{n2(f.area_plan)}</span>,
      },
      {
        campo: 'fecha_siembra',
        label: 'Fecha prevista',
        tipo: 'fecha',
        valor: (f) => f.fecha_siembra,
      },
      {
        campo: 'distancia_siembra',
        label: 'Distancia',
        tipo: 'texto',
        valor: (f) => f.distancia_siembra,
      },
    ],
    []
  )

  async function agregar() {
    const problema = validarPlan({
      lote_temporada_id: loteId,
      variedad_id: variedadId,
      ciclo,
      area_plan: area,
      fecha_siembra: fecha,
      distancia_siembra: distancia,
    })
    if (problema) return setError(problema)

    setError(null)
    setAviso(null)
    setGuardando(true)
    try {
      // Inserción, no `upsert`: un lote puede planificarse varias veces
      // con la misma variedad y el mismo ciclo, así que no hay nada que
      // «corregir en su sitio». Lo que sobre se elimina desde la tabla.
      const { error: e } = await supabase.from('planes_siembra').insert({
        temporada_id: temporadaId,
        lote_temporada_id: loteId,
        variedad_id: variedadId,
        ciclo: Number(ciclo),
        area_plan: Number(area),
        fecha_siembra: fecha || null,
        distancia_siembra: distancia || null,
      })
      if (e) throw e

      setGuardando(false)
      setArea('')
      setAviso('Línea agregada al plan.')
      router.refresh()
    } catch (e) {
      setGuardando(false)
      setError(mensajeDeError(e, 'No se pudo guardar el plan.'))
    }
  }

  async function eliminar(ids: string[], limpiar: () => void) {
    if (ids.length === 0) return
    if (
      !confirm(
        `Se van a eliminar ${ids.length} ${
          ids.length === 1 ? 'línea' : 'líneas'
        } del plan. Esto no se puede deshacer. ¿Continuar?`
      )
    ) {
      return
    }
    setOcupado(true)
    const { error: e } = await supabase.from('planes_siembra').delete().in('id', ids)
    setOcupado(false)
    if (e) return setError(mensajeDeError(e, 'No se pudieron eliminar las líneas.'))
    limpiar()
    setAviso(`${ids.length} ${ids.length === 1 ? 'línea eliminada' : 'líneas eliminadas'}.`)
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <Alerta>{error}</Alerta>}
      {aviso && <Alerta tono="azul">{aviso}</Alerta>}

      {puedeEditar && (
        <Tarjeta className="flex flex-col gap-3 p-4">
          <h2 className="text-sm font-semibold text-slate-900">Agregar al plan</h2>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Campo etiqueta="Lote" requerido>
              <SelectorBuscable
                valor={loteId}
                onCambiar={setLoteId}
                permitirVacio={false}
                placeholder="Buscar lote…"
                opciones={lotes.map((l) => ({
                  id: l.lote_temporada_id,
                  titulo: l.nomenclatura,
                  subtitulo: [l.nombre, l.zona].filter(Boolean).join(' · ') || undefined,
                }))}
              />
            </Campo>

            <Campo etiqueta="Variedad" requerido>
              <SelectorBuscable
                valor={variedadId}
                onCambiar={setVariedadId}
                permitirVacio={false}
                placeholder="Buscar variedad…"
                opciones={variedades.map((v) => ({
                  id: v.id,
                  titulo: v.nombre,
                  subtitulo: v.producto ?? undefined,
                }))}
              />
            </Campo>

            <Campo etiqueta="Ciclo" requerido>
              <Selector value={ciclo} onChange={(e) => setCiclo(e.target.value)}>
                {CICLOS_SIEMBRA.map((c) => (
                  <option key={c} value={c}>
                    Ciclo {c}
                  </option>
                ))}
              </Selector>
            </Campo>

            <Campo etiqueta="Área a sembrar (mz)" requerido>
              <Entrada
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={area}
                onChange={(e) => setArea(e.target.value)}
              />
            </Campo>

            <Campo etiqueta="Fecha de siembra">
              <Entrada type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </Campo>

            <Campo etiqueta="Distancia de siembra">
              <Entrada
                placeholder="ej. 1.80 x 0.35"
                value={distancia}
                onChange={(e) => setDistancia(e.target.value)}
              />
            </Campo>
          </div>

          <div className="flex justify-end">
            <Boton onClick={agregar} disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar'}
            </Boton>
          </div>
        </Tarjeta>
      )}

      <DataGrid<FilaPlanSiembra>
        filas={filas}
        columnas={columnas}
        titulo="Plan de siembra"
        nombreArchivo={`plan-siembra-${temporadaId.slice(0, 8)}`}
        ordenInicial={{ campo: 'ut', direccion: 'asc' }}
        minAncho="1000px"
        vacio={{
          titulo: 'Todavía no hay plan cargado',
          descripcion: 'Agrégalo línea a línea o impórtalo desde Excel.',
        }}
        resumen={(visibles) => {
          const total = visibles.reduce((a, f) => a + Number(f.area_plan), 0)
          return (
            <>
              <strong className="text-slate-900">{n2(total)} mz</strong> planificadas ·{' '}
              {visibles.length} {visibles.length === 1 ? 'línea' : 'líneas'} ·{' '}
              {new Set(visibles.map((f) => f.ut)).size} lotes
            </>
          )
        }}
        acciones={
          puedeEditar && (
            <Boton variante="secundario" tamano="sm" onClick={() => setImportar(true)}>
              Importar
            </Boton>
          )
        }
        accionesSeleccion={(ids, limpiar) => (
          <>
            {puedeEditar && (
              <Boton variante="secundario" tamano="sm" onClick={() => setEnMasa(ids)}>
                Editar {ids.length}
              </Boton>
            )}
            {puedeEliminar && (
              <Boton
                variante="peligro"
                tamano="sm"
                disabled={ocupado}
                onClick={() => eliminar(ids, limpiar)}
              >
                Eliminar {ids.length}
              </Boton>
            )}
          </>
        )}
        accionFila={(f) => (
          <span className="flex justify-end gap-1">
            {puedeEditar && <BotonFila onClick={() => setEditando(f)}>Editar</BotonFila>}
            {puedeEliminar && (
              <BotonFila peligro disabled={ocupado} onClick={() => eliminar([f.id], () => {})}>
                Eliminar
              </BotonFila>
            )}
          </span>
        )}
      />

      <EditarPlanModal
        fila={editando}
        enMasa={enMasa}
        lotes={lotes}
        variedades={variedades}
        onCerrar={() => {
          setEditando(null)
          setEnMasa(null)
        }}
        onGuardado={() => {
          setAviso('Plan actualizado.')
          router.refresh()
        }}
      />

      <ImportarPlanSiembra
        abierto={importar}
        onCerrar={() => setImportar(false)}
        temporadaId={temporadaId}
        filas={filas}
        lotes={lotes}
        variedades={variedades}
      />
    </div>
  )
}
