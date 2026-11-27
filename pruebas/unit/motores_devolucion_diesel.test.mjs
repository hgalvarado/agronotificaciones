// Pruebas de «Devolver diésel a bodega» (Motores, sql/155): armado de la operación, saldo local del tanque con lo pendiente,
// lo devuelto entre registros y la señal del visor. ESCRITA, NO ejecutada (la corre Opus).
// Correr: node --test pruebas/unit/motores_devolucion_diesel.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const cargar = (p) => import(pathToFileURL(resolve(p)).href)
const { armarDevolucionDiesel } = await cargar('src/lib/motores/devolucionDiesel.ts')
const { saldoTanqueLocal, devueltoEnRango } = await cargar('src/lib/motores/estado.ts')
const { senalesDeRegistro } = await cargar('src/lib/motores/senales.ts')

const pend = (tipo, datos, estado_local = 'PENDIENTE') => ({ id: Math.random().toString(36), tipo, datos, estado_local })
const estadoBase = (extra = {}) => ({
  servidor_en: '2026-11-22T00:00:00Z',
  permisos: { ver: true, registrar: true, anular: false, configurar: false },
  material_diesel_id: 'D',
  motores: [],
  tanques_sin_motor: [],
  tanques: [{ id: 'T1', nombre: 'Tanque 1', zona_id: null, estacion_id: 'E1', capacidad_gal: 300, motor_equipo_id: null, saldo_gal: 100 }],
  registros: [],
  recepciones: [],
  mantenimientos: [],
  asignaciones: [],
  devoluciones: [],
  ...extra,
})
const base = { estacionId: 'E1', tanqueId: 'T1', galones: 30, disponible: 100, destino: 'BODEGA', motivo: 'Fin de temporada', fechaHora: '2026-11-20T18:00:00-06:00', choferId: 'C1', vehiculoId: 'V1', vehiculoTipo: 'Pick-up' }

test('armar: datos completos', () => {
  const r = armarDevolucionDiesel(base)
  assert.ok('datos' in r)
  assert.deepEqual(r.datos, { estacion_id: 'E1', tanque_id: 'T1', galones: 30, fecha_hora: base.fechaHora, destino: 'BODEGA', motivo: 'Fin de temporada', chofer_id: 'C1', vehiculo_id: 'V1' })
})

test('armar: no más de lo que hay', () => {
  const r = armarDevolucionDiesel({ ...base, galones: 120 })
  assert.match(r.error, /más de lo que hay/)
})

test('armar: destino, motivo, chofer, vehículo y tipo obligatorios', () => {
  assert.match(armarDevolucionDiesel({ ...base, destino: '' }).error, /a dónde/)
  assert.match(armarDevolucionDiesel({ ...base, destino: 'CASA' }).error, /a dónde/)
  assert.match(armarDevolucionDiesel({ ...base, motivo: '  ' }).error, /motivo/)
  assert.match(armarDevolucionDiesel({ ...base, choferId: '' }).error, /quién retiró/)
  assert.match(armarDevolucionDiesel({ ...base, vehiculoId: '' }).error, /vehículo/)
  assert.match(armarDevolucionDiesel({ ...base, vehiculoTipo: null }).error, /no tiene tipo/)
  assert.match(armarDevolucionDiesel({ ...base, galones: 0 }).error, /galones/)
  assert.match(armarDevolucionDiesel({ ...base, tanqueId: '' }).error, /tanque/)
})

test('saldo local: lo pendiente de devolver sale del tanque; lo de otro tanque o ya enviado no', () => {
  const e = estadoBase()
  const cola = [
    pend('diesel_devolver', { tanque_id: 'T1', galones: 30 }),
    pend('diesel_devolver', { tanque_id: 'T2', galones: 50 }),
    pend('diesel_devolver', { tanque_id: 'T1', galones: 10 }, 'ACEPTADO'),
  ]
  assert.equal(saldoTanqueLocal('T1', e, cola), 70)
})

test('devuelto en rango: [desde, hasta) por día de Honduras, sin anuladas, con lo pendiente', () => {
  const e = estadoBase({
    devoluciones: [
      { id: 'a', tanque_id: 'T1', estacion_id: 'E1', galones: 20, fecha_hora: '2026-11-18T23:00:00-06:00', anulado_at: null },
      { id: 'b', tanque_id: 'T1', estacion_id: 'E1', galones: 7, fecha_hora: '2026-11-19T10:00:00-06:00', anulado_at: '2026-11-19T11:00:00Z' },
      { id: 'c', tanque_id: 'T1', estacion_id: 'E1', galones: 9, fecha_hora: '2026-11-20T08:00:00-06:00', anulado_at: null },
    ],
  })
  const cola = [pend('diesel_devolver', { tanque_id: 'T1', galones: 5, fecha_hora: '2026-11-19T15:00:00-06:00' })]
  // desde el 18 (incluido) hasta el 20 (excluido): 20 + 5 (la anulada no cuenta; la del 20 queda fuera)
  assert.equal(devueltoEnRango('T1', '2026-11-18', '2026-11-20', e, cola), 25)
})

test('señal del visor: la devolución entre registros explica la bajada (sin VISOR_FALTA)', () => {
  const reg = (id, fecha, vi, vf) => ({ id, equipo_id: 'M1', fecha, estacion_id: 'E1', tanque_id: 'T1', horo_ini: 0, horo_fin: 5, horas: 5, visor_ini: vi, visor_fin: vf, gastado_gal: vi - vf, recibido_gal: 0, rendimiento_gal_h: (vi - vf) / 5, rpm: 1800, horo_cambiado: false, visor_cambiado: false, dif_visor_gal: null, horas_estimadas: null, rend_ref_gal_h: null, anulado_at: null })
  const prev = reg('r1', '2026-11-18', 100, 90)
  const hoy = reg('r2', '2026-11-20', 60, 50)
  const devs = [{ tanque_id: 'T1', galones: 30, fecha_hora: '2026-11-18T18:00:00-06:00', anulado_at: null }]
  const sin = senalesDeRegistro(hoy, prev, [prev], [])
  assert.ok(sin.some((s) => s.codigo === 'VISOR_FALTA'), 'sin la devolución, faltan 30 gal')
  const con = senalesDeRegistro(hoy, prev, [prev], [], devs)
  assert.ok(!con.some((s) => s.codigo === 'VISOR_FALTA' || s.codigo === 'VISOR_SOBRA'), 'con la devolución, cuadra')
})
