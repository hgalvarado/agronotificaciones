'use client'

/**
 * Formulario completo de una línea de labor.
 *
 * «Reemplazar la edición actual limitada. Al seleccionar un registro y
 *  hacer clic en Editar, se debe abrir un modal con todos los datos
 *  originales capturados desde el ticket.»
 *
 * Lo capturado en un ticket vive en tres tablas y no en una, y eso no es
 * un detalle técnico: decide a cuántas filas afecta cada cambio.
 *
 *   · `horometros`  — el equipo, el turno, el operador y las lecturas.
 *     Es UNA pasada de la máquina; todas las labores de esa pasada la
 *     comparten.
 *   · `registros`   — la labor, su tarea SAP, el implemento y las horas
 *     imputadas. Puede cubrir varios lotes.
 *   · `registro_detalle` — la línea: el lote, la fecha, el ciclo, la
 *     etapa, las manzanas y los proveedores. Es sólo esta fila.
 *
 * El formulario lo dice en pantalla y sólo manda a la base los grupos que
 * de verdad cambiaron, para no tocar filas ajenas sin necesidad.
 */

import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Alerta,
  AreaTexto,
  Boton,
  Campo,
  Entrada,
  Selector,
} from '@/components/ui/Primitivos'
import { Modal } from '@/components/ui/Modal'
import { SelectorBuscable, type OpcionBuscable } from '@/components/ui/SelectorBuscable'
import { CICLOS } from '@/lib/estados'
import { mensajeDeError } from '@/lib/errores'
import type { Implemento, TareaSap, TurnoTipo } from '@/lib/types'
import type { ImplementoFisico, Proveedor } from '@/lib/datosRegistro'

/** Lo que el modal necesita de la fila. Coincide con `v_labores_control`. */
export type FilaEditable = {
  detalle_id: string
  registro_id: string
  horometro_id: string
  ticket_id: string
  ticket_codigo: string
  ut: string
  lote_nombre: string | null
  lote_temporada_id: string
  temporada_id?: string | null
  fecha: string
  labor_id: string
  labor_nombre: string
  tarea_id: string
  implemento_id: string | null
  ciclo: number
  avance_mz: number | null
  horas_maquina: number
  horas_hombre: number | null
  horas_notificadas: number | null
  turno: TurnoTipo
  equipo_codigo: string
  lotes_del_registro: number
  comentarios?: string | null
  /* Llegan con la migración 19 */
  implemento_fisico_id?: string | null
  /* Llegan con la migración 22 */
  etapa?: number | null
  con_moto?: boolean | null
  proveedor_plastico_id?: string | null
  proveedor_manguera_id?: string | null
  detalle_comentarios?: string | null
  detalle_fecha?: string | null
  equipo_id?: string | null
  operador_id?: string | null
  horometro_inicial?: number | null
  horometro_final?: number | null
  registros_del_horometro?: number | null
}

export type LaborCompleta = {
  id: string
  nombre: string
  labores_tareas: { tarea_id: string }[]
  labores_implementos: { implemento_id: string }[]
  /* Opcionales: llegan según la migración que esté corrida. */
  usa_proveedor_plastico?: boolean | null
  usa_proveedor_manguera?: boolean | null
  seguimiento_emplasticado?: boolean | null
}

export type CatalogosEdicion = {
  labores: LaborCompleta[]
  tareasSap: TareaSap[]
  implementos: Implemento[]
  implementosFisicos: ImplementoFisico[]
  vinculosFisicos: { labor_id: string; implemento_fisico_id: string }[]
  proveedores: Proveedor[]
  operadores: { id: string; codigo: string; nombre: string }[]
  equipos: { id: string; codigo: string; nombre: string | null }[]
  lotes: {
    lote_temporada_id: string
    temporada_id: string
    temporada_nombre: string
    nomenclatura: string
    nombre: string | null
  }[]
}

const ETAPAS = [1, 2, 3] as const

/** Estado del formulario: strings, que es lo que devuelven los campos. */
type Form = {
  // horómetro
  equipo_id: string
  operador_id: string
  turno: TurnoTipo
  horometro_inicial: string
  horometro_final: string
  horas_hombre: string
  // registro
  labor_id: string
  tarea_id: string
  implemento_id: string
  implemento_fisico_id: string
  horas_notificadas: string
  comentarios: string
  // detalle
  lote_temporada_id: string
  fecha: string
  ciclo: string
  etapa: string
  avance_mz: string
  con_moto: string
  proveedor_plastico_id: string
  proveedor_manguera_id: string
  detalle_comentarios: string
}

function aForm(f: FilaEditable): Form {
  const txt = (v: unknown) => (v === null || v === undefined ? '' : String(v))
  return {
    equipo_id: txt(f.equipo_id),
    operador_id: txt(f.operador_id),
    turno: f.turno,
    horometro_inicial: txt(f.horometro_inicial),
    horometro_final: txt(f.horometro_final),
    horas_hombre: txt(f.horas_hombre),
    labor_id: f.labor_id,
    tarea_id: f.tarea_id,
    implemento_id: txt(f.implemento_id),
    implemento_fisico_id: txt(f.implemento_fisico_id),
    horas_notificadas: txt(f.horas_notificadas),
    comentarios: txt(f.comentarios),
    lote_temporada_id: f.lote_temporada_id,
    fecha: f.detalle_fecha ?? f.fecha,
    ciclo: String(f.ciclo ?? 1),
    etapa: txt(f.etapa),
    avance_mz: txt(f.avance_mz),
    con_moto: f.con_moto === null || f.con_moto === undefined ? '' : f.con_moto ? 'si' : 'no',
    proveedor_plastico_id: txt(f.proveedor_plastico_id),
    proveedor_manguera_id: txt(f.proveedor_manguera_id),
    detalle_comentarios: txt(f.detalle_comentarios),
  }
}

const numero = (v: string) => (v.trim() === '' ? null : Number(v))

/**
 * Envoltorio: sin fila no hay modal, y con otra fila se monta uno nuevo.
 *
 * El `key` es lo que reinicia el formulario al abrir otra línea. La
 * alternativa —copiar la fila al estado dentro de un `useEffect`— es
 * justo lo que React 19 marca como cascada de renders, y además deja un
 * parpadeo con los valores de la línea anterior.
 */
export function EditarLaborModal({
  fila,
  catalogos,
  onCerrar,
  onGuardado,
}: {
  fila: FilaEditable | null
  catalogos: CatalogosEdicion
  onCerrar: () => void
  onGuardado: () => Promise<void> | void
}) {
  if (!fila) return null
  return (
    <Formulario
      key={fila.detalle_id}
      fila={fila}
      catalogos={catalogos}
      onCerrar={onCerrar}
      onGuardado={onGuardado}
    />
  )
}

function Formulario({
  fila,
  catalogos,
  onCerrar,
  onGuardado,
}: {
  fila: FilaEditable
  catalogos: CatalogosEdicion
  onCerrar: () => void
  onGuardado: () => Promise<void> | void
}) {
  const supabase = createClient()
  const [form, setForm] = useState<Form>(() => aForm(fila))
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const labor = useMemo(
    () => catalogos.labores.find((l) => l.id === form.labor_id),
    [catalogos.labores, form.labor_id]
  )

  // Las tres columnas nuevas son opcionales: si la migración que las trae
  // no está corrida, el campo no se ofrece en vez de fallar al guardar.
  const hayColumnas22 = fila.equipo_id !== undefined
  const hayImplementoFisico = fila.implemento_fisico_id !== undefined
  const sinBanderas = labor !== undefined && labor.usa_proveedor_plastico === undefined

  const pidePlastico = sinBanderas ? true : Boolean(labor?.usa_proveedor_plastico)
  const pideManguera = sinBanderas ? true : Boolean(labor?.usa_proveedor_manguera)
  const pideEtapa =
    labor === undefined || labor.seguimiento_emplasticado === undefined
      ? true
      : Boolean(labor.seguimiento_emplasticado)

  const tareasPermitidas = useMemo(() => {
    const ids = new Set(labor?.labores_tareas.map((t) => t.tarea_id) ?? [])
    return catalogos.tareasSap.filter((t) => ids.has(t.id) || t.id === form.tarea_id)
  }, [catalogos.tareasSap, labor, form.tarea_id])

  const implementosPermitidos = useMemo(() => {
    const ids = new Set(labor?.labores_implementos.map((i) => i.implemento_id) ?? [])
    return catalogos.implementos.filter((i) => ids.has(i.id) || i.id === form.implemento_id)
  }, [catalogos.implementos, labor, form.implemento_id])

  const fisicosPermitidos = useMemo(() => {
    const ids = new Set(
      catalogos.vinculosFisicos
        .filter((v) => v.labor_id === form.labor_id)
        .map((v) => v.implemento_fisico_id)
    )
    return catalogos.implementosFisicos.filter(
      (i) => ids.has(i.id) || i.id === form.implemento_fisico_id
    )
  }, [
    catalogos.vinculosFisicos,
    catalogos.implementosFisicos,
    form.labor_id,
    form.implemento_fisico_id,
  ])

  // Los lotes se limitan a la temporada de la línea: cambiar de lote aquí
  // es corregir una captura, no mover la línea de temporada (para eso
  // está el cambio de temporada de la tabla, que reapunta el lote).
  const lotesOpciones: OpcionBuscable[] = useMemo(() => {
    const temporada = fila.temporada_id ?? null
    return catalogos.lotes
      .filter((l) => (temporada ? l.temporada_id === temporada : true))
      .map((l) => ({
        id: l.lote_temporada_id,
        titulo: l.nomenclatura,
        subtitulo: l.nombre ?? l.temporada_nombre,
      }))
  }, [catalogos.lotes, fila.temporada_id])

  // Se listan los del tipo que toca, más el que ya trae la línea aunque
  // sea de otro tipo: si no, una captura vieja perdería su proveedor al
  // guardar sin que nadie lo hubiera tocado.
  const proveedoresPlastico = catalogos.proveedores.filter(
    (p) => p.tipo === 'PLASTICO' || p.id === form.proveedor_plastico_id
  )
  const proveedoresManguera = catalogos.proveedores.filter(
    (p) => p.tipo === 'MANGUERA' || p.id === form.proveedor_manguera_id
  )

  function set<K extends keyof Form>(campo: K, valor: Form[K]) {
    setForm((f) => ({ ...f, [campo]: valor }))
  }

  // Cambiar la labor puede dejar la tarea o el implemento fuera de lo
  // permitido; se ajustan en el mismo paso para no guardar una
  // combinación que la captura nunca habría dejado armar.
  function cambiarLabor(id: string) {
    const nueva = catalogos.labores.find((l) => l.id === id)
    const tareasOk = new Set(nueva?.labores_tareas.map((t) => t.tarea_id) ?? [])
    const implOk = new Set(nueva?.labores_implementos.map((i) => i.implemento_id) ?? [])
    const fisicosOk = new Set(
      catalogos.vinculosFisicos.filter((v) => v.labor_id === id).map((v) => v.implemento_fisico_id)
    )
    // Los campos que la labor nueva ya no pide se vacían aquí y no al
    // guardar: si se dejaran con su valor viejo, el formulario mostraría
    // una cosa —el campo desaparece— y la base guardaría otra.
    const nuevaPideEtapa =
      nueva === undefined || nueva.seguimiento_emplasticado === undefined
        ? true
        : Boolean(nueva.seguimiento_emplasticado)
    const nuevaSinBanderas = nueva !== undefined && nueva.usa_proveedor_plastico === undefined

    setForm((f) => ({
      ...f,
      labor_id: id,
      tarea_id: tareasOk.has(f.tarea_id) ? f.tarea_id : ([...tareasOk][0] ?? f.tarea_id),
      implemento_id: implOk.has(f.implemento_id) ? f.implemento_id : '',
      implemento_fisico_id: fisicosOk.has(f.implemento_fisico_id) ? f.implemento_fisico_id : '',
      etapa: nuevaPideEtapa ? f.etapa : '',
      proveedor_plastico_id:
        nuevaSinBanderas || nueva?.usa_proveedor_plastico ? f.proveedor_plastico_id : '',
      proveedor_manguera_id:
        nuevaSinBanderas || nueva?.usa_proveedor_manguera ? f.proveedor_manguera_id : '',
    }))
  }

  async function guardar() {
    if (!form.lote_temporada_id) return setError('Elige el lote de la línea.')
    if (!form.tarea_id) return setError('La labor necesita una tarea SAP.')
    if (
      hayColumnas22 &&
      numero(form.horometro_final) !== null &&
      numero(form.horometro_inicial) !== null &&
      Number(form.horometro_final) < Number(form.horometro_inicial)
    ) {
      return setError('El horómetro final no puede ser menor que el inicial.')
    }

    const original = aForm(fila)
    const cambio = (k: keyof Form) => form[k] !== original[k]

    // Cada grupo se manda sólo si de verdad cambió: así editar las
    // manzanas de una línea no reescribe el horómetro de toda la pasada.
    const deHorometro: Record<string, unknown> = {}
    if (hayColumnas22) {
      if (cambio('equipo_id') && form.equipo_id) deHorometro.equipo_id = form.equipo_id
      if (cambio('operador_id')) deHorometro.operador_id = form.operador_id || null
      if (cambio('turno')) deHorometro.turno = form.turno
      if (cambio('horometro_inicial'))
        deHorometro.horometro_inicial = numero(form.horometro_inicial)
      if (cambio('horometro_final')) deHorometro.horometro_final = numero(form.horometro_final)
      if (cambio('horas_hombre')) deHorometro.horas_hombre = numero(form.horas_hombre)
    }

    const deRegistro: Record<string, unknown> = {}
    if (cambio('labor_id')) deRegistro.labor_id = form.labor_id
    if (cambio('tarea_id')) deRegistro.tarea_id = form.tarea_id
    if (cambio('implemento_id')) deRegistro.implemento_id = form.implemento_id || null
    if (hayImplementoFisico && cambio('implemento_fisico_id'))
      deRegistro.implemento_fisico_id = form.implemento_fisico_id || null
    if (cambio('horas_notificadas')) deRegistro.horas_notificadas = numero(form.horas_notificadas)
    if (cambio('comentarios')) deRegistro.comentarios = form.comentarios || null

    const deDetalle: Record<string, unknown> = {}
    if (cambio('lote_temporada_id')) deDetalle.lote_temporada_id = form.lote_temporada_id
    if (cambio('fecha')) deDetalle.fecha = form.fecha
    if (cambio('ciclo')) deDetalle.ciclo = Number(form.ciclo)
    if (cambio('avance_mz')) deDetalle.avance_mz = numero(form.avance_mz)
    if (hayColumnas22) {
      if (cambio('etapa')) deDetalle.etapa = pideEtapa ? numero(form.etapa) : null
      if (cambio('con_moto'))
        deDetalle.con_moto = form.con_moto === '' ? null : form.con_moto === 'si'
      if (cambio('proveedor_plastico_id'))
        deDetalle.proveedor_plastico_id = form.proveedor_plastico_id || null
      if (cambio('proveedor_manguera_id'))
        deDetalle.proveedor_manguera_id = form.proveedor_manguera_id || null
      if (cambio('detalle_comentarios'))
        deDetalle.comentarios = form.detalle_comentarios || null
    }

    const tocaOtrasLineas = Object.keys(deRegistro).length > 0 && fila.lotes_del_registro > 1
    const tocaOtrosRegistros =
      Object.keys(deHorometro).length > 0 && (fila.registros_del_horometro ?? 1) > 1
    if (
      (tocaOtrasLineas || tocaOtrosRegistros) &&
      !confirm(
        [
          tocaOtrasLineas
            ? `La labor, la tarea, el implemento y las horas notificadas son del registro, que cubre ${fila.lotes_del_registro} lotes.`
            : '',
          tocaOtrosRegistros
            ? `El equipo, el operador, el turno y las lecturas son del horómetro, que tiene ${fila.registros_del_horometro} labores.`
            : '',
          'El cambio se aplica a todas. ¿Continuar?',
        ]
          .filter(Boolean)
          .join('\n\n')
      )
    ) {
      return
    }

    setGuardando(true)
    setError(null)
    try {
      if (Object.keys(deHorometro).length > 0) {
        const { error: e } = await supabase
          .from('horometros')
          .update(deHorometro)
          .eq('id', fila.horometro_id)
        if (e) throw e
      }
      if (Object.keys(deRegistro).length > 0) {
        const { error: e } = await supabase
          .from('registros')
          .update(deRegistro)
          .eq('id', fila.registro_id)
        if (e) throw e
      }
      if (Object.keys(deDetalle).length > 0) {
        const { error: e } = await supabase
          .from('registro_detalle')
          .update(deDetalle)
          .eq('id', fila.detalle_id)
        if (e) throw e
      }
      await onGuardado()
      setGuardando(false)
      onCerrar()
    } catch (e) {
      setGuardando(false)
      setError(mensajeDeError(e, 'No se pudo guardar. Revisa los campos y vuelve a intentar.'))
    }
  }

  const horasCalculadas =
    numero(form.horometro_final) !== null && numero(form.horometro_inicial) !== null
      ? Number(form.horometro_final) - Number(form.horometro_inicial)
      : fila.horas_maquina

  return (
    <Modal
      abierto
      onCerrar={onCerrar}
      titulo={`Editar ${fila.ut}${fila.lote_nombre ? ` · ${fila.lote_nombre}` : ''}`}
      pie={
        <div className="flex items-center justify-between gap-3">
          <span className="truncate text-xs text-slate-400">
            Ticket {fila.ticket_codigo} · {fila.equipo_codigo}
          </span>
          <div className="flex gap-2">
            <Boton variante="secundario" onClick={onCerrar} disabled={guardando}>
              Cancelar
            </Boton>
            <Boton onClick={guardar} disabled={guardando}>
              {guardando ? 'Guardando…' : 'Guardar cambios'}
            </Boton>
          </div>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        {error && <Alerta>{error}</Alerta>}

        {!hayColumnas22 && (
          <Alerta tono="ambar">
            Sólo se pueden editar la labor, la tarea, el lote y las manzanas. Para el operador, el
            turno, las lecturas del horómetro, la etapa y los proveedores falta correr la migración
            22 en el SQL Editor de Supabase.
          </Alerta>
        )}

        {/* ------------------------- LA LÍNEA --------------------------- */}
        <Grupo
          titulo="Esta línea"
          ayuda="El lote y lo que se hizo en él. Sólo afecta a esta fila."
        >
          <Campo etiqueta="Lote" className="sm:col-span-2">
            <SelectorBuscable
              valor={form.lote_temporada_id}
              opciones={lotesOpciones}
              onCambiar={(id) => set('lote_temporada_id', id)}
              permitirVacio={false}
              placeholder="Elige el lote…"
            />
          </Campo>

          <Campo etiqueta="Fecha">
            <Entrada type="date" value={form.fecha} onChange={(e) => set('fecha', e.target.value)} />
          </Campo>

          <Campo etiqueta="Manzanas" ayuda="En blanco si la labor no mide avance.">
            <Entrada
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={form.avance_mz}
              onChange={(e) => set('avance_mz', e.target.value)}
            />
          </Campo>

          <Campo etiqueta="Ciclo">
            <Selector value={form.ciclo} onChange={(e) => set('ciclo', e.target.value)}>
              {CICLOS.map((c) => (
                <option key={c} value={c}>
                  Ciclo {c}
                </option>
              ))}
            </Selector>
          </Campo>

          {hayColumnas22 && pideEtapa && (
            <Campo etiqueta="Etapa del plan">
              <Selector value={form.etapa} onChange={(e) => set('etapa', e.target.value)}>
                <option value="">Sin etapa</option>
                {ETAPAS.map((e) => (
                  <option key={e} value={e}>
                    Etapa {e}
                  </option>
                ))}
              </Selector>
            </Campo>
          )}

          {hayColumnas22 && (
            <Campo etiqueta="Uso de moto">
              <Selector value={form.con_moto} onChange={(e) => set('con_moto', e.target.value)}>
                <option value="">No especificado</option>
                <option value="si">Con moto</option>
                <option value="no">Sin moto</option>
              </Selector>
            </Campo>
          )}

          {hayColumnas22 && pidePlastico && (
            <Campo etiqueta="Proveedor de plástico">
              <Selector
                value={form.proveedor_plastico_id}
                onChange={(e) => set('proveedor_plastico_id', e.target.value)}
              >
                <option value="">Sin proveedor</option>
                {proveedoresPlastico.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </Selector>
            </Campo>
          )}

          {hayColumnas22 && pideManguera && (
            <Campo etiqueta="Proveedor de manguera">
              <Selector
                value={form.proveedor_manguera_id}
                onChange={(e) => set('proveedor_manguera_id', e.target.value)}
              >
                <option value="">Sin proveedor</option>
                {proveedoresManguera.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nombre}
                  </option>
                ))}
              </Selector>
            </Campo>
          )}

          {hayColumnas22 && (
            <Campo etiqueta="Comentario de la línea" className="sm:col-span-2">
              <AreaTexto
                rows={2}
                value={form.detalle_comentarios}
                onChange={(e) => set('detalle_comentarios', e.target.value)}
              />
            </Campo>
          )}
        </Grupo>

        {/* ------------------------ EL REGISTRO -------------------------- */}
        <Grupo
          titulo="La labor"
          ayuda={
            fila.lotes_del_registro > 1
              ? `Se comparte con los ${fila.lotes_del_registro} lotes de este registro.`
              : 'La labor de esta línea y cómo se notifica a SAP.'
          }
        >
          <Campo etiqueta="Labor">
            <Selector value={form.labor_id} onChange={(e) => cambiarLabor(e.target.value)}>
              {catalogos.labores.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.nombre}
                </option>
              ))}
            </Selector>
          </Campo>

          <Campo etiqueta="Tarea SAP">
            <Selector value={form.tarea_id} onChange={(e) => set('tarea_id', e.target.value)}>
              {tareasPermitidas.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.codigo} · {t.nombre}
                </option>
              ))}
            </Selector>
          </Campo>

          <Campo etiqueta="Implemento (tarifa)">
            <Selector
              value={form.implemento_id}
              onChange={(e) => set('implemento_id', e.target.value)}
            >
              <option value="">Sin implemento</option>
              {implementosPermitidos.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.codigo} · {i.nombre}
                </option>
              ))}
            </Selector>
          </Campo>

          {hayImplementoFisico && (
            <Campo
              etiqueta="Código de implemento"
              ayuda="El equipo exacto que se usó, p. ej. ROMSR-01."
            >
              <Selector
                value={form.implemento_fisico_id}
                onChange={(e) => set('implemento_fisico_id', e.target.value)}
              >
                <option value="">Sin código</option>
                {fisicosPermitidos.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.codigo} · {i.descripcion}
                  </option>
                ))}
              </Selector>
            </Campo>
          )}

          <Campo
            etiqueta="Horas notificadas"
            ayuda={`En blanco usa las ${horasCalculadas} h del horómetro.`}
          >
            <Entrada
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={form.horas_notificadas}
              onChange={(e) => set('horas_notificadas', e.target.value)}
            />
          </Campo>

          <Campo etiqueta="Comentario del registro" className="sm:col-span-2">
            <AreaTexto
              rows={2}
              value={form.comentarios}
              onChange={(e) => set('comentarios', e.target.value)}
            />
          </Campo>
        </Grupo>

        {/* ------------------------ EL HORÓMETRO ------------------------- */}
        {hayColumnas22 && (
          <Grupo
            titulo="El horómetro"
            ayuda={
              (fila.registros_del_horometro ?? 1) > 1
                ? `Es la pasada completa de la máquina: se comparte con las ${fila.registros_del_horometro} labores del horómetro.`
                : 'La pasada de la máquina: equipo, operador y lecturas.'
            }
          >
            <Campo etiqueta="Equipo">
              <Selector value={form.equipo_id} onChange={(e) => set('equipo_id', e.target.value)}>
                {catalogos.equipos.map((eq) => (
                  <option key={eq.id} value={eq.id}>
                    {eq.codigo}
                    {eq.nombre ? ` · ${eq.nombre}` : ''}
                  </option>
                ))}
              </Selector>
            </Campo>

            <Campo etiqueta="Operador">
              <Selector
                value={form.operador_id}
                onChange={(e) => set('operador_id', e.target.value)}
              >
                <option value="">Sin operador</option>
                {catalogos.operadores.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.codigo} · {o.nombre}
                  </option>
                ))}
              </Selector>
            </Campo>

            <Campo etiqueta="Turno">
              <Selector
                value={form.turno}
                onChange={(e) => set('turno', e.target.value as TurnoTipo)}
              >
                <option value="DIURNO">Diurno</option>
                <option value="NOCTURNO">Nocturno</option>
              </Selector>
            </Campo>

            <Campo etiqueta="Horas hombre">
              <Entrada
                type="number"
                inputMode="decimal"
                step="0.01"
                min="0"
                value={form.horas_hombre}
                onChange={(e) => set('horas_hombre', e.target.value)}
              />
            </Campo>

            <Campo etiqueta="Horómetro inicial">
              <Entrada
                type="number"
                inputMode="decimal"
                step="0.01"
                value={form.horometro_inicial}
                onChange={(e) => set('horometro_inicial', e.target.value)}
              />
            </Campo>

            <Campo
              etiqueta="Horómetro final"
              ayuda={`Horas máquina: ${Number(horasCalculadas).toFixed(2)}`}
            >
              <Entrada
                type="number"
                inputMode="decimal"
                step="0.01"
                value={form.horometro_final}
                onChange={(e) => set('horometro_final', e.target.value)}
              />
            </Campo>
          </Grupo>
        )}
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ */

/**
 * Un bloque del formulario. Los campos van en una rejilla de dos columnas
 * desde `sm`; en celular quedan uno debajo de otro, que es como se usa
 * esta pantalla en el campo.
 */
function Grupo({
  titulo,
  ayuda,
  children,
}: {
  titulo: string
  ayuda: string
  children: React.ReactNode
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="border-b border-slate-100 pb-1.5">
        <h3 className="text-sm font-bold text-slate-900">{titulo}</h3>
        <p className="text-xs text-slate-400">{ayuda}</p>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </section>
  )
}
