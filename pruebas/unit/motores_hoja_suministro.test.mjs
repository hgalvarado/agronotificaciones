// Hoja de Motores con suministros (columna «Sum.» y fila «solo suministro») y resumen de la temporada en el teléfono (sql/149).
// Correr: node --test pruebas/unit/motores_hoja_suministro.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const cargar = (p) => import(pathToFileURL(resolve(p)).href)
const H = await cargar('src/lib/motores/hoja.ts')
const R = await cargar('src/lib/motores/resumenTemporada.ts')

const reg = (fecha, extra = {}) => ({
  id: `r-${fecha}`, equipo_id: 'M', fecha, horo_ini: 100, horo_fin: 106, horas: 6, visor_ini: 200, visor_fin: 188, gastado_gal: 12, rendimiento_gal_h: 2,
  rpm: 1400, recibido_gal: 0, caudal_ini: null, caudal_fin: null, operador: 'Ana', anulado_at: null, ...extra,
})

test('hoja: el suministro del día llena «Sum.» sin sumarse dos veces con el del registro', () => {
  const f = H.filasDeHoja([reg('2026-11-10', { recibido_gal: 50 }), reg('2026-11-11')], {}, undefined, [
    { id: 'a', dia: '2026-11-10', galones: 50 },
    { id: 'b', dia: '2026-11-11', galones: 20 },
    { id: 'c', dia: '2026-11-11', galones: 10 },
  ])
  assert.deepEqual(f.map((x) => [x.fecha, x.suministro, Boolean(x.soloSuministro)]), [['2026-11-10', 50, false], ['2026-11-11', 30, false]])
})

test('hoja: día con suministro y sin registro = fila «solo suministro», en orden y dentro del rango', () => {
  const sum = [{ id: 'a', dia: '2026-11-09', galones: 40 }, { id: 'b', dia: '2026-11-12', galones: 15 }, { id: 'c', dia: '2026-12-01', galones: 99 }]
  const f = H.filasDeHoja([reg('2026-11-10'), reg('2026-11-11', { anulado_at: 'x' })], { hasta: '2026-11-30' }, undefined, sum)
  assert.deepEqual(f.map((x) => x.fecha), ['2026-11-09', '2026-11-10', '2026-11-12'])
  const solo = f.filter((x) => x.soloSuministro)
  assert.deepEqual(solo.map((x) => [x.fecha, x.suministro, x.horas, x.gastado]), [['2026-11-09', 40, 0, 0], ['2026-11-12', 15, 0, 0]])
  const t = H.totalesHoja(f)
  assert.deepEqual(t, { dias: 1, horas: 6, horasEst: 0, horasProy: 6, gastado: 12, suministro: 55, rendimiento: 2 })
})

test('hoja: el suministro de un día anulado sale como fila solo suministro', () => {
  const f = H.filasDeHoja([reg('2026-11-11', { anulado_at: 'x', recibido_gal: 30 })], {}, undefined, [{ id: 'a', dia: '2026-11-11', galones: 30 }])
  assert.equal(f.length, 1)
  assert.equal(f[0].soloSuministro, true)
})

test('resumen temporada: días con horas, rendimiento ponderado, RPM ponderada, sin anulados', () => {
  const c = R.resumirRegistros([
    { horas: 4, gastado_gal: 8, rpm: 1000 },
    { horas: 6, gastado_gal: 18, rpm: 2000, horas_estimadas: 1.5 },
    { horas: 0, gastado_gal: 3, rpm: 1500, horas_estimadas: 2 },
    { horas: 10, gastado_gal: 50, rpm: 3000, anulado_at: 'x' },
  ], 0, 2)
  assert.deepEqual(c, { dias: 2, horas: 10, horas_estimadas: 3.5, gal_gastados: 29, gal_recibidos: 0, rendimiento_gal_h: 2.6, rpm_prom: 1600, mantenimientos: 2 })
  assert.deepEqual(R.resumirRegistros([]), { dias: 0, horas: 0, horas_estimadas: 0, gal_gastados: 0, gal_recibidos: 0, rendimiento_gal_h: null, rpm_prom: null })
})

// recibido_gal del registro diario YA incluye lo recibido ese día en el tanque (sql/144 «sum-calc»): sumar además las recepciones lo cuenta doble.
test('resumen temporada: el suministro del registro y la recepción del mismo día no se cuentan doble', () => {
  const c = R.resumirRegistros([{ horas: 5, gastado_gal: 10, recibido_gal: 250 }], 0)
  assert.equal(c.gal_recibidos, 250)
})

test('hoja: la firma es quien entregó el combustible ese día (no el operador del registro)', () => {
  const f = H.filasDeHoja([reg('2026-11-10', { recibido_gal: 50 }), reg('2026-11-11')], {}, undefined, [
    { id: 'a', dia: '2026-11-10', galones: 50, entrego: 'Luis Pérez' },
    { id: 'b', dia: '2026-11-12', galones: 20, entrego: 'Ana Gómez' },
  ])
  assert.deepEqual(f.map((x) => [x.fecha, x.operador]), [['2026-11-10', 'Luis Pérez'], ['2026-11-11', null], ['2026-11-12', 'Ana Gómez']])
})
