// Pruebas de los frenos contra tormentas de consultas. Correr: node --test pruebas/unit/frenos.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const { crearFreno, crearDedupe } = await import(pathToFileURL(resolve('src/lib/datos/frenos.ts')).href)

test('la primera consulta automatica va; la siguiente antes de 15 s espera lo que falta', () => {
  const f = crearFreno()
  assert.deepEqual(f.autorizar(1000), { accion: 'ejecutar' })
  assert.deepEqual(f.autorizar(6000), { accion: 'esperar', enMs: 10_000 })
  assert.deepEqual(f.autorizar(16_000), { accion: 'ejecutar' })
})

test('una consulta pasados 15 s va sin espera', () => {
  const f = crearFreno()
  f.autorizar(0)
  assert.equal(f.autorizar(15_000).accion, 'ejecutar')
})

test('disyuntor: mas de 6 consultas en 60 s pausan 2 min y avisan una sola vez', () => {
  const f = crearFreno({ minimoMs: 0 })
  for (let i = 0; i < 6; i++) assert.equal(f.autorizar(i * 100).accion, 'ejecutar')
  // La septima anotada (manual) abre el disyuntor
  f.anotar(700)
  assert.equal(f.enPausa(800), true)
  const a = f.autorizar(800)
  assert.equal(a.accion, 'pausado')
  assert.equal(a.avisar, true)
  assert.equal(a.enMs, 700 + 120_000 - 800)
  const b = f.autorizar(900)
  assert.equal(b.accion, 'pausado')
  assert.equal(b.avisar, false)
})

test('el disyuntor se cierra al pasar los 2 min', () => {
  const f = crearFreno({ minimoMs: 0 })
  for (let i = 0; i < 7; i++) f.anotar(i * 100)
  assert.equal(f.autorizar(1000).accion, 'pausado')
  assert.equal(f.autorizar(121_000).accion, 'ejecutar')
  assert.equal(f.enPausa(121_001), false)
})

test('6 consultas en 60 s no abren el disyuntor; si se espacian mas de 60 s tampoco', () => {
  const f = crearFreno({ minimoMs: 0 })
  for (let i = 0; i < 6; i++) f.anotar(i * 1000)
  assert.equal(f.enPausa(7000), false)
  const g = crearFreno({ minimoMs: 0 })
  for (let i = 0; i < 20; i++) g.anotar(i * 20_000)
  assert.equal(g.enPausa(400_000), false)
})

test('un bucle de 11 por segundo queda en pocas consultas reales', () => {
  const f = crearFreno()
  let ejecutadas = 0
  for (let t = 0; t < 60_000; t += 90) if (f.autorizar(t).accion === 'ejecutar') ejecutadas++
  assert.ok(ejecutadas <= 4, `ejecutadas=${ejecutadas}`)
})

test('lo manual solo se anota: nunca se bloquea y no consume el intervalo minimo', () => {
  const f = crearFreno()
  f.anotar(0)
  f.anotar(10)
  assert.equal(f.autorizar(20).accion, 'ejecutar')
})

test('dedupe: misma huella 1 vez por minuto', () => {
  const d = crearDedupe()
  assert.equal(d('h1', 0), true)
  assert.equal(d('h1', 30_000), false)
  assert.equal(d('h2', 30_000), true)
  assert.equal(d('h1', 60_000), true)
})

test('dedupe: maximo 20 envios por sesion', () => {
  const d = crearDedupe()
  let ok = 0
  for (let i = 0; i < 30; i++) if (d(`h${i}`, i)) ok++
  assert.equal(ok, 20)
  assert.equal(d('nueva', 1_000_000), false)
})
