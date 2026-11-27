'use client'

/**
 * Vista GENERAL de Motores (sql/147 y 149; solo lectura; necesita señal): TODOS los motores con su ubicación, el medidor del tanque y la
 * barra de mantenimiento, al día en tiempo real, y al tocar uno su ficha: resumen de la temporada, dónde estuvo y el historial en tabla.
 * La ve quien tiene «Vista general» o «Auditar» (y el administrador); no puede registrar ni modificar nada.
 */

import { useMemo, useState } from 'react'
import { IconChevronRight } from '@/components/ui/Icons'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { useAvisosCambios } from '@/lib/datos/useAvisosCambios'
import { useMemoria } from '@/lib/memoria/useMemoria'
import { Boton } from '@/components/ui/Primitivos'
import { Modal } from '@/components/ui/Modal'
import { SelectorMultiple } from '@/components/ui/SelectorMultiple'
import { formatearFechaHora } from '@/lib/estados'
import { cantidad } from '@/lib/fertirriego/calculos'
import { compararPor, pronosticar, textoDias, type OrdenGeneral, type Pronostico } from '@/lib/motores/pronostico'
import { filtrarResumen, type CifrasTemporada, type FichaMotor, type RegistroFicha, type ResumenMotorAuditor, type ResumenTemporadaServidor, type TemporadaInfo, type TramoFicha } from '@/lib/motores/auditoria'
import type { RegistroMotor } from '@/lib/motores/estado'
import { filasDeHoja } from '@/lib/motores/hoja'
import { resumirRegistros } from '@/lib/motores/resumenTemporada'
import { descargarHoja } from '@/lib/motores/hojaArchivo'
import { peorNivel, type Aviso } from '@/lib/motores/senales'
import { useLlamadaRpc } from '@/lib/motores/useLlamadaRpc'
import { DetalleRegistroMotor, fechaCorta } from './DetalleRegistroMotor'
import { BandaNivel, ChipsSenales, EstadoConsulta, etiquetaMotor, FilaToque, InsigniaNivel } from './ElementosMotor'
import { BarraMantenimiento } from './BarraMantenimiento'
import { MedidorTanque } from './MedidorTanque'
import { ResumenTemporada } from './ResumenTemporada'
import { BarraVistaHistorial, HojaMotor, type VistaHistorial } from './HojaMotor'

const NOMBRE_ESTADO: Record<string, string> = { EN_ESTACION: 'En estación', TALLER: 'En el taller', RETIRADO: 'Retirado', SIN_ASIGNAR: 'Sin asignar' }
const NOMBRE_NIVEL_FILTRO = [
  { valor: 'rojo', etiqueta: 'Urgente' },
  { valor: 'amarillo', etiqueta: 'Atención' },
  { valor: 'verde', etiqueta: 'Bien' },
  { valor: 'gris', etiqueta: 'Sin dato' },
]
const NOMBRE_MOV: Record<string, string> = { INSTALADO: 'Motor recibido', TRASLADADO: 'Motor movido', RETIRADO: 'Motor retirado', AL_TALLER: 'Al taller', DE_VUELTA: 'De vuelta del taller' }
const NOMBRE_UBICACION: Record<string, string> = { ESTACION: 'En estación', TALLER: 'En el taller', RETIRADO: 'Retirado' }

const TABLAS_VIVAS = ['mot_registros', 'mot_recepciones', 'mot_motores', 'mot_custodias']

export function VistaGeneral({ generadoPor }: { generadoPor: string }) {
  const { datos, cargando, error, recargar } = useLlamadaRpc<ResumenMotorAuditor[]>('fn_mot_motores_resumen', undefined)
  const { datos: temporadasDatos, cargando: cargandoTemp } = useLlamadaRpc<TemporadaInfo[]>('fn_mot_temporadas', undefined)
  // Tiempo real: la base avisa (y al volver a la pantalla); con el freno de useAvisosCambios (sin bucles)
  useAvisosCambios({ tablas: TABLAS_VIVAS, alCambiar: recargar })
  const [zonas, setZonas] = useState<string[]>([])
  const [texto, setTexto] = useState('')
  const [estados, setEstados] = useState<string[]>([])
  const [estaciones, setEstaciones] = useState<string[]>([])
  const [niveles, setNiveles] = useState<string[]>([])
  const [filtros, setFiltros] = useState(false)
  const [ficha, setFicha] = useState<string | null>(null)
  // Orden: normal (por estación) o los de menos días de combustible / mantenimiento más cerca primero (lista plana)
  const [orden, fijarOrden] = useMemoria<OrdenGeneral>('motores-general-orden', 'normal')
  // Los motores van agrupados por estación (contraídos al abrir; cada persona recuerda cuáles dejó abiertas en su equipo)
  const [abiertos, fijarAbiertos] = useMemoria<string[]>('motores-general-abiertos', [])

  const lista = datos ?? []
  const opcionesEstaciones = useMemo(() => [...new Set(lista.map((m) => m.estacion).filter((x): x is string => Boolean(x)))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true })).map((x) => ({ valor: x, etiqueta: x })), [lista])
  const opcionesZonas = useMemo(() => [...new Set(lista.map((m) => m.zona).filter((x): x is string => Boolean(x)))].sort((a, b) => a.localeCompare(b, 'es', { numeric: true })).map((x) => ({ valor: x, etiqueta: x })), [lista])
  const visibles = useMemo(() => filtrarResumen(lista, { texto, estados, estaciones, niveles, zonas }), [lista, texto, estados, estaciones, niveles, zonas])
  const activos = [texto.trim(), estados.length, estaciones.length, niveles.length, zonas.length].filter(Boolean).length
  const grupos = useMemo(() => {
    const mapa = new Map<string, { clave: string; titulo: string; zona: string | null; motores: ResumenMotorAuditor[]; enEstacion: boolean }>()
    for (const m of visibles) {
      const enEstacion = m.estado === 'EN_ESTACION'
      const titulo = enEstacion ? (m.estacion ?? 'Sin estación') : (NOMBRE_ESTADO[m.estado] ?? m.estado)
      const clave = `${enEstacion ? 'e' : 'x'}:${titulo}`
      const g = mapa.get(clave) ?? { clave, titulo, zona: enEstacion ? (m.zona ?? null) : null, motores: [], enEstacion }
      g.motores.push(m)
      mapa.set(clave, g)
    }
    return [...mapa.values()].sort((a, b) => Number(b.enEstacion) - Number(a.enEstacion) || (a.zona ?? '').localeCompare(b.zona ?? '', 'es', { numeric: true }) || a.titulo.localeCompare(b.titulo, 'es', { numeric: true }))
  }, [visibles])
  const pronosticos = useMemo(() => new Map(visibles.map((m) => [m.equipo_id, pronosticar(m)])), [visibles])
  const ordenados = useMemo(
    () => (orden === 'normal' ? [] : [...visibles].sort((a, b) => compararPor(orden, pronosticos.get(a.equipo_id)!, pronosticos.get(b.equipo_id)!))),
    [orden, visibles, pronosticos]
  )
  const alternar = (clave: string) => fijarAbiertos(abiertos.includes(clave) ? abiertos.filter((x) => x !== clave) : [...abiertos, clave])
  // Buscando o filtrando se muestran todos los grupos abiertos (que no haga falta abrir uno por uno)
  const todosAbiertos = activos > 0

  return (
    <div className="flex flex-col gap-2" data-vista-general>
      <div className="flex items-center justify-between gap-2">
        <button type="button" onClick={() => setFiltros((v) => !v)} aria-expanded={filtros} className="min-h-11 rounded-lg px-3 text-sm font-semibold text-slate-700 ring-1 ring-inset ring-slate-300" data-filtros-general>
          Filtros{activos > 0 ? ` · ${activos} activo${activos === 1 ? '' : 's'}` : ''}
        </button>
        <span className="text-xs text-slate-500">{visibles.length} de {lista.length} motores</span>
        <Boton tamano="sm" variante="fantasma" className="min-h-11" onClick={recargar} data-actualizar-general>
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
          <SelectorMultiple etiqueta="Zona" opciones={opcionesZonas} valores={zonas} onCambiar={setZonas} />
          <SelectorMultiple etiqueta="Dónde está" opciones={Object.entries(NOMBRE_ESTADO).map(([valor, etiqueta]) => ({ valor, etiqueta }))} valores={estados} onCambiar={setEstados} />
          <SelectorMultiple etiqueta="Estación" opciones={opcionesEstaciones} valores={estaciones} onCambiar={setEstaciones} />
          <SelectorMultiple etiqueta="Semáforo" opciones={NOMBRE_NIVEL_FILTRO} valores={niveles} onCambiar={setNiveles} />
          {activos > 0 && (
            <button type="button" className="min-h-11 text-sm font-semibold text-brand-700 underline" onClick={() => { setTexto(''); setEstados([]); setEstaciones([]); setNiveles([]); setZonas([]) }}>
              Quitar filtros
            </button>
          )}
        </div>
      )}
      <div role="group" aria-label="Ordenar" className="flex flex-wrap gap-2" data-orden-general>
        {([
          ['normal', 'Por estación'],
          ['combustible', '⛽ Menos días de diésel'],
          ['mantenimiento', '🔧 Mantenimiento más cerca'],
        ] as const).map(([valor, etiqueta]) => (
          <button
            key={valor}
            type="button"
            aria-pressed={orden === valor}
            onClick={() => fijarOrden(valor)}
            data-orden={valor}
            className={`min-h-11 rounded-xl px-3 text-sm font-bold ring-2 ring-inset ${orden === valor ? 'bg-brand-700 text-white ring-brand-700' : 'bg-white text-slate-800 ring-slate-300'}`}
          >
            {orden === valor ? '✓ ' : ''}
            {etiqueta}
          </button>
        ))}
      </div>
      <EstadoConsulta cargando={cargando} error={error} vacio={visibles.length === 0} textoVacio={lista.length === 0 ? 'No hay motores.' : 'No hay motores con esos filtros.'} />
      {orden !== 'normal' && ordenados.map((m) => <FilaMotorGeneral key={m.equipo_id} m={m} p={pronosticos.get(m.equipo_id)!} resaltar={orden} onToque={() => setFicha(m.equipo_id)} />)}
      {orden === 'normal' && grupos.map((g) => {
        const abierto = todosAbiertos || abiertos.includes(g.clave)
        const nivel = peorNivel(g.motores.map((m) => m.ayuda?.nivel ?? 'gris').filter((n): n is 'rojo' | 'amarillo' | 'verde' => n === 'rojo' || n === 'amarillo' || n === 'verde'))
        return (
          <section key={g.clave} data-grupo-estacion={g.titulo} className="flex flex-col gap-2">
            <button
              type="button"
              onClick={() => alternar(g.clave)}
              aria-expanded={abierto}
              className="flex min-h-11 w-full items-center gap-2 rounded-xl bg-slate-100 px-3 text-left active:bg-slate-200"
              data-alternar-grupo
            >
              <IconChevronRight className={`h-4 w-4 shrink-0 text-slate-500 transition-transform ${abierto ? 'rotate-90' : ''}`} />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-900">
                {g.titulo}
                {g.zona ? <span className="ml-1 font-normal text-slate-600">· {g.zona}</span> : null}
              </span>
              {nivel === 'rojo' || nivel === 'amarillo' ? <InsigniaNivel nivel={nivel} /> : null}
              <span className="shrink-0 text-xs tabular-nums text-slate-600">{g.motores.length} motor{g.motores.length === 1 ? '' : 'es'}</span>
            </button>
            {abierto && g.motores.map((m) => <FilaMotorGeneral key={m.equipo_id} m={m} p={pronosticos.get(m.equipo_id)!} onToque={() => setFicha(m.equipo_id)} />)}
          </section>
        )
      })}
      {ficha && <FichaMotorAuditor equipoId={ficha} generadoPor={generadoPor} temporadas={temporadasDatos ?? []} temporadasListas={!cargandoTemp} onCerrar={() => setFicha(null)} />}
    </div>
  )
}

/** Una fila por motor: dónde está, medidor del tanque y barra de mantenimiento a la vista (sin abrir nada). */
function FilaMotorGeneral({ m, p, resaltar, onToque }: { m: ResumenMotorAuditor; p: Pronostico; resaltar?: OrdenGeneral; onToque: () => void }) {
  const nivel = m.ayuda?.nivel ?? 'gris'
  return (
    <div data-motor-auditor={m.codigo}>
      <button type="button" onClick={onToque} className="flex min-h-14 w-full items-center gap-2.5 rounded-xl bg-white py-2 pl-2.5 pr-3 text-left ring-1 ring-inset ring-slate-200 active:bg-slate-50">
        <BandaNivel nivel={nivel} />
        <span className="min-w-0 flex-1">
          <span className="flex items-start justify-between gap-2">
            <span className="block min-w-0 break-words text-[15px] font-medium leading-tight text-slate-900">{etiquetaMotor(m.codigo, m.nombre)}</span>
            {nivel !== 'gris' && <InsigniaNivel nivel={nivel} />}
          </span>
          <span className="mt-0.5 block break-words text-[13px] leading-snug text-slate-700">
            {m.estado === 'EN_ESTACION' ? (m.estacion ?? 'Sin estación') : (NOMBRE_ESTADO[m.estado] ?? m.estado)}
            {m.zona ? ` · ${m.zona}` : ''}
            {m.fecha_ultimo ? ` · último registro ${fechaCorta(m.fecha_ultimo).slice(0, 5)}` : ''}
          </span>
          <span className="mt-1.5 grid grid-cols-2 gap-3">
            <MedidorTanque saldo={m.tanque_id ? (m.saldo_gal ?? 0) : null} capacidad={m.capacidad_gal ?? null} />
            <BarraMantenimiento horas={m.horas_desde_mant ?? 0} estimadas={m.horas_est_desde_mant ?? 0} intervalo={m.intervalo_horas ?? null} aviso={m.aviso_horas ?? null} />
          </span>
          <span className="mt-1.5 grid grid-cols-2 gap-3" data-pronostico>
            <DatoPronostico
              titulo="Diésel para"
              valor={m.tanque_id ? textoDias(p.diasCombustible, 'Sin diésel') : 'Sin tanque'}
              detalle={p.galDia !== null ? `${cantidad(p.galDia)} gal/día` : null}
              alerta={p.diasCombustible !== null && p.diasCombustible < 3}
              fuerte={resaltar === 'combustible'}
              data-dias-combustible={p.diasCombustible === null ? '' : Math.floor(p.diasCombustible)}
            />
            <DatoPronostico
              titulo="Mantenimiento en"
              valor={m.intervalo_horas ? textoDias(p.diasMantenimiento) : 'Sin intervalo'}
              detalle={p.horasDia !== null ? `${cantidad(p.horasDia)} h/día` : null}
              alerta={p.diasMantenimiento !== null && p.diasMantenimiento < 7}
              fuerte={resaltar === 'mantenimiento'}
              data-dias-mantenimiento={p.diasMantenimiento === null ? '' : Math.floor(p.diasMantenimiento)}
            />
          </span>
        </span>
        <IconChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
      </button>
    </div>
  )
}

/** Un dato del pronóstico: título chico, días en grande; si es poco, en naranja con ⚠ (no solo color). */
function DatoPronostico({ titulo, valor, detalle, alerta, fuerte, ...props }: { titulo: string; valor: string; detalle: string | null; alerta: boolean; fuerte?: boolean } & Record<`data-${string}`, string | number>) {
  return (
    <span className={`block rounded-lg px-2 py-1 ring-1 ring-inset ${alerta ? 'bg-amber-50 ring-amber-300' : 'bg-slate-50 ring-slate-200'} ${fuerte ? 'ring-2' : ''}`} {...props}>
      <span className="block text-[12px] font-semibold text-slate-700">{titulo}</span>
      <span className={`block text-base font-extrabold leading-tight ${alerta ? 'text-amber-800' : 'text-slate-900'}`}>
        {alerta ? '⚠ ' : ''}
        {valor}
      </span>
      {detalle && <span className="block text-[12px] text-slate-600">{detalle}</span>}
    </span>
  )
}

function FichaMotorAuditor({ equipoId, generadoPor, temporadas, temporadasListas, onCerrar }: { equipoId: string; generadoPor: string; temporadas: TemporadaInfo[]; temporadasListas: boolean; onCerrar: () => void }) {
  // Temporada: la activa por defecto; las anteriores o «todo el historial» se piden aquí (sql/149)
  const [temporadaId, setTemporadaId] = useState('')
  const temporada = useMemo(() => (temporadaId === 'todo' ? null : (temporadas.find((t) => t.id === temporadaId) ?? temporadas.find((t) => t.activa) ?? null)), [temporadas, temporadaId])
  const [desde, setDesde] = useState('')
  const [hasta, setHasta] = useState('')
  const [estaciones, setEstaciones] = useState<string[]>([])
  const [codigosSenal, setCodigosSenal] = useState<string[]>([])
  const [limite, setLimite] = useState(40)
  const [abierta, setAbierta] = useState<string | null>(null)
  const [vista, setVista] = useState<VistaHistorial>('lista')
  const argumentos = useMemo(
    () => ({ p_equipo: equipoId, p_desde: desde || temporada?.fecha_inicio || null, p_hasta: hasta || temporada?.fecha_fin || null }),
    [equipoId, desde, hasta, temporada]
  )
  const { datos, cargando, error, recargar } = useLlamadaRpc<FichaMotor>('fn_mot_ficha_completa', argumentos, temporadasListas)
  const argumentosResumen = useMemo(() => ({ p_temporada: temporada?.id ?? null }), [temporada])
  const { datos: resumenSrv } = useLlamadaRpc<ResumenTemporadaServidor>('fn_mot_resumen_temporada', argumentosResumen, temporadasListas && temporadaId !== 'todo')

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
  const cifras = useMemo<CifrasTemporada | null>(() => {
    if (!datos) return null
    if (temporadaId === 'todo' || !resumenSrv) return resumirRegistros(datos.registros)
    return resumenSrv.motores.find((x) => x.equipo_id === equipoId) ?? resumirRegistros([])
  }, [datos, resumenSrv, temporadaId, equipoId])
  const tramosResumen = temporadaId === 'todo' ? [] : (resumenSrv?.motores.find((x) => x.equipo_id === equipoId)?.tramos ?? [])
  const opcionesTemporada = useMemo(() => [...temporadas.map((t) => ({ id: t.id, titulo: t.nombre, subtitulo: t.activa ? 'Activa' : undefined })), { id: 'todo', titulo: 'Todo el historial' }], [temporadas])
  const filasTabla = useMemo(() => filasDeHoja(registros, {}, senalesDe), [registros, senalesDe])
  /** PDF: una sección por estación donde estuvo el motor (con su zona y tanque). */
  const exportar = (formato: 'pdf' | 'excel') => {
    if (!m) return
    const tramoDe = new Map((datos?.tramos ?? []).filter((t) => t.estacion_id).map((t) => [t.estacion_id as string, t]))
    const ids = [...new Set(registros.map((r) => r.estacion_id ?? ''))]
    const secciones = ids.map((id) => {
      const t = id ? tramoDe.get(id) : undefined
      return { motor: etiquetaMotor(m.codigo, m.nombre), estacion: t?.estacion ?? m.estacion, zona: t?.zona ?? null, tanque: t?.tanque ?? null, filas: filasDeHoja(registros.filter((r) => (r.estacion_id ?? '') === id), {}, senalesDe) }
    })
    descargarHoja(formato, { secciones, desde, hasta, generadoPor, generadoEn: formatearFechaHora(new Date().toISOString()) }, `Motor_${m.codigo}`)
  }

  return (
    <Modal abierto ancho="ancho" titulo={`Ficha · ${m?.codigo ?? ''}`} onCerrar={onCerrar}>
      <div className="flex flex-col gap-2" data-ficha-auditor>
        <EstadoConsulta cargando={cargando || !temporadasListas} error={error} vacio={!datos} textoVacio="Sin datos." />
        {datos && m && (
          <>
            <p className="text-xs text-slate-600">
              {m.nombre}
              {m.modelo ? ` · ${m.modelo}` : ''} · {m.estacion ?? NOMBRE_ESTADO[m.estado] ?? m.estado}
              {m.horo_ultimo !== null ? ` · horómetro ${cantidad(m.horo_ultimo)}` : ''}
            </p>
            <div data-selector-temporada>
              <SelectorBuscable
                valor={temporadaId === 'todo' ? 'todo' : (temporada?.id ?? '')}
                opciones={opcionesTemporada}
                onCambiar={setTemporadaId}
                placeholder="Temporada…"
                etiquetaBusqueda="Buscar temporada"
                permitirVacio={false}
              />
            </div>
            <ResumenTemporada cifras={cifras} subtitulo={temporadaId === 'todo' ? 'Todo el historial' : (temporada?.nombre ?? '')}>
              {tramosResumen.length > 1 && (
                <ul className="mt-2 flex flex-col gap-1 border-t border-slate-100 pt-2" data-resumen-tramos>
                  {tramosResumen.map((t) => (
                    <li key={t.id} className="flex items-baseline justify-between gap-2 text-xs text-slate-700">
                      <span className="min-w-0 truncate">{t.estacion ?? 'Estación'}{t.zona ? ` · ${t.zona}` : ''}</span>
                      <span className="shrink-0 tabular-nums">{cantidad(t.horas)} h · {cantidad(t.gal_gastados)} gal{t.rendimiento_gal_h === null ? '' : ` · ${cantidad(t.rendimiento_gal_h)} gal/h`}</span>
                    </li>
                  ))}
                </ul>
              )}
            </ResumenTemporada>
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
            <BarraVistaHistorial vista={vista} onVista={setVista} onExportar={exportar} puedeExportar={registros.length > 0} />
            {registros.length === 0 && <p className="rounded-xl bg-slate-50 p-4 text-center text-sm text-slate-500 ring-1 ring-inset ring-slate-200">Nada con esos filtros.</p>}
            {vista === 'tabla' && registros.length > 0 && <HojaMotor titulo={etiquetaMotor(m.codigo, m.nombre)} filas={filasTabla} />}
            {vista === 'lista' && registros.slice(0, limite).map((r) => (
              <FilaRegistroFicha key={r.id} r={r} equipoId={m.equipo_id} senales={senalesDe.get(r.id) ?? []} abierta={abierta === r.id} onToque={() => setAbierta((a) => (a === r.id ? null : r.id))} />
            ))}
            {vista === 'lista' && registros.length > limite && (
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
