// Pruebas del menú «Campo» (fichas por permiso).
// Correr: node --test pruebas/unit/campo_fichas.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const { fichasCampo } = await import(pathToFileURL(resolve('src/lib/campo/fichas.ts')).href)

test('sin permisos no hay fichas', () => {
  assert.deepEqual(fichasCampo(() => false), [])
})

test('solo Fertirriego', () => {
  const f = fichasCampo((p) => p === 'fertirriego')
  assert.equal(f.length, 1)
  assert.equal(f[0].ruta, '/fertirriego')
})

test('ambas, en orden Fertirriego y AgroMétricas', () => {
  const f = fichasCampo((p, a) => a === 'ver' && (p === 'fertirriego' || p === 'agrometricas'))
  assert.deepEqual(f.map((x) => x.ruta), ['/fertirriego', '/agrometricas/parametros', '/agrometricas/registros', ''])
})

test('solo cuenta la acción «ver»', () => {
  assert.deepEqual(fichasCampo((_p, a) => a === 'editar'), [])
})

test('Motores y combustible: ficha propia, entre Inyección y AgroMétricas', () => {
  const f = fichasCampo((p, a) => a === 'ver' && ['fertirriego', 'inyeccion', 'motores', 'agrometricas'].includes(p))
  assert.deepEqual(f.map((x) => x.ruta), ['/fertirriego', '/inyeccion', '/motores', '/agrometricas/parametros', '/agrometricas/registros', ''])
  assert.equal(f[2].nombre, 'Motores y combustible')
})

test('Inyección: ficha propia, entre Fertirriego y AgroMétricas', () => {
  const f = fichasCampo((p, a) => a === 'ver' && ['fertirriego', 'inyeccion', 'agrometricas'].includes(p))
  assert.deepEqual(f.map((x) => x.ruta), ['/fertirriego', '/inyeccion', '/agrometricas/parametros', '/agrometricas/registros', ''])
  assert.equal(f[1].nombre, 'Inyección')
})
