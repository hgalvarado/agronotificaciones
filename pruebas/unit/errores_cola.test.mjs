// Pruebas de la cola local de la bitácora de errores (118). Correr: node --test pruebas/unit/errores_cola.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const { encolar, leerCola, tomarLote, confirmar, esperaMs, crearLimitador, LIMITE_COLA, CLAVE_COLA, esDefinitivo } = await import(pathToFileURL(resolve('src/lib/errores/cola.ts')).href)

const almacen = (limite = Infinity) => {
  const m = new Map()
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => { if (v.length > limite) throw new Error('QuotaExceededError'); m.set(k, v) } }
}
const item = (n, extra = {}) => ({ id: `id${n}`, huella: `h${n}`, usuario: 'u1', origen: 'navegador', modulo: 'x', ruta: '/x', severidad: 'error', codigo: null, mensaje: `m${n}`, detalle: {}, cuando: `2026-11-18T10:${String(n % 60).padStart(2, '0')}:00Z`, ...extra })

test('encolar y leer', () => {
  const a = almacen()
  encolar(a, item(1))
  assert.equal(leerCola(a).length, 1)
  assert.equal(leerCola(a)[0].repeticiones, 1)
})
test('el mismo error se SUMA en un solo elemento (con severidad máxima y última vez)', () => {
  const a = almacen()
  encolar(a, item(1, { severidad: 'aviso' }))
  encolar(a, item(1, { severidad: 'critico', cuando: '2026-11-18T11:00:00Z' }))
  const c = leerCola(a)
  assert.equal(c.length, 1)
  assert.equal(c[0].repeticiones, 2)
  assert.equal(c[0].severidad, 'critico')
  assert.equal(c[0].ultima, '2026-11-18T11:00:00Z')
})
test('el mismo error de otro usuario NO se mezcla', () => {
  const a = almacen()
  encolar(a, item(1))
  encolar(a, item(1, { usuario: 'u2' }))
  assert.equal(leerCola(a).length, 2)
})
test('rotación: pasa del límite y sale lo menos grave y más viejo', () => {
  const a = almacen()
  for (let i = 0; i < LIMITE_COLA + 20; i++) {
    encolar(a, item(i, { severidad: i === 5 ? 'critico' : 'info', cuando: `2026-11-18T${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00Z` }))
  }
  const c = leerCola(a)
  assert.equal(c.length, LIMITE_COLA)
  assert.ok(c.some((x) => x.huella === 'h5'), 'el crítico se conserva')
})
test('tomarLote: solo de esta persona (o sin dueño) y máximo n', () => {
  const a = almacen()
  for (let i = 0; i < 5; i++) encolar(a, item(i))
  encolar(a, item(9, { usuario: 'u2' }))
  encolar(a, item(10, { usuario: null }))
  assert.equal(tomarLote(a, 'u1', 3).length, 3)
  assert.equal(tomarLote(a, 'u1', 50).length, 6)
})
test('confirmar quita solo lo enviado', () => {
  const a = almacen()
  for (let i = 0; i < 3; i++) encolar(a, item(i))
  confirmar(a, ['id0', 'id2'])
  assert.deepEqual(leerCola(a).map((x) => x.id), ['id1'])
})
test('almacenamiento lleno: no revienta', () => {
  const a = almacen(900)
  for (let i = 0; i < 10; i++) assert.doesNotThrow(() => encolar(a, item(i, { mensaje: 'x'.repeat(100) })))
})
test('JSON dañado en el almacén: cola vacía, sin romper', () => {
  const a = almacen()
  a.setItem(CLAVE_COLA, '{no es json')
  assert.deepEqual(leerCola(a), [])
  assert.doesNotThrow(() => encolar(a, item(1)))
})
test('backoff: 5 s, 10 s, 20 s… tope 5 min', () => {
  assert.equal(esperaMs(1), 5000)
  assert.equal(esperaMs(2), 10000)
  assert.equal(esperaMs(3), 20000)
  assert.equal(esperaMs(30), 300000)
})
test('limitador anti-bucle: pasa 20 por minuto y vuelve a pasar después', () => {
  const ok = crearLimitador(20, 60000)
  let pasaron = 0
  for (let i = 0; i < 100; i++) if (ok('h', 1000 + i)) pasaron++
  assert.equal(pasaron, 20)
  assert.equal(ok('h', 1000 + 61000), true)
  assert.equal(ok('otra', 1000), true)
})
test('errores definitivos', () => {
  assert.ok(esDefinitivo('22P02'))
  assert.ok(!esDefinitivo('40001'))
})
