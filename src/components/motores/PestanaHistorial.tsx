'use client'

/**
 * Historial de Motores de una estación, por día: una fila compacta por registro (lo principal: horas, gastado y rendimiento; chips
 * de señal), por diésel recibido y por movimiento del motor. Tocar la fila abre el detalle con TODOS los campos de la hoja y,
 * solo ahí, Anular / Eliminar por completo. Solo lo que ocurrió en ESTA estación (la base ya lo filtra por custodia). Ventana de 40
 * filas y «Ver más». Las señales se calculan aquí con las reglas de la base, así que funcionan sin señal.
 */

import { useEffect, useMemo, useState } from 'react'
import { Boton } from '@/components/ui/Primitivos'
import { EliminarPorCompleto } from '@/components/fertirriego/EliminarPorCompleto'
import { formatearFechaHora } from '@/lib/estados'
import { cantidad } from '@/lib/fertirriego/calculos'
import { DESTINOS_DEVOLUCION } from '@/lib/fertirriego/devolucionBodega'
import type { TipoEliminable } from '@/lib/fertirriego/eliminar'
import type { Chofer, Estacion, Operacion, Persona, Vehiculo } from '@/lib/fertirriego/tipos'
import { diaLocal, nombreQuien, type EstadoMotores, type MotorEstacion, type RecepcionMotor, type RegistroMotor } from '@/lib/motores/estado'
import { filasDeHoja } from '@/lib/motores/hoja'
import { resumirRegistros } from '@/lib/motores/resumenTemporada'
import { descargarHoja } from '@/lib/motores/hojaArchivo'
import { peorNivel, senalesPorRegistro } from '@/lib/motores/senales'
import { DatoHoja, etiquetaMotor, FilaToque, ChipsSenales } from './ElementosMotor'
import { DetalleRegistroMotor, fechaCorta } from './DetalleRegistroMotor'
import { FormAnularMotor, type AnulableMotor } from './FormAnularMotor'
import { BarraVistaHistorial, HojaMotor, type VistaHistorial } from './HojaMotor'
import { ResumenTemporada } from './ResumenTemporada'
import { EncabezadoDia } from '@/components/campo/EncabezadoDia'

const NOMBRE_MOV: Record<string, string> = { INSTALADO: 'Motor recibido', TRASLADADO: 'Motor movido', RETIRADO: 'Motor retirado', AL_TALLER: 'Al taller', DE_VUELTA: 'De vuelta del taller' }
/** sql/160: el reemplazo temporal se lee como reparación, no como taller. */
const nombreMovimiento = (a: { tipo: string; motivo_codigo: string | null }) =>
  a.motivo_codigo === 'DANO_REEMPLAZO' && a.tipo === 'AL_TALLER' ? 'En reparación'
  : a.motivo_codigo === 'DANO_REEMPLAZO' && a.tipo === 'DE_VUELTA' ? 'Reparado y reactivado'
  : (NOMBRE_MOV[a.tipo] ?? a.tipo)
const TIPOS_PENDIENTES = ['motor_registro_diario', 'diesel_recibir', 'diesel_devolver', 'motor_mantenimiento', 'motor_asignar', 'motor_retiro']

type Evento = { clave: string; dia: string; ts: string; motorId: string | null; tanqueId: string | null; conAlerta: boolean; fila: React.ReactNode }

export function PestanaHistorial({
  estado,
  cola,
  estacion,
  yo,
  motores,
  motorInicial,
  choferes,
  vehiculos,
  nombreEstacion,
  puedeAnular,
  onCorregir,
  onCorregirRecepcion,
  puedeEliminar,
  registrar,
  onGuardado,
  onEliminado,
}: {
  estado: EstadoMotores
  cola: Operacion[]
  estacion: Estacion
  yo: Persona
  motores: MotorEstacion[]
  /** Si llega, el historial abre ya filtrado a ese motor. */
  motorInicial?: string
  choferes: Chofer[]
  vehiculos: Vehiculo[]
  nombreEstacion: (id: string | null) => string | null
  puedeAnular: boolean
  /** Solo administrador: abre la corrección de un registro del día. */
  onCorregir?: (r: RegistroMotor) => void
  /** Solo administrador: corrige una recepción de combustible. */
  onCorregirRecepcion?: (r: RecepcionMotor) => void
  puedeEliminar: boolean
  registrar: (...ops: Operacion[]) => Promise<void>
  onGuardado: (m: string) => void
  onEliminado: (m: string) => void
}) {
  const [abierta, setAbierta] = useState<string | null>(null)
  const [anulando, setAnulando] = useState<AnulableMotor | null>(null)
  const [eliminando, setEliminando] = useState<{ tipo: TipoEliminable; id: string; texto: string } | null>(null)
  // Los registros van POR MOTOR: se abre con un motor elegido (el que pidieron, o el primero). «Todos» sigue disponible.
  const [motoresSel, setMotoresSel] = useState<string[]>(motorInicial ? [motorInicial] : motores[0] ? [motores[0].equipo_id] : [])
  // Al cambiar de estación (otros motores) se elige el primero de la nueva
  useEffect(() => {
    if (motoresSel.length > 0 && !motoresSel.every((id) => motores.some((m) => m.equipo_id === id))) setMotoresSel(motores[0] ? [motores[0].equipo_id] : [])
  }, [motores, motoresSel])
  const [soloAlertas, setSoloAlertas] = useState(false)
  const [filtrosAbiertos, setFiltrosAbiertos] = useState(false)
  const [limite, setLimite] = useState(40)
  const [vista, setVista] = useState<VistaHistorial>('lista')
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')

  const puede = puedeAnular && estacion.permisos.anular
  const codigoDe = useMemo(() => new Map(estado.motores.map((m) => [m.equipo_id, etiquetaMotor(m.codigo, m.nombre)])), [estado.motores])
  const tanqueNombre = useMemo(() => new Map((estado.tanques ?? []).map((t) => [t.id, t.nombre])), [estado.tanques])
  const senales = useMemo(() => senalesPorRegistro(estado.registros, estado.recepciones, estado.devoluciones ?? []), [estado.registros, estado.recepciones, estado.devoluciones])
  const tanquesDeMotores = useMemo(() => new Map(estado.motores.map((m) => [m.equipo_id, m.tanque?.id ?? null])), [estado.motores])

  const acciones = (tipo: AnulableMotor['tipo'], elim: TipoEliminable, id: string, texto: string, anulado: boolean, reg?: RegistroMotor, rec?: RecepcionMotor) => (
    <>
      {rec && onCorregirRecepcion && puede && puedeEliminar && !anulado && (
        <Boton tamano="md" className="min-h-11" onClick={() => onCorregirRecepcion(rec)} data-corregir-recepcion-motor>
          Corregir
        </Boton>
      )}
      {reg && onCorregir && puede && puedeEliminar && !anulado && (
        <Boton tamano="md" className="min-h-11" onClick={() => onCorregir(reg)} data-corregir-registro-motor>
          Corregir
        </Boton>
      )}
      {puede && !anulado && (
        <Boton tamano="md" variante="peligro" className="min-h-11" onClick={() => setAnulando({ tipo, id, texto })} data-anular-motor={tipo}>
          Anular
        </Boton>
      )}
      {puedeEliminar && (
        <Boton tamano="md" variante="peligro" className="min-h-11" onClick={() => setEliminando({ tipo: elim, id, texto })} data-eliminar-por-completo-motor={elim}>
          Eliminar por completo
        </Boton>
      )}
    </>
  )

  const eventos = useMemo<Evento[]>(() => {
    const lista: Evento[] = []
    const alternar = (clave: string) => setAbierta((a) => (a === clave ? null : clave))
    for (const r of estado.registros) {
      if (r.estacion_id !== estacion.id) continue
      const s = senales.get(r.id) ?? []
      const nivel = r.anulado_at ? 'gris' : peorNivel(s.map((x) => x.nivel).filter((x) => x !== 'info'))
      const clave = `r${r.id}`
      lista.push({
        clave,
        dia: r.fecha,
        ts: r.fecha_hora,
        motorId: r.equipo_id,
        tanqueId: r.tanque_id,
        conAlerta: !r.anulado_at && s.some((x) => x.nivel !== 'info'),
        fila: (
          <FilaToque
            key={clave}
            atributos={{ 'data-registro-motor': r.id, 'data-destino': r.id }}
            nivel={nivel}
            titulo={
              <span className={r.anulado_at ? 'line-through opacity-60' : ''}>
                {codigoDe.get(r.equipo_id) ?? 'Motor'}
                <span className="mt-1 grid grid-cols-3 gap-1.5" data-cifras-registro>
                  <CifraRegistro etiqueta="Horas" valor={cantidad(r.horas)} />
                  <CifraRegistro etiqueta="Galones" valor={cantidad(r.gastado_gal)} />
                  <CifraRegistro etiqueta="RPM" valor={r.rpm === null ? '—' : cantidad(r.rpm)} />
                </span>
              </span>
            }
            derecha={r.rendimiento_gal_h === null ? undefined : <span>{cantidad(r.rendimiento_gal_h)} <span className="text-[11px] font-normal text-slate-500">gal/h</span></span>}
            linea2={`Horómetro ${cantidad(r.horo_ini)} → ${cantidad(r.horo_fin)} · Visor ${cantidad(r.visor_ini)} → ${cantidad(r.visor_fin)} · Toca para ver todo`}
            linea3={<ChipsSenales avisos={r.anulado_at ? [] : s} />}
            onToque={() => alternar(clave)}
            abierta={abierta === clave}
          >
            <DetalleRegistroMotor r={r} quien={nombreQuien(estado, r.registrado_por)} senales={s}>
              {acciones('motor_registro', 'mot_registro', r.id, `Registro del ${r.fecha}`, Boolean(r.anulado_at), r)}
            </DetalleRegistroMotor>
          </FilaToque>
        ),
      })
    }
    for (const x of estado.recepciones) {
      if (x.estacion_id !== estacion.id) continue
      const clave = `d${x.id}`
      const chofer = choferes.find((c) => c.id === x.chofer_id)?.nombre ?? null
      const placa = vehiculos.find((v) => v.id === x.vehiculo_id)?.placa ?? null
      lista.push({
        clave,
        dia: diaLocal(x.fecha_hora),
        ts: x.fecha_hora,
        motorId: null,
        tanqueId: x.tanque_id,
        conAlerta: false,
        fila: (
          <FilaToque
            key={clave}
            atributos={{ 'data-recepcion-motor': x.id, 'data-destino': x.id }}
            nivel={x.anulado_at ? 'gris' : 'verde'}
            titulo={<span className={x.anulado_at ? 'line-through opacity-60' : ''}>Combustible recibido · {cantidad(x.galones)} gal</span>}
            linea2={x.tanque_id ? `Tanque ${tanqueNombre.get(x.tanque_id) ?? '—'}` : 'Antes del tanque fijo'}
            onToque={() => alternar(clave)}
            abierta={abierta === clave}
          >
            <div className="mx-3 mb-2 mt-1 rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200" data-detalle-recepcion-motor>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
                <DatoHoja etiqueta="Galones" valor={cantidad(x.galones)} />
                <DatoHoja etiqueta="Fecha y hora" valor={formatearFechaHora(x.fecha_hora)} />
                <DatoHoja etiqueta="Tanque" valor={x.tanque_id ? (tanqueNombre.get(x.tanque_id) ?? '—') : null} />
                <DatoHoja etiqueta="Entregó (chofer)" valor={chofer} />
                <DatoHoja etiqueta="Vehículo" valor={placa} />
                <DatoHoja etiqueta="Registró" valor={nombreQuien(estado, x.registrado_por)} />
                <DatoHoja etiqueta="Observaciones" valor={x.comentario} ancho />
              </dl>
              {x.anulado_at && <p className="mt-2 text-xs font-semibold text-red-700">Anulado{x.motivo_anulacion ? `: ${x.motivo_anulacion}` : ''}</p>}
              {(puede || puedeEliminar) && <div className="mt-3 flex flex-wrap gap-2">{acciones('diesel_recepcion', 'mot_recepcion', x.id, `Recepción de ${x.galones} gal`, Boolean(x.anulado_at), undefined, x)}</div>}
            </div>
          </FilaToque>
        ),
      })
    }
    // sql/155: diésel devuelto a bodega (mismo detalle que la devolución de Fertirriego)
    for (const x of estado.devoluciones ?? []) {
      if (x.estacion_id !== estacion.id) continue
      const clave = `v${x.id}`
      const destino = DESTINOS_DEVOLUCION.find((d) => d.id === x.destino)?.nombre ?? x.destino
      const vehiculo = [x.vehiculo_tipo?.toLowerCase(), x.vehiculo].filter(Boolean).join(' ') || null
      lista.push({
        clave,
        dia: diaLocal(x.fecha_hora),
        ts: x.fecha_hora,
        motorId: null,
        tanqueId: x.tanque_id,
        conAlerta: false,
        fila: (
          <FilaToque
            key={clave}
            atributos={{ 'data-devolucion-motor': x.id, 'data-destino': x.id }}
            nivel={x.anulado_at ? 'gris' : 'info'}
            titulo={<span className={x.anulado_at ? 'line-through opacity-60' : ''}>Devuelto a {destino.toUpperCase()} · {cantidad(x.galones)} gal</span>}
            linea2={`Tanque ${tanqueNombre.get(x.tanque_id) ?? '—'} · retiró ${x.chofer ?? '—'}`}
            onToque={() => alternar(clave)}
            abierta={abierta === clave}
          >
            <div className="mx-3 mb-2 mt-1 rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200" data-detalle-devolucion-motor>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
                <DatoHoja etiqueta="Galones" valor={cantidad(x.galones)} />
                <DatoHoja etiqueta="A dónde" valor={destino} />
                <DatoHoja etiqueta="Fecha y hora" valor={formatearFechaHora(x.fecha_hora)} />
                <DatoHoja etiqueta="Tanque" valor={tanqueNombre.get(x.tanque_id) ?? null} />
                <DatoHoja etiqueta="Saldo antes" valor={x.saldo_antes === null ? null : `${cantidad(x.saldo_antes)} gal`} />
                <DatoHoja etiqueta="Saldo después" valor={x.saldo_despues === null ? null : `${cantidad(x.saldo_despues)} gal`} />
                <DatoHoja etiqueta="Retiró" valor={x.chofer} />
                <DatoHoja etiqueta="Vehículo" valor={vehiculo} />
                <DatoHoja etiqueta="Registró" valor={x.registrado_por_nombre ?? nombreQuien(estado, x.registrado_por)} />
                <DatoHoja etiqueta="Ubicación" valor={x.lat !== null && x.lon !== null ? `${x.lat.toFixed(5)}, ${x.lon.toFixed(5)}` : null} />
                <DatoHoja etiqueta="Motivo" valor={x.motivo} ancho />
              </dl>
              {x.anulado_at && (
                <p className="mt-2 text-xs font-semibold text-red-700">
                  Anulado{x.anulado_por_nombre ? ` por ${x.anulado_por_nombre}` : ''}{x.motivo_anulacion ? `: ${x.motivo_anulacion}` : ''}
                </p>
              )}
              {puede && !x.anulado_at && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Boton tamano="md" variante="peligro" className="min-h-11" onClick={() => setAnulando({ tipo: 'diesel_devolucion', id: x.id, texto: `Devolución de ${x.galones} gal a ${destino}` })} data-anular-motor="diesel_devolucion">
                    Anular
                  </Boton>
                </div>
              )}
            </div>
          </FilaToque>
        ),
      })
    }
    for (const a of estado.asignaciones) {
      if ((a.estacion_destino ?? a.estacion_origen) !== estacion.id && a.estacion_origen !== estacion.id && a.estacion_destino !== estacion.id) continue
      const clave = `m${a.id}`
      lista.push({
        clave,
        dia: diaLocal(a.fecha_hora),
        ts: a.fecha_hora,
        motorId: a.equipo_id,
        tanqueId: null,
        conAlerta: false,
        fila: (
          <FilaToque
            key={clave}
            atributos={{ 'data-movimiento-motor': a.id }}
            nivel={a.anulado_at ? 'gris' : 'info'}
            titulo={<span className={a.anulado_at ? 'line-through opacity-60' : ''}>{nombreMovimiento(a)} · {codigoDe.get(a.equipo_id) ?? 'Motor'}</span>}
            linea2={a.motivo}
            onToque={() => alternar(clave)}
            abierta={abierta === clave}
          >
            <div className="mx-3 mb-2 mt-1 rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200" data-detalle-movimiento-motor>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
                <DatoHoja etiqueta="Qué pasó" valor={nombreMovimiento(a)} />
                <DatoHoja etiqueta="Fecha y hora" valor={formatearFechaHora(a.fecha_hora)} />
                <DatoHoja etiqueta="De la estación" valor={nombreEstacion(a.estacion_origen)} />
                <DatoHoja etiqueta="A la estación" valor={nombreEstacion(a.estacion_destino)} />
                <DatoHoja etiqueta="Tanque" valor={a.tanque_id ? (tanqueNombre.get(a.tanque_id) ?? '—') : null} />
                <DatoHoja etiqueta="Diésel en el tanque (gal)" valor={a.saldo_gal === null ? null : cantidad(a.saldo_gal)} />
                <DatoHoja etiqueta="Motivo" valor={a.motivo} ancho />
              </dl>
              {(puede || puedeEliminar) && (
                <div className="mt-3 flex flex-wrap gap-2">{acciones('motor_asignacion', 'mot_asignacion', a.id, `${NOMBRE_MOV[a.tipo] ?? a.tipo} del ${a.fecha_hora.slice(0, 10)}`, Boolean(a.anulado_at))}</div>
              )}
            </div>
          </FilaToque>
        ),
      })
    }
    return lista.sort((x, y) => y.dia.localeCompare(x.dia) || y.ts.localeCompare(x.ts))
    // bucle-ok: depende de datos ya bajados y del estado de la propia pantalla; no consulta la red
  }, [estado, estacion, senales, codigoDe, tanqueNombre, abierta, choferes, vehiculos, nombreEstacion, puede, puedeEliminar])

  const visibles = useMemo(() => {
    const sel = new Set(motoresSel)
    const tanquesSel = new Set(motoresSel.map((id) => tanquesDeMotores.get(id)).filter((x): x is string => Boolean(x)))
    return eventos.filter((e) => {
      if (sel.size > 0) {
        if (e.motorId ? !sel.has(e.motorId) : !(e.tanqueId === null || tanquesSel.has(e.tanqueId))) return false
      }
      if (soloAlertas && !e.conAlerta) return false
      if ((desde && e.dia < desde) || (hasta && e.dia > hasta)) return false
      return true
    })
  }, [eventos, motoresSel, soloAlertas, tanquesDeMotores, desde, hasta])

  const pendientes = cola.filter((o) => TIPOS_PENDIENTES.includes(o.tipo) && o.estado_local !== 'ACEPTADO' && (o.datos.estacion_id === estacion.id || motores.some((m) => m.equipo_id === o.datos.equipo_id)))
  const mostradas = visibles.slice(0, limite)
  const porDia = useMemo(() => {
    const m = new Map<string, Evento[]>()
    for (const e of mostradas) m.set(e.dia, [...(m.get(e.dia) ?? []), e])
    return [...m.entries()]
  }, [mostradas])
  const fechaDia = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('es-HN', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })
  // El motor se elige con los botones de arriba: no cuenta como filtro
  const activos = (soloAlertas ? 1 : 0) + (desde ? 1 : 0) + (hasta ? 1 : 0)

  // Formato de campo: una tabla por motor (los elegidos, o todos los de la estación)
  const secciones = useMemo(() => {
    const elegidos = motoresSel.length > 0 ? motores.filter((m) => motoresSel.includes(m.equipo_id)) : motores
    return elegidos.map((m) => {
      const sumin = m.tanque?.id
        ? estado.recepciones.filter((x) => x.estacion_id === estacion.id && x.tanque_id === m.tanque?.id && !x.anulado_at).map((x) => ({ id: x.id, dia: diaLocal(x.fecha_hora), galones: x.galones, entrego: choferes.find((c) => c.id === x.chofer_id)?.nombre ?? null }))
        : []
      let filas = filasDeHoja(estado.registros.filter((r) => r.estacion_id === estacion.id), { equipoId: m.equipo_id, desde, hasta }, senales, sumin)
      if (soloAlertas) filas = filas.filter((f) => f.senal !== null)
      return { motor: m, titulo: etiquetaMotor(m.codigo, m.nombre), filas }
    })
  }, [motores, motoresSel, estado.registros, estado.recepciones, choferes, estacion.id, desde, hasta, soloAlertas, senales])
  // Resumen de la temporada (se calcula en el teléfono, también sin señal): motores elegidos (o todos los de la estación) y fechas del filtro
  const cifras = useMemo(() => {
    const ids = new Set(motoresSel.length > 0 ? motoresSel : motores.map((m) => m.equipo_id))
    const tanquesIds = new Set(motores.filter((m) => ids.has(m.equipo_id)).map((m) => m.tanque?.id).filter((x): x is string => Boolean(x)))
    const enRango = (dia: string) => (!desde || dia >= desde) && (!hasta || dia <= hasta)
    const regs = estado.registros.filter((r) => r.estacion_id === estacion.id && ids.has(r.equipo_id) && enRango(r.fecha))
    const recibido = estado.recepciones
      // el recibido de un registro ya incluye lo recibido ese día en su tanque: aparte solo van los días sin registro
      .filter((x) => x.estacion_id === estacion.id && !x.anulado_at && x.tanque_id !== null && tanquesIds.has(x.tanque_id) && enRango(diaLocal(x.fecha_hora)) && !regs.some((r) => r.fecha === diaLocal(x.fecha_hora) && r.tanque_id === x.tanque_id))
      .reduce((n, x) => n + x.galones, 0)
    return resumirRegistros(regs, recibido)
  }, [estado.registros, estado.recepciones, estacion.id, motores, motoresSel, desde, hasta])
  const exportar = (formato: 'pdf' | 'excel') =>
    descargarHoja(
      formato,
      {
        secciones: secciones.map((x) => ({ motor: x.titulo, estacion: estacion.nombre, zona: estacion.zona ?? null, tanque: x.motor.tanque?.nombre ?? null, filas: x.filas })),
        desde,
        hasta,
        generadoPor: yo.nombre,
        generadoEn: formatearFechaHora(new Date().toISOString()),
      },
      `Motores_${estacion.nombre}`
    )

  return (
    <div className="flex flex-col gap-2" data-historial-motores>
      <div role="group" aria-label="Motor" className="flex flex-col gap-1" data-motores-historial>
        <p className="text-xs font-bold uppercase tracking-wide text-slate-700">Motor</p>
        <div className="flex flex-wrap gap-2">
          {motores.map((m) => {
            const activo = motoresSel.length === 1 && motoresSel[0] === m.equipo_id
            return (
              <button
                key={m.equipo_id}
                type="button"
                aria-pressed={activo}
                onClick={() => setMotoresSel([m.equipo_id])}
                data-motor-boton={m.codigo}
                className={`min-h-11 rounded-xl px-3 text-sm font-bold ring-2 ring-inset ${activo ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-800 ring-slate-400'}`}
              >
                {activo ? '✓ ' : ''}
                {etiquetaMotor(m.codigo, m.nombre)}
              </button>
            )
          })}
          {motores.length > 1 && (
            <button
              type="button"
              aria-pressed={motoresSel.length === 0}
              onClick={() => setMotoresSel([])}
              data-motor-boton="todos"
              className={`min-h-11 rounded-xl px-3 text-sm font-bold ring-2 ring-inset ${motoresSel.length === 0 ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-800 ring-slate-400'}`}
            >
              {motoresSel.length === 0 ? '✓ ' : ''}Todos
            </button>
          )}
        </div>
      </div>
      <ResumenTemporada cifras={cifras} subtitulo={desde || hasta ? 'Fechas elegidas' : (estado.temporada?.nombre ?? 'Últimos 45 días')} />
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setFiltrosAbiertos((v) => !v)}
          aria-expanded={filtrosAbiertos}
          className="min-h-11 rounded-lg px-3 text-sm font-semibold text-slate-700 ring-1 ring-inset ring-slate-300"
          data-filtros-historial-motor
        >
          Filtros{activos > 0 ? ` · ${activos} activo${activos === 1 ? '' : 's'}` : ''}
        </button>
        <span className="text-xs text-slate-500">{vista === 'tabla' ? `${secciones.reduce((n, x) => n + x.filas.length, 0)} días` : `${visibles.length} movimiento${visibles.length === 1 ? '' : 's'}`}</span>
      </div>
      <BarraVistaHistorial vista={vista} onVista={setVista} onExportar={exportar} puedeExportar={secciones.some((x) => x.filas.length > 0)} />
      {filtrosAbiertos && (
        <div className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-slate-600">
              Desde
              <input type="date" value={desde} max={hasta || undefined} onChange={(e) => setDesde(e.target.value)} className="mt-0.5 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-2 text-base" data-filtro-desde />
            </label>
            <label className="text-xs text-slate-600">
              Hasta
              <input type="date" value={hasta} min={desde || undefined} onChange={(e) => setHasta(e.target.value)} className="mt-0.5 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-2 text-base" data-filtro-hasta />
            </label>
          </div>
          <button
            type="button"
            aria-pressed={soloAlertas}
            onClick={() => setSoloAlertas((v) => !v)}
            className={`min-h-11 rounded-lg px-3 text-sm font-semibold ring-1 ring-inset ${soloAlertas ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-700 ring-slate-300'}`}
            data-solo-alertas
          >
            Solo con señales
          </button>
          {activos > 0 && (
            <button type="button" className="min-h-11 text-sm font-semibold text-brand-700 underline" onClick={() => { setSoloAlertas(false); setDesde(''); setHasta('') }}>
              Quitar filtros
            </button>
          )}
        </div>
      )}

      {pendientes.map((o) => (
        <FilaToque
          key={o.id}
          atributos={{ 'data-motor-pendiente': true }}
          nivel={o.estado_local === 'RECHAZADO' ? 'rojo' : 'amarillo'}
          titulo={o.resumen}
          linea2={o.estado_local === 'RECHAZADO' ? (o.mensaje ?? 'Rechazado') : 'Por enviar. Sale sola con señal.'}
        />
      ))}

      {vista === 'lista' && visibles.length === 0 && (
        <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500 ring-1 ring-inset ring-slate-200">
          {activos > 0 ? 'Nada con esos filtros.' : 'Sin registros en la temporada.'}
        </p>
      )}
      {vista === 'tabla' && secciones.map((x) => <HojaMotor key={x.motor.equipo_id} titulo={x.titulo} filas={x.filas} />)}
      {vista === 'lista' && porDia.map(([dia, lista]) => (
        <section key={dia} className="flex flex-col gap-1.5" data-dia-motores={dia} data-destino={dia}>
          <EncabezadoDia>{fechaDia(dia)} · {fechaCorta(dia)}</EncabezadoDia>
          {lista.map((e) => e.fila)}
        </section>
      ))}
      {vista === 'lista' && visibles.length > limite && (
        <Boton variante="fantasma" className="min-h-11" onClick={() => setLimite((l) => l + 40)} data-ver-mas>
          Ver más ({visibles.length - limite})
        </Boton>
      )}

      {eliminando && (
        <EliminarPorCompleto
          tipo={eliminando.tipo}
          documentoId={eliminando.id}
          descripcion={eliminando.texto}
          onCerrar={() => setEliminando(null)}
          onEliminado={(m) => {
            setEliminando(null)
            onEliminado(m)
          }}
        />
      )}
      {anulando && <FormAnularMotor doc={anulando} estacion={estacion} yo={yo} registrar={registrar} puedeAceptarNegativo={puedeEliminar} onCerrar={() => setAnulando(null)} onGuardado={onGuardado} />}
    </div>
  )
}

/** Cifra del registro a la vista (sin tocar): etiqueta chica arriba, número grande. */
function CifraRegistro({ etiqueta, valor }: { etiqueta: string; valor: string }) {
  return (
    <span className="block rounded-lg bg-slate-50 px-2 py-1 text-center ring-1 ring-inset ring-slate-200">
      <span className="block text-[11px] font-semibold text-slate-700">{etiqueta}</span>
      <span className="block text-base font-extrabold tabular-nums text-slate-900">{valor}</span>
    </span>
  )
}
