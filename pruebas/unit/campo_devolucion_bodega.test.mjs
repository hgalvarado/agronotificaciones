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
const { armarDevolucionBodega, primerExceso, vistaDevolucion, rotuloDevolucion, lineaRetiro, SIN_DATO_ANTERIOR } = await import(pathToFileURL(resolve('src/lib/fertirriego/devolucionBodega.ts')).href)

const base = {
  estacionId: 'E', destino: 'SUMINISTROS', motivo: 'Fin de temporada', fechaHora: '2026-11-22T15:00:00Z',
  choferId: 'CH', vehiculoId: 'V', vehiculoTipo: 'Camión', choferNombre: 'Juan', vehiculoPlaca: 'ABC123',
}

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

test('sin chofer, sin vehículo o vehículo sin tipo en el catálogo: error', () => {
  const l = [{ material_id: 'A', cantidad: 5 }]
  assert.ok('error' in armarDevolucionBodega({ ...base, lineas: l, choferId: '' }))
  assert.ok('error' in armarDevolucionBodega({ ...base, lineas: l, vehiculoId: '' }))
  assert.ok('error' in armarDevolucionBodega({ ...base, lineas: l, vehiculoTipo: null }))
  assert.ok('error' in armarDevolucionBodega({ ...base, lineas: l, vehiculoTipo: '  ' }))
})

test('los datos llevan chofer, vehículo y nombres para el detalle sin señal', () => {
  const r = armarDevolucionBodega({ ...base, lineas: [{ material_id: 'A', cantidad: 5 }] })
  assert.equal(r.datos.chofer_id, 'CH')
  assert.equal(r.datos.vehiculo_id, 'V')
  assert.equal(r.datos.chofer_nombre, 'Juan')
  assert.equal(r.datos.vehiculo_placa, 'ABC123')
  assert.equal(r.datos.vehiculo_tipo, 'Camión')
})

test('rótulo con el destino concreto, nunca los tres juntos', () => {
  assert.equal(rotuloDevolucion('TALLER'), 'Devuelto a TALLER')
  assert.equal(rotuloDevolucion('BODEGA'), 'Devuelto a BODEGA')
  assert.ok(!rotuloDevolucion('SUMINISTROS').includes('/'))
})

test('vistaDevolucion: del servidor trae todo; sin chofer = registro anterior', () => {
  const estado = { yo: { id: 'U', nombre: 'Yo' }, devoluciones_bodega: [
    { id: 'S1', estacion_id: 'E', fecha_hora: '2026-11-22T15:00:00Z', destino: 'TALLER', motivo: 'm', registrado_por: 'U', registrado_por_nombre: 'Ana',
      chofer: 'Juan', vehiculo: 'ABC123', vehiculo_tipo: 'Camión', anulado_at: '2026-11-23T10:00:00Z', anulado_por_nombre: 'Luis', motivo_anulacion: 'error',
      lineas: [{ material_id: 'A', cantidad: 30, saldo_antes: 100, saldo_despues: 70 }] },
    { id: 'S2', estacion_id: 'E', fecha_hora: '2026-11-01T15:00:00Z', destino: 'BODEGA', motivo: 'm', registrado_por: 'U', anulado_at: null, motivo_anulacion: null, lineas: [] },
  ] }
  const v = vistaDevolucion(estado, [], 'S1')
  assert.equal(v.origen, 'servidor')
  assert.equal(v.lineas[0].saldo_antes, 100)
  assert.equal(v.lineas[0].saldo_despues, 70)
  assert.equal(v.anulado_por_nombre, 'Luis')
  assert.equal(lineaRetiro(v), 'retiró: Juan · camión ABC123')
  const viejo = vistaDevolucion(estado, [], 'S2')
  assert.equal(viejo.chofer, null)
  assert.ok(lineaRetiro(viejo).includes(SIN_DATO_ANTERIOR))
})

test('vistaDevolucion: en cola sin señal usa lo que trae la operación local', () => {
  const estado = { yo: { id: 'U', nombre: 'Yo' }, devoluciones_bodega: [] }
  const op = { id: 'P', tipo: 'devolucion_bodega', estado_local: 'PENDIENTE', creado_en: '2026-11-22T15:00:00Z', en_nombre_de: null, ubicacion: { lat: 1, lon: 2, precision: 5 },
    datos: { destino: 'SUMINISTROS', motivo: 'x', chofer_nombre: 'Juan', vehiculo_placa: 'ABC123', vehiculo_tipo: 'Camión', lineas: [{ material_id: 'A', cantidad: 3 }, { material_id: 'B', cantidad: 0 }] } }
  const v = vistaDevolucion(estado, [op], 'P')
  assert.equal(v.origen, 'local')
  assert.equal(v.destino, 'SUMINISTROS')
  assert.equal(v.chofer, 'Juan')
  assert.equal(v.registrado_por_nombre, 'Yo')
  assert.equal(v.operacion.lat, 1)
  assert.equal(v.lineas.length, 1)
  assert.equal(vistaDevolucion(estado, [], 'otro'), null)
})
