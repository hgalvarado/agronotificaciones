// Pruebas de la lógica pura del registro histórico (116): no mueve el saldo local y sale en la bitácora aparte.
// Correr: node --test pruebas/unit/fertirriego_historico.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const zona = pathToFileURL(resolve('src/lib/fechas/zona.ts')).href
const dir = mkdtempSync(join(tmpdir(), 'hist116-'))
const copia = join(dir, 'calculos.ts')
writeFileSync(copia, readFileSync(resolve('src/lib/fertirriego/calculos.ts'), 'utf8').replace("'@/lib/fechas/zona'", `'${zona}'`))
const { efectosDe, saldosLocales } = await import(pathToFileURL(copia).href)
const { filasHistoricas, filtrarBitacora, SIN_FILTROS } = await import(pathToFileURL(resolve('src/lib/fertirriego/bitacora.ts')).href)

const estado = {
  yo: { id: 'U1', nombre: 'Yo' },
  estaciones: [], relevos: [], traslados: [],
  saldos: [{ estacion_id: 'E', material_id: 'A', disponible: 10, en_transito: 0 }],
  saldos_previos: [],
  movimientos: [],
  plan: [],
  aplicaciones: [
    { id: 'H1', estacion_id: 'E', turno_ciclo_id: 'T', fecha: '2026-11-05', fecha_hora: '2026-11-05T18:00:00Z', registrado_por: 'U1', historica: true, anulado_at: null, lineas: [{ material_id: 'A', cantidad: 5 }] },
    { id: 'N1', estacion_id: 'E', turno_ciclo_id: 'T', fecha: '2026-11-06', fecha_hora: '2026-11-06T18:00:00Z', registrado_por: 'U1', historica: false, anulado_at: null, lineas: [{ material_id: 'A', cantidad: 1 }] },
  ],
}
const opHist = { id: 'P1', tipo: 'aplicacion_historica', estado_local: 'PENDIENTE', creado_en: '2026-11-18T15:00:00Z', en_nombre_de: null,
  datos: { estacion_id: 'E', turno_ciclo_id: 'T', fecha: '2026-11-07', lineas: [{ material_id: 'A', cantidad: '4' }] } }
const opNormal = { id: 'P2', tipo: 'aplicacion', estado_local: 'PENDIENTE', creado_en: '2026-11-18T15:00:00Z', en_nombre_de: null,
  datos: { estacion_id: 'E', turno_ciclo_id: 'T', fecha: '2026-11-17', lineas: [{ material_id: 'A', cantidad: '2' }] } }

test('una aplicación histórica pendiente NO tiene efecto en la bodega', () => {
  assert.deepEqual(efectosDe(opHist, estado, () => 0), [])
})
test('la normal sí descuenta', () => {
  assert.deepEqual(efectosDe(opNormal, estado, () => 0), [{ estacion_id: 'E', material_id: 'A', cantidad: -2, tipo: 'APLICACION' }])
})
test('el saldo local con histórica pendiente no cambia; con normal baja', () => {
  const s0 = saldosLocales(estado, [], 'E').get('A')
  assert.equal(saldosLocales(estado, [opHist], 'E').get('A'), s0)
  assert.equal(saldosLocales(estado, [opHist, opNormal], 'E').get('A'), s0 - 2)
})
test('la bitácora saca las históricas (de la base y pendientes) como filas sin entrada, salida ni saldo', () => {
  const f = filasHistoricas(estado, [opHist], 'E')
  assert.equal(f.length, 2)
  assert.ok(f.every((x) => x.tipo === 'HISTORICO' && x.entrada === 0 && x.salida === 0 && x.saldo === null))
  assert.deepEqual(f.map((x) => [x.documento_id, x.cantidad, x.pendiente]).sort(), [['H1', 5, false], ['P1', 4, true]])
  assert.equal(f.find((x) => x.documento_id === 'H1').dia, '2026-11-05')
})
test('otra estación y otro tipo de operación no entran', () => {
  assert.equal(filasHistoricas(estado, [opNormal], 'OTRA').length, 0)
  assert.equal(filasHistoricas(estado, [opNormal], 'E').length, 1)
})
test('el filtro de cantidad también mira la cantidad de las históricas', () => {
  const f = filasHistoricas(estado, [opHist], 'E')
  assert.equal(filtrarBitacora(f, { ...SIN_FILTROS, cantidadMin: '5', cantidadMax: '5' }).length, 1)
  assert.equal(filtrarBitacora(f, { ...SIN_FILTROS, tipos: ['HISTORICO'] }).length, 2)
})

// 117: aplicaciones anteriores a la siembra (DDT negativo)
const { ddtReal, textoDdt, ordenarDdtsParaElegir, diasEntre } = await import(pathToFileURL(resolve('src/lib/fertirriego/ddt.ts')).href)
test('117: ddtReal es negativo antes de la siembra y se muestra con signo menos', () => {
  assert.equal(ddtReal('2026-10-29', '2026-10-20'), -9)
  assert.equal(ddtReal('2026-10-29', '2026-10-29'), 0)
  assert.equal(ddtReal('2026-10-29', '2026-11-05'), 7)
  assert.equal(ddtReal(null, '2026-10-20'), null)
  assert.equal(textoDdt(-3), '−3')
  assert.equal(textoDdt(0), '0')
  assert.equal(textoDdt(null), '—')
})
test('117: los chips con DDT negativo se pueden ordenar y elegir', () => {
  const ddts = [{ fecha: '2026-10-24', ddt: -5, productos: new Map() }, { fecha: '2026-11-01', ddt: 3, productos: new Map() }]
  const o = ordenarDdtsParaElegir(ddts, new Set(), '2026-10-25')
  assert.equal(o[0].ddt, -5)
  assert.equal(diasEntre('2026-10-24', '2026-10-25'), 1)
})
