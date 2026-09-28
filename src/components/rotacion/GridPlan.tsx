'use client'

/**
 * El plan de rotación: cuánto se va a sembrar en cada lote y con cuánta
 * semilla.
 *
 * Todo se corrige EN LA CELDA. Un plan no se captura de una vez: se
 * carga a principio de temporada y se va ajustando conforme los lotes se
 * liberan, así que obligar a abrir un modal por cada manzana corregida
 * era el trabajo previo a hacer el trabajo.
 *
 * La nomenclatura, la zona y la dosis total son de SÓLO LECTURA: las
 * dos primeras salen del lote y la tercera la calcula la base. Dejarlas
 * escribir sería permitir que digan algo distinto de lo que son.
 */

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alerta, Boton, Campo, Entrada, Tarjeta } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { SelectorCelda } from '@/components/ui/SelectorCelda'
import { DataGrid } from '@/components/ui/DataGrid'
import { BotonFila } from '@/components/ui/BotonFila'
import type { ColumnaGrid } from '@/lib/grid/tipos'
import { mensajeDeError } from '@/lib/errores'
import {
  borrarPlan,
  crearPlan,
  crearVariedad,
  guardarPlan,
  type CamposPlan,
} from '@/lib/rotacion/repositorioCliente'
import {
  etiquetaUmb,
  n2,
  opciones,
  UNIDADES,
  type FilaPlan,
  type LoteRotacion,
  type VariedadRotacion,
} from '@/lib/rotacion/tipos'
import { ImportarPlan } from './Importadores'

/** De qué columna de la tabla sale cada campo de la base. */
const CAMPOS: Record<string, keyof CamposPlan> = {
  ut: 'lote_temporada_id',
  variedad: 'variedad_id',
  area_planificada_mz: 'area_planificada_mz',
  dosis_mz: 'dosis_mz',
  umb: 'umb',
  observaciones: 'observaciones',
}

const NUMERICOS = new Set(['area_planificada_mz', 'dosis_mz'])

export function GridPlan({
  temporadaId,
  filas,
  lotes,
  variedades,
  puedeEditar,
  puedeEliminar,
}: {
  temporadaId: string
  filas: FilaPlan[]
  lotes: LoteRotacion[]
  variedades: VariedadRotacion[]
  puedeEditar: boolean
  puedeEliminar: boolean
}) {
  const router = useRouter()

  const [loteId, setLoteId] = useState('')
  const [variedadId, setVariedadId] = useState('')
  const [area, setArea] = useState('')
  const [dosis, setDosis] = useState('')
  const [umb, setUmb] = useState('KG')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [importar, setImportar] = useState(false)

  const lote = lotes.find((l) => l.lote_temporada_id === loteId)
  // Lo que se va a guardar, calculado igual que en la base. Verlo antes
  // de guardar es lo que evita enterarse del cero de más al día
  // siguiente, cuando el pedido de semilla ya salió.
  const totalNuevo = Number(area || 0) * Number(dosis || 0)

  const opcionesLote = useMemo(
    () =>
      lotes.map((l) => ({
        value: l.lote_temporada_id,
        label: [l.nomenclatura, l.zona].filter(Boolean).join(' · '),
      })),
    [lotes]
  )

  const opcionesVariedad = useMemo(
    () => variedades.map((v) => ({ value: v.id, label: v.nombre })),
    [variedades]
  )

  const columnas = useMemo<ColumnaGrid<FilaPlan>[]>(
    () => [
      {
        campo: 'ut',
        label: 'Lote',
        tipo: 'seleccion',
        ancho: '11rem',
        valor: (f) => f.ut,
        etiqueta: (f) => f.ut,
        editable: puedeEditar,
        editor: 'seleccion',
        valorEdicion: (f) => f.lote_temporada_id,
        opciones: opcionesLote,
      },
      // Nomenclatura y zona: salen del lote elegido, y por eso no se
      // escriben. Están para comprobar de un vistazo que el lote es el
      // que se quería, que es el error que de verdad ocurre.
      {
        campo: 'lote_nombre',
        label: 'Nomenclatura',
        tipo: 'seleccion',
        valor: (f) => f.lote_nombre,
      },
      { campo: 'zona', label: 'Zona', tipo: 'seleccion', valor: (f) => f.zona },
      {
        campo: 'variedad',
        label: 'Variedad',
        tipo: 'seleccion',
        valor: (f) => f.variedad,
        editable: puedeEditar,
        editor: 'seleccion',
        valorEdicion: (f) => f.variedad_id,
        opciones: opcionesVariedad,
        onCrearOpcion: (texto) => crearVariedad(texto),
      },
      // El cultivo lo hereda de la variedad: no se teclea y no puede
      // equivocarse.
      { campo: 'producto', label: 'Producto', tipo: 'seleccion', valor: (f) => f.producto },
      {
        campo: 'area_planificada_mz',
        label: 'Área plan (mz)',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.area_planificada_mz),
        etiqueta: (f) => n2(f.area_planificada_mz),
        editable: puedeEditar,
        editor: 'numero',
      },
      {
        campo: 'dosis_mz',
        label: 'Dosis / mz',
        tipo: 'numero',
        numero: true,
        valor: (f) => (f.dosis_mz === null ? null : Number(f.dosis_mz)),
        etiqueta: (f) => n2(f.dosis_mz),
        editable: puedeEditar,
        editor: 'numero',
      },
      {
        campo: 'umb',
        label: 'UMB',
        tipo: 'seleccion',
        valor: (f) => f.umb,
        etiqueta: (f) => etiquetaUmb(f.umb),
        editable: puedeEditar,
        editor: 'seleccion',
        valorEdicion: (f) => f.umb ?? '',
        opciones: opciones(UNIDADES),
      },
      {
        campo: 'dosis_total_area',
        label: 'Dosis total',
        tipo: 'numero',
        numero: true,
        valor: (f) => (f.dosis_total_area === null ? null : Number(f.dosis_total_area)),
        etiqueta: (f) => n2(f.dosis_total_area),
        render: (f) => (
          <span className="font-semibold tabular-nums text-slate-900">
            {n2(f.dosis_total_area)} <span className="text-xs font-normal text-slate-400">
              {etiquetaUmb(f.umb)}
            </span>
          </span>
        ),
      },
      {
        campo: 'observaciones',
        label: 'Observaciones',
        tipo: 'texto',
        ancho: '14rem',
        valor: (f) => f.observaciones,
        editable: puedeEditar,
        editor: 'texto',
      },
    ],
    [puedeEditar, opcionesLote, opcionesVariedad]
  )

  async function editarCelda(fila: FilaPlan, campo: string, valor: unknown) {
    const cual = CAMPOS[campo]
    if (!cual) return
    setError(null)
    const limpio =
      valor === '' || valor === null
        ? null
        : NUMERICOS.has(cual)
          ? Number(valor)
          : valor
    const { error: e } = await guardarPlan(fila.id, { [cual]: limpio } as CamposPlan)
    if (e) return setError(mensajeDeError(e, 'No se pudo guardar el cambio.'))
    router.refresh()
  }

  async function agregar() {
    if (!loteId) return setError('Elige el lote.')
    if (!variedadId) return setError('Elige la variedad.')
    if (area === '' || Number(area) < 0) return setError('Escribe el área planificada.')

    setError(null)
    setAviso(null)
    setGuardando(true)
    const { error: e } = await crearPlan({
      temporada_id: temporadaId,
      lote_temporada_id: loteId,
      variedad_id: variedadId,
      area_planificada_mz: Number(area),
      dosis_mz: dosis === '' ? null : Number(dosis),
      umb: umb || null,
    })
    setGuardando(false)
    if (e) return setError(mensajeDeError(e, 'No se pudo guardar la línea del plan.'))
    setArea('')
    setDosis('')
    setAviso('Línea agregada al plan.')
    router.refresh()
  }

  async function eliminar(ids: string[], limpiar: () => void) {
    if (ids.length === 0) return
    if (
      !confirm(
        `Se van a eliminar ${ids.length} ${ids.length === 1 ? 'línea' : 'líneas'} del plan. ` +
          'Esto no se puede deshacer. ¿Continuar?'
      )
    ) {
      return
    }
    setOcupado(true)
    const { error: e } = await borrarPlan(ids)
    setOcupado(false)
    if (e) return setError(mensajeDeError(e, 'No se pudieron eliminar las líneas.'))
    limpiar()
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
            <Campo
              etiqueta="Lote"
              requerido
              ayuda={lote ? `${lote.nombre ?? '—'} · ${lote.zona ?? 'Sin zona'}` : undefined}
            >
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
                creacionRapida={{
                  etiqueta: 'Crear variedad',
                  campos: [{ key: 'nombre', label: 'Nombre de la variedad', requerido: true }],
                  onCrear: async (valores) => {
                    const id = await crearVariedad(valores.nombre ?? '')
                    router.refresh()
                    return { id, titulo: (valores.nombre ?? '').trim() }
                  },
                }}
              />
            </Campo>

            <Campo etiqueta="Área planificada (mz)" requerido>
              <Entrada
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={area}
                onChange={(e) => setArea(e.target.value)}
              />
            </Campo>

            <Campo etiqueta="Dosis por manzana">
              <Entrada
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={dosis}
                onChange={(e) => setDosis(e.target.value)}
              />
            </Campo>

            <Campo etiqueta="Unidad de medida">
              <SelectorCelda
                valor={umb}
                opciones={opciones(UNIDADES)}
                onElegir={setUmb}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </Campo>

            <Campo etiqueta="Dosis total" ayuda="Área × dosis. La calcula la base al guardar.">
              <Entrada value={`${n2(totalNuevo)} ${etiquetaUmb(umb)}`} disabled />
            </Campo>
          </div>

          <div className="flex justify-end">
            <Boton onClick={agregar} disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar'}
            </Boton>
          </div>
        </Tarjeta>
      )}

      <DataGrid<FilaPlan>
        filas={filas}
        columnas={columnas}
        titulo="Plan de rotación"
        nombreArchivo={`rotacion-plan-${temporadaId.slice(0, 8)}`}
        ordenInicial={{ campo: 'ut', direccion: 'asc' }}
        minAncho="1500px"
        puedeEditarCelda={puedeEditar}
        onEditarCelda={editarCelda}
        vacio={{
          titulo: 'Todavía no hay plan cargado',
          descripcion: 'Agrégalo línea a línea o impórtalo desde Excel.',
        }}
        resumen={(visibles) => {
          const total = visibles.reduce((a, f) => a + Number(f.area_planificada_mz), 0)
          const semilla = visibles.reduce((a, f) => a + Number(f.dosis_total_area ?? 0), 0)
          return (
            <>
              <strong className="text-slate-900">{n2(total)} mz</strong> planificadas ·{' '}
              {visibles.length} {visibles.length === 1 ? 'línea' : 'líneas'} ·{' '}
              {new Set(visibles.map((f) => f.ut)).size} lotes · {n2(semilla)} de semilla
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
        accionesSeleccion={(ids, limpiar) =>
          puedeEliminar && (
            <Boton
              variante="peligro"
              tamano="sm"
              disabled={ocupado}
              onClick={() => eliminar(ids, limpiar)}
            >
              Eliminar {ids.length}
            </Boton>
          )
        }
        accionFila={(f) =>
          puedeEliminar && (
            <span className="flex justify-end">
              <BotonFila peligro disabled={ocupado} onClick={() => eliminar([f.id], () => {})}>
                Eliminar
              </BotonFila>
            </span>
          )
        }
      />

      <ImportarPlan
        abierto={importar}
        onCerrar={() => setImportar(false)}
        temporadaId={temporadaId}
        lotes={lotes}
        variedades={variedades}
      />
    </div>
  )
}
