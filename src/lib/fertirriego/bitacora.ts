/**
 * Bitácora de la estación (piloto 2, puntos 2, 3 y 4). Pura: sin React ni red.
 *
 *   - filas de envases (de `envases_movimientos` si la base tiene la 100; si no, de las recepciones) + lo pendiente
 *   - nombre de quien registró (`nombres` de la 100; si no, las personas conocidas del teléfono)
 *   - filtros: turno, producto, tipo, fecha (un día o rango) y cantidad (exacta o entre)
 */

import type { FilaKardex } from './calculos'
import type { EstadoCampo, LineaEnvase, Operacion, TipoMovimiento } from './tipos'

/** Tipo de fila de la bitácora: los del kardex + los movimientos de envases. */
export type TipoFila = TipoMovimiento | 'ENVASE'

export type FilaBitacora = {
  clave: string
  fecha_hora: string
  dia: string
  tipo: TipoFila
  material_id: string | null
  envase_id: string | null
  entrada: number
  salida: number
  /** Saldo del producto después del movimiento (los envases no llevan). */
  saldo: number | null
  /** Turnos a los que toca: el del movimiento o los de la recepción. */
  turnos: string[]
  documento_tipo: string
  documento_id: string
  pendiente: boolean
  anulado: boolean
  registrado_por: string | null
  /** Solo envases: motivo de la base (RECEPCION, ENTREGA, CONTEO, ANULACION). */
  motivo?: string | null
}

const entero = (v: unknown) => Math.trunc(Number(v ?? 0) || 0)

// El día en hora de Honduras (UTC-6), igual que isoDe de lib/fechas/zona. Aquí sin importarlo para que las pruebas
// unitarias (node --test, solo tipos) carguen este archivo sin el alias «@/».
const CALENDARIO = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Tegucigalpa', year: 'numeric', month: '2-digit', day: '2-digit' })
const isoDe = (d: Date) => CALENDARIO.format(d)

/** Nombre de una persona: el que manda la base (100) o el de las personas que el teléfono ya conoce. */
export function nombrePersona(estado: Pick<EstadoCampo, 'nombres' | 'yo' | 'estaciones' | 'relevos' | 'traslados'>, id: string | null | undefined): string | null {
  if (!id) return null
  const n = estado.nombres?.[id]
  if (n) return n
  if (estado.yo?.id === id) return estado.yo.nombre
  for (const e of estado.estaciones ?? []) {
    const p = e.personas?.find((x) => x.id === id)
    if (p) return p.nombre
    if (e.custodio_id === id && e.custodio) return e.custodio
  }
  for (const r of estado.relevos ?? []) {
    if (r.entrega_id === id && r.entrega) return r.entrega
    if (r.recibe_id === id && r.recibe) return r.recibe
  }
  for (const t of estado.traslados ?? []) {
    if (t.creado_por === id && t.creador) return t.creador
    if (t.autorizador_id === id && t.autorizador) return t.autorizador
  }
  return null
}

/** Filas del kardex de productos como filas de la bitácora (con los turnos de la recepción). */
export function filasDeKardex(estado: Pick<EstadoCampo, 'recepciones'>, kardex: FilaKardex[]): FilaBitacora[] {
  const turnosRecepcion = new Map((estado.recepciones ?? []).map((r) => [r.id, r.turnos ?? []]))
  return kardex.map((f) => ({
    clave: f.clave,
    fecha_hora: f.fecha_hora,
    dia: f.dia,
    tipo: f.tipo,
    material_id: f.material_id,
    envase_id: null,
    entrada: f.entrada,
    salida: f.salida,
    saldo: f.saldo,
    turnos: f.turno_ciclo_id ? [f.turno_ciclo_id] : (turnosRecepcion.get(f.documento_id) ?? []),
    documento_tipo: f.documento_tipo,
    documento_id: f.documento_id,
    pendiente: f.pendiente,
    anulado: f.anulado,
    registrado_por: f.registrado_por,
  }))
}

/**
 * Movimientos de envases de una estación: de la base (100) o, sin ella, de las recepciones (recibidos +,
 * entregados −). Más las recepciones pendientes de enviar (incluye «solo envases»).
 */
export function filasEnvases(
  estado: Pick<EstadoCampo, 'envases_movimientos' | 'recepciones' | 'yo'>,
  cola: Operacion[],
  estacionId: string
): FilaBitacora[] {
  const filas: FilaBitacora[] = []
  const recepciones = new Map((estado.recepciones ?? []).map((r) => [r.id, r]))
  const fila = (x: Omit<FilaBitacora, 'dia' | 'material_id' | 'saldo'>): FilaBitacora => ({
    ...x,
    dia: isoDe(new Date(x.fecha_hora)),
    material_id: null,
    saldo: null,
  })

  if (Array.isArray(estado.envases_movimientos)) {
    for (const m of estado.envases_movimientos) {
      if (m.estacion_id !== estacionId || !m.cantidad) continue
      const rec = m.documento_id ? recepciones.get(m.documento_id) : undefined
      filas.push(
        fila({
          clave: `env-${m.id}`,
          fecha_hora: m.fecha_hora,
          tipo: 'ENVASE',
          envase_id: m.envase_id,
          entrada: m.cantidad > 0 ? m.cantidad : 0,
          salida: m.cantidad < 0 ? -m.cantidad : 0,
          turnos: rec?.turnos ?? [],
          documento_tipo: m.documento_tipo ?? 'recepcion',
          documento_id: m.documento_id ?? m.id,
          pendiente: false,
          anulado: m.motivo !== 'ANULACION' && Boolean(rec?.anulado_at),
          registrado_por: m.registrado_por,
          motivo: m.motivo,
        })
      )
    }
  } else {
    for (const r of estado.recepciones ?? []) {
      if (r.estacion_id !== estacionId) continue
      for (const e of r.envases ?? []) {
        const base = { fecha_hora: r.fecha_hora, tipo: 'ENVASE' as const, envase_id: e.envase_id, turnos: r.turnos ?? [], documento_tipo: 'recepcion', documento_id: r.id, pendiente: false, anulado: Boolean(r.anulado_at), registrado_por: r.registrado_por }
        if (entero(e.recibidos) > 0) filas.push(fila({ ...base, clave: `env-${r.id}-${e.envase_id}-r`, entrada: entero(e.recibidos), salida: 0, motivo: 'RECEPCION' }))
        if (entero(e.entregados) > 0) filas.push(fila({ ...base, clave: `env-${r.id}-${e.envase_id}-e`, entrada: 0, salida: entero(e.entregados), motivo: 'ENTREGA' }))
      }
    }
  }

  for (const op of cola) {
    if (op.estado_local !== 'PENDIENTE' || op.tipo !== 'recepcion' || op.datos.estacion_id !== estacionId) continue
    const fh = String(op.datos.fecha_hora ?? op.creado_en)
    for (const e of (op.datos.envases as LineaEnvase[] | undefined) ?? []) {
      const base = { fecha_hora: fh, tipo: 'ENVASE' as const, envase_id: e.envase_id, turnos: (op.datos.turnos as string[] | undefined) ?? [], documento_tipo: 'recepcion', documento_id: op.id, pendiente: true, anulado: false, registrado_por: op.en_nombre_de ?? estado.yo?.id ?? null }
      if (entero(e.recibidos) > 0) filas.push(fila({ ...base, clave: `env-${op.id}-${e.envase_id}-r`, entrada: entero(e.recibidos), salida: 0, motivo: 'RECEPCION' }))
      if (entero(e.entregados) > 0) filas.push(fila({ ...base, clave: `env-${op.id}-${e.envase_id}-e`, entrada: 0, salida: entero(e.entregados), motivo: 'ENTREGA' }))
    }
  }
  return filas
}

export type FiltrosBitacora = {
  turnos: string[]
  productos: string[]
  tipos: TipoFila[]
  /** Un día: desde = hasta. Vacío = sin límite. AAAA-MM-DD en hora de Honduras. */
  desde: string
  hasta: string
  /** Cantidad (entrada o salida). Exacta: min = max. Vacío = sin límite. */
  cantidadMin: string
  cantidadMax: string
}

export const SIN_FILTROS: FiltrosBitacora = { turnos: [], productos: [], tipos: [], desde: '', hasta: '', cantidadMin: '', cantidadMax: '' }

const leer = (v: string) => {
  const t = v.trim().replace(',', '.')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/** Cuántos filtros están puestos (para el botón «Filtros (n)»). */
export function filtrosActivos(f: FiltrosBitacora): number {
  return (
    (f.turnos.length ? 1 : 0) +
    (f.productos.length ? 1 : 0) +
    (f.tipos.length ? 1 : 0) +
    (f.desde || f.hasta ? 1 : 0) +
    (leer(f.cantidadMin) !== null || leer(f.cantidadMax) !== null ? 1 : 0)
  )
}

export function filtrarBitacora(filas: FilaBitacora[], f: FiltrosBitacora): FilaBitacora[] {
  const min = leer(f.cantidadMin)
  const max = leer(f.cantidadMax)
  return filas.filter((x) => {
    if (f.turnos.length && !x.turnos.some((t) => f.turnos.includes(t))) return false
    if (f.productos.length && (!x.material_id || !f.productos.includes(x.material_id))) return false
    if (f.tipos.length && !f.tipos.includes(x.tipo)) return false
    if (f.desde && x.dia < f.desde) return false
    if (f.hasta && x.dia > f.hasta) return false
    const c = x.entrada || x.salida
    if (min !== null && c < min - 1e-9) return false
    if (max !== null && c > max + 1e-9) return false
    return true
  })
}

/** Todas las filas de la estación, lo más reciente arriba. */
export function ordenarRecientes(filas: FilaBitacora[]): FilaBitacora[] {
  return [...filas].sort((a, b) => b.fecha_hora.localeCompare(a.fecha_hora) || Number(b.pendiente) - Number(a.pendiente))
}
