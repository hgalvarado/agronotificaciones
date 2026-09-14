'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { hoyIso } from '@/lib/fechas'
import { Modal } from '@/components/ui/Modal'
import {
  Alerta,
  Boton,
  Campo,
  Entrada,
  EstadoVacio,
  Insignia,
  Selector,
  Tarjeta,
} from '@/components/ui/Primitivos'
import { IconInbox, IconPlus, IconSearch, IconSend } from '@/components/ui/Icons'
import {
  construirXlsx,
  descargar,
  leerArchivoTabular,
  partirTextoTabular,
  type CeldaHoja,
} from '@/lib/hojas'
import { formatearFecha } from '@/lib/estados'
import { mensajeDeError } from '@/lib/errores'

export type PuestoTarifa = {
  id: string
  codigo: string
  descripcion: string | null
  operacion_sap: number | null
}

export type TarifaFila = {
  id: string
  puesto_trabajo_id: string
  costo_hora: number
  moneda: string
  vigente_desde: string
  vigente_hasta: string | null
  comentario: string | null
}

export type TemporadaOpcion = { id: string; nombre: string; activa: boolean }

/* ------------------------------------------------------------------ */
/* Ayudas                                                              */
/* ------------------------------------------------------------------ */

function normalizar(texto: string) {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
}

const lempiras = new Intl.NumberFormat('es-HN', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/**
 * Lee un número escrito de cualquiera de las dos formas: 1,234.56 o
 * 1.234,56. El separador decimal es el que queda más a la derecha; el otro
 * es de millares y se descarta.
 */
function aNumero(bruto: string): number | null {
  const limpio = bruto.replace(/[^\d.,-]/g, '')
  if (!limpio) return null
  const normalizado =
    limpio.lastIndexOf(',') > limpio.lastIndexOf('.')
      ? limpio.replace(/\./g, '').replace(',', '.')
      : limpio.replace(/,/g, '')
  const n = Number(normalizado)
  return Number.isFinite(n) ? n : null
}

/** Acepta 2026-09-07 y 07/09/2026. Devuelve null si no es fecha. */
function aFechaIso(bruto: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(bruto)) return bruto
  const m = bruto.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null
}

const clasesArchivo =
  'w-full rounded-xl border border-dashed border-slate-300 bg-white p-3 text-sm text-slate-500 ' +
  'file:mr-3 file:rounded-lg file:border-0 file:bg-brand-700 file:px-3 file:py-1.5 ' +
  'file:text-sm file:font-semibold file:text-white'

const clasesPegar =
  'w-full rounded-xl border border-slate-200 bg-white p-3 font-mono text-xs ' +
  'placeholder:font-sans placeholder:text-slate-300 focus:border-brand-600 focus:outline-none ' +
  'focus:ring-4 focus:ring-brand-600/10'

/* ================================================================== */
/* Pantalla                                                            */
/* ================================================================== */

export function GestionTarifas({
  temporadas,
  temporadaId,
  puestos,
  tarifas,
  soloLectura,
}: {
  temporadas: TemporadaOpcion[]
  temporadaId: string | null
  puestos: PuestoTarifa[]
  tarifas: TarifaFila[]
  soloLectura: boolean
}) {
  const router = useRouter()
  const [busqueda, setBusqueda] = useState('')
  const [puestoAbierto, setPuestoAbierto] = useState<PuestoTarifa | null>(null)
  const [abrirCarga, setAbrirCarga] = useState(false)

  const hoy = hoyIso()

  // Historial por puesto, de la más nueva a la más vieja.
  const porPuesto = useMemo(() => {
    const mapa = new Map<string, TarifaFila[]>()
    for (const t of tarifas) {
      const lista = mapa.get(t.puesto_trabajo_id) ?? []
      lista.push(t)
      mapa.set(t.puesto_trabajo_id, lista)
    }
    for (const lista of mapa.values())
      lista.sort((a, b) => b.vigente_desde.localeCompare(a.vigente_desde))
    return mapa
  }, [tarifas])

  const vigenteHoy = (puestoId: string) =>
    (porPuesto.get(puestoId) ?? []).find(
      (t) => t.vigente_desde <= hoy && (t.vigente_hasta === null || t.vigente_hasta >= hoy)
    )

  const filtrados = useMemo(() => {
    const q = normalizar(busqueda)
    if (!q) return puestos
    return puestos.filter(
      (p) =>
        normalizar(p.codigo).includes(q) ||
        normalizar(p.descripcion ?? '').includes(q) ||
        String(p.operacion_sap ?? '').includes(busqueda.trim())
    )
  }, [puestos, busqueda])

  const conTarifa = puestos.filter((p) => vigenteHoy(p.id)).length
  const temporada = temporadas.find((t) => t.id === temporadaId)

  function exportar() {
    const filas: CeldaHoja[][] = [
      ['Puesto', 'Descripcion ceco', 'Operacion', 'Costo x Hora', 'Vigente desde', 'Comentario'],
      ...filtrados.map((p) => {
        const t = vigenteHoy(p.id)
        return [
          p.codigo,
          p.descripcion ?? '',
          p.operacion_sap ?? '',
          t?.costo_hora ?? '',
          t?.vigente_desde ?? '',
          t?.comentario ?? '',
        ] as CeldaHoja[]
      }),
    ]
    descargar(construirXlsx('Tarifas', filas), `tarifas-${temporada?.nombre ?? 'temporada'}.xlsx`)
  }

  return (
    <div className="flex flex-col gap-4">
      <Tarjeta className="p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <Campo etiqueta="Temporada" className="sm:max-w-xs sm:flex-1">
            <Selector
              value={temporadaId ?? ''}
              onChange={(e) => router.push(`/admin/tarifas?temporada=${e.target.value}`)}
            >
              {temporadas.length === 0 && <option value="">Sin temporadas</option>}
              {temporadas.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                  {t.activa ? ' (activa)' : ''}
                </option>
              ))}
            </Selector>
          </Campo>

          <p className="text-sm text-slate-500">
            <span className="font-bold text-slate-900">{conTarifa}</span> de {puestos.length}{' '}
            puestos con tarifa vigente
          </p>
        </div>
      </Tarjeta>

      {temporadaId && puestos.length > 0 && conTarifa === 0 && (
        <Alerta tono="ambar">
          Todavía no hay tarifas vigentes en esta temporada, así que los costos van a salir en cero.
          Con «Importar» las subes todas de una vez.
        </Alerta>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[160px] flex-1">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar puesto, descripción u operación…"
            inputMode="search"
            className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-300 focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/10"
          />
        </div>
        <Boton variante="secundario" tamano="sm" onClick={exportar} disabled={puestos.length === 0}>
          <IconSend className="h-4 w-4" />
          Excel
        </Boton>
        {!soloLectura && temporadaId && (
          <Boton tamano="sm" onClick={() => setAbrirCarga(true)}>
            <IconPlus className="h-4 w-4" />
            Importar
          </Boton>
        )}
      </div>

      <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[var(--shadow-card)]">
        {filtrados.length === 0 ? (
          <EstadoVacio
            icono={<IconInbox />}
            titulo={busqueda ? 'Sin resultados' : 'Sin puestos de trabajo'}
            descripcion={
              busqueda
                ? 'Prueba con otra búsqueda.'
                : 'Carga primero el catálogo de Puestos de trabajo SAP.'
            }
          />
        ) : (
          <>
            {/* Celular: una tarjeta por puesto. La tabla de seis columnas
                obligaba a arrastrar de lado en un teléfono. */}
            <div className="flex flex-col divide-y divide-slate-100 sm:hidden">
              {filtrados.map((p) => {
                const historial = porPuesto.get(p.id) ?? []
                const actual = vigenteHoy(p.id)
                return (
                  <button
                    key={p.id}
                    onClick={() => setPuestoAbierto(p)}
                    className="flex items-start gap-3 px-3 py-3 text-left transition-colors active:bg-slate-50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-slate-800">{p.codigo}</p>
                      <p className="truncate text-xs text-slate-400">{p.descripcion ?? '—'}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-400">
                        {p.operacion_sap !== null && (
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-600">
                            Oper {String(p.operacion_sap).padStart(4, '0')}
                          </span>
                        )}
                        {actual ? formatearFecha(actual.vigente_desde) : 'sin tarifa'}
                        {historial.length > 1 ? ` · ${historial.length} cambios` : ''}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-bold tabular-nums text-slate-900">
                        {actual ? `L ${lempiras.format(actual.costo_hora)}` : '—'}
                      </p>
                      <p className="text-[11px] text-slate-400">por hora</p>
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Escritorio: la tabla completa */}
            <div className="hidden sm:block">
              <div className="scroll-suave overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-slate-100 bg-slate-50/60 text-left">
                    {['Puesto', 'Descripción ceco', 'Oper', 'Costo x hora', 'Desde', 'Cambios'].map(
                      (h) => (
                        <th
                          key={h}
                          className="px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-400"
                        >
                          {h}
                        </th>
                      )
                    )}
                  </tr>
                </thead>
                <tbody>
                  {filtrados.map((p) => {
                    const historial = porPuesto.get(p.id) ?? []
                    const actual = vigenteHoy(p.id)
                    return (
                      <tr
                        key={p.id}
                        onClick={() => setPuestoAbierto(p)}
                        className="cursor-pointer border-b border-slate-50 transition-colors last:border-0 hover:bg-slate-50/70"
                      >
                        <td className="whitespace-nowrap px-3 py-2.5 font-semibold text-slate-800">
                          {p.codigo}
                        </td>
                        <td className="max-w-[240px] truncate px-3 py-2.5 text-slate-600">
                          {p.descripcion ?? '—'}
                        </td>
                        <td className="px-3 py-2.5 tabular-nums text-slate-400">
                          {p.operacion_sap !== null ? String(p.operacion_sap).padStart(4, '0') : '—'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-right font-bold tabular-nums text-slate-900">
                          {actual ? lempiras.format(actual.costo_hora) : '—'}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 text-slate-400">
                          {actual ? formatearFecha(actual.vigente_desde) : '—'}
                        </td>
                        <td className="px-3 py-2.5">
                          {historial.length > 1 ? (
                            <Insignia tono="azul">{historial.length}</Insignia>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            </div>
          </>
        )}
      </div>

      <p className="px-1 text-xs text-slate-400">
        Toca un puesto para ver su historial y registrar un cambio de tarifa. Las tarifas viejas no
        se borran: un trabajo de agosto sigue costeado con la tarifa que estaba vigente en agosto.
      </p>

      {puestoAbierto && temporadaId && (
        <ModalPuesto
          puesto={puestoAbierto}
          temporadaId={temporadaId}
          historial={porPuesto.get(puestoAbierto.id) ?? []}
          soloLectura={soloLectura}
          onCerrar={() => setPuestoAbierto(null)}
          onGuardado={() => {
            setPuestoAbierto(null)
            router.refresh()
          }}
        />
      )}

      {temporadaId && (
        <CargaMasiva
          abierto={abrirCarga}
          onCerrar={() => setAbrirCarga(false)}
          temporadaId={temporadaId}
          puestos={puestos}
          onGuardado={() => {
            setAbrirCarga(false)
            router.refresh()
          }}
        />
      )}
    </div>
  )
}

/* ================================================================== */
/* Un puesto: historial + alta de una tarifa nueva                     */
/* ================================================================== */

function ModalPuesto({
  puesto,
  temporadaId,
  historial,
  soloLectura,
  onCerrar,
  onGuardado,
}: {
  puesto: PuestoTarifa
  temporadaId: string
  historial: TarifaFila[]
  soloLectura: boolean
  onCerrar: () => void
  onGuardado: () => void
}) {
  const supabase = createClient()
  const hoy = hoyIso()
  const [costo, setCosto] = useState('')
  const [desde, setDesde] = useState(hoy)
  const [comentario, setComentario] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function guardar() {
    const valor = aNumero(costo)
    if (valor === null || valor < 0) return setError('Escribe el costo por hora.')
    if (!desde) return setError('Indica desde cuándo aplica la tarifa nueva.')

    setError(null)
    setGuardando(true)
    const { error: e } = await supabase.from('tarifas_puesto').insert({
      temporada_id: temporadaId,
      puesto_trabajo_id: puesto.id,
      costo_hora: valor,
      vigente_desde: desde,
      comentario: comentario || null,
    })
    setGuardando(false)
    if (e) {
      setError(
        e.code === '23505'
          ? 'Ya hay una tarifa que arranca ese mismo día para este puesto. Cambia la fecha.'
          : e.message
      )
      return
    }
    onGuardado()
  }

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo={puesto.codigo}
      pie={
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={onCerrar} disabled={guardando}>
            Cerrar
          </Boton>
          {!soloLectura && (
            <Boton className="flex-1" onClick={guardar} disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar tarifa'}
            </Boton>
          )}
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-500">{puesto.descripcion ?? 'Sin descripción'}</p>

        {historial.length > 0 && (
          <div>
            <p className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">
              Historial de tarifas
            </p>
            <div className="overflow-hidden rounded-xl ring-1 ring-inset ring-slate-200">
              {historial.map((t) => {
                const vigente =
                  t.vigente_desde <= hoy && (t.vigente_hasta === null || t.vigente_hasta >= hoy)
                return (
                  <div
                    key={t.id}
                    className={`flex items-start justify-between gap-3 border-b border-slate-100 px-3 py-2.5 last:border-0 ${
                      vigente ? 'bg-emerald-50/50' : ''
                    }`}
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-bold tabular-nums text-slate-900">
                        {t.moneda} {lempiras.format(t.costo_hora)}
                      </p>
                      <p className="text-xs text-slate-400">
                        {formatearFecha(t.vigente_desde)} →{' '}
                        {t.vigente_hasta ? formatearFecha(t.vigente_hasta) : 'sin fecha de fin'}
                      </p>
                      {t.comentario && (
                        <p className="mt-0.5 text-xs italic text-slate-400">{t.comentario}</p>
                      )}
                    </div>
                    {vigente && <Insignia tono="verde">Vigente</Insignia>}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {!soloLectura && (
          <div className="flex flex-col gap-4 rounded-xl bg-slate-50 p-3.5 ring-1 ring-inset ring-slate-200/70">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
              {historial.length === 0 ? 'Cargar tarifa' : 'Registrar un cambio'}
            </p>

            <Campo etiqueta="Costo por hora (L)" requerido>
              <Entrada
                inputMode="decimal"
                placeholder="171.68"
                value={costo}
                onChange={(e) => setCosto(e.target.value)}
                autoFocus
              />
            </Campo>

            <Campo
              etiqueta="Vigente desde"
              requerido
              ayuda="La tarifa anterior se cierra sola el día antes de esta fecha."
            >
              <Entrada type="date" value={desde} onChange={(e) => setDesde(e.target.value)} />
            </Campo>

            <Campo etiqueta="Motivo del cambio">
              <Entrada
                placeholder="Ej. ajuste por combustible"
                value={comentario}
                onChange={(e) => setComentario(e.target.value)}
              />
            </Campo>
          </div>
        )}

        {error && <Alerta>{error}</Alerta>}
      </div>
    </Modal>
  )
}

/* ================================================================== */
/* Carga masiva desde Excel                                            */
/* ================================================================== */

type Linea = {
  numero: number
  puesto?: PuestoTarifa
  costo?: number
  desde: string
  comentario: string | null
  error?: string
}

function CargaMasiva({
  abierto,
  onCerrar,
  temporadaId,
  puestos,
  onGuardado,
}: {
  abierto: boolean
  onCerrar: () => void
  temporadaId: string
  puestos: PuestoTarifa[]
  onGuardado: () => void
}) {
  const supabase = createClient()
  const router = useRouter()
  const refArchivo = useRef<HTMLInputElement>(null)
  const [desdeGlobal, setDesdeGlobal] = useState(hoyIso())
  const [lineas, setLineas] = useState<Linea[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [guardando, setGuardando] = useState(false)

  function plantilla() {
    // Baja con los puestos ya escritos: sólo hay que poner el costo al
    // lado, que es exactamente como él tiene su hoja hoy.
    const filas: CeldaHoja[][] = [
      ['Puesto', 'Descripcion ceco', 'Costo x Hora', 'Vigente desde', 'Comentario'],
      ...puestos.map((p) => [p.codigo, p.descripcion ?? '', '', '', ''] as CeldaHoja[]),
    ]
    descargar(construirXlsx('Tarifas', filas), 'plantilla-tarifas.xlsx')
  }

  function preparar(matriz: string[][]) {
    setError(null)
    if (matriz.length < 2) {
      setLineas(null)
      setError('El archivo debe traer encabezados y al menos una fila.')
      return
    }

    const encabezados = matriz[0].map(normalizar)
    const col = (...nombres: string[]) =>
      encabezados.findIndex((h) => nombres.some((n) => h === normalizar(n)))

    const iPuesto = col('Puesto', 'codigo', 'Puesto Trabajo')
    const iCosto = col('Costo x Hora', 'costo hora', 'costo', 'tarifa')
    const iDesde = col('Vigente desde', 'desde', 'fecha')
    const iComentario = col('Comentario', 'motivo', 'observacion')

    if (iPuesto < 0 || iCosto < 0) {
      setLineas(null)
      setError(
        'Faltan las columnas «Puesto» y «Costo x Hora». Descarga la plantilla, que ya viene con los puestos.'
      )
      return
    }

    const resultado: Linea[] = []
    for (let i = 1; i < matriz.length; i++) {
      const fila = matriz[i]
      const codigo = (fila[iPuesto] ?? '').trim()
      const costoBruto = (fila[iCosto] ?? '').trim()
      // Los puestos sin costo se saltan sin ruido: la plantilla trae los 38
      // y lo normal es llenar sólo los que cambian.
      if (!costoBruto) continue

      const desdeBruto = iDesde >= 0 ? (fila[iDesde] ?? '').trim() : ''
      const linea: Linea = {
        numero: i + 1,
        desde: desdeGlobal,
        comentario: iComentario >= 0 ? (fila[iComentario] ?? '').trim() || null : null,
      }

      const n = normalizar(codigo)
      linea.puesto =
        puestos.find((p) => normalizar(p.codigo) === n) ??
        puestos.find((p) => normalizar(p.descripcion ?? '') === n)

      if (!linea.puesto) {
        linea.error = `no existe el puesto “${codigo}”`
      } else {
        const valor = aNumero(costoBruto)
        if (valor === null || valor < 0) linea.error = `“${costoBruto}” no es un costo válido`
        else linea.costo = valor
      }

      if (desdeBruto) {
        const iso = aFechaIso(desdeBruto)
        if (iso) linea.desde = iso
        else linea.error ??= `“${desdeBruto}” no es una fecha (usa 2026-09-07)`
      }

      resultado.push(linea)
    }

    if (resultado.length === 0) {
      setLineas(null)
      setError('Ninguna fila trae costo. Escribe el costo por hora al lado de cada puesto.')
      return
    }
    setLineas(resultado)
  }

  async function leer(archivo: File) {
    try {
      preparar(await leerArchivoTabular(archivo))
    } catch (e) {
      setLineas(null)
      setError(mensajeDeError(e, 'No se pudo leer el archivo.'))
    }
  }

  async function importar() {
    const validas = (lineas ?? []).filter((l) => !l.error && l.puesto && l.costo !== undefined)
    if (validas.length === 0) return

    setGuardando(true)
    setError(null)

    // De una en una y en orden: el disparador que cierra la vigencia
    // anterior necesita ver cada tarifa ya insertada para calcular el
    // «vigente_hasta» de la que reemplaza. En bloque se pisarían.
    let hechas = 0
    for (const l of validas) {
      const { error: e } = await supabase.from('tarifas_puesto').insert({
        temporada_id: temporadaId,
        puesto_trabajo_id: l.puesto!.id,
        costo_hora: l.costo!,
        vigente_desde: l.desde,
        comentario: l.comentario,
      })
      if (e) {
        setGuardando(false)
        setError(`${l.puesto!.codigo}: ${e.message} — se cargaron ${hechas} de ${validas.length}.`)
        router.refresh()
        return
      }
      hechas++
    }

    setGuardando(false)
    setLineas(null)
    if (refArchivo.current) refArchivo.current.value = ''
    onGuardado()
  }

  const validas = (lineas ?? []).filter((l) => !l.error).length
  const malas = (lineas ?? []).filter((l) => l.error)

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Cargar tarifas"
      pie={
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton className="flex-1" onClick={importar} disabled={guardando || validas === 0}>
            {guardando ? 'Cargando…' : validas > 0 ? `Cargar ${validas}` : 'Cargar'}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="rounded-xl bg-slate-50 p-3.5 ring-1 ring-inset ring-slate-200/70">
          <p className="text-sm text-slate-600">
            La plantilla baja con los {puestos.length} puestos ya escritos. Pon el costo por hora al
            lado de los que apliquen y vuelve a subirla; las filas en blanco se ignoran.
          </p>
          <Boton variante="secundario" tamano="sm" className="mt-2.5" onClick={plantilla}>
            Descargar plantilla .xlsx
          </Boton>
        </div>

        <Campo
          etiqueta="Vigente desde"
          ayuda="Se usa para las filas que no traigan fecha propia en el archivo."
        >
          <Entrada
            type="date"
            value={desdeGlobal}
            onChange={(e) => setDesdeGlobal(e.target.value)}
          />
        </Campo>

        <input
          ref={refArchivo}
          type="file"
          accept=".xlsx,.csv,.txt"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) leer(f)
          }}
          className={clasesArchivo}
        />

        <textarea
          rows={3}
          placeholder="…o pega aquí desde Excel (Puesto y Costo x Hora)"
          onChange={(e) => {
            const t = e.target.value.trim()
            if (t) preparar(partirTextoTabular(t))
            else setLineas(null)
          }}
          className={clasesPegar}
        />

        {error && <Alerta>{error}</Alerta>}

        {lineas && (
          <div>
            <p className="text-sm">
              <span className="font-bold text-emerald-700">{validas}</span> tarifa
              {validas === 1 ? '' : 's'} lista{validas === 1 ? '' : 's'}
              {malas.length > 0 && (
                <>
                  {' · '}
                  <span className="font-bold text-red-700">{malas.length}</span> con problema
                </>
              )}
            </p>
            {malas.length > 0 && (
              <ul className="mt-2 max-h-36 overflow-y-auto rounded-xl bg-red-50/60 p-3 text-xs text-red-800">
                {malas.slice(0, 20).map((l) => (
                  <li key={l.numero} className="py-0.5">
                    <span className="font-semibold">Fila {l.numero}:</span> {l.error}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
