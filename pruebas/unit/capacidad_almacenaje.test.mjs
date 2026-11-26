// Pruebas de la lógica pura de capacidad de almacenaje (sql/152): capacidad efectiva con préstamo, Calcio nunca, excedentes.
// Correr: node --test pruebas/unit/capacidad_almacenaje.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const C = await import(pathToFileURL(resolve('src/lib/fertirriego/capacidad.ts')).href)

const cap = (material_id, base, efectiva, prestable_con = null, extra = {}) => ({
  estacion_id: 'E1', material_id, capacidad_base: base, capacidad: efectiva, prestable_con,
  cede_a: null, recibe_de: null, prestamo_id: null, prestamo_origen: null, prestamo_desde: null, prestamo_hasta: null, prestamo_por: null, ...extra,
})
const sinPrestamo = [cap('VEG', 3000, 3000, 'GEN'), cap('GEN', 3000, 3000, 'VEG'), cap('CAL', 5000, 5000)]
const conPrestamo = [cap('VEG', 3000, 6000, 'GEN', { recibe_de: 'GEN' }), cap('GEN', 3000, 0, 'VEG', { cede_a: 'VEG' }), cap('CAL', 5000, 5000)]

test('espacio disponible y exceso', () => {
  assert.equal(C.espacioDisponible(3000, 1000), 2000)
  assert.equal(C.espacioDisponible(3000, 3500), 0)
  assert.equal(C.espacioDisponible(null, 10), null)
  assert.equal(C.excesoAlRecibir(3000, 2500, 1000), 500)
  assert.equal(C.excesoAlRecibir(3000, 2500, 500), 0)
  assert.equal(C.excesoAlRecibir(undefined, 2500, 500), 0)
})

test('capacidad efectiva con préstamo: quien recibe suma, quien cede queda en 0', () => {
  const m = C.capacidadesDeEstacion(conPrestamo, 'E1')
  assert.equal(m.get('VEG').capacidad, 6000)
  assert.equal(m.get('GEN').capacidad, 0)
  assert.equal(C.espacioDisponible(m.get('VEG').capacidad, 4000), 2000)
  assert.equal(C.capacidadesDeEstacion(conPrestamo, 'otra').size, 0)
})

test('Calcio nunca se presta; Vegetativa y Generativa solo entre sí', () => {
  const m = C.capacidadesDeEstacion(sinPrestamo, 'E1')
  assert.equal(C.sePuedePrestar(m, 'VEG', 'GEN'), true)
  assert.equal(C.sePuedePrestar(m, 'GEN', 'VEG'), true)
  assert.equal(C.sePuedePrestar(m, 'CAL', 'VEG'), false)
  assert.equal(C.sePuedePrestar(m, 'VEG', 'CAL'), false)
  // una pareja declarada en un solo sentido no vale
  const rota = C.capacidadesDeEstacion([cap('VEG', 3000, 3000, 'GEN'), cap('GEN', 3000, 3000, null)], 'E1')
  assert.equal(C.sePuedePrestar(rota, 'VEG', 'GEN'), false)
})

test('excedentes de una recepción (suma por producto)', () => {
  const m = C.capacidadesDeEstacion(sinPrestamo, 'E1')
  const saldos = new Map([['VEG', 2500], ['CAL', 100]])
  const r = C.excedentesDeRecepcion(m, saldos, [{ material_id: 'VEG', cantidad: 400 }, { material_id: 'VEG', cantidad: 300 }, { material_id: 'CAL', cantidad: 1000 }, { material_id: 'X', cantidad: 9 }])
  assert.deepEqual(r, [{ material_id: 'VEG', exceso: 200, capacidad: 3000, saldo: 2500 }])
  // con el préstamo ya cabe
  const mp = C.capacidadesDeEstacion(conPrestamo, 'E1')
  assert.deepEqual(C.excedentesDeRecepcion(mp, saldos, [{ material_id: 'VEG', cantidad: 700 }]), [])
  // el tanque cedido no acepta nada
  assert.equal(C.excedentesDeRecepcion(mp, new Map(), [{ material_id: 'GEN', cantidad: 1 }]).length, 1)
})

test('medidor, criticidad y resumen', () => {
  assert.deepEqual(C.medidorCapacidad(1500, 3000), { pct: 50, zona: 'verde' })
  assert.deepEqual(C.medidorCapacidad(2600, 3000), { pct: 87, zona: 'amarillo' })
  assert.deepEqual(C.medidorCapacidad(3200, 3000), { pct: 100, zona: 'rojo' })
  assert.deepEqual(C.medidorCapacidad(0, 3000, true), { pct: 0, zona: 'rojo' })
  assert.deepEqual(C.medidorCapacidad(10, 0), { pct: null, zona: 'gris' })
  assert.ok(C.criticidad(95) > C.criticidad(50))
  assert.equal(C.criticidad(null), -1)
  const r = C.resumenDeNiveles([{ saldo: 1000, capacidad: 3000 }, { saldo: 500, capacidad: 5000 }])
  assert.equal(r.saldo, 1500); assert.equal(r.capacidad, 8000); assert.equal(r.espacio, 6500)
})
