'use client'

/**
 * Recepción de plántulas: captura en línea, estilo hoja de cálculo.
 *
 * La factura del vivero trae veinte líneas y abrir un modal por cada una
 * es inaceptable; aquí se escribe sobre la tabla y se guarda una vez.
 *
 * El componente NO sabe de reglas: qué es una fila válida, qué cambió y
 * cuánto suma cada línea está en `lib/trasplante/recepcion` (puro), y
 * escribir está en `repositorioCliente`. Aquí sólo hay celdas y foco.
 */

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Alerta, Boton, Selector } from '@/components/ui/Primitivos'
import { IconCheck, IconCopy, IconPlus, IconTrash } from '@/components/ui/Icons'
import { construirXlsx, descargar, type CeldaHoja } from '@/lib/hojas'
import { mensajeDeError } from '@/lib/errores'
import { hoyIso } from '@/lib/fechas'
import { guardarRecepciones } from '@/lib/trasplante/repositorioCliente'
import {
  aBorrador,
  diferir,
  estaVacia,
  filaVacia,
  hayCambios,
  totalLinea,
  totalesRecepcion,
  type Borrador,
  type CampoBorrador,
} from '@/lib/trasplante/recepcion'
import { n0, n2 } from '@/lib/trasplante/formato'
import type { FilaRecepcion, Variedad } from '@/lib/trasplante/tipos'

type Celda = {
  campo: CampoBorrador
  label: string
  ancho: string
  tipo?: 'date' | 'number' | 'texto' | 'variedad'
  paso?: string
}

const CELDAS: Celda[] = [
  { campo: 'fecha', label: 'Fecha', ancho: 'w-[124px]', tipo: 'date' },
  { campo: 'variedad_id', label: 'Variedad', ancho: 'w-[150px]', tipo: 'variedad' },
  { campo: 'plantulas_enviadas', label: 'Enviadas', ancho: 'w-[94px]', tipo: 'number' },
  { campo: 'plantulas_facturadas', label: 'Facturadas', ancho: 'w-[94px]', tipo: 'number' },
  { campo: 'costo_unitario', label: 'Costo unit.', ancho: 'w-[86px]', tipo: 'number', paso: '0.0001' },
  { campo: 'numero_factura', label: '# Factura', ancho: 'w-[94px]' },
  { campo: 'lote_semilla', label: 'Lote semilla', ancho: 'w-[100px]' },
  { campo: 'bandejas_enviadas', label: 'Bandejas', ancho: 'w-[86px]', tipo: 'number' },
  { campo: 'documento_sap', label: 'Doc. SAP', ancho: 'w-[94px]' },
  { campo: 'observaciones', label: 'Observaciones', ancho: 'w-[150px]' },
]

/** Columnas que tiene sentido llenar de golpe en varias filas. */
const EN_MASA: CampoBorrador[] = [
  'fecha',
  'variedad_id',
  'costo_unitario',
  'numero_factura',
  'lote_semilla',
  'documento_sap',
  'observaciones',
]

export function GridRecepcion({
  temporadaId,
  filas,
  variedades,
  puedeEditar,
}: {
  temporadaId: string
  filas: FilaRecepcion[]
  variedades: Variedad[]
  puedeEditar: boolean
}) {
  const router = useRouter()
  const hoy = hoyIso()

  // `key` sobre la temporada remonta el borrador cuando cambian los datos
  // de origen; dentro de la pantalla el borrador manda.
  const [borrador, setBorrador] = useState<Borrador[]>(() => filas.map(aBorrador))
  const [marcadas, setMarcadas] = useState<Set<number>>(new Set())
  const [campoMasa, setCampoMasa] = useState<CampoBorrador>('costo_unitario')
  const [valorMasa, setValorMasa] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  const diferencia = useMemo(() => diferir(filas, borrador), [filas, borrador])
  const totales = useMemo(() => totalesRecepcion(borrador), [borrador])
  const sucio = hayCambios(diferencia) || diferencia.errores.length > 0
  const erroresPorFila = useMemo(
    () => new Map(diferencia.errores.map((e) => [e.indice, e.error])),
    [diferencia]
  )

  function escribir(indice: number, campo: CampoBorrador, valor: string) {
    setBorrador((prev) => prev.map((b, i) => (i === indice ? { ...b, [campo]: valor } : b)))
  }

  function agregar() {
    setBorrador((prev) => [...prev, filaVacia(hoy)])
  }

  function duplicar() {
    setBorrador((prev) => {
      const copias = [...marcadas]
        .sort((a, b) => a - b)
        .map((i) => ({ ...prev[i], id: null }))
        .filter(Boolean)
      return [...prev, ...copias]
    })
    setMarcadas(new Set())
  }

  function eliminarMarcadas() {
    if (marcadas.size === 0) return
    setBorrador((prev) => prev.filter((_, i) => !marcadas.has(i)))
    setMarcadas(new Set())
  }

  function aplicarEnMasa() {
    if (marcadas.size === 0) return
    setBorrador((prev) =>
      prev.map((b, i) => (marcadas.has(i) ? { ...b, [campoMasa]: valorMasa } : b))
    )
  }

  function descartar() {
    setBorrador(filas.map(aBorrador))
    setMarcadas(new Set())
    setError(null)
    setAviso(null)
  }

  async function guardar() {
    setError(null)
    setAviso(null)

    if (diferencia.errores.length > 0) {
      const [primero] = diferencia.errores
      return setError(`Fila ${primero.indice + 1}: ${primero.error}. Revisa las filas marcadas en ámbar.`)
    }
    if (!hayCambios(diferencia)) return setAviso('No hay cambios que guardar.')

    if (
      diferencia.borradas.length > 0 &&
      !confirm(
        `Se van a eliminar ${diferencia.borradas.length} ${
          diferencia.borradas.length === 1 ? 'línea' : 'líneas'
        } de recepción. ¿Continuar?`
      )
    ) {
      return
    }

    setGuardando(true)
    const { error: e } = await guardarRecepciones(
      diferencia.nuevas.map((c) => ({ ...c, temporada_id: temporadaId })),
      diferencia.cambiadas,
      diferencia.borradas
    )
    setGuardando(false)
    if (e) return setError(mensajeDeError(e, 'No se pudo guardar la recepción.'))

    setMarcadas(new Set())
    setAviso(
      `Guardado: ${diferencia.nuevas.length} nuevas, ${diferencia.cambiadas.length} modificadas, ${diferencia.borradas.length} eliminadas.`
    )
    router.refresh()
  }

  function exportar() {
    const nombre = new Map(variedades.map((v) => [v.id, v.nombre]))
    const hoja: CeldaHoja[][] = [
      [
        'Fecha', 'Variedad', 'Plantulas enviadas', 'Plantulas facturadas', 'Costo unitario',
        'Total', '# Factura', 'Lote semilla', 'Bandejas enviadas', 'Documento SAP', 'Observaciones',
      ],
      ...borrador
        .filter((b) => !estaVacia(b))
        .map(
          (b) =>
            [
              b.fecha, nombre.get(b.variedad_id) ?? '', b.plantulas_enviadas,
              b.plantulas_facturadas, b.costo_unitario, totalLinea(b), b.numero_factura,
              b.lote_semilla, b.bandejas_enviadas, b.documento_sap, b.observaciones,
            ] as CeldaHoja[]
        ),
    ]
    descargar(construirXlsx('Recepcion', hoja), `recepcion-plantulas-${temporadaId.slice(0, 8)}.xlsx`)
  }

  return (
    <div className="flex flex-col gap-3">
      {error && <Alerta>{error}</Alerta>}
      {aviso && <Alerta tono="azul">{aviso}</Alerta>}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-slate-500">
          <strong className="text-slate-900">{n0(totales.facturadas)}</strong> plántulas facturadas ·{' '}
          {n0(totales.enviadas)} enviadas · {n0(totales.bandejas)} bandejas ·{' '}
          <strong className="text-slate-900">L {n2(totales.costo)}</strong> · {totales.lineas}{' '}
          {totales.lineas === 1 ? 'línea' : 'líneas'}
        </p>

        <div className="flex flex-wrap gap-2">
          {puedeEditar && (
            <Boton variante="secundario" tamano="sm" onClick={agregar}>
              <IconPlus className="mr-1 inline h-3.5 w-3.5" />
              Agregar fila
            </Boton>
          )}
          {puedeEditar && marcadas.size > 0 && (
            <>
              <Boton variante="secundario" tamano="sm" onClick={duplicar}>
                <IconCopy className="mr-1 inline h-3.5 w-3.5" />
                Duplicar {marcadas.size}
              </Boton>
              <Boton variante="peligro" tamano="sm" onClick={eliminarMarcadas}>
                <IconTrash className="mr-1 inline h-3.5 w-3.5" />
                Eliminar {marcadas.size}
              </Boton>
            </>
          )}
          <Boton
            variante="secundario"
            tamano="sm"
            onClick={exportar}
            disabled={totales.lineas === 0}
          >
            Exportar Excel
          </Boton>
        </div>
      </div>

      {/* Llenar de golpe: el costo unitario y el número de factura se
          repiten en todas las líneas de una misma factura. */}
      {puedeEditar && marcadas.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-brand-200 bg-brand-50/50 px-3 py-2">
          <span className="text-xs font-semibold text-brand-800">
            Aplicar a {marcadas.size} {marcadas.size === 1 ? 'fila' : 'filas'}:
          </span>
          <Selector
            value={campoMasa}
            onChange={(e) => setCampoMasa(e.target.value as CampoBorrador)}
            className="h-9 max-w-[170px] text-sm"
          >
            {CELDAS.filter((c) => EN_MASA.includes(c.campo)).map((c) => (
              <option key={c.campo} value={c.campo}>
                {c.label}
              </option>
            ))}
          </Selector>
          {campoMasa === 'variedad_id' ? (
            <Selector
              value={valorMasa}
              onChange={(e) => setValorMasa(e.target.value)}
              className="h-9 max-w-[190px] text-sm"
            >
              <option value="">—</option>
              {variedades.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.nombre}
                </option>
              ))}
            </Selector>
          ) : (
            <input
              type={campoMasa === 'fecha' ? 'date' : 'text'}
              value={valorMasa}
              onChange={(e) => setValorMasa(e.target.value)}
              placeholder="Valor…"
              className="h-9 rounded-lg border border-slate-200 px-2 text-sm focus:border-brand-600 focus:outline-none"
            />
          )}
          <Boton tamano="sm" onClick={aplicarEnMasa}>
            Aplicar
          </Boton>
        </div>
      )}

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[var(--shadow-card)]">
        <div className="scroll-suave overflow-x-auto">
          <table className="w-full min-w-[1120px] border-collapse text-xs">
            <thead className="bg-slate-50">
              <tr className="border-b border-slate-200 text-left">
                <th className="w-9 px-2 py-2">
                  <button
                    type="button"
                    aria-label="Marcar todas"
                    onClick={() =>
                      setMarcadas(
                        marcadas.size === borrador.length
                          ? new Set()
                          : new Set(borrador.map((_, i) => i))
                      )
                    }
                    className={`flex h-4 w-4 items-center justify-center rounded border ${
                      marcadas.size === borrador.length && borrador.length > 0
                        ? 'border-brand-700 bg-brand-700 text-white'
                        : 'border-slate-300 bg-white'
                    }`}
                  >
                    {marcadas.size === borrador.length && borrador.length > 0 && (
                      <IconCheck className="h-2.5 w-2.5" />
                    )}
                  </button>
                </th>
                <th className="w-10 px-1 py-2 text-[10px] font-bold uppercase text-slate-400">#</th>
                {CELDAS.map((c) => (
                  <th
                    key={c.campo}
                    className={`${c.ancho} px-2 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-500`}
                  >
                    {c.label}
                  </th>
                ))}
                <th className="sticky right-0 w-[108px] border-l border-slate-200 bg-slate-50 px-2 py-2 text-right text-[10px] font-bold uppercase tracking-wide text-slate-500">
                  Total
                </th>
              </tr>
            </thead>

            <tbody>
              {borrador.map((b, i) => {
                const problema = erroresPorFila.get(i)
                return (
                  <tr
                    key={`${b.id ?? 'nueva'}-${i}`}
                    className={`border-b border-slate-100 last:border-0 ${
                      problema ? 'bg-amber-50/60' : marcadas.has(i) ? 'bg-brand-50/40' : ''
                    }`}
                    title={problema ?? undefined}
                  >
                    <td className="px-2 py-1">
                      <button
                        type="button"
                        aria-label={`Marcar fila ${i + 1}`}
                        onClick={() =>
                          setMarcadas((prev) => {
                            const copia = new Set(prev)
                            if (copia.has(i)) copia.delete(i)
                            else copia.add(i)
                            return copia
                          })
                        }
                        className={`flex h-4 w-4 items-center justify-center rounded border ${
                          marcadas.has(i)
                            ? 'border-brand-700 bg-brand-700 text-white'
                            : 'border-slate-300 bg-white hover:border-brand-400'
                        }`}
                      >
                        {marcadas.has(i) && <IconCheck className="h-2.5 w-2.5" />}
                      </button>
                    </td>
                    <td className="px-1 py-1 text-center text-[10px] text-slate-300">{i + 1}</td>

                    {CELDAS.map((c) => (
                      <td key={c.campo} className="px-0.5 py-0.5">
                        {c.tipo === 'variedad' ? (
                          <select
                            value={b.variedad_id}
                            disabled={!puedeEditar}
                            onChange={(e) => escribir(i, 'variedad_id', e.target.value)}
                            className="w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-xs hover:border-slate-200 focus:border-brand-600 focus:bg-white focus:outline-none disabled:text-slate-500"
                          >
                            <option value="">—</option>
                            {variedades.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.nombre}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            type={c.tipo === 'date' ? 'date' : c.tipo === 'number' ? 'number' : 'text'}
                            inputMode={c.tipo === 'number' ? 'decimal' : undefined}
                            step={c.paso}
                            value={b[c.campo]}
                            disabled={!puedeEditar}
                            onChange={(e) => escribir(i, c.campo, e.target.value)}
                            className={`w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-xs hover:border-slate-200 focus:border-brand-600 focus:bg-white focus:outline-none disabled:text-slate-500 ${
                              c.tipo === 'number' ? 'text-right tabular-nums' : ''
                            }`}
                          />
                        )}
                      </td>
                    ))}

                    {/* Pegado a la derecha: el total no debe perderse al
                        desplazar la tabla, que es ancha por naturaleza. */}
                    <td
                      className={`sticky right-0 border-l border-slate-200 px-2 py-1 text-right font-bold tabular-nums text-slate-800 ${
                        problema ? 'bg-amber-50' : marcadas.has(i) ? 'bg-brand-50' : 'bg-white'
                      }`}
                    >
                      {n2(totalLinea(b))}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {borrador.length === 0 && (
          <p className="px-4 py-10 text-center text-sm text-slate-400">
            Todavía no hay recepciones. Agrega una fila para empezar.
          </p>
        )}
      </div>

      {puedeEditar && (
        <div className="sticky bottom-2 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 shadow-[var(--shadow-card)] backdrop-blur">
          <p className="text-xs text-slate-500">
            {sucio ? (
              <>
                {diferencia.nuevas.length} nuevas · {diferencia.cambiadas.length} modificadas ·{' '}
                {diferencia.borradas.length} eliminadas
                {diferencia.errores.length > 0 && (
                  <span className="ml-2 font-semibold text-amber-700">
                    {diferencia.errores.length} con datos incompletos
                  </span>
                )}
              </>
            ) : (
              'Sin cambios pendientes.'
            )}
          </p>
          <div className="flex gap-2">
            <Boton variante="secundario" tamano="sm" onClick={descartar} disabled={!sucio || guardando}>
              Descartar
            </Boton>
            <Boton tamano="sm" onClick={guardar} disabled={!sucio || guardando}>
              {guardando ? 'Guardando…' : 'Guardar cambios'}
            </Boton>
          </div>
        </div>
      )}
    </div>
  )
}
