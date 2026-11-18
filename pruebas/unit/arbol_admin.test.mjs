// Pruebas del arbol de Administracion: favoritos, recientes, busqueda y lectura defensiva de lo guardado.
// Correr: node --test pruebas/unit/arbol_admin.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

register(
  'data:text/javascript,' +
    encodeURIComponent(
      `export async function resolve(s, c, n) { try { return await n(s, c) } catch (e) { if (s.startsWith('.') && !/\\.[cm]?[jt]sx?$/.test(s)) return n(s + '.ts', c); throw e } }`
    )
)
const A = await import('../../src/lib/navegacion/arbolAdmin.ts')
const { arbolDeclarado } = await import('../../src/lib/catalogos/grupos.ts')

const e = (n) => ({ href: `/admin/${n}`, etiqueta: n })

test('recientes: la ultima va primero, sin repetidos y maximo 5', () => {
  let p = A.PREFS_VACIAS
  for (const n of ['a', 'b', 'c', 'd', 'e', 'f']) p = A.registrarReciente(p, e(n))
  assert.deepEqual(p.recientes.map((x) => x.etiqueta), ['f', 'e', 'd', 'c', 'b'])
  p = A.registrarReciente(p, e('c'))
  assert.deepEqual(p.recientes.map((x) => x.etiqueta), ['c', 'f', 'e', 'd', 'b'])
  assert.equal(A.registrarReciente(p, e('c')), p, 'repetir la primera no cambia nada')
})

test('favoritos: alternar pone y quita', () => {
  let p = A.alternarFavorito(A.PREFS_VACIAS, e('x'))
  assert.ok(A.esFavorito(p, '/admin/x'))
  p = A.alternarFavorito(p, e('x'))
  assert.ok(!A.esFavorito(p, '/admin/x'))
})

test('busqueda: sin acentos, por nombre y por contexto, primero los que empiezan', () => {
  const lista = [
    { href: '/a', etiqueta: 'Familia de los equipos', contexto: 'Catalogos · Equipos e implementos' },
    { href: '/b', etiqueta: 'Equipos', contexto: 'Catalogos · Equipos e implementos' },
    { href: '/c', etiqueta: 'Tarifas', contexto: 'Costos' },
    { href: '/b', etiqueta: 'Equipos (repetido)' },
  ]
  assert.deepEqual(A.filtrarEntradas(lista, 'equipos').map((x) => x.href), ['/b', '/a'])
  assert.deepEqual(A.filtrarEntradas(lista, 'TARIFA').map((x) => x.href), ['/c'])
  assert.deepEqual(A.filtrarEntradas(lista, 'costos tarif').map((x) => x.href), ['/c'])
  assert.deepEqual(A.filtrarEntradas(lista, '   '), [])
})

test('lo guardado se lee con cuidado: datos raros no rompen', () => {
  assert.deepEqual(A.normalizarPrefs(null), A.PREFS_VACIAS)
  const p = A.normalizarPrefs({
    abiertos: { x: true, y: 'si' },
    favoritos: [{ href: '/ok', etiqueta: 'Ok' }, { href: 'http://malo', etiqueta: 'X' }, 5],
    recientes: 'no',
  })
  assert.deepEqual(p.abiertos, { x: true })
  assert.equal(p.favoritos.length, 1)
  assert.deepEqual(p.recientes, [])
})

test('arbol de catalogos: solo los bloques que se pueden ver, con nombres y enlaces', () => {
  const todo = arbolDeclarado(() => true)
  assert.equal(todo.length, 5)
  const eq = todo[0].items.find((i) => i.key === 'equipos')
  assert.equal(eq.etiqueta, 'Equipos')
  assert.equal(eq.href, '/admin/catalogos?catalogo=equipos')
  assert.equal(todo[0].items.find((i) => i.key === 'tarifas').href, '/admin/tarifas')
  const sap = arbolDeclarado((p) => p === 'catalogo_sap')
  assert.deepEqual(sap.map((b) => b.key), ['sap'])
})
