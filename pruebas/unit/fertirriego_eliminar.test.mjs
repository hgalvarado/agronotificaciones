// Lógica pura de «Eliminar por completo» (sql/119).
// Correr: node --test pruebas/unit/fertirriego_eliminar.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const dir = mkdtempSync(join(tmpdir(), 'elim119-'))
const copia = join(dir, 'eliminar.ts')
writeFileSync(copia, readFileSync(resolve('src/lib/fertirriego/eliminar.ts'), 'utf8'))
const m = await import(pathToFileURL(copia).href)

test('motivo: vacío, corto y suficiente', () => {
  assert.match(m.errorMotivoEliminar(''), /Escribe/)
  assert.match(m.errorMotivoEliminar('   '), /Escribe/)
  assert.match(m.errorMotivoEliminar('muy corto'), /mínimo 15/)
  assert.match(m.errorMotivoEliminar('  1234567890123 '), /llevas 13/)
  assert.equal(m.errorMotivoEliminar('Se registró por error'), null)
  assert.equal(m.errorMotivoEliminar('123456789012345'), null)
})

test('tipos eliminables', () => {
  assert.equal(m.TIPOS_ELIMINABLES.length, 12)   // 140: + inyección y motores
  assert.ok(m.esTipoEliminable('relevo'))
  assert.ok(!m.esTipoEliminable('archivo_turno'))
  assert.equal(m.NOMBRE_TIPO_ELIMINABLE.bitacora, 'Horas de riego')
})

test('aviso de eliminado', () => {
  assert.equal(m.resumenEliminado({ ok: true, tipo: 'conteo', eliminados: {} }), 'Registro eliminado.')
  assert.equal(m.resumenEliminado(null), 'Registro eliminado.')
  assert.match(m.resumenEliminado({ ok: true, tipo: 'recepcion', eliminados: {}, saldos_negativos: [{ estacion: 'E1', material: 'UREA', saldo: -5 }] }), /saldo negativo en UREA \(-5\)/)
})

test('falta de señal', () => {
  assert.ok(m.esFaltaDeSenal(new TypeError('Failed to fetch')))
  assert.ok(m.esFaltaDeSenal({ message: 'NetworkError when attempting to fetch resource.' }))
  assert.ok(!m.esFaltaDeSenal({ message: 'No tienes permiso', code: '42501' }))
})

test('copia en AGL', () => {
  assert.match(m.TEXTO_COPIA_EN_AGL, /está en AGL \(Fertirriego › Eliminados\)/)
})

test('quitarDocumentoDelEstado: la aplicacion, su devolucion y su anulacion salen al instante y el saldo se corrige', () => {
  const mov = (id, doc, tipo, cant, anula = null) => ({ id, cursor: 1, estacion_id: 'E', material_id: 'M', tipo, cantidad: cant, fecha_hora: 'x', turno_ciclo_id: null, documento_tipo: 'x', documento_id: doc, anula_id: anula, registrado_por: 'p' })
  const estado = {
    saldos: [{ estacion_id: 'E', material_id: 'M', disponible: 75, en_transito: 0 }],
    movimientos: [mov('m1', 'R', 'RECEPCION', 100), mov('m2', 'A', 'APLICACION', -30), mov('m3', 'D', 'DEVOLUCION', 5, null), mov('m4', 'A', 'ANULACION', 30, 'm2')],
    recepciones: [{ id: 'R' }], aplicaciones: [{ id: 'A' }, { id: 'B' }], conteos: [{ id: 'C' }], relevos: undefined, traslados: [], envases_movimientos: [{ id: 1, documento_id: 'A' }, { id: 2, documento_id: 'R' }],
  }
  const antes = JSON.stringify(estado)
  const r = m.quitarDocumentoDelEstado(estado, 'A')
  assert.equal(JSON.stringify(estado), antes, 'no modifica el estado recibido')
  assert.deepEqual(r.movimientos.map((x) => x.id), ['m1', 'm3'])   // m2 y su anulacion m4 fuera; m3 es de otro documento
  assert.equal(r.saldos[0].disponible, 75 - (-30 + 30))           // lo quitado suma 0: se resta cantidad total quitada
  assert.deepEqual(r.aplicaciones.map((x) => x.id), ['B'])
  assert.deepEqual(r.recepciones.map((x) => x.id), ['R'])
  assert.deepEqual(r.envases_movimientos.map((x) => x.id), [2])
  assert.equal(r.relevos, undefined)
  // Una recepcion consumida: el saldo baja por lo que entro
  const r2 = m.quitarDocumentoDelEstado(estado, 'R')
  assert.equal(r2.saldos[0].disponible, 75 - 100)
  assert.deepEqual(r2.recepciones, [])
})
