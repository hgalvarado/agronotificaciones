'use client'

/**
 * Registro diario del motor (replica la hoja FTR_F-MA-103, mismo orden y nombres): fecha, horómetro inicial/final, horas,
 * visor inicial/final, galones gastados, rendimiento, revoluciones y quién lo registra. Sin señal: se guarda en el
 * teléfono y se envía solo (operación `motor_registro_diario`, sql/130). Las cuentas son de lib/motores (las mismas
 * de la base); aquí solo se muestran. Se registran jornadas de ayer o anteriores: nunca se asume «hoy».
 */

import { useMemo, useState } from 'react'
import { AreaTexto, Campo } from '@/components/ui/Primitivos'
import { ayerIso, deEntradaLocal, ahoraIso, hoyIso } from '@/lib/fechas/zona'
import { claveBorrador, useAutoguardado, useBorrador } from '@/lib/fertirriego/borrador'
import { crearOperacion } from '@/lib/fertirriego/operaciones'
import type { Estacion, Operacion, Persona, PermisoHistorico } from '@/lib/fertirriego/tipos'
import type { EstadoMotores, MotorEstacion, OperacionPendienteMotor } from '@/lib/motores/estado'
import { armarRegistroDiario, avisosContinuidad, calcularRegistro, proponerInicial } from '@/lib/motores/registroDiario'
import { MarcoRegistro } from '@/components/fertirriego/MarcoRegistro'

type Datos = {
  fecha: string
  horoIni: string | null
  horoFin: string
  visorIni: string | null
  visorFin: string
  rpm: string
  horoCambiado: boolean
  visorCambiado: boolean
  noTrabajo: boolean
  comentario: string
  suministro?: string
}

const num = (t: string): number | null => {
  const s = t.trim().replace(',', '.')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
const fmtFecha = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const ORIGEN: Record<string, string> = { cola: 'en cola', registro: 'registro', motor: 'último guardado' }

function CajaNumero({ valor, onCambiar, dato, etiqueta, deshabilitado = false }: { valor: string; onCambiar: (v: string) => void; dato: string; etiqueta: string; deshabilitado?: boolean }) {
  return (
    <input
      inputMode="decimal"
      aria-label={etiqueta}
      value={valor}
      disabled={deshabilitado}
      onChange={(e) => onCambiar(e.target.value.replace(/[^\d.,]/g, ''))}
      placeholder="0"
      {...{ [dato]: true }}
      className="min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-right text-base font-semibold tabular-nums focus:border-brand-600 focus:outline-none disabled:bg-slate-50"
    />
  )
}

function Calculado({ etiqueta, valor, dato }: { etiqueta: string; valor: string; dato: string }) {
  return (
    <Campo etiqueta={etiqueta}>
      <p className="flex min-h-11 items-center justify-end rounded-lg bg-slate-50 px-3 text-base font-bold tabular-nums text-slate-800" {...{ [dato]: true }}>
        {valor}
      </p>
    </Campo>
  )
}

export function FormRegistroMotor({
  motor,
  estado,
  pendientes,
  estacion,
  yo,
  historico,
  bodegaDiesel,
  dieselMaterialId,
  registrar,
  onAbrirRecibir,
  onCerrar,
  onGuardado,
}: {
  motor: MotorEstacion
  estado: EstadoMotores
  pendientes: OperacionPendienteMotor[]
  estacion: Estacion
  yo: Persona
  /** sql/140: permiso temporal «Registro histórico» de esta estación (si lo tiene, se ofrece la casilla). */
  historico?: PermisoHistorico | null
  /** sql/144: el diésel en la bodega de la estación (con lo pendiente de enviar); null = no se sabe todavía. */
  bodegaDiesel: number | null
  /** El producto diésel de AGL (para rebajar la bodega local al guardar). */
  dieselMaterialId: string | null
  registrar: (...ops: Operacion[]) => Promise<void>
  /** «Recibir diésel»: abre la recepción a la bodega de la estación. */
  onAbrirRecibir: () => void
  onCerrar: () => void
  onGuardado: (m: string) => void
}) {
  const borrador = useBorrador<Datos>(claveBorrador('motor_registro', yo.id, estacion.id, motor.equipo_id))
  const b = borrador.inicial
  const [fecha, setFecha] = useState(b?.fecha ?? ayerIso())
  const [horoIni, setHoroIni] = useState<string | null>(b?.horoIni ?? null)
  const [horoFin, setHoroFin] = useState(b?.horoFin ?? '')
  const [visorIni, setVisorIni] = useState<string | null>(b?.visorIni ?? null)
  const [visorFin, setVisorFin] = useState(b?.visorFin ?? '')
  const [rpm, setRpm] = useState(b?.rpm ?? '')
  const [horoCambiado, setHoroCambiado] = useState(b?.horoCambiado ?? false)
  const [visorCambiado, setVisorCambiado] = useState(b?.visorCambiado ?? false)
  const [noTrabajo, setNoTrabajo] = useState(b?.noTrabajo ?? false)
  const [comentario, setComentario] = useState(b?.comentario ?? '')
  const [suministro, setSuministro] = useState(b?.suministro ?? '')
  // Confirmación de «sin inventario»: atada a lo que se confirmó (si cambia el suministro, hay que confirmar de nuevo)
  const [aceptada, setAceptada] = useState<string | null>(null)
  // sql/140 · Registro histórico: día pasado, sin custodia y SIN mover el diésel del tanque (la base lo vuelve a validar)
  const [esHistorico, setEsHistorico] = useState(false)
  useAutoguardado(borrador, { fecha, horoIni, horoFin, visorIni, visorFin, rpm, horoCambiado, visorCambiado, noTrabajo, comentario, suministro })

  // El inicial propuesto es la lectura final del último registro ANTERIOR a esta fecha (cola incluida)
  const propuesta = useMemo(() => proponerInicial({ equipoId: motor.equipo_id, fecha, estado, pendientes }), [motor.equipo_id, fecha, estado, pendientes])
  const horoIniTxt = horoIni ?? (propuesta.horoIni !== null ? String(propuesta.horoIni) : '')
  const visorIniTxt = visorIni ?? (propuesta.visorIni !== null ? String(propuesta.visorIni) : '')
  const horoFinEf = noTrabajo ? horoIniTxt : horoFin
  const visorFinEf = noTrabajo ? visorIniTxt : visorFin

  const tanqueId = motor.tanque?.id ?? ''
  // sql/144: el suministro de combustible del día sale de la bodega de la estación y sube el tanque
  const recibido = Math.max(num(suministro) ?? 0, 0)
  const falta = !esHistorico && recibido > 0 && bodegaDiesel !== null && recibido > bodegaDiesel + 0.0001
  const firmaFalta = falta ? `${recibido}|${bodegaDiesel}` : ''
  const aceptaNegativo = falta && aceptada === firmaFalta
  const calc = calcularRegistro(
    { horoIni: num(horoIniTxt), horoFin: num(horoFinEf), visorIni: num(visorIniTxt), visorFin: num(visorFinEf), recibido },
    { horoCambiado }
  )
  const completo = num(horoIniTxt) !== null && num(horoFinEf) !== null && num(visorIniTxt) !== null && num(visorFinEf) !== null
  const continuidad = avisosContinuidad({ horoIni: num(horoIniTxt), visorIni: num(visorIniTxt), horoCambiado, visorCambiado, propuesta })
  const hoy = hoyIso()

  const avisoPie = (
    <div className="flex flex-col gap-1" data-avisos-registro>
      {falta && (
        <label className="flex items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-900 ring-1 ring-inset ring-red-300" role="alert" data-alerta-sin-inventario>
          <input type="checkbox" checked={aceptaNegativo} onChange={(e) => setAceptada(e.target.checked ? firmaFalta : null)} className="h-6 w-6 shrink-0" data-acepta-negativo />
          <span className="min-w-0 flex-1 break-words leading-snug">
            <strong>Sin inventario</strong>: en la bodega hay {bodegaDiesel} gal y suministras {recibido}.{' '}
            <span className="font-semibold">Marca para confirmar que sí se suministró.</span>
          </span>
        </label>
      )}
      {propuesta.origen && propuesta.fechaBase && (
        <p className="text-xs text-slate-600">
          Continúa del registro del {fmtFecha(propuesta.fechaBase).slice(0, 5)} ({ORIGEN[propuesta.origen]}).
        </p>
      )}
      {continuidad.map((a) => (
        <p key={a} className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 ring-1 ring-inset ring-amber-600/20" role="status" data-aviso-continuidad>
          {a}
        </p>
      ))}
      {completo && calc.errores.map((e) => (
        <p key={e} className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800 ring-1 ring-inset ring-red-300" role="alert" data-error-registro>
          {e}
        </p>
      ))}
      {completo && calc.avisos.map((a) => (
        <p key={a} className="text-xs font-semibold text-amber-700" data-aviso-registro>
          {a}
        </p>
      ))}
    </div>
  )

  return (
    <MarcoRegistro
      titulo={`Registro diario · ${motor.codigo}`}
      estacion={estacion}
      yo={yo}
      registrar={registrar}
      onCerrar={onCerrar}
      onGuardado={onGuardado}
      borrador={borrador}
      rapido
      avisoPie={avisoPie}
      permisoHistorico={esHistorico}
      construir={({ ubicacion, enNombreDe }) => {
        if (!fecha) return 'Indica la fecha del registro.'
        if (esHistorico && fecha >= hoy) return 'El registro histórico es solo de días pasados: elige un día anterior a hoy.'
        if (!completo) return 'Escribe un número válido.'
        if (falta && !aceptaNegativo) return 'No hay diésel suficiente en la bodega. Marca la casilla roja de abajo para confirmar que sí se suministró, o corrige el suministro (o primero recibe el diésel).'
        const rpmNum = rpm.trim() ? num(rpm) : null
        if (rpm.trim() && rpmNum === null) return 'Las revoluciones deben estar entre 0 y 6000.'
        const a = armarRegistroDiario({
          equipoId: motor.equipo_id,
          fecha,
          fechaHora: deEntradaLocal(`${fecha}T12:00`) ?? ahoraIso(),
          horoIni: num(horoIniTxt) as number,
          horoFin: num(horoFinEf) as number,
          visorIni: num(visorIniTxt) as number,
          visorFin: num(visorFinEf) as number,
          rpm: rpmNum,
          horoCambiado,
          visorCambiado,
          comentario,
          estacionId: estacion.id,
          tanqueId: tanqueId || undefined,
          suministro: recibido,
          dieselMaterialId,
          hoy,
        })
        if ('error' in a) return a.error
        return [
          crearOperacion('motor_registro_diario', { ...a.datos, ...(esHistorico ? { historica: true } : {}), ...(aceptaNegativo ? { acepta_negativo: true } : {}) }, {
            ubicacion,
            enNombreDe,
            resumen: `${esHistorico ? 'Registro HISTÓRICO' : 'Registro diario'} · ${motor.codigo} · ${fmtFecha(fecha).slice(0, 5)}${calc.horas !== null ? ` · ${calc.horas} h` : ''}`,
          }),
        ]
      }}
    >
      {historico && (
        <label className="flex items-start gap-2 rounded-xl bg-sky-50 p-3 text-xs leading-snug text-slate-700 ring-1 ring-inset ring-sky-200" data-registro-historico-motor>
          <input
            type="checkbox"
            className="mt-0.5 h-6 w-6 shrink-0"
            checked={esHistorico}
            onChange={(e) => {
              setEsHistorico(e.target.checked)
              if (e.target.checked && fecha >= hoy) {
                setFecha(ayerIso())
                setHoroIni(null)
                setVisorIni(null)
              }
            }}
            data-casilla-historico
          />
          <span className="min-w-0 flex-1">
            <strong>Registro histórico</strong> (una lectura de antes de usar el sistema): día pasado y NO mueve el diésel del tanque; solo
            guarda horómetro, visor y horas. Permiso hasta el {historico.hasta}
            {historico.dias_restantes <= 0 ? ' (vence hoy)' : ` · te quedan ${historico.dias_restantes} día(s)`}.
          </span>
        </label>
      )}
      <Campo etiqueta="Fecha" requerido>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={fecha}
            max={hoy}
            onChange={(e) => {
              setFecha(e.target.value)
              setHoroIni(null)
              setVisorIni(null)
            }}
            className="min-h-11 w-44 rounded-lg border border-slate-200 bg-white px-3 py-2 text-base focus:border-brand-600 focus:outline-none"
            data-fecha-registro
          />
          {[['Hoy', hoy], ['Ayer', ayerIso()]].map(([txt, v]) => (
            <button
              key={txt}
              type="button"
              onClick={() => {
                setFecha(v)
                setHoroIni(null)
                setVisorIni(null)
              }}
              className={`min-h-11 rounded-full px-4 text-sm font-semibold ring-1 ring-inset ${fecha === v ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-300'}`}
            >
              {txt}
            </button>
          ))}
        </div>
      </Campo>

      <label className="flex min-h-11 items-center gap-3 text-sm font-semibold text-slate-800">
        <input type="checkbox" checked={noTrabajo} onChange={(e) => setNoTrabajo(e.target.checked)} className="h-6 w-6" data-no-trabajo />
        No trabajó ese día (horas 0)
      </label>

      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Horómetro inicial" requerido>
          <CajaNumero valor={horoIniTxt} onCambiar={setHoroIni} dato="data-horo-ini" etiqueta="Horómetro inicial" />
        </Campo>
        <Campo etiqueta="Horómetro final" requerido>
          <CajaNumero valor={horoFinEf} onCambiar={setHoroFin} dato="data-horo-fin" etiqueta="Horómetro final" deshabilitado={noTrabajo} />
        </Campo>
        <Calculado etiqueta="Horas" valor={calc.horas === null ? '—' : String(calc.horas)} dato="data-horas" />
        <Campo etiqueta="Revoluciones (opcional)">
          <CajaNumero valor={rpm} onCambiar={setRpm} dato="data-rpm" etiqueta="Revoluciones del motor" />
        </Campo>
        <Campo etiqueta="Visor inicial (gal)" requerido>
          <CajaNumero valor={visorIniTxt} onCambiar={setVisorIni} dato="data-visor-ini" etiqueta="Visor inicial" />
        </Campo>
        <Campo etiqueta="Visor final (gal)" requerido>
          <CajaNumero valor={visorFinEf} onCambiar={setVisorFin} dato="data-visor-fin" etiqueta="Visor final" deshabilitado={noTrabajo} />
        </Campo>
        <Calculado etiqueta="Galones gastados" valor={calc.gastado === null ? '—' : String(calc.gastado)} dato="data-gastado" />
        <Calculado etiqueta="Rendimiento gal/h" valor={calc.rendimiento === null ? '—' : String(calc.rendimiento)} dato="data-rendimiento" />
      </div>

      <Campo etiqueta="Suministro de combustible (gal)">
        <div className="flex flex-wrap items-center gap-3" data-suministro-dia>
          <div className="w-32">
            <CajaNumero valor={suministro} onCambiar={setSuministro} dato="data-suministro" etiqueta="Suministro de combustible" />
          </div>
          <span className="text-xs text-slate-600" data-bodega-diesel>
            {esHistorico ? 'El histórico no mueve la bodega.' : bodegaDiesel === null ? 'Sale de la bodega de la estación.' : `En bodega: ${bodegaDiesel} gal (sale de ahí)`}
          </span>
          <button type="button" onClick={onAbrirRecibir} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-brand-700 underline" data-recibi-diesel>
            Recibir diésel
          </button>
        </div>
      </Campo>

      <div className="flex flex-col gap-1">
        <label className="flex min-h-11 items-center gap-3 text-sm text-slate-800">
          <input type="checkbox" checked={horoCambiado} onChange={(e) => setHoroCambiado(e.target.checked)} className="h-6 w-6" data-horo-cambiado />
          Cambié el horómetro
        </label>
        <label className="flex min-h-11 items-center gap-3 text-sm text-slate-800">
          <input type="checkbox" checked={visorCambiado} onChange={(e) => setVisorCambiado(e.target.checked)} className="h-6 w-6" data-visor-cambiado />
          Cambié el visor
        </label>
      </div>

      <Campo etiqueta={horoCambiado || visorCambiado ? 'Observaciones (obligatorias con el cambio)' : 'Observaciones'} requerido={horoCambiado || visorCambiado}>
        <AreaTexto value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2} placeholder="Opcional" data-comentario />
      </Campo>

      <p className="text-xs text-slate-500" data-firma-operador>
        Firma del operador: <strong>{yo.nombre}</strong> (queda como quien registra).
      </p>
    </MarcoRegistro>
  )
}
