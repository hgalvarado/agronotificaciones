'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Alerta, AreaTexto, Boton, Campo, Entrada, Tarjeta } from '@/components/ui/Primitivos'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { IconMoon, IconSun } from '@/components/ui/Icons'
import type { Equipo, Operador, TurnoTipo } from '@/lib/types'
import { mensajeDeError } from '@/lib/errores'
import { formatearFecha } from '@/lib/estados'
import { validarHorometro } from '@/lib/horometro/validacion'
import {
  ultimoOperadorDeEquipo,
  type OperadorSugerido,
} from '@/lib/horometro/repositorioSugerencia'

type Props = {
  ticketId: string
  /** Fecha del ticket. Es la única fecha que existe; no se captura aquí. */
  fechaTicket: string
  equipos: Equipo[]
  operadores: Operador[]
  /** Heredado del último horómetro del ticket, para no reteclear lo mismo. */
  valoresIniciales?: { turno?: TurnoTipo }
  horometroBase?: {
    id: string
    equipo_id?: string
    operador_id?: string | null
    turno?: TurnoTipo
    fecha?: string
    horometro_inicial?: number
    horometro_final?: number
    horas_hombre?: number | null
    comentario?: string | null
  }
}

export function HorometroForm({
  ticketId,
  fechaTicket,
  equipos,
  operadores,
  horometroBase,
  valoresIniciales,
}: Props) {
  const supabase = createClient()
  const router = useRouter()
  const [guardando, setGuardando] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Copia local para que un operador recién creado aparezca de inmediato
  // sin recargar la página ni perder lo que ya se escribió en el formulario.
  const [listaOperadores, setListaOperadores] = useState(operadores)
  // De dónde salió el operador que está puesto: sirve para enseñar el
  // aviso «lo puso el sistema» y para no volver a pisar una elección
  // hecha a mano si se cambia de equipo.
  const [sugerido, setSugerido] = useState<OperadorSugerido | null>(null)
  const [buscandoOperador, setBuscandoOperador] = useState(false)
  const [form, setForm] = useState({
    turno: (horometroBase?.turno ?? valoresIniciales?.turno ?? 'DIURNO') as TurnoTipo,
    equipo_id: horometroBase?.equipo_id ?? '',
    horometro_inicial: horometroBase?.horometro_inicial?.toString() ?? '',
    horometro_final: horometroBase?.horometro_final?.toString() ?? '',
    horas_hombre: horometroBase?.horas_hombre?.toString() ?? '',
    operador_id: horometroBase?.operador_id ?? '',
    comentario: horometroBase?.comentario ?? '',
  })

  // Vista previa en vivo de las horas máquina: el operador ve el cálculo
  // mientras teclea, sin tener que guardar para descubrir un error.
  const horasMaquina = useMemo(() => {
    const ini = Number(form.horometro_inicial)
    const fin = Number(form.horometro_final)
    if (!form.horometro_inicial || !form.horometro_final) return null
    if (Number.isNaN(ini) || Number.isNaN(fin)) return null
    return Math.round((fin - ini) * 100) / 100
  }, [form.horometro_inicial, form.horometro_final])

  /**
   * «Al seleccionar un Equipo, preseleccionar automáticamente al Operador
   *  asociado… El campo debe seguir siendo editable por si hubo rotación.»
   *
   * Se dispara en el CLIC de elegir equipo y no en un efecto: es una
   * consecuencia de lo que el usuario acaba de hacer, no un valor
   * derivado, y así React 19 no la marca como `setState` dentro de un
   * efecto.
   *
   * Sólo rellena si el campo está vacío o si lo que hay lo puso la
   * sugerencia anterior. Un operador elegido a mano no se toca: quien lo
   * escribió sabe algo que la base no.
   */
  async function elegirEquipo(equipoId: string) {
    const puestoAMano = form.operador_id !== '' && form.operador_id !== sugerido?.id
    setForm((f) => ({ ...f, equipo_id: equipoId }))

    if (!equipoId || puestoAMano) return

    setBuscandoOperador(true)
    const ultimo = await ultimoOperadorDeEquipo(equipoId)
    setBuscandoOperador(false)
    setSugerido(ultimo)
    setForm((f) => ({ ...f, operador_id: ultimo?.id ?? '' }))
  }

  async function crearOperador(valores: Record<string, string>) {
    const { data, error: dbError } = await supabase
      .from('operadores')
      .insert({ nombre: valores.nombre.trim(), codigo: valores.codigo?.trim() || null })
      .select('id, nombre, codigo')
      .single()

    if (dbError) throw new Error(dbError.message)

    setListaOperadores((prev) =>
      [...prev, data as Operador].sort((a, b) => a.nombre.localeCompare(b.nombre))
    )
    return { id: data.id, titulo: data.nombre, subtitulo: data.codigo ?? undefined }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    // Toda la validación en una llamada, y en el orden en que se llenan
    // los campos: el primer problema que encuentra es el que se dice.
    const revisado = validarHorometro({
      equipoId: form.equipo_id,
      horometroInicial: form.horometro_inicial,
      horometroFinal: form.horometro_final,
      horasHombre: form.horas_hombre,
    })
    if (!revisado.ok) return setError(revisado.error)

    setGuardando(true)

    // La fecha ya no se captura, pero SÍ se manda: es la del ticket.
    //
    // El disparador de la base la sobreescribe con la del ticket de todos
    // modos, así que mandarla no cambia el resultado. Se manda porque la
    // columna es obligatoria: si el código llega a la máquina antes de que
    // se corra la migración 14, sin este valor el insert fallaría por
    // NOT NULL. Con esto, el código nuevo funciona con o sin migración.
    const valores = {
      fecha: fechaTicket,
      turno: form.turno,
      equipo_id: form.equipo_id,
      horometro_inicial: revisado.valor.horometroInicial,
      horometro_final: revisado.valor.horometroFinal,
      horas_hombre: revisado.valor.horasHombre,
      operador_id: form.operador_id || null,
      comentario: form.comentario || null,
    }

    if (horometroBase?.id) {
      const { error: dbError } = await supabase
        .from('horometros')
        .update(valores)
        .eq('id', horometroBase.id)

      setGuardando(false)
      if (dbError) return setError(mensajeDeError(dbError))
      router.push(`/tickets/${ticketId}/horometros/${horometroBase.id}`)
      router.refresh()
      return
    }

    const { data, error: dbError } = await supabase
      .from('horometros')
      .insert({ ticket_id: ticketId, ...valores })
      .select('id')
      .single()

    setGuardando(false)
    if (dbError) return setError(mensajeDeError(dbError))
    // Se salta la pantalla de detalle: después de capturar un horómetro
    // SIEMPRE sigue registrar qué hizo el equipo. Un clic menos por equipo.
    router.push(`/tickets/${ticketId}/horometros/${data.id}/registros/nuevo`)
    router.refresh()
  }

  return (
    // `noValidate`: la validación la manda `lib/horometro/validacion` y
    // nadie más. El globo del navegador sale en su propio idioma, dice
    // «Completa este campo» sin explicar el rango y se salta el orden en
    // que queremos avisar; con dos jueces, el usuario ve uno u otro según
    // el navegador que le tocó.
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <Tarjeta className="flex flex-col gap-4 p-5">
        {/* En celular cada campo ocupa el ancho completo: con Fecha y Turno
            compartiendo fila, cada botón de turno quedaba a un cuarto de
            pantalla y el texto se encimaba. */}
        {/* La fecha NO se captura: es la del ticket. Tenerla editable aquí
            permitía que un horómetro quedara en otro día que su ticket, y
            entonces el ticket dejaba de controlar nada. */}
        <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3.5 py-2.5 ring-1 ring-inset ring-slate-200/70">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">
            Fecha de la jornada
          </span>
          <span className="text-sm font-semibold text-slate-800">
            {formatearFecha(fechaTicket)}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-4">
          <Campo etiqueta="Turno" requerido>
            <div className="grid grid-cols-2 gap-1.5">
              {(
                [
                  { valor: 'DIURNO' as const, etiqueta: 'Diurno', icono: <IconSun className="h-4 w-4" /> },
                  { valor: 'NOCTURNO' as const, etiqueta: 'Nocturno', icono: <IconMoon className="h-4 w-4" /> },
                ]
              ).map((op) => (
                <button
                  key={op.valor}
                  type="button"
                  onClick={() => setForm({ ...form, turno: op.valor })}
                  className={`flex h-12 items-center justify-center gap-2 rounded-xl border px-2 text-sm font-semibold transition-all ${
                    form.turno === op.valor
                      ? 'border-brand-700 bg-brand-700 text-white'
                      : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                  }`}
                >
                  {op.icono}
                  {op.etiqueta}
                </button>
              ))}
            </div>
          </Campo>
        </div>

        <Campo etiqueta="Equipo" requerido>
          <SelectorBuscable
            valor={form.equipo_id}
            onCambiar={elegirEquipo}
            placeholder="Buscar equipo…"
            etiquetaBusqueda="Escribe el código, ej. A08"
            permitirVacio={false}
            opciones={equipos.map((eq) => ({
              id: eq.id,
              titulo: eq.codigo,
              subtitulo: eq.nombre,
            }))}
          />
        </Campo>

        <Campo
          etiqueta="Operador"
          ayuda={
            buscandoOperador
              ? 'Buscando quién llevó este equipo la última vez…'
              : sugerido && form.operador_id === sugerido.id
                ? `Lo puso el sistema: es quien manejó este equipo el ${formatearFecha(sugerido.fecha)}. Cámbialo si hubo rotación.`
                : undefined
          }
        >
          <SelectorBuscable
            valor={form.operador_id}
            onCambiar={(id) => setForm({ ...form, operador_id: id })}
            placeholder="Buscar operador…"
            etiquetaBusqueda="Escribe el nombre o código"
            textoVacio="Sin operador asignado"
            opciones={listaOperadores.map((op) => ({
              id: op.id,
              titulo: op.nombre,
              subtitulo: op.codigo ?? undefined,
            }))}
            creacionRapida={{
              etiqueta: 'Crear operador nuevo',
              campos: [
                { key: 'nombre', label: 'Nombre del operador', requerido: true },
                { key: 'codigo', label: 'Código (opcional)' },
              ],
              onCrear: crearOperador,
            }}
          />
        </Campo>
      </Tarjeta>

      <Tarjeta className="flex flex-col gap-4 p-5">
        <div className="grid grid-cols-2 gap-3">
          <Campo etiqueta="Horómetro inicial" requerido>
            <Entrada
              type="text"
              inputMode="decimal"
              value={form.horometro_inicial}
              onChange={(e) => setForm({ ...form, horometro_inicial: e.target.value })}
              placeholder="0"
              required
            />
          </Campo>
          <Campo etiqueta="Horómetro final" requerido>
            <Entrada
              type="text"
              inputMode="decimal"
              value={form.horometro_final}
              onChange={(e) => setForm({ ...form, horometro_final: e.target.value })}
              placeholder="0"
              required
            />
          </Campo>
        </div>

        {horasMaquina !== null && (
          <div
            className={`flex items-center justify-between rounded-xl px-3.5 py-3 ring-1 ring-inset ${
              horasMaquina < 0
                ? 'bg-red-50 text-red-700 ring-red-600/10'
                : 'bg-brand-50 text-brand-800 ring-brand-600/10'
            }`}
          >
            <span className="text-sm font-medium">Horas máquina</span>
            <span className="text-lg font-bold">{horasMaquina}</span>
          </div>
        )}

        {/* Obligatorias: de esta columna sale el costo de mano de obra, y
            un vacío se sumaba como cero sin que nadie lo notara. */}
        <Campo
          etiqueta="Horas hombre"
          requerido
          ayuda="Las que trabajó la persona, aunque no coincidan con las de la máquina (ej. 4 h máquina, 8 h hombre)."
        >
          <Entrada
            type="text"
            inputMode="decimal"
            value={form.horas_hombre}
            onChange={(e) => setForm({ ...form, horas_hombre: e.target.value })}
            placeholder="8"
            required
          />
        </Campo>

        <Campo etiqueta="Comentarios" ayuda="Fallas, novedades o cualquier observación de la jornada.">
          <AreaTexto
            value={form.comentario}
            onChange={(e) => setForm({ ...form, comentario: e.target.value })}
            rows={3}
          />
        </Campo>
      </Tarjeta>

      {error && <Alerta>{error}</Alerta>}

      <div className="sticky bottom-20 z-10 lg:bottom-4">
        <Boton type="submit" tamano="lg" className="w-full" disabled={guardando}>
          {guardando
          ? 'Guardando…'
          : horometroBase?.id
            ? 'Guardar cambios'
            : 'Guardar y registrar labores'}
        </Boton>
      </div>
    </form>
  )
}
