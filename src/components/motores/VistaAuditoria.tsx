'use client'

/**
 * Auditoría de Motores (solo con «Auditar»; necesita señal): TODOS los motores con su semáforo y, al tocar uno, su ficha completa
 * (sql/147: fn_mot_motores_resumen y fn_mot_ficha_completa). La ficha trae la línea de tiempo de tramos (dónde estuvo y con qué
 * horómetro), los movimientos y todos los días con todos los campos de la hoja y sus señales, con filtros por fecha, estación y señal.
 */

import { useMemo, useState } from 'react'
import { Boton } from '@/components/ui/Primitivos'
import { Modal } from '@/components/ui/Modal'
import { SelectorMultiple } from '@/components/ui/SelectorMultiple'
import { formatearFechaHora } from '@/lib/estados'
import { cantidad } from '@/lib/fertirriego/calculos'
import { filtrarResumen, type FichaMotor, type RegistroFicha, type ResumenMotorAuditor, type TramoFicha } from '@/lib/motores/auditoria'
import type { RegistroMotor } from '@/lib/motores/estado'
import { peorNivel, type Aviso } from '@/lib/motores/senales'
import { useLlamadaRpc } from '@/lib/motores/useLlamadaRpc'
import { DetalleRegistroMotor, fechaCorta } from './DetalleRegistroMotor'
import { ChipsSenales, EstadoConsulta, FilaToque } from './ElementosMotor'

const NOMBRE_ESTADO: Record<string, string> = { EN_ESTACION: 'En estación', TALLER: 'En el taller', RETIRADO: 'Retirado', SIN_ASIGNAR: 'Sin asignar' }
const NOMBRE_NIVEL_FILTRO = [
  { valor: 'rojo', etiqueta: 'Urgente' },
  { valor: 'amarillo', etiqueta: 'Atención' },
  { valor: 'verde', etiqueta: 'Bien' },
  { valor: 'gris', etiqueta: 'Sin dato' },
]
const NOMBRE_MOV: Record<string, string> = { INSTALADO: 'Motor recibido', TRASLADADO: 'Motor movido', RETIRADO: 'Motor retirado', AL_TALLER: 'Al taller', DE_VUELTA: 'De vuelta del taller' }
const NOMBRE_UBICACION: Record<string, string> = { ESTACION: 'En estación', TALLER: 'En el taller', RETIRADO: 'Retirado' }

export function VistaAuditoria() {
  const { datos, cargando, error, recargar } = useLlamadaRpc<ResumenMotorAuditor[]>('fn_mot_motores_resumen', undefined)
  const [texto, setTexto] = useState('')
  const [estados, setEstados] = useState<string[]>([])
  const [estaciones, setEstaciones] = useState<string[]>([])
  const [niveles, setNiveles] = useState<string[]>([])
  const [filtros, setFiltros] = useState(false)
  const [limite, setLimite] = useState(40)
  const [ficha, setFicha] = useState<string | null>(null)

  const lista = datos ?? []
  const opcionesEstaciones = useMemo(() => [...new Set(lista.map((m) => m.estacion).filter((x): x is string => Boolean(x)))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true })).map((x) => ({ valor: x, etiqueta: x })), [lista])
  const visibles = useMemo(() => filtrarResumen(lista, { texto, estados, estaciones, niveles }), [lista, texto, estados, estaciones, niveles])
  const activos = [texto.trim(), estados.length, estaciones.length, niveles.length].filter(Boolean).length

  return (
    <div className="flex flex-col gap-2" data-vista-auditoria>
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => setFiltros((v) => !v)} aria-expanded={filtros} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-slate-700 ring-1 ring-inset ring-slate-300" data-filtros-auditoria>
          Filtros{activos > 0 ? ` · ${activos} activo${activos === 1 ? '' : 's'}` : ''}
        </button>
        <span className="text-xs text-slate-500">{visibles.length} de {lista.length} motores</span>
        <Boton tamano="sm" variante="fantasma" className="min-h-11" onClick={recargar} data-actualizar-auditoria>
          Actualizar
        </Boton>
      </div>
      {filtros && (
        <div className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar motor, estación, tanque…"
            aria-label="Buscar"
            className="min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-base focus:border-brand-600 focus:outline-none"
          />
          <SelectorMultiple etiqueta="Dónde está" opciones={Object.entries(NOMBRE_ESTADO).map(([valor, etiqueta]) => ({ valor, etiqueta }))} valores={estados} onCambiar={setEstados} />
          <SelectorMultiple etiqueta="Estación" opciones={opcionesEstaciones} valores={estaciones} onCambiar={setEstaciones} />
          <SelectorMultiple etiqueta="Semáforo" opciones={NOMBRE_NIVEL_FILTRO} valores={niveles} onCambiar={setNiveles} />
          {activos > 0 && (
            <button type="button" className="min-h-11 text-sm font-semibold text-brand-700 underline" onClick={() => { setTexto(''); setEstados([]); setEstaciones([]); setNiveles([]) }}>
              Quitar filtros
            </button>
          )}
        </div>
      )}
      <EstadoConsulta cargando={cargando} error={error} vacio={visibles.length === 0} textoVacio={lista.length === 0 ? 'No hay motores.' : 'No hay motores con esos filtros.'} />
      {visibles.slice(0, limite).map((m) => (
        <FilaToque
          key={m.equipo_id}
          atributos={{ 'data-motor-auditor': m.codigo }}
          nivel={m.ayuda?.nivel ?? 'gris'}
          titulo={
            <>
              {m.codigo}
              <span className="ml-1 text-xs font-normal text-slate-600">{NOMBRE_ESTADO[m.estado] ?? m.estado}</span>
            </>
          }
          linea2={m.ayuda?.ahora?.[0]?.texto ?? m.ayuda?.mantenimiento?.texto ?? 'Sin novedades.'}
          linea3={`${m.estacion ?? 'Sin estación'}${m.zona ? ` · ${m.zona}` : ''}${m.tanque ? ` · tanque ${m.tanque}` : ''} · ${m.tramos} tramo${m.tramos === 1 ? '' : 's'}${m.fecha_ultimo ? ` · último registro ${fechaCorta(m.fecha_ultimo).slice(0, 5)}` : ''}`}
          onToque={() => setFicha(m.equipo_id)}
        />
      ))}
      {visibles.length > limite && (
        <Boton variante="fantasma" className="min-h-11" onClick={() => setLimite((l) => l + 40)} data-ver-mas>
          Ver más ({visibles.length - limite})
        </Boton>
      )}
      {ficha && <FichaMotorAuditor equipoId={ficha} onCerrar={() => setFicha(null)} />}
    </div>
  )
}

function FichaMotorAuditor({ equipoId, onCerrar }: { equipoId: string; onCerrar: () => void }) {
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [estaciones, setEstaciones] = useState<string[]>([])
  const [codigosSenal, setCodigosSenal] = useState<string[]>([])
  const [limite, setLimite] = useState(40)
  const [abierta, setAbierta] = useState<string | null>(null)
  const argumentos = useMemo(() => ({ p_equipo: equipoId, p_desde: desde || null, p_hasta: hasta || null }), [equipoId, desde, hasta])
  const { datos, cargando, error, recargar } = useLlamadaRpc<FichaMotor>('fn_mot_ficha_completa', argumentos)

  const senalesDe = useMemo(() => {
    const m = new Map<string, Aviso[]>()
    for (const s of datos?.senales ?? []) m.set(s.registro_id, [...(m.get(s.registro_id) ?? []), { nivel: s.nivel, codigo: s.codigo, texto: s.texto }])
    return m
  }, [datos])
  const opcionesEstacion = useMemo(() => {
    const ids = new Map<string, string>()
    for (const t of datos?.tramos ?? []) if (t.estacion_id && t.estacion) ids.set(t.estacion_id, t.estacion)
    return [...ids.entries()].map(([valor, etiqueta]) => ({ valor, etiqueta }))
  }, [datos])
  const opcionesSenal = useMemo(() => [...new Set((datos?.senales ?? []).map((s) => s.codigo))].map((c) => ({ valor: c, etiqueta: c.replaceAll('_', ' ').toLowerCase() })), [datos])
  const registros = useMemo(
    () =>
      (datos?.registros ?? []).filter((r) => {
        if (estaciones.length > 0 && !(r.estacion_id && estaciones.includes(r.estacion_id))) return false
        if (codigosSenal.length > 0 && !(senalesDe.get(r.id) ?? []).some((s) => codigosSenal.includes(s.codigo))) return false
        return true
      }),
    [datos, estaciones, codigosSenal, senalesDe]
  )
  const activos = [desde, hasta, estaciones.length, codigosSenal.length].filter(Boolean).length
  const [filtros, setFiltros] = useState(false)
  const m = datos?.motor

  return (
    <Modal abierto ancho="ancho" titulo={`Ficha · ${m?.codigo ?? ''}`} onCerrar={onCerrar}>
      <div className="flex flex-col gap-2" data-ficha-auditor>
        <EstadoConsulta cargando={cargando} error={error} vacio={!datos} textoVacio="Sin datos." />
        {datos && m && (
          <>
            <p className="text-xs text-slate-600">
              {m.nombre}
              {m.modelo ? ` · ${m.modelo}` : ''} · {m.estacion ?? NOMBRE_ESTADO[m.estado] ?? m.estado}
              {m.horo_ultimo !== null ? ` · horómetro ${cantidad(m.horo_ultimo)}` : ''}
            </p>
            {datos.ayuda?.mantenimiento && <FilaToque nivel={datos.ayuda.mantenimiento.nivel} titulo="Mantenimiento" linea2={datos.ayuda.mantenimiento.texto} linea3={`${cantidad(m.horas_desde_mant)} h desde el último mantenimiento${m.horas_estimadas_mant > 0 ? ` (${cantidad(m.horas_estimadas_mant)} h estimadas)` : ''}`} />}
            {datos.ayuda?.registro && <FilaToque nivel={datos.ayuda.registro.nivel} titulo="Registro del día" linea2={datos.ayuda.registro.texto} />}
            {datos.ayuda?.tanque && <FilaToque nivel={datos.ayuda.tanque.nivel} titulo="Tanque" linea2={datos.ayuda.tanque.texto} />}

            <h3 className="mt-2 text-xs font-bold uppercase tracking-wide text-slate-500">Dónde estuvo</h3>
            {datos.tramos.length === 0 && <p className="text-sm text-slate-500">Sin tramos.</p>}
            {datos.tramos.map((t) => (
              <FilaTramo key={t.id} t={t} />
            ))}

            {datos.movimientos.length > 0 && <h3 className="mt-2 text-xs font-bold uppercase tracking-wide text-slate-500">Movimientos</h3>}
            {datos.movimientos.map((x) => (
              <FilaToque
                key={x.id}
                nivel={x.anulado_at ? 'gris' : 'info'}
                titulo={<span className={x.anulado_at ? 'line-through opacity-60' : ''}>{NOMBRE_MOV[x.tipo] ?? x.tipo}</span>}
                linea2={`${formatearFechaHora(x.fecha_hora)}${x.motivo ? ` · ${x.motivo}` : ''}`}
                linea3={`${x.horometro !== null ? `Horómetro ${cantidad(x.horometro)}` : 'Sin horómetro'}${x.registrado_por ? ` · ${x.registrado_por}` : ''}`}
              />
            ))}

            <div className="mt-2 flex items-center justify-between gap-2">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Días registrados ({registros.length})</h3>
              <button type="button" onClick={() => setFiltros((v) => !v)} aria-expanded={filtros} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-slate-700 ring-1 ring-inset ring-slate-300">
                Filtros{activos > 0 ? ` · ${activos}` : ''}
              </button>
            </div>
            {filtros && (
              <div className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3 ring-1 ring-inset ring-slate-200">
                <div className="grid grid-cols-2 gap-2">
                  <label className="text-xs text-slate-600">
                    Desde
                    <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className="mt-0.5 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-2 text-base" />
                  </label>
                  <label className="text-xs text-slate-600">
                    Hasta
                    <input type="date" value={hasta} onChange={(e) => setHasta(e.target.value)} className="mt-0.5 min-h-11 w-full rounded-lg border border-slate-200 bg-white px-2 text-base" />
                  </label>
                </div>
                <SelectorMultiple etiqueta="Estación" opciones={opcionesEstacion} valores={estaciones} onCambiar={setEstaciones} />
                <SelectorMultiple etiqueta="Señal" opciones={opcionesSenal} valores={codigosSenal} onCambiar={setCodigosSenal} />
                {activos > 0 && (
                  <button type="button" className="min-h-11 text-sm font-semibold text-brand-700 underline" onClick={() => { setDesde(''); setHasta(''); setEstaciones([]); setCodigosSenal([]) }}>
                    Quitar filtros
                  </button>
                )}
              </div>
            )}
            {registros.length === 0 && <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500 ring-1 ring-inset ring-slate-200">No hay registros con esos filtros.</p>}
            {registros.slice(0, limite).map((r) => (
              <FilaRegistroFicha key={r.id} r={r} equipoId={m.equipo_id} senales={senalesDe.get(r.id) ?? []} abierta={abierta === r.id} onToque={() => setAbierta((a) => (a === r.id ? null : r.id))} />
            ))}
            {registros.length > limite && (
              <Boton variante="fantasma" className="min-h-11" onClick={() => setLimite((l) => l + 40)} data-ver-mas>
                Ver más ({registros.length - limite})
              </Boton>
            )}
            <div className="flex gap-2">
              <Boton variante="secundario" className="min-h-11" onClick={recargar}>
                Actualizar
              </Boton>
              <Boton variante="fantasma" className="min-h-11" onClick={onCerrar}>
                Regresar
              </Boton>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

function FilaTramo({ t }: { t: TramoFicha }) {
  const nivel = t.ubicacion === 'ESTACION' ? ((t.dias_sin_registro ?? 0) >= 3 ? 'amarillo' : 'verde') : t.ubicacion === 'TALLER' ? 'info' : 'gris'
  return (
    <FilaToque
      atributos={{ 'data-tramo': t.id }}
      nivel={nivel}
      titulo={t.ubicacion === 'ESTACION' ? (t.estacion ?? 'Estación') : NOMBRE_UBICACION[t.ubicacion]}
      linea2={`${fechaCorta(t.desde.slice(0, 10))} → ${t.hasta ? fechaCorta(t.hasta.slice(0, 10)) : 'hoy'} · horómetro ${t.horo_entrada === null ? '—' : cantidad(t.horo_entrada)} → ${t.horo_salida === null ? (t.hasta ? '—' : 'en uso') : cantidad(t.horo_salida)}`}
      linea3={
        t.ubicacion === 'ESTACION'
          ? `${t.registros} registro${t.registros === 1 ? '' : 's'} · ${cantidad(t.horas)} h${t.horas_estimadas > 0 ? ` (${cantidad(t.horas_estimadas)} estimadas)` : ''} · ${cantidad(t.gal_gastados)} gal gastados · ${cantidad(t.gal_suministrados)} suministrados${t.rendimiento_prom !== null ? ` · ${cantidad(t.rendimiento_prom)} gal/h` : ''}${t.dias_sin_registro ? ` · ${t.dias_sin_registro} día(s) sin registro` : ''}${t.tanque ? ` · tanque ${t.tanque}` : ''}`
          : undefined
      }
    />
  )
}

function FilaRegistroFicha({ r, equipoId, senales, abierta, onToque }: { r: RegistroFicha; equipoId: string; senales: Aviso[]; abierta: boolean; onToque: () => void }) {
  const completo: RegistroMotor = {
    ...r,
    equipo_id: equipoId,
    estacion_id: r.estacion_id ?? '',
    tanque_id: r.tanque_id ?? '',
    registrado_por: null,
  }
  const nivel = r.anulado_at ? 'gris' : peorNivel(senales.map((s) => s.nivel).filter((x) => x !== 'info'))
  return (
    <FilaToque
      atributos={{ 'data-registro-ficha': r.id }}
      nivel={nivel}
      titulo={
        <span className={r.anulado_at ? 'line-through opacity-60' : ''}>
          {fechaCorta(r.fecha).slice(0, 5)} · {cantidad(r.horas)} h · {cantidad(r.gastado_gal)} gal
        </span>
      }
      derecha={r.rendimiento_gal_h === null ? undefined : <span>{cantidad(r.rendimiento_gal_h)} <span className="text-[11px] font-normal text-slate-500">gal/h</span></span>}
      linea2={`Horómetro ${cantidad(r.horo_ini)} → ${cantidad(r.horo_fin)} · Visor ${cantidad(r.visor_ini)} → ${cantidad(r.visor_fin)}`}
      linea3={<ChipsSenales avisos={r.anulado_at ? [] : senales} />}
      onToque={onToque}
      abierta={abierta}
    >
      <DetalleRegistroMotor r={completo} quien={r.registrado_por} senales={senales} />
    </FilaToque>
  )
}
