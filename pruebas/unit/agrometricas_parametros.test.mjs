// Pruebas de src/lib/agrometricas/parametros.ts. Correr: node --test pruebas/unit/agrometricas_parametros.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { leerNumero, revisar, ddt, CAMPOS, SECCIONES } from '../../src/lib/agrometricas/parametros.ts'

const ph = CAMPOS.find((c) => c.clave === 'ph_agua')
test('coma o punto decimal', () => {
  assert.equal(leerNumero('7,5'), 7.5); assert.equal(leerNumero(' 12 '), 12)
  assert.equal(leerNumero(''), null); assert.equal(leerNumero('abc'), null); assert.equal(leerNumero('-0.5'), -0.5)
})
test('dentro de rango o sin rango: no avisa', () => {
  assert.equal(revisar(7, { parametro: 'ph_agua', minimo: 4, maximo: 9 }, ph).fuera, false)
  assert.equal(revisar(797, undefined, ph).fuera, false)
  assert.equal(revisar(797, { parametro: 'ph_agua', minimo: null, maximo: null }, ph).fuera, false)
})
test('pH 797 sugiere 7.97', () => {
  const r = revisar(797, { parametro: 'ph_agua', minimo: 4, maximo: 9 }, ph)
  assert.equal(r.fuera, true); assert.equal(r.sugerencia, 7.97); assert.match(r.mensaje, /Quisiste decir 7\.97/)
})
test('ETo 5048 sugiere 5.048', () => {
  assert.equal(revisar(5048, { parametro: 'eto', minimo: 0, maximo: 12 }).sugerencia, 5.048)
})
test('fuera sin sugerencia posible: pide revisar', () => {
  const r = revisar(-3, { parametro: 'ph_agua', minimo: 4, maximo: 9 }, ph)
  assert.equal(r.sugerencia, null); assert.match(r.mensaje, /Revisa la lectura/)
})
test('DDT', () => {
  assert.equal(ddt('2026-11-12', '2026-11-01'), 11); assert.equal(ddt('2026-10-25', '2026-11-01'), -7)
  assert.equal(ddt('2026-11-12', null), null)
})
test('secciones: tensiómetros primero y abierta', () => {
  assert.equal(SECCIONES[0].clave, 'tensiometros'); assert.equal(SECCIONES[0].abierta, true)
  assert.ok(CAMPOS.every((c) => SECCIONES.some((s) => s.clave === c.seccion)))
})
