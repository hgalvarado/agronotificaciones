'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Modal } from '@/components/ui/Modal'
import {
  Alerta,
  Boton,
  Campo,
  Insignia,
  Selector,
  Tarjeta,
} from '@/components/ui/Primitivos'
import { IconCheck, IconCopy, IconPlus, IconSearch } from '@/components/ui/Icons'
import { Entrada } from '@/components/ui/Primitivos'
import {
  TablaAvanzada,
  type ColumnaTabla,
  type FilaTabla,
  type PermisosTabla,
} from '@/components/ui/TablaAvanzada'
import { ImportarLotes } from './ImportarLotes'
import { CICLOS } from '@/lib/estados'
import type { Zona } from '@/lib/types'
import { mensajeDeError } from '@/lib/errores'

export type AsignacionLote = {
  id: string
  lote_id: string
  zona_id: string | null
  area_bruta: number | null
  area_neta: number
  ciclo: number
  activo: boolean
  nomenclatura: string
  nombre: string | null
}

export type LoteDisponible = { id: string; nomenclatura: string; nombre: string | null }

export type TemporadaOpcion = { id: string; nombre: string; activa: boolean }

export function LotesTemporada({
  temporadaId,
  temporadaNombre,
  temporadaEsActiva = true,
  temporadas = [],
  asignados,
  disponibles,
  zonas,
  permisos,
}: {
  temporadaId: string | null
  temporadaNombre: string | null
  /** Si la temporada que se está viendo es la marcada como activa. */
  temporadaEsActiva?: boolean
  temporadas?: TemporadaOpcion[]
  asignados: AsignacionLote[]
  disponibles: LoteDisponible[]
  zonas: Zona[]
  permisos?: PermisosTabla
}) {
  const supabase = createClient()
  const router = useRouter()
  const [agregando, setAgregando] = useState(false)
  const [creando, setCreando] = useState(false)
  const [importando, setImportando] = useState(false)
  const [clonando, setClonando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const areaTotal = asignados.reduce((acc, a) => acc + (a.area_neta ?? 0), 0)

  const columnas: ColumnaTabla[] = useMemo(
    () => [
      {
        key: 'nomenclatura',
        label: 'Lote',
        // La nomenclatura no se edita en la celda: es la llave con la que
        // se reconoce el lote en todo el sistema. Si está mal escrita, se
        // borra el lote y se vuelve a crear.
        render: (f) => (
          <div className="min-w-0">
            <p className="font-semibold text-slate-800">{String(f.nomenclatura)}</p>
            {f.nombre ? <p className="text-xs text-slate-400">{String(f.nombre)}</p> : null}
          </div>
        ),
      },
      { key: 'nombre', label: 'Nombre', tipo: 'texto', editable: true },
      {
        key: 'zona_id',
        label: 'Zona',
        tipo: 'seleccion',
        editable: true,
        opciones: zonas.map((z) => ({ value: z.id, label: z.nombre })),
      },
      { key: 'area_bruta', label: 'Área bruta', tipo: 'numero', editable: true, alinear: 'derecha' },
      { key: 'area_neta', label: 'Área neta', tipo: 'numero', editable: true, alinear: 'derecha' },
      {
        key: 'ciclo',
        label: 'Ciclo',
        tipo: 'seleccion',
        editable: true,
        opciones: CICLOS.map((c) => ({ value: String(c), label: String(c) })),
      },
      { key: 'activo', label: 'Activo', tipo: 'booleano', editable: true },
    ],
    [zonas]
  )

  async function actualizar(id: string, cambios: Record<string, unknown>) {
    const { error: e } = await supabase.from('lotes_temporada').update(cambios).eq('id', id)
    if (e) {
      setError(e.message)
      return
    }
    setError(null)
    router.refresh()
  }

  // El nombre vive en `lotes` (es del lote físico), lo demás en
  // `lotes_temporada`. Se manda cada cambio a su tabla.
  async function editarCelda(id: string, key: string, valor: unknown) {
    if (key === 'nombre') {
      const fila = asignados.find((a) => a.id === id)
      if (!fila) return
      const { error: e } = await supabase
        .from('lotes')
        .update({ nombre: valor })
        .eq('id', fila.lote_id)
      if (e) return setError(e.message)
      setError(null)
      router.refresh()
      return
    }
    await actualizar(id, { [key]: valor })
  }

  async function editarMasivo(ids: string[], cambios: Record<string, unknown>) {
    if ('nombre' in cambios) {
      const loteIds = asignados.filter((a) => ids.includes(a.id)).map((a) => a.lote_id)
      const { error: e } = await supabase.from('lotes').update(cambios).in('id', loteIds)
      if (e) throw new Error(e.message)
    } else {
      const { error: e } = await supabase.from('lotes_temporada').update(cambios).in('id', ids)
      if (e) throw new Error(e.message)
    }
    setError(null)
    router.refresh()
  }

  // Borra el lote completo (no sólo su asignación a la temporada), que es
  // el caso real: se escribió mal la nomenclatura y hay que rehacerlo. La
  // base se niega sola si el lote ya tiene labores registradas, así que el
  // histórico no corre riesgo aunque se confirme el borrado.
  async function eliminar(ids: string[]) {
    const loteIds = asignados.filter((a) => ids.includes(a.id)).map((a) => a.lote_id)
    const fallos: string[] = []

    for (const loteId of loteIds) {
      const { error: e } = await supabase.rpc('fn_eliminar_lote', {
        p_lote_id: loteId,
        p_forzar: true,
      })
      if (e) fallos.push(e.message.replace(/^.*?:\s*/, ''))
    }

    router.refresh()
    if (fallos.length > 0) {
      throw new Error(
        fallos.length === loteIds.length
          ? fallos[0]
          : `Se eliminaron ${loteIds.length - fallos.length} de ${loteIds.length}. ${fallos[0]}`
      )
    }
  }

  if (!temporadaId) {
    return (
      <Alerta tono="ambar">
        No hay una temporada marcada como activa. Ve a Catálogos → Temporadas, crea una y actívala
        con el interruptor.
      </Alerta>
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {/* El selector cambia la dirección en vez de guardar estado local:
          así la temporada que se está viendo se puede compartir por chat y
          la página se vuelve a pedir al servidor con sus lotes. */}
      {temporadas.length > 1 && (
        <Tarjeta className="p-3 sm:p-4">
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wide text-slate-400">
              Temporada
            </span>
            <Selector
              value={temporadaId ?? ''}
              onChange={(e) => router.push(`/admin/lotes?temporada=${e.target.value}`)}
            >
              {temporadas.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                  {t.activa ? ' (activa)' : ''}
                </option>
              ))}
            </Selector>
          </label>
        </Tarjeta>
      )}

      <div className="grid grid-cols-3 gap-3">
        <Tarjeta className="px-3.5 py-3">
          <p className="truncate text-sm font-bold text-slate-900">{temporadaNombre}</p>
          <p className="text-[11px] font-medium text-slate-400">
            {temporadaEsActiva ? 'Temporada activa' : 'Temporada'}
          </p>
        </Tarjeta>
        <Tarjeta className="px-3.5 py-3">
          <p className="text-xl font-bold tracking-tight text-slate-900">{asignados.length}</p>
          <p className="text-[11px] font-medium text-slate-400">Lotes asignados</p>
        </Tarjeta>
        <Tarjeta className="px-3.5 py-3">
          <p className="text-xl font-bold tracking-tight text-brand-700">
            {Math.round(areaTotal * 100) / 100}
          </p>
          <p className="text-[11px] font-medium text-slate-400">Mz netas</p>
        </Tarjeta>
      </div>

      {error && <Alerta>{error}</Alerta>}

      {disponibles.length > 0 && (
        <p className="px-1 text-xs text-slate-400">
          Hay <strong>{disponibles.length}</strong>{' '}
          {disponibles.length === 1
            ? 'lote del catálogo sin asignar'
            : 'lotes del catálogo sin asignar'}{' '}
          a esta temporada.
        </p>
      )}

      <TablaAvanzada
        titulo={`Lotes ${temporadaNombre ?? ''}`.trim()}
        columnas={columnas}
        filas={asignados as unknown as FilaTabla[]}
        permisos={permisos}
        minAncho="720px"
        vacio={{
          titulo: 'Ningún lote asignado',
          descripcion:
            'Asigna lotes a esta temporada para poder registrar avance en campo, o cárgalos desde Excel.',
        }}
        onEditarCelda={editarCelda}
        onEditarMasivo={editarMasivo}
        onEliminar={eliminar}
        acciones={
          <>
            <Boton variante="secundario" tamano="sm" onClick={() => setClonando(true)}>
              <IconCopy className="h-4 w-4" />
              Copiar de otra temporada
            </Boton>
            <Boton variante="secundario" tamano="sm" onClick={() => setImportando(true)}>
              Importar
            </Boton>
            <Boton
              variante="secundario"
              tamano="sm"
              onClick={() => setAgregando(true)}
              disabled={disponibles.length === 0}
            >
              Asignar existentes ({disponibles.length})
            </Boton>
            <Boton tamano="sm" onClick={() => setCreando(true)}>
              <IconPlus className="h-4 w-4" />
              Nuevo lote
            </Boton>
          </>
        }
      />

      <p className="px-1 text-xs text-slate-400">
        El <strong>área neta</strong> es el área física del lote. El área que se va a trabajar se
        define aparte, en el <strong>Plan de mecanización</strong>, y es contra ese plan que se mide
        el avance. El <strong>ciclo</strong> se usa como valor por defecto al capturar labores.
      </p>

      <ModalNuevoLote
        abierto={creando}
        onCerrar={() => setCreando(false)}
        temporadaId={temporadaId}
        zonas={zonas}
      />

      <ImportarLotes
        abierto={importando}
        onCerrar={() => setImportando(false)}
        temporadaId={temporadaId}
        zonas={zonas}
        nomenclaturasExistentes={new Set(asignados.map((a) => a.nomenclatura))}
      />

      <ModalClonar
        abierto={clonando}
        onCerrar={() => setClonando(false)}
        temporadaDestinoId={temporadaId}
        temporadas={temporadas}
      />

      <ModalAsignar
        abierto={agregando}
        onCerrar={() => setAgregando(false)}
        temporadaId={temporadaId}
        disponibles={disponibles}
        zonas={zonas}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Modal para asignar lotes nuevos a la temporada                      */
/* ------------------------------------------------------------------ */

function ModalAsignar({
  abierto,
  onCerrar,
  temporadaId,
  disponibles,
  zonas,
}: {
  abierto: boolean
  onCerrar: () => void
  temporadaId: string
  disponibles: LoteDisponible[]
  zonas: Zona[]
}) {
  const supabase = createClient()
  const router = useRouter()
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set())
  const [zonaId, setZonaId] = useState('')
  const [busqueda, setBusqueda] = useState('')
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    if (!q) return disponibles
    return disponibles.filter(
      (l) => l.nomenclatura.toLowerCase().includes(q) || (l.nombre ?? '').toLowerCase().includes(q)
    )
  }, [disponibles, busqueda])

  function alternar(id: string) {
    setSeleccion((prev) => {
      const copia = new Set(prev)
      if (copia.has(id)) copia.delete(id)
      else copia.add(id)
      return copia
    })
  }

  async function asignar() {
    if (seleccion.size === 0) return setError('Selecciona al menos un lote.')
    setError(null)
    setGuardando(true)

    // area_neta arranca en 0: se captura lote por lote en la tabla, porque
    // el área real varía y no tendría sentido inventar un valor por defecto.
    const filas = [...seleccion].map((lote_id) => ({
      lote_id,
      temporada_id: temporadaId,
      zona_id: zonaId || null,
      area_neta: 0,
      activo: true,
    }))

    const { error: e } = await supabase.from('lotes_temporada').insert(filas)

    setGuardando(false)
    if (e) return setError(e.message)

    setSeleccion(new Set())
    onCerrar()
    router.refresh()
  }

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Asignar lotes a la temporada"
      pie={
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton className="flex-1" onClick={asignar} disabled={guardando}>
            {guardando ? 'Asignando…' : `Asignar ${seleccion.size || ''}`}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <Campo etiqueta="Zona" ayuda="Se aplica a todos los lotes que asignes ahora; luego puedes ajustarla uno por uno.">
          <Selector value={zonaId} onChange={(e) => setZonaId(e.target.value)}>
            <option value="">Sin zona</option>
            {zonas.map((z) => (
              <option key={z.id} value={z.id}>
                {z.nombre}
              </option>
            ))}
          </Selector>
        </Campo>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
              Lotes disponibles
            </p>
            <Insignia tono="verde">{seleccion.size}</Insignia>
          </div>

          <div className="relative mb-2">
            <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
            <input
              value={busqueda}
              onChange={(e) => setBusqueda(e.target.value)}
              placeholder="Buscar…"
              className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm placeholder:text-slate-300 focus:border-brand-600 focus:bg-white focus:outline-none"
            />
          </div>

          <div className="scroll-suave max-h-64 overflow-y-auto rounded-xl border border-slate-200">
            {filtrados.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-slate-400">
                Todos los lotes del catálogo ya están asignados a esta temporada.
              </p>
            ) : (
              filtrados.map((lote) => {
                const marcado = seleccion.has(lote.id)
                return (
                  <button
                    key={lote.id}
                    type="button"
                    onClick={() => alternar(lote.id)}
                    className={`flex w-full items-center gap-3 border-b border-slate-50 px-3 py-2.5 text-left transition-colors last:border-0 ${
                      marcado ? 'bg-brand-50/60' : 'hover:bg-slate-50'
                    }`}
                  >
                    <span
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition-all ${
                        marcado
                          ? 'border-brand-700 bg-brand-700 text-white'
                          : 'border-slate-300 bg-white'
                      }`}
                    >
                      {marcado && <IconCheck className="h-3.5 w-3.5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-slate-800">
                        {lote.nomenclatura}
                      </span>
                      {lote.nombre && (
                        <span className="block truncate text-xs text-slate-400">{lote.nombre}</span>
                      )}
                    </span>
                  </button>
                )
              })
            )}
          </div>
        </div>

        {error && <Alerta>{error}</Alerta>}
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Alta de un lote nuevo: catálogo + asignación a la temporada de una  */
/* sola vez, con zona y áreas. Evita el doble paso.                    */
/* ------------------------------------------------------------------ */

function ModalNuevoLote({
  abierto,
  onCerrar,
  temporadaId,
  zonas,
}: {
  abierto: boolean
  onCerrar: () => void
  temporadaId: string
  zonas: Zona[]
}) {
  const supabase = createClient()
  const router = useRouter()
  const [form, setForm] = useState({
    nomenclatura: '',
    nombre: '',
    zona_id: '',
    area_bruta: '',
    area_neta: '',
  })
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function crear() {
    if (!form.nomenclatura.trim()) return setError('La nomenclatura es obligatoria.')

    setError(null)
    setGuardando(true)
    try {
      const { data: lote, error: e1 } = await supabase
        .from('lotes')
        .insert({
          nomenclatura: form.nomenclatura.trim(),
          nombre: form.nombre.trim() || null,
        })
        .select('id')
        .single()
      if (e1) throw e1

      const { error: e2 } = await supabase.from('lotes_temporada').insert({
        lote_id: lote.id,
        temporada_id: temporadaId,
        zona_id: form.zona_id || null,
        area_bruta: form.area_bruta ? Number(form.area_bruta) : null,
        area_neta: form.area_neta ? Number(form.area_neta) : 0,
        activo: true,
      })
      if (e2) throw e2

      setGuardando(false)
      setForm({ nomenclatura: '', nombre: '', zona_id: '', area_bruta: '', area_neta: '' })
      onCerrar()
      router.refresh()
    } catch (e) {
      setGuardando(false)
      setError(mensajeDeError(e, 'No se pudo crear el lote.'))
    }
  }

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Nuevo lote"
      pie={
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={onCerrar} disabled={guardando}>
            Cancelar
          </Boton>
          <Boton className="flex-1" onClick={crear} disabled={guardando}>
            {guardando ? 'Creando…' : 'Crear y asignar'}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-500">
          Se crea en el catálogo y se asigna a la temporada activa en un solo paso.
        </p>

        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Nomenclatura" requerido>
            <Entrada
              value={form.nomenclatura}
              onChange={(e) => setForm({ ...form, nomenclatura: e.target.value })}
              placeholder="1001-010"
              autoFocus
            />
          </Campo>
          <Campo etiqueta="Nombre">
            <Entrada
              value={form.nombre}
              onChange={(e) => setForm({ ...form, nombre: e.target.value })}
              placeholder="Carretillo"
            />
          </Campo>
        </div>

        <Campo etiqueta="Zona">
          <Selector value={form.zona_id} onChange={(e) => setForm({ ...form, zona_id: e.target.value })}>
            <option value="">Sin zona</option>
            {zonas.map((z) => (
              <option key={z.id} value={z.id}>
                {z.nombre}
              </option>
            ))}
          </Selector>
        </Campo>

        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Área bruta">
            <Entrada
              inputMode="decimal"
              value={form.area_bruta}
              onChange={(e) => setForm({ ...form, area_bruta: e.target.value })}
              placeholder="29.84"
            />
          </Campo>
          <Campo etiqueta="Área neta" ayuda="Meta del dashboard.">
            <Entrada
              inputMode="decimal"
              value={form.area_neta}
              onChange={(e) => setForm({ ...form, area_neta: e.target.value })}
              placeholder="24.95"
            />
          </Campo>
        </div>

        {error && <Alerta>{error}</Alerta>}
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */
/* Clonado masivo entre temporadas                                     */
/* ------------------------------------------------------------------ */

/**
 * «Copiar lotes de una temporada origen a una temporada destino… si el
 *  lote ya existe en el destino, se actualizan sus datos; si no existe,
 *  se inserta como nuevo.»
 *
 * El destino es la temporada que se está viendo, no un tercer selector:
 * lo que se está haciendo es llenar ESTA temporada con los lotes de otra,
 * y así el resultado queda a la vista al cerrar el modal.
 *
 * Antes de copiar se cuenta qué va a pasar —cuántos entran nuevos y
 * cuántos se van a corregir—, porque «actualizar» sobre una temporada que
 * ya tiene áreas capturadas las reemplaza, y eso hay que verlo antes de
 * apretar el botón, no después.
 */
function ModalClonar({
  abierto,
  onCerrar,
  temporadaDestinoId,
  temporadas,
}: {
  abierto: boolean
  onCerrar: () => void
  temporadaDestinoId: string | null
  temporadas: TemporadaOpcion[]
}) {
  const supabase = createClient()
  const router = useRouter()

  const otras = useMemo(
    () => temporadas.filter((t) => t.id !== temporadaDestinoId),
    [temporadas, temporadaDestinoId]
  )

  const [origenId, setOrigenId] = useState('')
  const [previo, setPrevio] = useState<{ nuevos: number; corregidos: number } | null>(null)
  const [contando, setContando] = useState(false)
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [resultado, setResultado] = useState<string | null>(null)

  const destino = temporadas.find((t) => t.id === temporadaDestinoId)
  const origen = otras.find((t) => t.id === origenId)

  async function contar(id: string) {
    setOrigenId(id)
    setPrevio(null)
    setError(null)
    setResultado(null)
    if (!id || !temporadaDestinoId) return

    setContando(true)
    const [enOrigen, enDestino] = await Promise.all([
      supabase.from('lotes_temporada').select('lote_id').eq('temporada_id', id),
      supabase.from('lotes_temporada').select('lote_id').eq('temporada_id', temporadaDestinoId),
    ])
    setContando(false)

    if (enOrigen.error || enDestino.error) {
      setError(mensajeDeError(enOrigen.error ?? enDestino.error, 'No se pudo leer las temporadas.'))
      return
    }

    const yaEstan = new Set((enDestino.data ?? []).map((f) => f.lote_id as string))
    const ids = (enOrigen.data ?? []).map((f) => f.lote_id as string)
    setPrevio({
      nuevos: ids.filter((x) => !yaEstan.has(x)).length,
      corregidos: ids.filter((x) => yaEstan.has(x)).length,
    })
  }

  async function clonar() {
    if (!origenId) return setError('Elige la temporada de la que se copian los lotes.')
    setError(null)
    setResultado(null)
    setGuardando(true)

    const { data, error: e } = await supabase.rpc('fn_clonar_lotes_temporada', {
      p_origen_id: origenId,
      p_destino_id: temporadaDestinoId,
    })

    setGuardando(false)
    if (e) {
      return setError(
        mensajeDeError(
          e,
          'No se pudieron copiar los lotes. Si dice que la función no existe, falta correr la migración 16 en el SQL Editor de Supabase.'
        )
      )
    }

    const fila = (data as { insertados: number; actualizados: number }[] | null)?.[0]
    const partes: string[] = []
    if (fila && fila.insertados > 0)
      partes.push(`${fila.insertados} agregado${fila.insertados === 1 ? '' : 's'}`)
    if (fila && fila.actualizados > 0)
      partes.push(`${fila.actualizados} actualizado${fila.actualizados === 1 ? '' : 's'}`)
    setResultado(partes.length > 0 ? `Listo: ${partes.join(' y ')}.` : 'No hubo nada que copiar.')
    setPrevio(null)
    router.refresh()
  }

  function cerrar() {
    setOrigenId('')
    setPrevio(null)
    setError(null)
    setResultado(null)
    onCerrar()
  }

  return (
    <Modal
      abierto={abierto}
      onCerrar={cerrar}
      titulo="Copiar lotes de otra temporada"
      pie={
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={cerrar} disabled={guardando}>
            Cerrar
          </Boton>
          <Boton className="flex-1" onClick={clonar} disabled={guardando || !origenId}>
            {guardando ? 'Copiando…' : 'Copiar'}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-slate-500">
          Se copian a <strong>{destino?.nombre ?? 'esta temporada'}</strong> la zona, el área bruta,
          el área neta, el ciclo y el estado de cada lote. El nombre y la nomenclatura no se copian
          porque son del lote físico: son los mismos en todas las temporadas.
        </p>

        {otras.length === 0 ? (
          <Alerta tono="ambar">
            No hay otra temporada de la que copiar. Crea la anterior en Catálogos → Temporadas.
          </Alerta>
        ) : (
          <Campo etiqueta="Copiar desde" requerido>
            <Selector value={origenId} onChange={(e) => contar(e.target.value)}>
              <option value="">Elige la temporada…</option>
              {otras.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nombre}
                  {t.activa ? ' (activa)' : ''}
                </option>
              ))}
            </Selector>
          </Campo>
        )}

        {contando && <p className="text-sm text-slate-400">Revisando…</p>}

        {previo && (
          <div className="rounded-xl bg-slate-50 p-3.5 text-sm ring-1 ring-inset ring-slate-200/70">
            <p className="text-[11px] font-bold uppercase tracking-wide text-slate-400">
              Qué va a pasar
            </p>
            {previo.nuevos === 0 && previo.corregidos === 0 ? (
              <p className="mt-1 text-slate-500">
                {origen?.nombre} no tiene lotes asignados, así que no hay nada que copiar.
              </p>
            ) : (
              <>
                <div className="mt-1.5 flex flex-wrap gap-2">
                  {previo.nuevos > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-700">
                      <IconPlus className="h-3.5 w-3.5" />
                      {previo.nuevos === 1 ? 'se agrega 1' : `se agregan ${previo.nuevos}`}
                    </span>
                  )}
                  {previo.corregidos > 0 && (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                      {previo.corregidos === 1
                        ? '1 ya está y se actualiza'
                        : `${previo.corregidos} ya están y se actualizan`}
                    </span>
                  )}
                </div>
                {previo.corregidos > 0 && (
                  <p className="mt-2 text-xs text-slate-500">
                    {previo.corregidos === 1 ? 'Ese lote va' : `Esos ${previo.corregidos} van`} a
                    quedar con la zona, las áreas, el ciclo y el estado de {origen?.nombre}. Si en{' '}
                    {destino?.nombre} ya les habías corregido el área, se reemplaza.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        {error && <Alerta>{error}</Alerta>}
        {resultado && (
          <Alerta tono="azul">
            <span className="inline-flex items-center gap-1.5">
              <IconCheck className="h-4 w-4" />
              {resultado}
            </span>
          </Alerta>
        )}
      </div>
    </Modal>
  )
}
