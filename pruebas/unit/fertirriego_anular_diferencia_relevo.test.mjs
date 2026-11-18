// Pruebas del efecto local de anular la diferencia de UN producto de un relevo (115).
// Correr: node --test pruebas/unit/fertirriego_anular_diferencia_relevo.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// calculos.ts usa el alias «@/»: se prueba una copia temporal con el alias resuelto a su archivo real
const zona = pathToFileURL(resolve('src/lib/fechas/zona.ts')).href
const dir = mkdtempSync(join(tmpdir(), 'calc115-'))
const copia = join(dir, 'calculos.ts')
writeFileSync(copia, readFileSync(resolve('src/lib/fertirriego/calculos.ts'), 'utf8').replace("'@/lib/fechas/zona'", `'${zona}'`))
const { efectosDe } = await import(pathToFileURL(copia).href)

const estado = {
  aplicaciones: [],
  movimientos: [
    { id: 'm1', estacion_id: 'E', material_id: 'A', tipo: 'DIFERENCIA_RELEVO', cantidad: -3, documento_id: 'R1', anula_id: null },
    { id: 'm2', estacion_id: 'E', material_id: 'B', tipo: 'DIFERENCIA_RELEVO', cantidad: -2, documento_id: 'R1', anula_id: null },
    { id: 'm3', estacion_id: 'E', material_id: 'B', tipo: 'ANULACION', cantidad: 2, documento_id: 'R1', anula_id: 'm2' },
  ],
}
const op = (datos) => ({ tipo: 'anulacion', datos })
const saldo = () => 0

test('relevo: repone solo la diferencia del producto indicado', () => {
  const e = efectosDe(op({ estacion_id: 'E', documento_tipo: 'relevo', documento_id: 'R1', material_id: 'A', motivo: 'x' }), estado, saldo)
  assert.deepEqual(e, [{ estacion_id: 'E', material_id: 'A', cantidad: 3, tipo: 'ANULACION' }])
})
test('relevo: lo ya anulado no se repone otra vez', () => {
  const e = efectosDe(op({ estacion_id: 'E', documento_tipo: 'relevo', documento_id: 'R1', material_id: 'B', motivo: 'x' }), estado, saldo)
  assert.deepEqual(e, [])
})
test('otros documentos: sigue anulando todo lo del documento', () => {
  const e = efectosDe(op({ estacion_id: 'E', documento_tipo: 'conteo', documento_id: 'R1', motivo: 'x' }), estado, saldo)
  assert.equal(e.length, 1)
  assert.equal(e[0].material_id, 'A')
})
