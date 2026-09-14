'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  Alerta,
  AreaTexto,
  Boton,
  Campo,
  Entrada,
  Selector,
  Tarjeta,
} from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { IconCheck, IconPlus, IconSearch, IconX } from '@/components/ui/Icons'
import { Modal } from '@/components/ui/Modal'
import { CICLOS } from '@/lib/estados'
import type { Implemento, TareaSap } from '@/lib/types'
import type { ImplementoFisico, Proveedor } from '@/lib/datosRegistro'
import { mensajeDeError } from '@/lib/errores'
import { ajustarHorasDelHorometro } from '@/lib/prorrateo/servicioProrrateo'
import { fisicosDeLabor, textoImplementoDeducido } from '@/lib/implementos/derivacion'

type LaborConReglas = {
  id: string
  nombre: string
  /**
   * Opcionales a propósito: si la migración 15 todavía no está corrida,
   * las columnas no vienen y llegan como `undefined`. Ver `pidePlastico`
   * más abajo, que distingue «la labor dice que no» de «la base todavía
   * no sabe de esto».
   */
  usa_proveedor_plastico?: boolean | null
  usa_proveedor_manguera?: boolean | null
  /** Llega con la migración 21: sólo el emplasticado lleva etapa. */
  seguimiento_emplasticado?: boolean | null
  labores_tareas: { tarea_id: string }[]
}

type LoteOpcion = {
  lote_temporada_id: string
  temporada_id: string
  temporada_nombre: string
  nomenclatura: string
  nombre: string | null
  area_neta: number
  ciclo: number
}

type TemporadaOpcion = { id: string; nombre: string; activa: boolean }

/**
 * Una línea de captura dentro de un lote.
 *
 * Es una LISTA por lote, no un solo valor: «hay veces que en un mismo lote
 * usan 2 o tres proveedores, entonces querré saber qué área es la que hizo
 * por proveedor». Cada línea se guarda como su propia fila de
 * `registro_detalle`, con su área y su proveedor.
 */
type Captura = { mz: string; ciclo: string; plastico: string; manguera: string }

function capturaVacia(ciclo: string): Captura {
  return { mz: '', ciclo, plastico: '', manguera: '' }
}

/** Etapa del plan de mecanización a la que se imputa el trabajo. */
const ETAPAS = [1, 2, 3] as const

export type RegistroBase = {
  id: string
  labor_id: string
  tarea_id: string
  implemento_id: string | null
  implemento_fisico_id?: string | null
  comentarios: string | null
  horas_notificadas: number | null
  etapa: number | null
  detalle: {
    lote_temporada_id: string
    avance_mz: number | null
    ciclo: number | null
    proveedor_plastico_id: string | null
    proveedor_manguera_id: string | null
  }[]
}

type Props = {
  ticketId: string
  horometroId: string
  temporadaId: string | null
  fecha: string
  labores: LaborConReglas[]
  tareasSap: TareaSap[]
  implementos: Implemento[]
  lotes: LoteOpcion[]
  temporadas: TemporadaOpcion[]
  proveedores: Proveedor[]
  /** Catálogo de máquinas concretas: ROMSR-01, ROMSR-08… */
  implementosFisicos?: ImplementoFisico[]
  /** Qué códigos físicos aplican a cada labor. */
  vinculosFisicos?: { labor_id: string; implemento_fisico_id: string }[]
  /** Horas que dio el horometro completo (final - inicial). */
  horasMaquina: number
  /** Horas ya repartidas en las OTRAS labores de este mismo horometro. */
  horasRepartidas: number
  registroBase?: RegistroBase
}

export function RegistroForm({
  ticketId,
  horometroId,
  temporadaId,
  fecha,
  labores,
  tareasSap,
  implementos,
  lotes,
  temporadas,
  proveedores,
  implementosFisicos = [],
  vinculosFisicos = [],
  horasMaquina,
  horasRepartidas,
  registroBase,
}: Props) {
  const supabase = createClient()
  const router = useRouter()
  const esEdicion = Boolean(registroBase)

  const [guardando, setGuardando] = useState<'normal' | 'otra' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  const [laborId, setLaborId] = useState(registroBase?.labor_id ?? '')
  const [tareaId, setTareaId] = useState(registroBase?.tarea_id ?? '')
  // Ya no hay estado para el implemento: se deduce del código físico.
  const [implementoFisicoId, setImplementoFisicoId] = useState(
    registroBase?.implemento_fisico_id ?? ''
  )
  const [comentarios, setComentarios] = useState(registroBase?.comentarios ?? '')
  // Horas imputadas a ESTA labor. Al dar de alta se propone el saldo que
  // queda del horometro, que es lo correcto cuando la maquina hizo una sola
  // labor y tambien el valor de partida cuando hizo varias.
  const [horas, setHoras] = useState(
    registroBase?.horas_notificadas !== null && registroBase?.horas_notificadas !== undefined
      ? String(registroBase.horas_notificadas)
      : String(Math.max(0, Math.round((horasMaquina - horasRepartidas) * 100) / 100))
  )
  const [abrirLotes, setAbrirLotes] = useState(false)
  // Temporada por la que se filtra la lista de lotes. No amarra la labor:
  // si el equipo trabajó en lotes de dos temporadas, se cambia el filtro y
  // se agregan los de la otra. La temporada del registro la deduce la base
  // a partir de los lotes que queden.
  const [temporadaFiltro, setTemporadaFiltro] = useState(temporadaId ?? '')
  // Datos del plan. Todos opcionales: si se dejan vacíos, el avance se
  // imputa a la etapa en que el lote está planificado y el reporte sale
  // igual. Están aquí y no por lote porque una labor de un día usa el
  // mismo rollo de plástico en todos los lotes que tocó.
  const [etapa, setEtapa] = useState(
    registroBase?.etapa !== null && registroBase?.etapa !== undefined
      ? String(registroBase.etapa)
      : ''
  )
  // Al editar, las filas del detalle se reagrupan por lote: un lote con dos
  // proveedores vuelve a la pantalla como dos líneas.
  const [seleccion, setSeleccion] = useState<Record<string, Captura[]>>(() => {
    const mapa: Record<string, Captura[]> = {}
    for (const d of registroBase?.detalle ?? []) {
      const lista = mapa[d.lote_temporada_id] ?? []
      lista.push({
        mz: d.avance_mz?.toString() ?? '',
        ciclo: String(d.ciclo ?? 1),
        plastico: d.proveedor_plastico_id ?? '',
        manguera: d.proveedor_manguera_id ?? '',
      })
      mapa[d.lote_temporada_id] = lista
    }
    return mapa
  })

  const laborActual = labores.find((l) => l.id === laborId)

  const plasticos = useMemo(() => proveedores.filter((p) => p.tipo === 'PLASTICO'), [proveedores])
  const mangueras = useMemo(() => proveedores.filter((p) => p.tipo === 'MANGUERA'), [proveedores])

  const tareasPermitidas = useMemo(() => {
    if (!laborActual) return []
    const ids = new Set(laborActual.labores_tareas.map((t) => t.tarea_id))
    return tareasSap.filter((t) => ids.has(t.id))
  }, [laborActual, tareasSap])

  // Códigos físicos vinculados a ESTA labor. Se filtra por labor a
  // propósito: una lista de 94 fierros haría que el digitador eligiera
  // el equivocado, y de eso se trata tener la vinculación.
  const fisicosPermitidos = useMemo(
    () => fisicosDeLabor(implementosFisicos, vinculosFisicos, laborActual?.id),
    [laborActual, vinculosFisicos, implementosFisicos]
  )

  // «Al hacerlo, el sistema debe autocompletar silenciosamente el
  //  Implemento Usado.» Se enseña, no se edita: el dato que manda es el
  //  código físico y el tipo va detrás.
  const implementoDeducido = useMemo(
    () => textoImplementoDeducido(implementos, implementosFisicos, implementoFisicoId),
    [implementos, implementosFisicos, implementoFisicoId]
  )

  // Se ordenan por nomenclatura para que la lista no salte de posición
  // cada vez que se agrega uno.
  const ordenSeleccion = useMemo(
    () =>
      Object.keys(seleccion).sort((a, b) => {
        const na = lotes.find((l) => l.lote_temporada_id === a)?.nomenclatura ?? ''
        const nb = lotes.find((l) => l.lote_temporada_id === b)?.nomenclatura ?? ''
        return na.localeCompare(nb)
      }),
    [seleccion, lotes]
  )

  const seleccionados = ordenSeleccion.length
  const totalMz = Object.values(seleccion)
    .flat()
    .reduce((acc, v) => acc + (Number(v.mz) || 0), 0)
  const totalLineas = Object.values(seleccion).reduce((acc, v) => acc + v.length, 0)

  // Qué proveedores pide ESTA labor.
  //
  // «Añadir opción/checkbox para habilitar proveedores de plástico y
  //  manguera de forma individual por labor.»
  //
  // Antes bastaba con que el catálogo de proveedores tuviera a alguien y
  // los dos selectores salían en toda labor, arado incluido. Ahora lo
  // decide la labor. Si las columnas no vienen —migración 15 sin
  // correr— se mantiene el comportamiento de antes en vez de esconder
  // los selectores y dejarlo sin poder capturar el emplasticado.
  const sinMigracion = laborActual !== undefined && laborActual.usa_proveedor_plastico === undefined
  const pidePlastico =
    plasticos.length > 0 &&
    (sinMigracion ? true : Boolean(laborActual?.usa_proveedor_plastico))
  const pideManguera =
    mangueras.length > 0 &&
    (sinMigracion ? true : Boolean(laborActual?.usa_proveedor_manguera))
  const hayProveedores = pidePlastico || pideManguera

  // «El seguimiento de planes y etapas aplica única y exclusivamente
  //  para la labor de Emplasticado.»
  //
  // La etapa sólo tiene sentido ahí; en el arado era un campo más que
  // estorbaba. Mientras la migración 21 no esté corrida la columna no
  // viene y se sigue mostrando, para no esconder un dato que hoy sí se
  // está capturando.
  const pideEtapa =
    laborActual !== undefined &&
    (laborActual.seguimiento_emplasticado === undefined
      ? true
      : Boolean(laborActual.seguimiento_emplasticado))

  function cambiarLinea(loteId: string, indice: number, cambios: Partial<Captura>) {
    setSeleccion((prev) => ({
      ...prev,
      [loteId]: prev[loteId].map((c, i) => (i === indice ? { ...c, ...cambios } : c)),
    }))
  }

  function agregarLinea(loteId: string) {
    setSeleccion((prev) => {
      const actuales = prev[loteId]
      const ultima = actuales[actuales.length - 1]
      // La línea nueva hereda el ciclo pero no el proveedor: justamente se
      // está agregando porque el proveedor cambia.
      return { ...prev, [loteId]: [...actuales, capturaVacia(ultima?.ciclo ?? '1')] }
    })
  }

  function quitarLinea(loteId: string, indice: number) {
    setSeleccion((prev) => {
      const restantes = prev[loteId].filter((_, i) => i !== indice)
      if (restantes.length === 0) {
        const copia = { ...prev }
        delete copia[loteId]
        return copia
      }
      return { ...prev, [loteId]: restantes }
    })
  }

  function quitarLote(id: string) {
    setSeleccion((prev) => {
      const copia = { ...prev }
      delete copia[id]
      return copia
    })
  }

  const horasNum = horas.trim() === '' ? null : Number(horas.replace(',', '.'))
  const saldo = Math.round((horasMaquina - horasRepartidas - (horasNum ?? 0)) * 100) / 100
  // Techo real de esta labor. La base lo valida igual con un disparador,
  // pero avisarlo aquí evita que el usuario pierda lo que escribió.
  const horasDisponibles = Math.round((horasMaquina - horasRepartidas) * 100) / 100

  function validar() {
    if (!laborId) return 'Selecciona la labor.'
    if (!tareaId) return 'Selecciona la tarea SAP.'
    if (seleccionados === 0) return 'Agrega al menos una ubicación técnica.'
    if (horasNum !== null && (!Number.isFinite(horasNum) || horasNum < 0))
      return 'Las horas de la labor no son un número válido.'

    // El horómetro dio X horas y las labores no pueden sumar más. Un error
    // de dedo aquí (2008 h en un horómetro de 6) multiplica el costo de la
    // temporada completa.
    if (horasMaquina > 0 && horasNum !== null && horasNum > horasDisponibles) {
      return horasRepartidas > 0
        ? `El horómetro dio ${horasMaquina} h y las otras labores ya llevan ${horasRepartidas} h, así que a esta le quedan ${horasDisponibles} h como máximo.`
        : `El horómetro dio ${horasMaquina} h, así que esta labor no puede llevar más de ${horasDisponibles} h.`
    }

    // Si un lote se partió en varias líneas es porque cada una lleva su
    // proveedor; sin área, la repartición no significa nada.
    for (const [loteId, lineas] of Object.entries(seleccion)) {
      if (lineas.length > 1 && lineas.some((l) => !l.mz.trim())) {
        const lote = lotes.find((l) => l.lote_temporada_id === loteId)
        return `En ${lote?.nomenclatura ?? 'un lote'} hay una línea sin manzanas. Escribe el área de cada proveedor o quita la línea.`
      }
    }
    return null
  }

  async function guardar(modo: 'normal' | 'otra') {
    const problema = validar()
    if (problema) return setError(problema)

    setError(null)
    setAviso(null)
    setGuardando(modo)

    // Una fila de detalle por LÍNEA, no por lote: así un lote con dos
    // proveedores queda como dos filas, cada una con su área.
    const detalleFilas = (registroId: string) =>
      Object.entries(seleccion).flatMap(([lote_temporada_id, lineas]) =>
        lineas.map((captura) => ({
          registro_id: registroId,
          lote_temporada_id,
          avance_mz: captura.mz ? Number(captura.mz) : null,
          ciclo: Number(captura.ciclo) || 1,
          // Sin seguimiento de emplasticado la etapa no significa nada,
          // y guardarla dejaría avance imputado a una etapa inventada.
          etapa: pideEtapa && etapa ? Number(etapa) : null,
          // Si la labor no pide proveedor, no se guarda ninguno aunque
          // haya quedado escrito de una labor anterior en la pantalla.
          proveedor_plastico_id: pidePlastico ? captura.plastico || null : null,
          proveedor_manguera_id: pideManguera ? captura.manguera || null : null,
          fecha,
        }))
      )

    try {
      /* ---------------------------- Edición ---------------------------- */
      if (registroBase) {
        const { error: e1 } = await supabase
          .from('registros')
          .update({
            labor_id: laborId,
            tarea_id: tareaId,
            // El implemento se manda VACÍO a propósito: el disparador de
            // la base lo rellena desde el código físico. Es la misma
            // regla para el formulario, la edición en línea y la
            // importación del histórico, escrita una sola vez.
            implemento_id: null,
            implemento_fisico_id: implementoFisicoId || null,
            comentarios: comentarios || null,
            horas_notificadas: horasNum,
          })
          .eq('id', registroBase.id)
        if (e1) throw e1

        // El detalle se reemplaza completo: son pocas filas y así se evita
        // arrastrar lotes que el usuario ya desmarcó.
        const { error: e2 } = await supabase
          .from('registro_detalle')
          .delete()
          .eq('registro_id', registroBase.id)
        if (e2) throw e2

        const { error: e3 } = await supabase
          .from('registro_detalle')
          .insert(detalleFilas(registroBase.id))
        if (e3) throw e3

        // El reparto se recalcula DESPUÉS de guardar, con el horómetro ya
        // completo: si esta labor cambió de manzanas, las horas de todas
        // las demás cambian con ella.
        await ajustarHorasDelHorometro(horometroId)

        setGuardando(null)
        router.push(`/tickets/${ticketId}/horometros/${horometroId}`)
        router.refresh()
        return
      }

      /* ------------------------------ Alta ----------------------------- */
      const { data: registro, error: e1 } = await supabase
        .from('registros')
        .insert({
          ticket_id: ticketId,
          horometro_id: horometroId,
          temporada_id: temporadaFiltro || temporadaId,
          fecha,
          labor_id: laborId,
          tarea_id: tareaId,
          implemento_id: null,
          implemento_fisico_id: implementoFisicoId || null,
          comentarios: comentarios || null,
          horas_notificadas: horasNum,
        })
        .select('id')
        .single()
      if (e1 || !registro) throw e1 ?? new Error('No se pudo crear el registro.')

      const { error: e2 } = await supabase.from('registro_detalle').insert(detalleFilas(registro.id))
      if (e2) throw e2

      // Con la labor nueva dentro, se vuelve a cuadrar el horómetro.
      const ajuste = await ajustarHorasDelHorometro(horometroId)

      setGuardando(null)

      if (modo === 'otra') {
        // Se limpia sólo la labor: los lotes se conservan porque lo normal
        // es que el mismo equipo haya hecho varias labores en los mismos
        // lotes durante la jornada. Ahorra volver a marcarlos.
        const nombreGuardado = laborActual?.nombre ?? 'La labor'
        setLaborId('')
        setTareaId('')
        setImplementoFisicoId('')
        setComentarios('')
        // Las horas se reponen con lo que quedo del horometro, para que la
        // siguiente labor arranque con el saldo y no vuelva a cobrar el dia
        // completo.
        setHoras(String(Math.max(0, saldo)))
        // La etapa y los proveedores NO se limpian: es el mismo día, el
        // mismo equipo y casi siempre el mismo rollo de plástico.
        setAviso(
          [
            `${nombreGuardado} quedó guardada.`,
            // Cuando el reparto tocó las horas se dice: cambiarle los
            // números al usuario en silencio es la forma segura de que
            // desconfíe del sistema.
            ajuste.ajustado
              ? ajuste.mensaje
              : saldo > 0
                ? `Quedan ${saldo} h del horómetro por repartir.`
                : null,
            'Los lotes siguen marcados para la siguiente.',
          ]
            .filter(Boolean)
            .join(' ')
        )
        window.scrollTo({ top: 0, behavior: 'smooth' })
        router.refresh()
        return
      }

      router.push(`/tickets/${ticketId}/horometros/${horometroId}`)
      router.refresh()
    } catch (e) {
      setGuardando(null)
      setError(mensajeDeError(e, 'No se pudo guardar.'))
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        guardar('normal')
      }}
      className="flex flex-col gap-4"
    >
      {aviso && <Alerta tono="azul">{aviso}</Alerta>}

      <Tarjeta className="flex flex-col gap-4 p-5">
        <Campo etiqueta="Labor" requerido>
          <SelectorBuscable
            valor={laborId}
            onCambiar={(id) => {
              setLaborId(id)
              setTareaId('')
              setImplementoFisicoId('')
            }}
            placeholder="Buscar labor…"
            etiquetaBusqueda="Escribe el nombre de la labor"
            permitirVacio={false}
            opciones={labores.map((l) => ({ id: l.id, titulo: l.nombre }))}
          />
        </Campo>

        <Campo etiqueta="Tarea SAP a liquidar" requerido>
          <SelectorBuscable
            valor={tareaId}
            onCambiar={setTareaId}
            disabled={!laborId}
            placeholder={laborId ? 'Selecciona una tarea…' : 'Primero elige la labor'}
            etiquetaBusqueda="Escribe el código o el nombre"
            permitirVacio={false}
            opciones={tareasPermitidas.map((t) => ({
              id: t.id,
              titulo: t.codigo,
              subtitulo: t.nombre,
            }))}
          />
        </Campo>

        {laborId && tareasPermitidas.length === 0 && (
          <Alerta tono="ambar">
            Esta labor no tiene tareas SAP configuradas. Vincúlalas en Catálogos → Labores antes de
            registrarla.
          </Alerta>
        )}

        {/* Primero el fierro. El operador dice «salió el ROMSR-01», no
            «salió un Romplow»: se pide lo que la gente sabe y el tipo
            SAP —que es de donde sale la tarifa— se deduce solo. */}
        <Campo
          etiqueta="Código físico del implemento"
          ayuda="La máquina exacta que salió a trabajar. Al elegirla se completa solo el implemento."
        >
          <SelectorBuscable
            valor={implementoFisicoId}
            onCambiar={setImplementoFisicoId}
            disabled={!laborId}
            placeholder={laborId ? 'Buscar código…' : 'Primero elige la labor'}
            etiquetaBusqueda="Escribe el código o la descripción"
            textoVacio="Sin implemento / no aplica"
            opciones={fisicosPermitidos.map((i) => ({
              id: i.id,
              titulo: i.codigo,
              subtitulo: i.descripcion,
            }))}
          />
        </Campo>

        <Campo etiqueta="Implemento utilizado">
          <p
            className={`rounded-xl border px-3.5 py-3 text-base ${
              implementoDeducido.pendiente
                ? 'border-amber-200 bg-amber-50 text-amber-800'
                : 'border-slate-200 bg-slate-50 text-slate-600'
            }`}
          >
            {implementoDeducido.texto}
          </p>
        </Campo>

        {pideEtapa && (
          <Campo
            etiqueta="Etapa del plan"
            ayuda="Déjalo así y el avance se imputa a la etapa en que el lote está planificado."
          >
            <Selector value={etapa} onChange={(e) => setEtapa(e.target.value)}>
              <option value="">Según el plan</option>
              {ETAPAS.map((e) => (
                <option key={e} value={e}>
                  Etapa {e}
                </option>
              ))}
            </Selector>
          </Campo>
        )}

        {/* Horas de ESTA labor. Es la columna H_NOT del Excel de
            notificación: si un equipo de 8 horas hizo tres labores, cada una
            se lleva su parte. Sin esto el costo se cobraría tres veces. */}
        <Campo
          etiqueta="Horas de esta labor"
          requerido
          ayuda={
            horasMaquina > 0
              ? `El horómetro dio ${horasMaquina} h${
                  horasRepartidas > 0
                    ? `, ya repartidas ${horasRepartidas} h en otras labores. Máximo ${horasDisponibles} h`
                    : ''
                }.`
              : 'Este horómetro no tiene horas calculadas todavía, así que no hay tope que validar.'
          }
        >
          <div className="flex items-center gap-2">
            <Entrada
              inputMode="decimal"
              placeholder="0"
              value={horas}
              onChange={(e) => setHoras(e.target.value)}
              className="text-right font-semibold tabular-nums"
            />
            {horasMaquina > 0 && (
              <span
                className={`shrink-0 rounded-lg px-2.5 py-2 text-xs font-semibold ${
                  saldo < 0
                    ? 'bg-red-50 text-red-700'
                    : saldo === 0
                      ? 'bg-emerald-50 text-emerald-700'
                      : 'bg-amber-50 text-amber-700'
                }`}
              >
                {saldo < 0
                  ? `sobran ${Math.abs(saldo)} h`
                  : saldo === 0
                    ? 'cuadrado'
                    : `faltan ${saldo} h`}
              </span>
            )}
          </div>
        </Campo>
      </Tarjeta>

      {/* Ubicaciones técnicas: sólo se muestran las que el usuario agrega.
          Cargar los 90+ lotes de la temporada en pantalla hacía la lista
          interminable y obligaba a desplazarse para llegar al botón. */}
      <Tarjeta>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-slate-900">Ubicaciones técnicas</h2>
            <p className="text-xs text-slate-400">
              {seleccionados === 0
                ? 'Agrega los lotes donde trabajó el equipo.'
                : 'Captura el avance en manzanas de cada lote.'}
            </p>
          </div>
          {seleccionados > 0 && (
            <div className="text-right">
              <p className="text-sm font-bold text-brand-700">{seleccionados}</p>
              <p className="text-[11px] text-slate-400">
                {totalMz > 0 ? `${Math.round(totalMz * 100) / 100} mz` : 'lotes'}
                {totalLineas > seleccionados ? ` · ${totalLineas} líneas` : ''}
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-col divide-y divide-slate-100">
          {ordenSeleccion.map((id) => {
            const lote = lotes.find((l) => l.lote_temporada_id === id)
            if (!lote) return null
            const lineas = seleccion[id]
            const sumaLote = lineas.reduce((a, c) => a + (Number(c.mz) || 0), 0)

            return (
              <div key={id} className="px-3 py-2.5">
                {/* Cabecera del lote */}
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-800">
                      {lote.nomenclatura}
                    </p>
                    <p className="truncate text-xs text-slate-400">
                      {lote.nombre ? `${lote.nombre} · ` : ''}
                      {lote.area_neta} mz neta
                      {lineas.length > 1 ? ` · ${lineas.length} proveedores · ${sumaLote} mz` : ''}
                    </p>
                    {temporadas.length > 1 && lote.temporada_nombre && (
                      <p className="truncate text-[11px] font-semibold text-brand-700">
                        {lote.temporada_nombre}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => quitarLote(id)}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-400 transition-colors hover:border-red-200 hover:text-red-600"
                    aria-label={`Quitar ${lote.nomenclatura}`}
                  >
                    <IconX className="h-4 w-4" />
                  </button>
                </div>

                {/* Una línea por proveedor */}
                <div className="mt-1.5 flex flex-col gap-2">
                  {lineas.map((captura, i) => (
                    <div
                      key={i}
                      className={
                        lineas.length > 1
                          ? 'rounded-xl bg-slate-50 p-2 ring-1 ring-inset ring-slate-200/70'
                          : ''
                      }
                    >
                      <div className="flex items-end gap-2">
                        <label className="flex shrink-0 flex-col items-center gap-0.5">
                          <span className="text-[10px] font-semibold uppercase text-slate-400">
                            Ciclo
                          </span>
                          <select
                            value={captura.ciclo}
                            onChange={(e) => cambiarLinea(id, i, { ciclo: e.target.value })}
                            className="w-14 rounded-lg border border-slate-200 bg-white px-1 py-2 text-center text-sm font-semibold focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/10"
                          >
                            {CICLOS.map((c) => (
                              <option key={c} value={c}>
                                {c}
                              </option>
                            ))}
                          </select>
                        </label>

                        <label className="flex flex-1 flex-col gap-0.5">
                          <span className="text-[10px] font-semibold uppercase text-slate-400">
                            Manzanas
                          </span>
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="0"
                            value={captura.mz}
                            onChange={(e) => cambiarLinea(id, i, { mz: e.target.value })}
                            className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-right text-sm font-semibold focus:border-brand-600 focus:outline-none focus:ring-4 focus:ring-brand-600/10"
                          />
                        </label>

                        {lineas.length > 1 && (
                          <button
                            type="button"
                            onClick={() => quitarLinea(id, i)}
                            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-400 transition-colors hover:border-red-200 hover:text-red-600"
                            aria-label="Quitar esta línea"
                          >
                            <IconX className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>

                      {hayProveedores && (
                        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {pidePlastico && (
                            <label className="flex flex-col gap-0.5">
                              <span className="text-[10px] font-semibold uppercase text-slate-400">
                                Plástico
                              </span>
                              <select
                                value={captura.plastico}
                                onChange={(e) => cambiarLinea(id, i, { plastico: e.target.value })}
                                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm focus:border-brand-600 focus:outline-none"
                              >
                                <option value="">Sin proveedor</option>
                                {plasticos.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.nombre}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                          {pideManguera && (
                            <label className="flex flex-col gap-0.5">
                              <span className="text-[10px] font-semibold uppercase text-slate-400">
                                Manguera
                              </span>
                              <select
                                value={captura.manguera}
                                onChange={(e) => cambiarLinea(id, i, { manguera: e.target.value })}
                                className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-sm focus:border-brand-600 focus:outline-none"
                              >
                                <option value="">Sin proveedor</option>
                                {mangueras.map((p) => (
                                  <option key={p.id} value={p.id}>
                                    {p.nombre}
                                  </option>
                                ))}
                              </select>
                            </label>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                {hayProveedores && (
                  <button
                    type="button"
                    onClick={() => agregarLinea(id)}
                    className="mt-1.5 inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-brand-700 transition-colors hover:bg-brand-50"
                  >
                    <IconPlus className="h-3.5 w-3.5" />
                    Otro proveedor en este lote
                  </button>
                )}
              </div>
            )
          })}
        </div>

        <div className="p-3">
          <Boton
            type="button"
            variante="secundario"
            className="w-full"
            onClick={() => setAbrirLotes(true)}
          >
            <IconPlus className="h-4 w-4" />
            {seleccionados === 0 ? 'Agregar ubicaciones técnicas' : 'Agregar más lotes'}
          </Boton>
        </div>
      </Tarjeta>

      <SelectorLotes
        abierto={abrirLotes}
        onCerrar={() => setAbrirLotes(false)}
        lotes={lotes}
        temporadas={temporadas}
        temporadaFiltro={temporadaFiltro}
        onCambiarTemporada={setTemporadaFiltro}
        yaSeleccionados={seleccion}
        onConfirmar={(ids, cicloElegido) => {
          setSeleccion((prev) => {
            const copia = { ...prev }
            ids.forEach((id) => {
              if (!(id in copia)) {
                // Si no se eligió ciclo en el modal, se usa el que tiene
                // configurado el lote en la temporada.
                const porDefecto = lotes.find((l) => l.lote_temporada_id === id)?.ciclo ?? 1
                copia[id] = [capturaVacia(cicloElegido || String(porDefecto))]
              }
            })
            return copia
          })
          setAbrirLotes(false)
        }}
      />

      <Tarjeta className="p-5">
        <Campo etiqueta="Comentarios">
          <AreaTexto value={comentarios} onChange={(e) => setComentarios(e.target.value)} rows={2} />
        </Campo>
      </Tarjeta>

      {error && <Alerta>{error}</Alerta>}

      <div className="sticky bottom-20 z-10 flex flex-col gap-2 lg:bottom-4">
        {!esEdicion && (
          <Boton
            type="button"
            variante="secundario"
            tamano="lg"
            className="w-full"
            onClick={() => guardar('otra')}
            disabled={guardando !== null}
          >
            {guardando === 'otra' ? 'Guardando…' : 'Guardar y agregar otra labor'}
          </Boton>
        )}
        <Boton type="submit" tamano="lg" className="w-full" disabled={guardando !== null}>
          {guardando === 'normal'
            ? 'Guardando…'
            : esEdicion
              ? 'Guardar cambios'
              : 'Guardar y terminar'}
        </Boton>
      </div>
    </form>
  )
}

/* ------------------------------------------------------------------ */
/* Selector de lotes: se abre bajo demanda y sólo devuelve los         */
/* elegidos, en vez de tener los 90+ lotes siempre en pantalla.        */
/* ------------------------------------------------------------------ */

function SelectorLotes({
  abierto,
  onCerrar,
  lotes,
  temporadas,
  temporadaFiltro,
  onCambiarTemporada,
  yaSeleccionados,
  onConfirmar,
}: {
  abierto: boolean
  onCerrar: () => void
  lotes: LoteOpcion[]
  temporadas: TemporadaOpcion[]
  temporadaFiltro: string
  onCambiarTemporada: (id: string) => void
  yaSeleccionados: Record<string, Captura[]>
  onConfirmar: (ids: string[], ciclo: string) => void
}) {
  const [busqueda, setBusqueda] = useState('')
  const [ciclo, setCiclo] = useState('')
  const [marcados, setMarcados] = useState<Set<string>>(new Set())

  const filtrados = useMemo(() => {
    const q = busqueda.trim().toLowerCase()
    const disponibles = lotes.filter(
      (l) =>
        !(l.lote_temporada_id in yaSeleccionados) &&
        (!temporadaFiltro || l.temporada_id === temporadaFiltro)
    )
    if (!q) return disponibles
    return disponibles.filter(
      (l) => l.nomenclatura.toLowerCase().includes(q) || (l.nombre ?? '').toLowerCase().includes(q)
    )
  }, [lotes, busqueda, yaSeleccionados, temporadaFiltro])

  function alternar(id: string) {
    setMarcados((prev) => {
      const copia = new Set(prev)
      if (copia.has(id)) copia.delete(id)
      else copia.add(id)
      return copia
    })
  }

  function confirmar() {
    onConfirmar([...marcados], ciclo)
    setMarcados(new Set())
    setBusqueda('')
    setCiclo('')
  }

  return (
    <Modal
      abierto={abierto}
      onCerrar={onCerrar}
      titulo="Agregar ubicaciones técnicas"
      pie={
        <div className="flex gap-2">
          <Boton variante="secundario" className="flex-1" onClick={onCerrar}>
            Cancelar
          </Boton>
          <Boton className="flex-1" onClick={confirmar} disabled={marcados.size === 0}>
            Agregar {marcados.size > 0 ? marcados.size : ''}
          </Boton>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {temporadas.length > 1 && (
          <Campo
            etiqueta="Temporada"
            ayuda="Cámbiala para alcanzar lotes que todavía están en la temporada anterior. Los lotes que ya agregaste no se pierden al cambiarla."
          >
            <SelectorBuscable
              valor={temporadaFiltro}
              onCambiar={onCambiarTemporada}
              placeholder="Todas las temporadas"
              etiquetaBusqueda="Escribe el nombre de la temporada"
              textoVacio="Todas las temporadas"
              opciones={temporadas.map((t) => ({
                id: t.id,
                titulo: t.nombre,
                subtitulo: t.activa ? 'Activa' : undefined,
              }))}
            />
          </Campo>
        )}

        <Campo
          etiqueta="Ciclo"
          ayuda="Se aplica a los lotes que agregues ahora. Con «Según el lote» se usa el ciclo configurado en cada uno."
        >
          <Selector value={ciclo} onChange={(e) => setCiclo(e.target.value)}>
            <option value="">Según el lote</option>
            {CICLOS.map((c) => (
              <option key={c} value={c}>
                Ciclo {c}
              </option>
            ))}
          </Selector>
        </Campo>

        <div className="relative">
          <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-300" />
          <input
            value={busqueda}
            onChange={(e) => setBusqueda(e.target.value)}
            placeholder="Buscar lote…"
            inputMode="search"
            autoFocus
            className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-9 pr-3 text-base placeholder:text-slate-300 focus:border-brand-600 focus:bg-white focus:outline-none focus:ring-4 focus:ring-brand-600/10"
          />
        </div>

        <div className="flex flex-col">
          {filtrados.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-slate-400">
              {lotes.length === 0
                ? 'No hay lotes vinculados a la temporada activa.'
                : busqueda
                  ? `Ningún lote coincide con «${busqueda}».`
                  : 'Ya agregaste todos los lotes disponibles.'}
            </p>
          ) : (
            filtrados.map((lote) => {
              const marcado = marcados.has(lote.lote_temporada_id)
              return (
                <button
                  key={lote.lote_temporada_id}
                  type="button"
                  onClick={() => alternar(lote.lote_temporada_id)}
                  className={`flex items-center gap-3 border-b border-slate-50 px-2 py-3 text-left transition-colors last:border-0 ${
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
                    <span className="block truncate text-xs text-slate-400">
                      {lote.nombre ? `${lote.nombre} · ` : ''}
                      {lote.area_neta} mz neta · ciclo {lote.ciclo}
                      {!temporadaFiltro && lote.temporada_nombre
                        ? ` · ${lote.temporada_nombre}`
                        : ''}
                    </span>
                  </span>
                </button>
              )
            })
          )}
        </div>
      </div>
    </Modal>
  )
}
