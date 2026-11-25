// Pruebas de la lógica pura de los indicadores de Motores: medidor del tanque, barra de mantenimiento y la tabla en formato de hoja.
// Correr: node --test pruebas/unit/motores_indicadores.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const cargar = (p) => import(pathToFileURL(resolve(p)).href)
const I = await cargar('src/lib/motores/indicadores.ts')
const H = await cargar('src/lib/motores/hoja.ts')

test('medidor del tanque: porcentaje, zonas y casos sin dato', () => {
  assert.deepEqual(I.medidorTanque(300, 600), { pct: 50, zona: 'verde' })
  assert.deepEqual(I.medidorTanque(90, 600), { pct: 15, zona: 'amarillo' })
  assert.deepEqual(I.medidorTanque(0, 600), { pct: 0, zona: 'rojo' })
  assert.deepEqual(I.medidorTanque(-5, 600), { pct: 0, zona: 'rojo' })
  assert.deepEqual(I.medidorTanque(900, 600), { pct: 100, zona: 'verde' })
  assert.deepEqual(I.medidorTanque(39, null), { pct: null, zona: 'gris' })
  assert.deepEqual(I.medidorTanque(0, null), { pct: null, zona: 'rojo' })
  assert.deepEqual(I.medidorTanque(null, 600), { pct: null, zona: 'gris' })
})

test('arco del medidor: E a la izquierda, F a la derecha, mitad arriba', () => {
  assert.deepEqual(I.puntoArco(0, 40), { x: 10, y: 50 })
  assert.deepEqual(I.puntoArco(100, 40), { x: 90, y: 50 })
  assert.deepEqual(I.puntoArco(50, 40), { x: 50, y: 10 })
  assert.equal(I.trazoArco(50, 40), 'M 10 50 A 40 40 0 0 1 50 10')
})

test('barra de mantenimiento: verde, ámbar (aviso 10 %), vencido, estimadas y sin intervalo', () => {
  const v = I.barraMantenimiento({ horas: 100, intervalo: 500 })
  assert.equal(v.zona, 'verde')
  assert.equal(v.pct, 20)
  assert.equal(v.pctAviso, 90)
  assert.equal(v.texto, 'faltan 400 h')
  const a = I.barraMantenimiento({ horas: 460, intervalo: 500 })
  assert.equal(a.zona, 'amarillo')
  assert.equal(a.texto, 'faltan 40 h')
  const r = I.barraMantenimiento({ horas: 519, intervalo: 500 })
  assert.equal(r.zona, 'rojo')
  assert.equal(r.pct, 100)
  assert.equal(r.texto, 'vencido 19 h')
  const e = I.barraMantenimiento({ horas: 484, estimadas: 4, intervalo: 500 })
  assert.equal(e.pctReal, 96)
  assert.equal(e.pct, 96.8)
  assert.equal(I.barraMantenimiento({ horas: 10, intervalo: 500, aviso: 100 }).pctAviso, 80)
  const s = I.barraMantenimiento({ horas: 5, intervalo: null })
  assert.equal(s.sinIntervalo, true)
  assert.equal(s.zona, 'gris')
  assert.equal(s.texto, 'sin intervalo')
})

const reg = (fecha, extra = {}) => ({
  id: `r-${fecha}`, equipo_id: 'M', fecha, horo_ini: 100, horo_fin: 106, horas: 6, visor_ini: 200, visor_fin: 188, gastado_gal: 12, rendimiento_gal_h: 2,
  rpm: 1400, recibido_gal: 0, caudal_ini: null, caudal_fin: null, operador: 'Ana Perez', anulado_at: null, ...extra,
})

test('hoja: orden de la hoja, sin anulados, rango de fechas, motor y señal más grave', () => {
  const regs = [reg('2026-11-12'), reg('2026-11-10'), reg('2026-11-11', { anulado_at: 'x' }), reg('2026-11-13', { equipo_id: 'OTRO' }), reg('2026-11-14')]
  const senales = new Map([['r-2026-11-12', [{ nivel: 'info' }, { nivel: 'amarillo' }]], ['r-2026-11-14', [{ nivel: 'rojo' }, { nivel: 'amarillo' }]]])
  const f = H.filasDeHoja(regs, { equipoId: 'M' }, senales)
  assert.deepEqual(f.map((x) => x.fecha), ['2026-11-10', '2026-11-12', '2026-11-14'])
  assert.deepEqual(f.map((x) => x.senal), [null, 'amarillo', 'rojo'])
  assert.deepEqual(H.filasDeHoja(regs, { equipoId: 'M', desde: '2026-11-11', hasta: '2026-11-12' }).map((x) => x.fecha), ['2026-11-12'])
})

test('hoja: totales y rendimiento medio ponderado (gal ÷ horas de los días que trabajaron)', () => {
  const f = H.filasDeHoja([reg('2026-11-10'), reg('2026-11-11', { horas: 4, gastado_gal: 20, recibido_gal: 40 }), reg('2026-11-12', { horas: 0, gastado_gal: 5, rendimiento_gal_h: null })], {})
  const t = H.totalesHoja(f)
  assert.deepEqual(t, { dias: 3, horas: 10, gastado: 37, suministro: 40, rendimiento: 3.2 })
  assert.deepEqual(H.totalesHoja([]), { dias: 0, horas: 0, gastado: 0, suministro: 0, rendimiento: null })
})

test('hoja: formato corto de números y fechas', () => {
  assert.equal(H.numHoja(19185.64), '19185.6')
  assert.equal(H.numHoja(1.956, 2), '1.96')
  assert.equal(H.numHoja(null), '—')
  assert.equal(H.numHoja(1450, 0), '1450')
  assert.equal(H.ddmm('2026-11-20'), '20/11')
  assert.equal(H.ddmmaa('2026-11-20'), '20/11/26')
})
