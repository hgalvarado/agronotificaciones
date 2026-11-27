import { test } from 'node:test'
import assert from 'node:assert/strict'
import { compararPor, pronosticar, textoDias } from '../../src/lib/motores/pronostico.ts'

const base = { tanque_id: 't1', saldo_gal: 100, intervalo_horas: 500, horas_desde_mant: 300, horas_est_desde_mant: 0 }

test('días de combustible = saldo ÷ gal por día trabajado', () => {
  const p = pronosticar({ ...base, reciente: { dias: 10, horas: 80, gal: 200 } })
  assert.equal(p.galDia, 20)
  assert.equal(p.diasCombustible, 5)
})

test('días para mantenimiento = horas que faltan ÷ horas por día', () => {
  const p = pronosticar({ ...base, reciente: { dias: 10, horas: 80, gal: 200 } })
  assert.equal(p.horasRestantes, 200)
  assert.equal(p.diasMantenimiento, 25)
})

test('las horas estimadas también cuentan para el mantenimiento', () => {
  const p = pronosticar({ ...base, horas_est_desde_mant: 100, reciente: { dias: 10, horas: 80, gal: 200 } })
  assert.equal(p.horasRestantes, 100)
})

test('mantenimiento pasado = 0 días aunque no haya datos recientes', () => {
  const p = pronosticar({ ...base, horas_desde_mant: 520, reciente: null })
  assert.equal(p.diasMantenimiento, 0)
  assert.equal(p.diasCombustible, null)
})

test('menos de 3 días con registro: sin datos suficientes', () => {
  const p = pronosticar({ ...base, reciente: { dias: 2, horas: 16, gal: 40 } })
  assert.equal(p.suficiente, false)
  assert.equal(p.diasCombustible, null)
  assert.equal(p.diasMantenimiento, null)
})

test('sin tanque no hay días de combustible; saldo negativo cuenta como 0', () => {
  assert.equal(pronosticar({ ...base, tanque_id: null, reciente: { dias: 5, horas: 40, gal: 50 } }).diasCombustible, null)
  assert.equal(pronosticar({ ...base, saldo_gal: -5, reciente: { dias: 5, horas: 40, gal: 50 } }).diasCombustible, 0)
})

test('ordenar: menos días primero y sin dato al final', () => {
  const a = pronosticar({ ...base, saldo_gal: 10, reciente: { dias: 5, horas: 40, gal: 50 } })
  const b = pronosticar({ ...base, saldo_gal: 100, reciente: { dias: 5, horas: 40, gal: 50 } })
  const c = pronosticar({ ...base, reciente: null })
  const lista = [c, b, a].sort((x, y) => compararPor('combustible', x, y))
  assert.deepEqual(lista, [a, b, c])
})

test('textos', () => {
  assert.equal(textoDias(null), 'Sin datos suficientes')
  assert.equal(textoDias(0), 'Le toca ya')
  assert.equal(textoDias(0.5), 'Menos de 1 día')
  assert.equal(textoDias(1.9), '1 día')
  assert.equal(textoDias(12.2), '12 días')
})
