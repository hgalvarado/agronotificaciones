'use client'

/**
 * Registro diario del motor = la hoja física FTR_F-MA-103, con sus mismos campos y su mismo orden: fecha, control de horas del motor
 * (horómetro inicial, final, horas), lectura del visor del tanque (galones iniciales, finales, gastados), rendimiento, revoluciones,
 * lectura de caudal (inicial y final). La firma es de quien ENTREGA el combustible y se anota al recibirlo. El suministro de combustible NO se escribe aquí: se recibe con «Recibir
 * combustible» y la base lo toma de las recepciones del día. El gastado (inicial − final) y el rendimiento
 * se calculan en vivo y las alertas salen al instante, con texto claro. Sin señal: se guarda en el teléfono y se envía solo
 * (operación `motor_registro_diario`). Se registran jornadas de ayer o anteriores: nunca se asume «hoy».
 */

import { useMemo, useState } from 'react'
import { AreaTexto, Campo, Insignia } from '@/components/ui/Primitivos'
import { ayerIso, deEntradaLocal, ahoraIso, hoyIso } from '@/lib/fechas/zona'
import { claveBorrador, useAutoguardado, useBorrador } from '@/lib/fertirriego/borrador'
import { crearOperacion } from '@/lib/fertirriego/operaciones'
import type { Estacion, Operacion, Persona, PermisoHistorico } from '@/lib/fertirriego/tipos'
import { recibidoEnDia, saldoTanqueLocal, type EstadoMotores, type MotorEstacion, type OperacionPendienteMotor, type RegistroMotor } from '@/lib/motores/estado'
import { armarRegistroDiario, calcularRegistro, proponerInicial } from '@/lib/motores/registroDiario'
import { alertasRegistro, fechaUltimaLocal, horasEstimadas, rendimientoReferencia } from '@/lib/motores/senales'
import { MarcoRegistro } from '@/components/fertirriego/MarcoRegistro'
import { TONO_DE_NIVEL } from './ElementosMotor'

type Datos = {
  fecha: string
  horoIni: string | null
  horoFin: string
  visorIni: string | null
  visorFin: string
  rpm: string
  horoCambiado: boolean
  visorCambiado: boolean
  horoMalo?: boolean
  comentario: string
  caudalIni?: string
  caudalFin?: string
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

const Seccion = ({ children }: { children: string }) => <p className="text-[11px] font-bold uppercase tracking-wide text-slate-500">{children}</p>

export function FormRegistroMotor({
  motor,
  estado,
  pendientes,
  estacion,
  yo,
  historico,
  corregir,
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
  /** Solo administrador: corrige un registro ya guardado (se anula el viejo y se guarda el corregido, con motivo). */
  corregir?: RegistroMotor
  registrar: (...ops: Operacion[]) => Promise<void>
  /** «Recibir combustible»: abre la recepción al tanque, con la fecha de este registro. */
  onAbrirRecibir: (fecha: string) => void
  onCerrar: () => void
  onGuardado: (m: string) => void
}) {
  const borrador = useBorrador<Datos>(claveBorrador('motor_registro', yo.id, estacion.id, corregir ? `corregir-${corregir.id}` : motor.equipo_id))
  const c0 = corregir
  const t0 = (v: number | null | undefined) => (v === null || v === undefined ? '' : String(v))
  const b = borrador.inicial
  const [motivo, setMotivo] = useState('')
  const [fecha, setFecha] = useState(b?.fecha ?? c0?.fecha ?? ayerIso())
  const [horoIni, setHoroIni] = useState<string | null>(b?.horoIni ?? (c0 ? t0(c0.horo_ini) : null))
  const [horoFin, setHoroFin] = useState(b?.horoFin ?? (c0 ? t0(c0.horo_fin) : ''))
  const [visorIni, setVisorIni] = useState<string | null>(b?.visorIni ?? (c0 ? t0(c0.visor_ini) : null))
  const [visorFin, setVisorFin] = useState(b?.visorFin ?? (c0 ? t0(c0.visor_fin) : ''))
  const [rpm, setRpm] = useState(b?.rpm ?? (c0 ? t0(c0.rpm) : ''))
  const [horoCambiado, setHoroCambiado] = useState(b?.horoCambiado ?? c0?.horo_cambiado ?? false)
  const [visorCambiado, setVisorCambiado] = useState(b?.visorCambiado ?? c0?.visor_cambiado ?? false)
  // Horómetro dañado: no hay lectura; las horas quedan en 0, el diésel sí se registra y las horas se estiman solo para el mantenimiento
  const [horoMalo, setHoroMalo] = useState(b?.horoMalo ?? false)
  const [comentario, setComentario] = useState(b?.comentario ?? c0?.comentario ?? '')
  const [caudalIni, setCaudalIni] = useState(b?.caudalIni ?? (c0 ? t0(c0.caudal_ini) : ''))
  const [caudalFin, setCaudalFin] = useState(b?.caudalFin ?? (c0 ? t0(c0.caudal_fin) : ''))
  // sql/140 · Registro histórico: día pasado, sin custodia y SIN mover el diésel del tanque (la base lo vuelve a validar)
  const [esHistorico, setEsHistorico] = useState(false)
  useAutoguardado(borrador, { fecha, horoIni, horoFin, visorIni, visorFin, rpm, horoCambiado, visorCambiado, horoMalo, comentario, caudalIni, caudalFin })

  // El inicial propuesto es la lectura final del último registro ANTERIOR a esta fecha (cola incluida)
  const propuesta = useMemo(() => proponerInicial({ equipoId: motor.equipo_id, fecha, estado, pendientes }), [motor.equipo_id, fecha, estado, pendientes])
  // Horómetro dañado: no se escribe ninguna lectura; se usa donde terminó el motor la última vez
  const horoBase = propuesta.horoIni ?? motor.horo_ultimo ?? 0
  const horoIniTxt = horoMalo ? String(horoBase) : horoIni ?? (propuesta.horoIni !== null ? String(propuesta.horoIni) : '')
  // El visor inicial = donde terminó el último registro + lo recibido ese día en el tanque (ej.: terminó en 47 y hoy entraron 150 → 197).
  // En un registro histórico no se suma: no mueve el tanque.
  const tanqueId = motor.tanque?.id ?? ''
  const recibidoHoy = tanqueId ? recibidoEnDia(tanqueId, fecha, estado, pendientes) : 0
  const visorIniTxt = visorIni ?? (propuesta.visorIni !== null ? String(Math.round((propuesta.visorIni + (esHistorico ? 0 : recibidoHoy)) * 100) / 100) : '')
  const horoFinEf = horoMalo ? horoIniTxt : horoFin
  const visorFinEf = visorFin

  const hoy = hoyIso()
  // sql/147: el suministro del día = lo recibido ese día en el tanque (recepciones, también las pendientes de enviar)
  const recibido = recibidoHoy
  const calc = calcularRegistro(
    { horoIni: num(horoIniTxt), horoFin: num(horoFinEf), visorIni: num(visorIniTxt), visorFin: num(visorFinEf), recibido },
    { horoCambiado }
  )
  // Las horas salen en cuanto se escribe el horómetro final (sin esperar los galones)
  const hi = num(horoIniTxt), hf = num(horoFinEf)
  const horasVivo = hi !== null && hf !== null ? (hf >= hi ? Math.round((hf - hi) * 100) / 100 : horoCambiado ? 0 : null) : null
  const completo = num(horoIniTxt) !== null && num(horoFinEf) !== null && num(visorIniTxt) !== null && num(visorFinEf) !== null
  const visorSube = completo && (num(visorFinEf) as number) > (num(visorIniTxt) as number) && recibidoHoy === 0
  const saldoLibro = tanqueId ? saldoTanqueLocal(tanqueId, estado, pendientes) : null
  const ultima = fechaUltimaLocal(motor, pendientes)
  // el libro solo se compara con el registro más reciente del motor (igual que la base)
  const compararLibro = !esHistorico && (ultima === null || fecha > ultima)
  const alertas = useMemo(
    () =>
      alertasRegistro({
        fecha,
        horoIni: num(horoIniTxt),
        horoFin: num(horoFinEf),
        visorIni: num(visorIniTxt),
        visorFin: num(visorFinEf),
        suministro: recibido,
        horoCambiado,
        visorCambiado,
        previo: { horoIni: propuesta.horoIni, visorIni: propuesta.visorIni, fechaBase: propuesta.fechaBase },
        saldoTanque: compararLibro ? saldoLibro : null,
        recibidoHoyTanque: recibidoHoy,
        registros: estado.registros,
        equipoId: motor.equipo_id,
        historico: esHistorico,
      }),
    [fecha, horoIniTxt, horoFinEf, visorIniTxt, visorFinEf, recibido, horoCambiado, visorCambiado, propuesta, compararLibro, saldoLibro, recibidoHoy, estado.registros, motor.equipo_id, esHistorico]
  )
  const estimadas = completo && calc.horas === 0 && calc.gastado !== null ? horasEstimadas(0, calc.gastado, rendimientoReferencia(estado.registros, motor.equipo_id, fecha)) : null

  const avisoPie = (
    <div className="flex flex-col gap-1.5" data-avisos-registro>
      {propuesta.origen && propuesta.fechaBase && (
        <p className="text-xs text-slate-600">
          Sigue del {fmtFecha(propuesta.fechaBase).slice(0, 5)} ({ORIGEN[propuesta.origen]}).
        </p>
      )}
      {completo &&
        !visorSube &&
        calc.errores.map((e) => (
          <p key={e} className="rounded-lg bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-800 ring-1 ring-inset ring-red-600/20" role="alert" data-error-registro>
            {e}
          </p>
        ))}
      {alertas.map((a) => (
        <p
          key={a.codigo}
          className="flex items-start gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-slate-800 ring-1 ring-inset ring-slate-200"
          role={a.nivel === 'rojo' ? 'alert' : 'status'}
          data-aviso-continuidad={a.codigo}
        >
          <Insignia tono={TONO_DE_NIVEL[a.nivel]}>{a.nivel === 'rojo' ? 'Urgente' : 'Atención'}</Insignia>
          <span className="min-w-0 flex-1 break-words pt-0.5">{a.texto}</span>
        </p>
      ))}
      {completo && calc.duranteDia && (
        <p className="text-xs text-slate-600" data-aviso-registro>
          Entró combustible ese día.
        </p>
      )}
    </div>
  )

  return (
    <MarcoRegistro
      titulo={`${corregir ? 'Corregir registro' : 'Registro diario'} · ${motor.codigo}`}
      {...(corregir ? { permiso: 'anular' as const, sinCustodia: true, textoGuardar: 'Guardar corrección' } : {})}
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
        if (!fecha) return 'Falta la fecha.'
        if (corregir && motivo.trim().length < 10) return 'Escribe por qué se corrige (mínimo 10 letras).'
        if (esHistorico && fecha >= hoy) return 'Histórico: elige un día anterior a hoy.'
        if (!completo) return 'Escribe un número válido.'
        const rpmNum = rpm.trim() ? num(rpm) : null
        if (rpm.trim() && rpmNum === null) return 'Revoluciones entre 0 y 6000.'
        const ci = caudalIni.trim() ? num(caudalIni) : null
        const cf = caudalFin.trim() ? num(caudalFin) : null
        if ((caudalIni.trim() && ci === null) || (caudalFin.trim() && cf === null)) return 'Caudal: escribe un número.'
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
          comentario: horoMalo && !/horómetro (malo|dañado)/i.test(comentario) ? `[Horómetro dañado] ${comentario}`.trim() : comentario,
          estacionId: estacion.id,
          tanqueId: tanqueId || undefined,
          caudalIni: ci,
          caudalFin: cf,
          hoy,
        })
        if ('error' in a) return a.error
        const nuevo = crearOperacion('motor_registro_diario', { ...a.datos, ...(esHistorico ? { historica: true } : {}) }, {
          ubicacion,
          enNombreDe,
          resumen: `${corregir ? 'Registro CORREGIDO' : esHistorico ? 'Registro HISTÓRICO' : 'Registro diario'} · ${motor.codigo} · ${fmtFecha(fecha).slice(0, 5)}${calc.horas !== null ? ` · ${calc.horas} h` : ''}`,
        })
        if (!corregir) return [nuevo]
        // Corregir = anular el registro viejo (el tanque vuelve a como estaba) y guardar el corregido, en ese orden
        const anula = crearOperacion('anulacion', { estacion_id: estacion.id, documento_tipo: 'motor_registro', documento_id: corregir.id, motivo: `Corrección: ${motivo.trim()}` }, { ubicacion, enNombreDe, resumen: `Corrección · anula registro del ${fmtFecha(corregir.fecha).slice(0, 5)}` })
        return [anula, nuevo]
      }}
    >
      {historico && !corregir && (
        <label className="flex items-start gap-2 rounded-xl bg-sky-50 p-3 text-xs leading-snug text-slate-700 ring-1 ring-inset ring-sky-600/20" data-registro-historico-motor>
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
            <strong>Registro histórico</strong>: día pasado, no mueve el tanque. Hasta el {historico.hasta}
            {historico.dias_restantes <= 0 ? ' (vence hoy)' : ` · ${historico.dias_restantes} día(s)`}.
          </span>
        </label>
      )}
      <Campo etiqueta="Fecha" requerido>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={fecha}
            max={hoy}
            disabled={Boolean(corregir)}
            onChange={(e) => {
              setFecha(e.target.value)
              setHoroIni(null)
              setVisorIni(null)
            }}
            className="min-h-11 w-44 rounded-lg border border-slate-200 bg-white px-3 py-2 text-base focus:border-brand-600 focus:outline-none"
            data-fecha-registro
          />
          {(corregir ? [] : [['Hoy', hoy], ['Ayer', ayerIso()]]).map(([txt, v]) => (
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
        <input type="checkbox" checked={horoMalo} onChange={(e) => setHoroMalo(e.target.checked)} className="h-6 w-6" data-horo-malo />
        Horómetro dañado (sin lectura)
      </label>

      <Seccion>Control de horas del motor</Seccion>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Horómetro inicial" requerido>
          <CajaNumero valor={horoIniTxt} onCambiar={setHoroIni} dato="data-horo-ini" etiqueta="Horómetro inicial" deshabilitado={horoMalo} />
        </Campo>
        <Campo etiqueta="Horómetro final" requerido>
          <CajaNumero valor={horoFinEf} onCambiar={setHoroFin} dato="data-horo-fin" etiqueta="Horómetro final" deshabilitado={horoMalo} />
        </Campo>
        <Calculado etiqueta="Horas" valor={horasVivo === null ? '—' : String(horasVivo)} dato="data-horas" />
        <Campo etiqueta="Revoluciones (opcional)">
          <CajaNumero valor={rpm} onCambiar={setRpm} dato="data-rpm" etiqueta="Revoluciones del motor" />
        </Campo>
      </div>
      {estimadas !== null && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-900 ring-1 ring-inset ring-amber-600/20" data-horas-estimadas>
          Se estiman {estimadas} h para el mantenimiento.
        </p>
      )}

      <Seccion>Lectura de visor del tanque</Seccion>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Galones iniciales" requerido>
          <CajaNumero valor={visorIniTxt} onCambiar={setVisorIni} dato="data-visor-ini" etiqueta="Galones iniciales del visor" />
        </Campo>
        <Campo etiqueta="Galones finales" requerido>
          <CajaNumero valor={visorFinEf} onCambiar={setVisorFin} dato="data-visor-fin" etiqueta="Galones finales del visor" />
        </Campo>
        <Calculado etiqueta="Galones gastados" valor={calc.gastado === null ? '—' : String(calc.gastado)} dato="data-gastado" />
        <Calculado etiqueta="Rendimiento gal/h" valor={calc.rendimiento === null ? '—' : String(calc.rendimiento)} dato="data-rendimiento" />
      </div>

      {visorSube && (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-red-800" role="alert" data-visor-sube>
          <span className="font-medium">Subió el visor: recibe combustible primero.</span>
          <button type="button" onClick={() => onAbrirRecibir(fecha)} className="min-h-11 rounded-lg px-3 text-sm font-medium text-brand-700 underline" data-recibi-diesel>
            Recibir combustible
          </button>
        </p>
      )}
      {recibidoHoy > 0 && !esHistorico && (
        <p className="text-xs text-slate-600" data-tanque-libro>
          Recibido ese día: {recibidoHoy} gal.
        </p>
      )}

      <Seccion>Lectura de caudal</Seccion>
      <div className="grid grid-cols-2 gap-3">
        <Campo etiqueta="Inicial (opcional)">
          <CajaNumero valor={caudalIni} onCambiar={setCaudalIni} dato="data-caudal-ini" etiqueta="Lectura de caudal inicial" />
        </Campo>
        <Campo etiqueta="Final (opcional)">
          <CajaNumero valor={caudalFin} onCambiar={setCaudalFin} dato="data-caudal-fin" etiqueta="Lectura de caudal final" />
        </Campo>
      </div>

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

      {corregir && (
        <Campo etiqueta="Motivo de la corrección" requerido>
          <AreaTexto value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} placeholder="Qué estaba mal" data-motivo-correccion />
        </Campo>
      )}
      <Campo etiqueta={horoCambiado || visorCambiado ? 'Observaciones (obligatorias con el cambio)' : 'Observaciones'} requerido={horoCambiado || visorCambiado}>
        <AreaTexto value={comentario} onChange={(e) => setComentario(e.target.value)} rows={2} placeholder="Opcional" data-comentario />
      </Campo>
    </MarcoRegistro>
  )
}
