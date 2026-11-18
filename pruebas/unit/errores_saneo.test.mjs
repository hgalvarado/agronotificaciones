// Pruebas del saneamiento de la bitácora de errores (118). Correr: node --test pruebas/unit/errores_saneo.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const { sanear, sanearTexto, normalizarMensaje, huellaLocal, acortarPila, esRuido } = await import(pathToFileURL(resolve('src/lib/errores/saneo.ts')).href)

test('texto: quita JWT, Bearer y contraseñas', () => {
  const s = sanearTexto('x Bearer abc.def-1 password=hunter2 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.firma y')
  assert.ok(!/abc\.def|hunter2|firma/.test(s))
  assert.match(s, /\[token\]/)
})
test('texto: se acota', () => assert.equal(sanearTexto('a'.repeat(5000), 100).length, 100))
test('objeto: oculta claves sensibles, también anidadas', () => {
  const o = sanear({ password: 'a', Token: 'b', n: { authorization: 'c', cookie: 'd', ok: 'visible' }, lista: [{ llave: 'z', v: 1 }] })
  assert.equal(o.password, '[oculto]')
  assert.equal(o.Token, '[oculto]')
  assert.equal(o.n.authorization, '[oculto]')
  assert.equal(o.n.cookie, '[oculto]')
  assert.equal(o.n.ok, 'visible')
  assert.equal(o.lista[0].llave, '[oculto]')
  assert.equal(o.lista[0].v, 1)
})
test('objeto: profundidad y anchura acotadas', () => {
  const hondo = { a: { b: { c: { d: { e: { f: 1 } } } } } }
  assert.equal(JSON.stringify(sanear(hondo)).includes('[…]'), true)
  const ancho = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, i]))
  assert.equal(Object.keys(sanear(ancho)).length, 40)
})
test('Error: da nombre, mensaje y pila corta', () => {
  const e = new Error('Falló con password=abc')
  const o = sanear(e)
  assert.equal(o.nombre, 'Error')
  assert.ok(!o.mensaje.includes('abc'))
})
test('pila: máximo 8 líneas y sin parámetros de URL', () => {
  const pila = Array.from({ length: 20 }, (_, i) => `at f${i} (https://x.com/a.js?token=SECRETO:1:1)`).join('\n')
  const c = acortarPila(pila)
  assert.equal(c.split('\n').length, 8)
  assert.ok(!c.includes('SECRETO'))
})
test('huella: mismo error con otros números/UUID = misma huella; distinto mensaje = otra', () => {
  const a = huellaLocal('navegador', 'fertirriego', '/fertirriego/123', 'TypeError', 'Falló 12 en 9f2b6c1a-1111-2222-3333-444455556666')
  const b = huellaLocal('navegador', 'fertirriego', '/fertirriego/999', 'TypeError', 'Falló 77 en aaaaaaaa-1111-2222-3333-444455556666')
  const c = huellaLocal('navegador', 'fertirriego', '/fertirriego/123', 'TypeError', 'Otra cosa')
  assert.equal(a, b)
  assert.notEqual(a, c)
})
test('normalizar: números y UUID a #', () => assert.equal(normalizarMensaje('Op 12 de 9f2b6c1a-1111-2222-3333-444455556666'), 'op # de #'))
test('ruido del navegador', () => {
  assert.ok(esRuido('ResizeObserver loop completed with undelivered notifications'))
  assert.ok(esRuido('Script error.'))
  assert.ok(!esRuido('Cannot read properties of undefined'))
})
