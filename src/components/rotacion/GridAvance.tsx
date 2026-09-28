'use client'

/**
 * El avance diario de la rotación: lo que de verdad se sembró.
 *
 * Igual que el plan, se corrige en la celda. Las tres columnas
 * calculadas —semilla por manzana, costo total— son de sólo lectura: las
 * hace la base a partir de sus factores, y dejarlas escribir sería
 * permitir que digan algo distinto de lo que son. Se corrigen moviendo
 * el factor, que es donde está el error de verdad.
 */

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alerta, Boton, Campo, Entrada, Insignia, Tarjeta } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { SelectorCelda } from '@/components/ui/SelectorCelda'
import { DataGrid } from '@/components/ui/DataGrid'
import { BotonFila } from '@/components/ui/BotonFila'
import type { ColumnaGrid } from '@/lib/grid/tipos'
import { mensajeDeError } from '@/lib/errores'
import { hoyIso } from '@/lib/fechas'
import {
  borrarAvance,
  crearAvance,
  crearVariedad,
  guardarAvance,
  type CamposAvance,
} from '@/lib/rotacion/repositorioCliente'
import {
  etiquetaTipoSiembra,
  etiquetaUmb,
  n2,
  opciones,
  TIPOS_SIEMBRA,
  UNIDADES,
  type FilaAvance,
  type LoteRotacion,
  type VariedadRotacion,
} from '@/lib/rotacion/tipos'
import { ImportarAvance } from './Importadores'

const CAMPOS: Record<string, keyof CamposAvance> = {
  fecha: 'fecha',
  ut: 'lote_temporada_id',
  variedad: 'variedad_id',
  avance_mz: 'avance_mz',
  gasto_semilla: 'gasto_semilla',
  umb: 'umb',
  tipo_siembra: 'tipo_siembra',
  costo_tipo_siembra_mz: 'costo_tipo_siembra_mz',
  observaciones: 'observaciones',
}

const NUMERICOS = new Set(['avance_mz', 'gasto_semilla', 'costo_tipo_siembra_mz'])

export function GridAvance({
  temporadaId,
  filas,
  lotes,
  variedades,
  puedeEditar,
  puedeEliminar,
}: {
  temporadaId: string
  filas: FilaAvance[]
  lotes: LoteRotacion[]
  variedades: VariedadRotacion[]
  puedeEditar: boolean
  puedeEliminar: boolean
}) {
  const router = useRouter()

  const [fecha, setFecha] = useState(hoyIso())
  const [loteId, setLoteId] = useState('')
  const [variedadId, setVariedadId] = useState('')
  const [avance, setAvance] = useState('')
  const [gasto, setGasto] = useState('')
  const [umb, setUmb] = useState('KG')
  const [tipo, setTipo] = useState('DIRECTA')
  const [costoMz, setCostoMz] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)
  const [importar, setImportar] = useState(false)

  const lote = lotes.find((l) => l.lote_temporada_id === loteId)
  const variedad = variedades.find((v) => v.id === variedadId)

  // Las dos cuentas de la base, hechas también aquí para verlas antes de
  // guardar. No las guarda la pantalla: las guarda la base.
  const semillaMz = Number(avance) > 0 ? Number(gasto || 0) / Number(avance) : 0
  const costoTotal = Number(costoMz || 0) * Number(avance || 0)

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

  const columnas = useMemo<ColumnaGrid<FilaAvance>[]>(
    () => [
      {
        campo: 'fecha',
        label: 'Fecha',
        tipo: 'fecha',
        valor: (f) => f.fecha,
        editable: puedeEditar,
        editor: 'fecha',
      },
      {
        campo: 'ut',
        label: 'Lote',
        tipo: 'seleccion',
        ancho: '11rem',
        valor: (f) => f.ut,
        editable: puedeEditar,
        editor: 'seleccion',
        valorEdicion: (f) => f.lote_temporada_id,
        opciones: opcionesLote,
      },
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
      { campo: 'producto', label: 'Producto', tipo: 'seleccion', valor: (f) => f.producto },
      {
        campo: 'avance_mz',
        label: 'Avance (mz)',
        tipo: 'numero',
        numero: true,
        valor: (f) => Number(f.avance_mz),
        etiqueta: (f) => n2(f.avance_mz),
        editable: puedeEditar,
        editor: 'numero',
      },
      {
        campo: 'gasto_semilla',
        label: 'Gasto semilla',
        tipo: 'numero',
        numero: true,
        valor: (f) => (f.gasto_semilla === null ? null : Number(f.gasto_semilla)),
        etiqueta: (f) => n2(f.gasto_semilla),
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
        campo: 'semilla_mz',
        label: 'Semilla / mz',
        tipo: 'numero',
        numero: true,
        valor: (f) => (f.semilla_mz === null ? null : Number(f.semilla_mz)),
        etiqueta: (f) => n2(f.semilla_mz),
        render: (f) => (
          <span className="font-semibold tabular-nums text-slate-900">{n2(f.semilla_mz)}</span>
        ),
      },
      {
        campo: 'tipo_siembra',
        label: 'Tipo de siembra',
        tipo: 'seleccion',
        valor: (f) => f.tipo_siembra,
        etiqueta: (f) => etiquetaTipoSiembra(f.tipo_siembra),
        render: (f) => <Insignia tono="azul">{etiquetaTipoSiembra(f.tipo_siembra)}</Insignia>,
        editable: puedeEditar,
        editor: 'seleccion',
        valorEdicion: (f) => f.tipo_siembra,
        opciones: opciones(TIPOS_SIEMBRA),
      },
      {
        campo: 'costo_tipo_siembra_mz',
        label: 'Costo / mz',
        tipo: 'numero',
        numero: true,
        valor: (f) => (f.costo_tipo_siembra_mz === null ? null : Number(f.costo_tipo_siembra_mz)),
        etiqueta: (f) => n2(f.costo_tipo_siembra_mz),
        editable: puedeEditar,
        editor: 'numero',
      },
      {
        campo: 'costo_total',
        label: 'Costo total',
        tipo: 'numero',
        numero: true,
        valor: (f) => (f.costo_total === null ? null : Number(f.costo_total)),
        etiqueta: (f) => n2(f.costo_total),
        render: (f) => (
          <span className="font-semibold tabular-nums text-slate-900">L {n2(f.costo_total)}</span>
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
      {
        campo: 'usuario_nombre',
        label: 'Registró',
        tipo: 'seleccion',
        valor: (f) => f.usuario_nombre,
      },
    ],
    [puedeEditar, opcionesLote, opcionesVariedad]
  )

  async function editarCelda(fila: FilaAvance, campo: string, valor: unknown) {
    const cual = CAMPOS[campo]
    if (!cual) return
    setError(null)
    const limpio =
      valor === '' || valor === null
        ? null
        : NUMERICOS.has(cual)
          ? Number(valor)
          : valor
    const { error: e } = await guardarAvance(fila.id, { [cual]: limpio } as CamposAvance)
    if (e) return setError(mensajeDeError(e, 'No se pudo guardar el cambio.'))
    router.refresh()
  }

  async function agregar() {
    if (!loteId) return setError('Elige el lote.')
    if (!variedadId) return setError('Elige la variedad.')
    if (avance === '' || Number(avance) <= 0) return setError('El avance tiene que ser mayor que cero.')

    setError(null)
    setAviso(null)
    setGuardando(true)
    const { error: e } = await crearAvance({
      temporada_id: temporadaId,
      fecha,
      lote_temporada_id: loteId,
      variedad_id: variedadId,
      avance_mz: Number(avance),
      gasto_semilla: gasto === '' ? null : Number(gasto),
      umb: umb || null,
      tipo_siembra: tipo,
      costo_tipo_siembra_mz: costoMz === '' ? null : Number(costoMz),
    })
    setGuardando(false)
    if (e) return setError(mensajeDeError(e, 'No se pudo guardar el avance.'))
    setAvance('')
    setGasto('')
    setAviso('Avance registrado.')
    router.refresh()
  }

  async function eliminar(ids: string[], limpiar: () => void) {
    if (ids.length === 0) return
    if (
      !confirm(
        `Se van a eliminar ${ids.length} ${ids.length === 1 ? 'registro' : 'registros'} de avance. ` +
          'Esto no se puede deshacer. ¿Continuar?'
      )
    ) {
      return
    }
    setOcupado(true)
    const { error: e } = await borrarAvance(ids)
    setOcupado(false)
    if (e) return setError(mensajeDeError(e, 'No se pudieron eliminar los registros.'))
    limpiar()
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-4">
      {error && <Alerta>{error}</Alerta>}
      {aviso && <Alerta tono="azul">{aviso}</Alerta>}

      {puedeEditar && (
        <Tarjeta className="flex flex-col gap-3 p-4">
          <h2 className="text-sm font-semibold text-slate-900">Registrar avance</h2>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
            <Campo etiqueta="Fecha" requerido>
              <Entrada type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} />
            </Campo>

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

            <Campo
              etiqueta="Variedad"
              requerido
              ayuda={variedad?.producto ? `Producto: ${variedad.producto}` : undefined}
            >
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

            <Campo etiqueta="Avance (mz)" requerido>
              <Entrada
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={avance}
                onChange={(e) => setAvance(e.target.value)}
              />
            </Campo>

            <Campo etiqueta="Gasto de semilla">
              <Entrada
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={gasto}
                onChange={(e) => setGasto(e.target.value)}
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

            <Campo etiqueta="Tipo de siembra" requerido>
              <SelectorCelda
                valor={tipo}
                opciones={opciones(TIPOS_SIEMBRA)}
                onElegir={setTipo}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
              />
            </Campo>

            <Campo etiqueta="Costo por manzana">
              <Entrada
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={costoMz}
                onChange={(e) => setCostoMz(e.target.value)}
              />
            </Campo>

            <Campo
              etiqueta="Semilla / mz · Costo total"
              ayuda="Las dos las calcula la base al guardar."
            >
              <Entrada
                value={`${n2(semillaMz)} ${etiquetaUmb(umb)} · L ${n2(costoTotal)}`}
                disabled
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

      <DataGrid<FilaAvance>
        filas={filas}
        columnas={columnas}
        titulo="Avance de rotación"
        nombreArchivo={`rotacion-avance-${temporadaId.slice(0, 8)}`}
        ordenInicial={{ campo: 'fecha', direccion: 'desc' }}
        minAncho="2200px"
        puedeEditarCelda={puedeEditar}
        onEditarCelda={editarCelda}
        vacio={{
          titulo: 'Sin avance registrado',
          descripcion: 'Captura la primera siembra o impórtalas desde Excel.',
        }}
        resumen={(visibles) => {
          const area = visibles.reduce((a, f) => a + Number(f.avance_mz), 0)
          const costo = visibles.reduce((a, f) => a + Number(f.costo_total ?? 0), 0)
          const semilla = visibles.reduce((a, f) => a + Number(f.gasto_semilla ?? 0), 0)
          return (
            <>
              <strong className="text-slate-900">{n2(area)} mz</strong> sembradas ·{' '}
              {visibles.length} {visibles.length === 1 ? 'línea' : 'líneas'} · {n2(semilla)} de
              semilla · L {n2(costo)}
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

      <ImportarAvance
        abierto={importar}
        onCerrar={() => setImportar(false)}
        temporadaId={temporadaId}
        lotes={lotes}
        variedades={variedades}
      />
    </div>
  )
}
