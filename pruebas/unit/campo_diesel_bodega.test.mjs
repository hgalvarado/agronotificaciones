// Pruebas del diésel como producto de la bodega (sql/144): saldo local con lo pendiente de enviar.
// Correr: node --test pruebas/unit/campo_diesel_bodega.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const zona = pathToFileURL(resolve('src/lib/fechas/zona.ts')).href
const dir = mkdtempSync(join(tmpdir(), 'dieselbod-'))
const copia = join(dir, 'calculos.ts')
writeFileSync(copia, readFileSync(resolve('src/lib/fertirriego/calculos.ts'), 'utf8').replace("'@/lib/fechas/zona'", `'${zona}'`))
const { efectosDe, saldosLocales, NOMBRE_MOVIMIENTO } = await import(pathToFileURL(copia).href)
const { armarBodega } = await import(pathToFileURL(resolve('src/lib/fertirriego/bodegaGeneral.ts')).href)

const op = (tipo, datos, estado_local = 'PENDIENTE') => ({ id: Math.random().toString(36), tipo, datos, estado_local })
const estado = { saldos: [{ estacion_id: 'E', material_id: 'D', disponible: 50, en_transito: 0 }], movimientos: [], aplicaciones: [], traslados: [] }

test('recibir diésel sube la bodega y el suministro del registro diario la baja', () => {
  const cola = [
    op('diesel_recibir', { estacion_id: 'E', galones: 100, diesel_material_id: 'D' }),
    op('motor_registro_diario', { estacion_id: 'E', equipo_id: 'M', suministro_gal: 40, diesel_material_id: 'D' }),
    op('diesel_recibir', { estacion_id: 'E', galones: 999, diesel_material_id: 'D' }, 'ACEPTADO'),
  ]
  assert.equal(saldosLocales(estado, cola, 'E').get('D'), 110)
})

test('el registro histórico y el registro sin suministro no mueven la bodega', () => {
  assert.deepEqual(efectosDe(op('motor_registro_diario', { estacion_id: 'E', suministro_gal: 40, diesel_material_id: 'D', historica: true }), estado, () => 0), [])
  assert.deepEqual(efectosDe(op('motor_registro_diario', { estacion_id: 'E', diesel_material_id: 'D' }), estado, () => 0), [])
  assert.deepEqual(efectosDe(op('diesel_recibir', { estacion_id: 'E', galones: 5 }), estado, () => 0), [])
})

test('los movimientos nuevos tienen nombre para la bitácora', () => {
  assert.equal(NOMBRE_MOVIMIENTO.RECEPCION_DIESEL, 'Diésel recibido')
  assert.ok(NOMBRE_MOVIMIENTO.SUMINISTRO_MOTOR)
})

test('bodega general: el diésel sale como producto tipo DIESEL (no se lista el tanque)', () => {
  const filas = armarBodega({
    estacionId: 'E',
    saldos: new Map([['D', 110], ['P', 5]]),
    saldosEnvases: new Map(),
    material: () => undefined,
    nombreEnvase: () => '',
    servidor: {
      servidor_en: 'x',
      material_diesel_id: 'D',
      filas: [
        { estacion_id: 'E', tipo: 'DIESEL', clave: 'D', material_id: 'D', codigo: 'DSL', nombre: 'Diésel', unidad: 'GAL', grupo: 'Diésel', saldo: 110, ultima_recepcion: 'h', procedencia: 'Juan · ABC' },
        // fila vieja (antes de la 144): un tanque; ya no debe aparecer
        { estacion_id: 'E', tipo: 'DIESEL', clave: 'TANQUE', material_id: 'D', codigo: 'DSL', nombre: 'Diésel', unidad: 'GAL', grupo: 'Diésel', saldo: 30, ultima_recepcion: null, procedencia: null, detalle: 'Tanque M1' },
      ],
    },
  })
  assert.equal(filas.filter((f) => f.tipo === 'DIESEL').length, 1)
  const d = filas.find((f) => f.tipo === 'DIESEL')
  assert.equal(d.saldo, 110)
  assert.equal(d.procedencia, 'Juan · ABC')
})
