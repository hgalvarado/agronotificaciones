// Pruebas de la devolución a bodega (Campo, bloque 1): armado de la operación y saldo local.
// Correr: node --test pruebas/unit/campo_devolucion_bodega.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const zona = pathToFileURL(resolve('src/lib/fechas/zona.ts')).href
const dir = mkdtempSync(join(tmpdir(), 'devbod-'))
const copia = join(dir, 'calculos.ts')
writeFileSync(copia, readFileSync(resolve('src/lib/fertirriego/calculos.ts'), 'utf8').replace("'@/lib/fechas/zona'", `'${zona}'`))
const { efectosDe, saldosLocales, NOMBRE_MOVIMIENTO } = await import(pathToFileURL(copia).href)
const { armarDevolucionBodega, primerExceso } = await import(pathToFileURL(resolve('src/lib/fertirriego/devolucionBodega.ts')).href)

const base = { estacionId: 'E', destino: 'SUMINISTROS', motivo: 'Fin de temporada', fechaHora: '2026-11-22T15:00:00Z' }

test('sin motivo da error', () => {
  const r = armarDevolucionBodega({ ...base, motivo: '  ', lineas: [{ material_id: 'A', cantidad: 5 }] })
  assert.ok('error' in r)
})

test('destino fuera de la lista da error', () => {
  const r = armarDevolucionBodega({ ...base, destino: 'OTRO', lineas: [{ material_id: 'A', cantidad: 5 }] })
  assert.ok('error' in r)
})

test('todas las cantidades en 0 → Indica al menos un producto', () => {
  const r = armarDevolucionBodega({ ...base, lineas: [{ material_id: 'A', cantidad: 0 }, { material_id: 'B', cantidad: 0 }] })
  assert.deepEqual(r, { error: 'Indica al menos un producto' })
})

test('descarta la línea en 0 y devuelve destino y líneas', () => {
  const r = armarDevolucionBodega({ ...base, lineas: [{ material_id: 'A', cantidad: 5 }, { material_id: 'B', cantidad: 0 }, { material_id: 'C', cantidad: 2.5 }] })
  assert.ok('datos' in r)
  assert.equal(r.datos.destino, 'SUMINISTROS')
  assert.equal(r.datos.estacion_id, 'E')
  assert.deepEqual(r.datos.lineas, [{ material_id: 'A', cantidad: 5 }, { material_id: 'C', cantidad: 2.5 }])
})

test('primerExceso detecta lo que pasa del saldo', () => {
  const saldos = new Map([['A', 10]])
  assert.equal(primerExceso([{ material_id: 'A', cantidad: 10 }], saldos), null)
  assert.deepEqual(primerExceso([{ material_id: 'A', cantidad: 11 }], saldos), { material_id: 'A', disponible: 10 })
})

test('el saldo local resta DEVOLUCION_BODEGA: 100 → 70', () => {
  const estado = {
    yo: { id: 'U', nombre: 'Yo' }, estaciones: [], relevos: [], traslados: [], plan: [], aplicaciones: [], movimientos: [],
    saldos: [{ estacion_id: 'E', material_id: 'A', disponible: 100, en_transito: 0 }],
  }
  const op = { id: 'P', tipo: 'devolucion_bodega', estado_local: 'PENDIENTE', creado_en: '2026-11-22T15:00:00Z', en_nombre_de: null,
    datos: { estacion_id: 'E', destino: 'TALLER', motivo: 'x', lineas: [{ material_id: 'A', cantidad: 30 }, { material_id: 'B', cantidad: 0 }] } }
  const ef = efectosDe(op, estado, () => 0)
  assert.deepEqual(ef, [{ estacion_id: 'E', material_id: 'A', cantidad: -30, tipo: 'DEVOLUCION_BODEGA' }])
  assert.equal(saldosLocales(estado, [op], 'E').get('A'), 70)
  assert.ok(NOMBRE_MOVIMIENTO.DEVOLUCION_BODEGA)
})

test('la devolución a bodega se puede anular; relevo y traslado no', async () => {
  const { esDocumentoAnulable } = await import(pathToFileURL(resolve('src/lib/fertirriego/devolucionBodega.ts')).href)
  assert.equal(esDocumentoAnulable('devolucion_bodega'), true)
  assert.equal(esDocumentoAnulable('recepcion'), true)
  assert.equal(esDocumentoAnulable('relevo'), false)
  assert.equal(esDocumentoAnulable('traslado'), false)
})
