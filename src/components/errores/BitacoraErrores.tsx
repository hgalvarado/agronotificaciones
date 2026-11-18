'use client'

/**
 * Administración › Bitácora de errores (sql/118).
 *
 * Arriba: tarjetas de resumen. Después «Lo que NO se registró» (rechazos del servidor y pendientes que no han
 * llegado), la lista de usuarios con semáforo de salud y la LÍNEA DE TIEMPO (de todos o del usuario elegido) con
 * filtros. Cada entrada abre el INFORME: diagnóstico (src/lib/errores/diagnostico.ts), datos técnicos copiables y,
 * si se tiene permiso, «Marcar atendido» con nota. Se actualiza sola cada minuto y con el botón «Actualizar».
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Alerta, Boton, Campo, Entrada, Insignia, Tarjeta, type Tono } from '@/components/ui/Primitivos'
import { Modal } from '@/components/ui/Modal'
import { SelectorBuscable } from '@/components/ui/SelectorBuscable'
import { mensajeDeError } from '@/lib/errores'
import { diagnosticar, diagnosticarLatido, semaforo, textoDelInforme, type Diagnostico, type EntradaDiagnostico, type Gravedad } from '@/lib/errores/diagnostico'
import { construirXlsxHojas, descargar, type CeldaHoja } from '@/lib/hojas'
import { hoyIso, sumarDias } from '@/lib/fechas/zona'

type Resumen = {
  usuario_id: string
  nombre: string
  ultimo_latido: string | null
  version_app: string | null
  pendientes: number | null
  pendiente_mas_viejo_h: number | null
  ultima_sync_ok: string | null
  en_linea: boolean | null
  desfase_reloj_s: number | null
  errores_7d: number
  graves_nuevos: number
  errores_hoy: number
  rechazos_7d: number
  rechazos_hoy: number
}

type ErrorFila = {
  id: string
  usuario_id: string
  usuario: string
  creado_en: string
  ultima_vez: string
  repeticiones: number
  origen: string
  modulo: string | null
  ruta: string | null
  severidad: Gravedad
  codigo: string | null
  mensaje: string
  detalle: Record<string, unknown>
  estado: 'nuevo' | 'visto' | 'atendido'
  nota_admin: string | null
  atendido_at: string | null
  atendido_por: string | null
}

type OpFallida = {
  id: string
  usuario_id: string
  usuario: string
  tipo: string
  estacion_id: string | null
  estacion: string | null
  resultado: 'RECHAZADO' | 'ACEPTADO_CON_OBSERVACIONES' | 'ACEPTADO'
  mensaje: string | null
  observaciones: string[] | null
  creado_en: string | null
  enviado_en: string | null
  recibido_en: string
  demora_s: number | null
  inmediato: boolean
  dispositivo: string | null
  datos_resumen: string | null
}

type Entrada_ = {
  clave: string
  tipo: 'error' | 'operacion' | 'salud'
  usuario_id: string
  usuario: string
  cuando: string
  gravedad: Gravedad
  modulo: string
  titulo: string
  estado: string
  repeticiones: number
  entrada: EntradaDiagnostico
  diag: Diagnostico
  error?: ErrorFila
  op?: OpFallida
}

const TONO_GRAVEDAD: Record<Gravedad, Tono> = { info: 'gris', aviso: 'ambar', error: 'rojo', critico: 'rojo' }
const TEXTO_GRAVEDAD: Record<Gravedad, string> = { info: 'Informativo', aviso: 'Aviso', error: 'Error', critico: 'Crítico' }
const TONO_SEMAFORO = { verde: 'verde', ambar: 'ambar', rojo: 'rojo', gris: 'gris' } as const
const TEXTO_SEMAFORO = { verde: 'Sano', ambar: 'Revisar', rojo: 'Actuar', gris: 'Sin datos' } as const
const NOMBRE_TIPO: Record<string, string> = {
  recepcion: 'Recepción', aplicacion: 'Aplicación', aplicacion_historica: 'Aplicación histórica', bitacora: 'Bitácora de riego',
  conteo: 'Conteo', devolucion: 'Devolución', anulacion: 'Anulación', chofer: 'Chofer nuevo', vehiculo: 'Vehículo nuevo',
  relevo_entregar: 'Entrega de estación', relevo_recibir: 'Recepción de estación', traslado_crear: 'Traslado',
}
const PESO: Record<Gravedad, number> = { info: 0, aviso: 1, error: 2, critico: 3 }

const fechaHora = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('es-HN', { timeZone: 'America/Tegucigalpa', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
const hace = (iso: string | null | undefined) => {
  if (!iso) return 'nunca'
  const h = (Date.now() - new Date(iso).getTime()) / 3_600_000
  if (h < 1) return `hace ${Math.max(1, Math.round(h * 60))} min`
  if (h < 48) return `hace ${Math.round(h)} h`
  return `hace ${Math.round(h / 24)} días`
}
const inicioDia = (d: string) => `${d}T00:00:00-06:00`

export function BitacoraErrores({ versionActual, puedeAtender, puedeExportar }: { versionActual: string; puedeAtender: boolean; puedeExportar: boolean }) {
  const supabase = useMemo(() => createClient(), [])
  const [desde, setDesde] = useState(() => sumarDias(hoyIso(), -14))
  const [hasta, setHasta] = useState(() => hoyIso())
  const [usuario, setUsuario] = useState('')
  const [gravedades, setGravedades] = useState<Gravedad[]>([])
  const [modulo, setModulo] = useState('')
  const [estado, setEstado] = useState('')
  const [orden, setOrden] = useState<'urgentes' | 'nombre' | 'sync' | 'errores'>('urgentes')
  const [resumen, setResumen] = useState<Resumen[] | null>(null)
  const [errores, setErrores] = useState<ErrorFila[]>([])
  const [ops, setOps] = useState<OpFallida[]>([])
  const [cargando, setCargando] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sinMigracion, setSinMigracion] = useState(false)
  const [abierta, setAbierta] = useState<Entrada_ | null>(null)
  const [ahora, setAhora] = useState(() => new Date())

  const cargar = useCallback(
    async (silencioso = false) => {
      if (!silencioso) setCargando(true)
      const desdeIso = inicioDia(desde)
      const hastaIso = inicioDia(sumarDias(hasta, 1))
      const [r, l, o] = await Promise.all([
        supabase.rpc('fn_errores_resumen_por_usuario'),
        supabase.rpc('fn_errores_listar', { p_filtros: { desde: desdeIso, hasta: hastaIso, limite: 500, ...(usuario ? { usuario } : {}) } }),
        supabase.rpc('fn_errores_operaciones_fallidas', { p_desde: desdeIso, p_hasta: hastaIso, p_usuario: usuario || null, p_solo_rechazadas: false }),
      ])
      const fallo = r.error ?? l.error ?? o.error
      if (fallo) {
        if (fallo.code === '42883' || fallo.code === 'PGRST202' || /could not find the function/i.test(fallo.message ?? '')) setSinMigracion(true)
        else setError(mensajeDeError(fallo, 'No se pudo leer la bitácora.'))
      } else {
        setError(null)
        setSinMigracion(false)
        setResumen((r.data as Resumen[] | null) ?? [])
        setErrores((l.data as ErrorFila[] | null) ?? [])
        setOps((o.data as OpFallida[] | null) ?? [])
        setAhora(new Date())
      }
      setCargando(false)
    },
    [supabase, desde, hasta, usuario]
  )

  useEffect(() => {
    // La carga inicial va en una microtarea (no dentro del propio efecto)
    void Promise.resolve().then(() => cargar())
  }, [cargar])

  // Se actualiza sola: cada minuto y al volver a la pestaña
  useEffect(() => {
    const reloj = setInterval(() => document.visibilityState === 'visible' && void cargar(true), 60_000)
    const alVolver = () => document.visibilityState === 'visible' && void cargar(true)
    document.addEventListener('visibilitychange', alVolver)
    return () => {
      clearInterval(reloj)
      document.removeEventListener('visibilitychange', alVolver)
    }
  }, [cargar])


  /** Salud de cada persona (semáforo + problemas detectados sin que hubiera error). */
  const salud = useMemo(
    () =>
      (resumen ?? []).map((u) => ({
        u,
        semaforo: semaforo(u, ahora, versionActual),
        problemas: diagnosticarLatido(u, ahora, versionActual),
      })),
    [resumen, ahora, versionActual]
  )

  /** Todo en una sola línea de tiempo. */
  const entradas = useMemo<Entrada_[]>(() => {
    const out: Entrada_[] = []
    for (const e of errores) {
      const entrada: EntradaDiagnostico = { origen: e.origen, codigo: e.codigo, mensaje: e.mensaje, modulo: e.modulo, detalle: e.detalle }
      const diag = diagnosticar(entrada)
      out.push({
        clave: `e:${e.id}`, tipo: 'error', usuario_id: e.usuario_id, usuario: e.usuario, cuando: e.ultima_vez,
        gravedad: PESO[e.severidad] >= PESO[diag.gravedad] ? e.severidad : diag.gravedad,
        modulo: e.modulo ?? '—', titulo: diag.titulo, estado: e.estado, repeticiones: e.repeticiones, entrada, diag, error: e,
      })
    }
    for (const o of ops) {
      const entrada: EntradaDiagnostico = { origen: 'servidor', mensaje: o.mensaje, resultado: o.resultado, observaciones: o.observaciones, tipoOperacion: o.tipo, modulo: 'fertirriego' }
      const diag = diagnosticar(entrada)
      out.push({
        clave: `o:${o.id}`, tipo: 'operacion', usuario_id: o.usuario_id, usuario: o.usuario, cuando: o.recibido_en,
        gravedad: o.resultado === 'RECHAZADO' ? (PESO[diag.gravedad] >= 2 ? diag.gravedad : 'error') : diag.gravedad,
        modulo: 'fertirriego', titulo: `${o.resultado === 'RECHAZADO' ? 'No se registró' : 'Con observaciones'}: ${NOMBRE_TIPO[o.tipo] ?? o.tipo} · ${diag.titulo}`,
        estado: o.resultado === 'RECHAZADO' ? 'rechazada' : 'observada', repeticiones: 1, entrada, diag, op: o,
      })
    }
    for (const s of salud) {
      if (usuario && s.u.usuario_id !== usuario) continue
      for (const d of s.problemas) {
        out.push({
          clave: `s:${s.u.usuario_id}:${d.clave}`, tipo: 'salud', usuario_id: s.u.usuario_id, usuario: s.u.nombre,
          cuando: s.u.ultimo_latido ?? new Date().toISOString(), gravedad: d.gravedad, modulo: 'salud', titulo: d.titulo,
          estado: 'vigente', repeticiones: 1, entrada: { origen: 'otro', mensaje: d.titulo, modulo: 'salud', detalle: { ...s.u } as unknown as Record<string, unknown> }, diag: d,
        })
      }
    }
    return out.sort((a, b) => b.cuando.localeCompare(a.cuando))
  }, [errores, ops, salud, usuario])

  const modulos = useMemo(() => [...new Set(entradas.map((e) => e.modulo))].sort(), [entradas])
  const filtradas = useMemo(
    () =>
      entradas.filter(
        (e) =>
          (!usuario || e.usuario_id === usuario) &&
          (gravedades.length === 0 || gravedades.includes(e.gravedad)) &&
          (!modulo || e.modulo === modulo) &&
          (!estado || e.estado === estado)
      ),
    [entradas, usuario, gravedades, modulo, estado]
  )

  const noRegistradas = useMemo(
    () => ({
      rechazos: ops.filter((o) => o.resultado === 'RECHAZADO' && (!usuario || o.usuario_id === usuario)),
      pendientes: salud.filter((s) => (!usuario || s.u.usuario_id === usuario) && (s.u.pendientes ?? 0) > 0 && (s.u.pendiente_mas_viejo_h ?? 0) >= 6),
    }),
    [ops, salud, usuario]
  )

  const tarjetas = useMemo(() => {
    const r = resumen ?? []
    return {
      conProblemasHoy: r.filter((u) => u.errores_hoy > 0 || u.rechazos_hoy > 0).length,
      noRegistradas: noRegistradas.rechazos.length,
      pendientesViejos: salud.filter((s) => (s.u.pendientes ?? 0) > 0 && (s.u.pendiente_mas_viejo_h ?? 0) >= 6).length,
      gravesNuevos: r.reduce((n, u) => n + u.graves_nuevos, 0),
    }
  }, [resumen, salud, noRegistradas])

  const usuariosOrdenados = useMemo(() => {
    const rango = { rojo: 0, ambar: 1, verde: 2, gris: 3 } as const
    const l = [...salud]
    l.sort((a, b) => {
      if (orden === 'nombre') return a.u.nombre.localeCompare(b.u.nombre)
      if (orden === 'sync') return (a.u.ultima_sync_ok ?? '').localeCompare(b.u.ultima_sync_ok ?? '')
      if (orden === 'errores') return b.u.errores_7d - a.u.errores_7d
      return rango[a.semaforo] - rango[b.semaforo] || b.u.graves_nuevos - a.u.graves_nuevos || a.u.nombre.localeCompare(b.u.nombre)
    })
    return l
  }, [salud, orden])

  const opcionesUsuario = useMemo(() => (resumen ?? []).map((u) => ({ id: u.usuario_id, titulo: u.nombre })).sort((a, b) => a.titulo.localeCompare(b.titulo)), [resumen])

  function exportar() {
    const filasErrores: CeldaHoja[][] = [
      ['Fecha (UTC-6)', 'Usuario', 'Tipo', 'Gravedad', 'Módulo', 'Problema', 'Estado', 'Repeticiones', 'Qué pasó', 'Causa probable', 'Qué hacer (usuario)', 'Qué hacer (administrador)', '¿Se perdió algo?'],
      ...filtradas.map((e) => [
        fechaHora(e.cuando), e.usuario, e.tipo, TEXTO_GRAVEDAD[e.gravedad], e.modulo, e.titulo, e.estado, e.repeticiones,
        e.diag.quePaso, e.diag.causa, e.diag.alUsuario, e.diag.alAdministrador, e.diag.seperdio === 'si' ? 'Sí' : e.diag.seperdio === 'no' ? 'No' : 'Por verificar',
      ]),
    ]
    const filasNo: CeldaHoja[][] = [
      ['Recibida (UTC-6)', 'Capturada (UTC-6)', 'Usuario', 'Operación', 'Estación', 'Motivo del rechazo'],
      ...noRegistradas.rechazos.map((o) => [fechaHora(o.recibido_en), fechaHora(o.creado_en), o.usuario, NOMBRE_TIPO[o.tipo] ?? o.tipo, o.estacion ?? '', o.mensaje ?? '']),
    ]
    const filasUsu: CeldaHoja[][] = [
      ['Usuario', 'Semáforo', 'Último latido', 'Última sincronización', 'Pendientes', 'Pendiente más viejo (h)', 'Versión', 'Errores 7 días', 'Rechazos 7 días'],
      ...usuariosOrdenados.map((s) => [s.u.nombre, TEXTO_SEMAFORO[s.semaforo], fechaHora(s.u.ultimo_latido), fechaHora(s.u.ultima_sync_ok), s.u.pendientes ?? 0, s.u.pendiente_mas_viejo_h ?? '', s.u.version_app ?? '', s.u.errores_7d, s.u.rechazos_7d]),
    ]
    descargar(construirXlsxHojas([{ nombre: 'Línea de tiempo', filas: filasErrores }, { nombre: 'No registradas', filas: filasNo }, { nombre: 'Usuarios', filas: filasUsu }]), `bitacora-errores-${hoyIso()}.xlsx`)
  }

  if (sinMigracion) {
    return <Alerta tono="ambar">Falta correr la migración 118 en esta base de datos. Cuando se corra, esta pantalla empieza a mostrar la bitácora.</Alerta>
  }

  return (
    <div className="flex flex-col gap-4" data-bitacora-errores>
      <div className="flex flex-wrap items-center gap-2">
        <Boton variante="secundario" onClick={() => void cargar()} disabled={cargando} data-actualizar>
          {cargando ? 'Actualizando…' : 'Actualizar'}
        </Boton>
        {puedeExportar && (
          <Boton variante="secundario" onClick={exportar} disabled={cargando} data-exportar>
            Exportar
          </Boton>
        )}
      </div>

      {error && <Alerta>{error}</Alerta>}

      {/* Tarjetas de resumen */}
      <div className="grid grid-cols-1 gap-2 min-[420px]:grid-cols-2" data-tarjetas>
        <TarjetaDato titulo="Usuarios con problemas hoy" valor={tarjetas.conProblemasHoy} tono={tarjetas.conProblemasHoy ? 'ambar' : 'verde'} dato="tarjeta-hoy" />
        <TarjetaDato titulo="Operaciones que NO se registraron" valor={tarjetas.noRegistradas} tono={tarjetas.noRegistradas ? 'rojo' : 'verde'} dato="tarjeta-no-registradas" />
        <TarjetaDato titulo="Pendientes viejos sin sincronizar" valor={tarjetas.pendientesViejos} tono={tarjetas.pendientesViejos ? 'rojo' : 'verde'} dato="tarjeta-pendientes" />
        <TarjetaDato titulo="Errores graves nuevos" valor={tarjetas.gravesNuevos} tono={tarjetas.gravesNuevos ? 'rojo' : 'verde'} dato="tarjeta-graves" />
      </div>

      {/* Filtros */}
      <Tarjeta className="flex flex-col gap-3 p-4">
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
          <Campo etiqueta="Desde">
            <Entrada type="date" value={desde} max={hasta} onChange={(e) => e.target.value && setDesde(e.target.value)} data-desde />
          </Campo>
          <Campo etiqueta="Hasta">
            <Entrada type="date" value={hasta} min={desde} onChange={(e) => e.target.value && setHasta(e.target.value)} data-hasta />
          </Campo>
        </div>
        <Campo etiqueta="Usuario">
          <SelectorBuscable valor={usuario} opciones={opcionesUsuario} onCambiar={setUsuario} placeholder="Todos los usuarios" etiquetaBusqueda="Buscar usuario" textoVacio="Todos los usuarios" />
        </Campo>
        <div>
          <p className="mb-1 text-sm font-semibold text-slate-700">Gravedad</p>
          <div className="flex flex-wrap gap-2">
            {(['critico', 'error', 'aviso', 'info'] as Gravedad[]).map((g) => {
              const on = gravedades.includes(g)
              return (
                <button
                  key={g}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setGravedades((x) => (on ? x.filter((y) => y !== g) : [...x, g]))}
                  className={`min-h-11 rounded-xl border px-3 text-sm font-semibold ${on ? 'border-brand-700 bg-brand-50 text-brand-800' : 'border-slate-200 bg-white text-slate-600'}`}
                  data-gravedad={g}
                >
                  {TEXTO_GRAVEDAD[g]}
                </button>
              )
            })}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
          <Campo etiqueta="Módulo">
            <SelectorBuscable valor={modulo} opciones={modulos.map((m) => ({ id: m, titulo: m }))} onCambiar={setModulo} placeholder="Todos" etiquetaBusqueda="Buscar módulo" textoVacio="Todos" />
          </Campo>
          <Campo etiqueta="Estado">
            <SelectorBuscable
              valor={estado}
              opciones={[
                { id: 'nuevo', titulo: 'Nuevo' }, { id: 'visto', titulo: 'Visto' }, { id: 'atendido', titulo: 'Atendido' },
                { id: 'rechazada', titulo: 'Operación rechazada' }, { id: 'observada', titulo: 'Operación con observaciones' }, { id: 'vigente', titulo: 'Señal de salud vigente' },
              ]}
              onCambiar={setEstado}
              placeholder="Todos"
              etiquetaBusqueda="Buscar estado"
              textoVacio="Todos"
            />
          </Campo>
        </div>
      </Tarjeta>

      {/* Lo que NO se registró */}
      <section data-no-registrado>
        <h2 className="mb-2 break-words text-base font-bold text-slate-900">Lo que NO se registró</h2>
        {noRegistradas.rechazos.length === 0 && noRegistradas.pendientes.length === 0 ? (
          <Alerta tono="azul">Nada pendiente en este periodo: ninguna operación fue rechazada y no hay registros viejos sin enviar.</Alerta>
        ) : (
          <ul className="flex flex-col gap-2">
            {noRegistradas.pendientes.map((s) => (
              <li key={`p${s.u.usuario_id}`} className="rounded-xl border border-red-200 bg-red-50 p-3" data-no-registrado-fila>
                <p className="break-words text-sm font-bold text-red-800">
                  {s.u.nombre}: {s.u.pendientes} registro(s) sin llegar al servidor
                </p>
                <p className="break-words text-xs text-red-700">
                  El más viejo lleva {Math.round(s.u.pendiente_mas_viejo_h ?? 0)} h guardado en su teléfono. Para el sistema todavía no existe.
                </p>
              </li>
            ))}
            {noRegistradas.rechazos.map((o) => {
              const e = entradas.find((x) => x.clave === `o:${o.id}`)
              return (
                <li key={o.id} className="rounded-xl border border-red-200 bg-white p-3" data-no-registrado-fila>
                  <p className="break-words text-sm font-bold text-slate-900">
                    {o.usuario} · {NOMBRE_TIPO[o.tipo] ?? o.tipo}
                    {o.estacion ? ` · ${o.estacion}` : ''}
                  </p>
                  <p className="text-xs text-slate-500">Capturada {fechaHora(o.creado_en)} · recibida {fechaHora(o.recibido_en)}</p>
                  <p className="break-words text-xs text-red-700">{o.mensaje}</p>
                  {e && (
                    <button type="button" onClick={() => setAbierta(e)} className="mt-1 min-h-11 text-sm font-bold text-brand-700 underline" data-ver-informe>
                      Ver informe
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {/* Usuarios */}
      <section data-usuarios>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="break-words text-base font-bold text-slate-900">Salud por usuario</h2>
          <div className="w-52 max-w-full">
            <SelectorBuscable
              valor={orden}
              opciones={[
                { id: 'urgentes', titulo: 'Más urgentes primero' }, { id: 'nombre', titulo: 'Nombre' },
                { id: 'sync', titulo: 'Sincronizó hace más tiempo' }, { id: 'errores', titulo: 'Más errores (7 días)' },
              ]}
              onCambiar={(v) => v && setOrden(v as typeof orden)}
              permitirVacio={false}
              etiquetaBusqueda="Ordenar por"
            />
          </div>
        </div>
        {cargando && !resumen ? (
          <p className="text-sm text-slate-500">Cargando…</p>
        ) : usuariosOrdenados.length === 0 ? (
          <Alerta tono="azul">Todavía no hay latidos ni errores. Aparecen cuando alguien abre la aplicación con la versión nueva.</Alerta>
        ) : (
          <ul className="flex flex-col gap-2">
            {usuariosOrdenados.map((s) => (
              <li key={s.u.usuario_id}>
                <button
                  type="button"
                  onClick={() => setUsuario(usuario === s.u.usuario_id ? '' : s.u.usuario_id)}
                  className={`flex w-full min-h-11 flex-col gap-1 rounded-xl border p-3 text-left ${usuario === s.u.usuario_id ? 'border-brand-700 bg-brand-50' : 'border-slate-200 bg-white'}`}
                  data-usuario-fila
                >
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="break-words text-sm font-bold text-slate-900">{s.u.nombre}</span>
                    <Insignia tono={TONO_SEMAFORO[s.semaforo]} punto>
                      {TEXTO_SEMAFORO[s.semaforo]}
                    </Insignia>
                  </span>
                  <span className="break-words text-xs text-slate-600">
                    Última sincronización: {s.u.ultima_sync_ok ? hace(s.u.ultima_sync_ok) : 'sin datos'} · Pendientes: {s.u.pendientes ?? 0}
                    {s.u.pendiente_mas_viejo_h ? ` (el más viejo ${Math.round(s.u.pendiente_mas_viejo_h)} h)` : ''}
                  </span>
                  <span className="break-words text-xs text-slate-500">
                    Versión: {s.u.version_app ?? '—'} · Errores 7 días: {s.u.errores_7d} · Rechazos 7 días: {s.u.rechazos_7d} · Visto {hace(s.u.ultimo_latido)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Línea de tiempo */}
      <section data-linea-tiempo>
        <h2 className="mb-2 break-words text-base font-bold text-slate-900">
          Línea de tiempo{usuario ? ` de ${opcionesUsuario.find((o) => o.id === usuario)?.titulo ?? ''}` : ''}
          <span className="ml-2 text-sm font-normal text-slate-500">({filtradas.length})</span>
        </h2>
        {filtradas.length === 0 ? (
          <Alerta tono="azul">No hay registros con estos filtros.</Alerta>
        ) : (
          <ul className="flex flex-col gap-2">
            {filtradas.slice(0, 300).map((e) => (
              <li key={e.clave}>
                <button
                  type="button"
                  onClick={() => setAbierta(e)}
                  className="flex w-full min-h-11 flex-col gap-1 rounded-xl border border-slate-200 bg-white p-3 text-left"
                  data-entrada
                  data-gravedad-entrada={e.gravedad}
                >
                  <span className="flex flex-wrap items-center gap-2">
                    <Insignia tono={TONO_GRAVEDAD[e.gravedad]}>{TEXTO_GRAVEDAD[e.gravedad]}</Insignia>
                    {e.tipo === 'error' && e.estado !== 'atendido' && <Insignia tono={e.estado === 'nuevo' ? 'azul' : 'gris'}>{e.estado}</Insignia>}
                    {e.tipo === 'error' && e.estado === 'atendido' && <Insignia tono="verde">atendido</Insignia>}
                    {e.repeticiones > 1 && <Insignia tono="gris">{e.repeticiones} veces</Insignia>}
                  </span>
                  <span className="break-words text-sm font-bold text-slate-900">{e.titulo}</span>
                  <span className="break-words text-xs text-slate-600">
                    {e.usuario} · {e.modulo} · {fechaHora(e.cuando)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {abierta && <InformeModal entrada={abierta} puedeAtender={puedeAtender} onCerrar={() => setAbierta(null)} onCambio={() => void cargar(true)} />}
    </div>
  )
}

function TarjetaDato({ titulo, valor, tono, dato }: { titulo: string; valor: number; tono: Tono; dato: string }) {
  return (
    <div data-tarjeta={dato}>
      <Tarjeta className="flex h-full flex-col gap-1 p-3">
        <span className="break-words text-xs font-semibold text-slate-500">{titulo}</span>
        <span className="flex items-center gap-2">
          <span className="text-2xl font-bold text-slate-900" data-valor>
            {valor}
          </span>
          <Insignia tono={tono} punto>
            {valor === 0 ? 'Bien' : 'Revisar'}
          </Insignia>
        </span>
      </Tarjeta>
    </div>
  )
}

function Seccion({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-slate-400">{titulo}</p>
      <p className="break-words text-sm text-slate-800">{texto}</p>
    </div>
  )
}

function InformeModal({ entrada, puedeAtender, onCerrar, onCambio }: { entrada: Entrada_; puedeAtender: boolean; onCerrar: () => void; onCambio: () => void }) {
  const supabase = useMemo(() => createClient(), [])
  const [nota, setNota] = useState(entrada.error?.nota_admin ?? '')
  const [trabajando, setTrabajando] = useState(false)
  const [mensaje, setMensaje] = useState<string | null>(null)
  const [fallo, setFallo] = useState<string | null>(null)
  const { diag, error, op } = entrada

  const texto = useMemo(
    () =>
      textoDelInforme(entrada.entrada, diag, {
        Usuario: entrada.usuario,
        Cuándo: fechaHora(entrada.cuando),
        Repeticiones: entrada.repeticiones,
        Ruta: error?.ruta,
        'Primera vez': error ? fechaHora(error.creado_en) : undefined,
        Operación: op?.id,
        Estación: op?.estacion,
        'Capturada en el teléfono': op ? fechaHora(op.creado_en) : undefined,
        'Recibida en el servidor': op ? fechaHora(op.recibido_en) : undefined,
        Dispositivo: op?.dispositivo,
      }),
    [entrada, diag, error, op]
  )

  // Al abrir un error nuevo se marca como «visto» (si se tiene permiso de atender)
  useEffect(() => {
    if (puedeAtender && error && error.estado === 'nuevo') {
      void supabase.rpc('fn_errores_marcar', { p_ids: [error.id], p_estado: 'visto', p_nota: null }).then(({ error: e }) => {
        if (!e) onCambio()
      })
    }
    // solo al abrir
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function marcar(nuevo: 'visto' | 'atendido' | 'nuevo') {
    if (!error) return
    setTrabajando(true)
    setFallo(null)
    const { error: e } = await supabase.rpc('fn_errores_marcar', { p_ids: [error.id], p_estado: nuevo, p_nota: nota.trim() || null })
    setTrabajando(false)
    if (e) return setFallo(mensajeDeError(e, 'No se pudo marcar.'))
    setMensaje(nuevo === 'atendido' ? 'Marcado como atendido.' : nuevo === 'visto' ? 'Marcado como visto.' : 'Vuelto a «nuevo».')
    onCambio()
  }

  async function copiar() {
    try {
      await navigator.clipboard.writeText(texto)
      setMensaje('Informe copiado.')
    } catch {
      setMensaje('No se pudo copiar: selecciona el texto de abajo y cópialo a mano.')
    }
  }

  return (
    <Modal abierto onCerrar={onCerrar} titulo="Informe del problema" ancho="ancho">
      <div className="flex flex-col gap-3" data-informe>
        <div className="flex flex-wrap items-center gap-2">
          <Insignia tono={TONO_GRAVEDAD[entrada.gravedad]}>{TEXTO_GRAVEDAD[entrada.gravedad]}</Insignia>
          <Insignia tono={diag.seperdio === 'si' ? 'rojo' : diag.seperdio === 'no' ? 'verde' : 'ambar'}>
            {diag.seperdio === 'si' ? 'Se perdió un registro' : diag.seperdio === 'no' ? 'No se perdió nada' : 'Por verificar si se perdió algo'}
          </Insignia>
        </div>
        <h3 className="break-words text-lg font-bold text-slate-900">{diag.titulo}</h3>
        <p className="break-words text-xs text-slate-500">
          {entrada.usuario} · {fechaHora(entrada.cuando)}
          {entrada.repeticiones > 1 ? ` · ${entrada.repeticiones} veces` : ''}
        </p>
        <Seccion titulo="Qué pasó" texto={diag.quePaso} />
        <Seccion titulo="Causa probable" texto={diag.causa} />
        <Seccion titulo="Por qué ocurre" texto={diag.porQue} />
        <Seccion titulo="Qué le toca al usuario" texto={diag.alUsuario} />
        <Seccion titulo="Qué le toca al administrador" texto={diag.alAdministrador} />
        <Seccion titulo="Cómo verificarlo" texto={diag.comoVerificar} />

        {op && (
          <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-700" data-operacion>
            <p className="font-bold">Operación afectada</p>
            <p className="break-all">Identificador: {op.id}</p>
            <p className="break-words">
              {NOMBRE_TIPO[op.tipo] ?? op.tipo}
              {op.estacion ? ` · ${op.estacion}` : ''} · {op.resultado.toLowerCase().replace(/_/g, ' ')}
            </p>
            <p>Capturada: {fechaHora(op.creado_en)} · Recibida: {fechaHora(op.recibido_en)}</p>
            {op.demora_s != null && op.demora_s > 120 && <p>Tardó {Math.round(op.demora_s / 60)} min en llegar (se capturó sin señal).</p>}
            {op.datos_resumen && <p className="mt-1 break-all text-slate-500">{op.datos_resumen.slice(0, 500)}</p>}
          </div>
        )}

        <details className="rounded-xl border border-slate-200 p-3">
          <summary className="min-h-11 cursor-pointer text-sm font-bold text-slate-700">Datos técnicos (copiables)</summary>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs text-slate-700" data-datos-tecnicos>
            {texto}
          </pre>
        </details>

        <div className="flex flex-wrap gap-2">
          <Boton variante="secundario" onClick={copiar} data-copiar>
            Copiar informe
          </Boton>
          <Boton variante="secundario" onClick={onCerrar}>
            Cerrar
          </Boton>
        </div>

        {error && puedeAtender && (
          <div className="flex flex-col gap-2 border-t border-slate-200 pt-3" data-atender>
            <Campo etiqueta="Nota del administrador">
              <textarea
                value={nota}
                onChange={(e) => setNota(e.target.value)}
                rows={3}
                maxLength={1000}
                className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-base text-slate-900"
                placeholder="Qué se hizo o se acordó con la persona"
                data-nota
              />
            </Campo>
            <div className="flex flex-wrap gap-2">
              <Boton onClick={() => marcar('atendido')} disabled={trabajando} data-marcar-atendido>
                Marcar atendido
              </Boton>
              {error.estado !== 'nuevo' && (
                <Boton variante="secundario" onClick={() => marcar('nuevo')} disabled={trabajando}>
                  Volver a nuevo
                </Boton>
              )}
            </div>
            {error.atendido_at && (
              <p className="text-xs text-slate-500">
                Atendido por {error.atendido_por ?? '—'} el {fechaHora(error.atendido_at)}
              </p>
            )}
          </div>
        )}
        {mensaje && <Alerta tono="azul">{mensaje}</Alerta>}
        {fallo && <Alerta>{fallo}</Alerta>}
      </div>
    </Modal>
  )
}
