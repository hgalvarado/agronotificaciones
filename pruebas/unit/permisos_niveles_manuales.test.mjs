// «Eliminar por completo» nunca se enciende con un nivel rápido (solo con su casilla): decisión 2026-11-19.
// Correr: node --test pruebas/unit/permisos_niveles_manuales.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const dir = mkdtempSync(join(tmpdir(), 'niv-'))
const copia = join(dir, 'niveles.ts')
writeFileSync(copia, readFileSync(resolve('src/lib/permisos/niveles.ts'), 'utf8'))
const m = await import(pathToFileURL(copia).href)

const acciones = [
  { codigo: 'ver', nivel: 1 }, { codigo: 'exportar', nivel: 1 }, { codigo: 'registrar', nivel: 2 },
  { codigo: 'anular', nivel: 3 }, { codigo: 'configurar', nivel: 4 }, { codigo: 'eliminar_definitivo', nivel: 4 },
]

test('el nivel «Todo» enciende todo MENOS «Eliminar por completo»', () => {
  const todo = m.accionesDelNivel(acciones, 4)
  assert.ok(todo.has('configurar'))
  assert.ok(!todo.has('eliminar_definitivo'))
  assert.equal(todo.size, 5)
})

test('los niveles menores tampoco la encienden', () => {
  for (const n of [1, 2, 3]) assert.ok(!m.accionesDelNivel(acciones, n).has('eliminar_definitivo'))
})

test('con la casilla encendida a mano el nivel queda «a la medida»', () => {
  const conCasilla = new Set([...m.accionesDelNivel(acciones, 4), 'eliminar_definitivo'])
  assert.equal(m.nivelActual(acciones, conCasilla), null)
  assert.equal(m.nivelActual(acciones, m.accionesDelNivel(acciones, 4)), 4)
})
