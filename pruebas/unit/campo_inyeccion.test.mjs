// Pruebas de Inyección por lote (Campo, bloque 2): armado de la operación, plan por lote y saldo local.
// Correr: node --test pruebas/unit/campo_inyeccion.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const zona = pathToFileURL(resolve('src/lib/fechas/zona.ts')).href
const dir = mkdtempSync(join(tmpdir(), 'iny-'))
const copia = join(dir, 'calculos.ts')
writeFileSync(copia, readFileSync(resolve('src/lib/fertirriego/calculos.ts'), 'utf8').replace("'@/lib/fechas/zona'", `'${zona}'`))
const { efectosDe, saldosLocales, NOMBRE_MOVIMIENTO } = await import(pathToFileURL(copia).href)
const { dosisPorMz, areaPropuesta, armarAplicacionLote, lineasDelPlan, OBJETIVOS } = await import(pathToFileURL(resolve('src/lib/inyeccion/aplicarLote.ts')).href)
const { fichasCampo } = await import(pathToFileURL(resolve('src/lib/campo/fichas.ts')).href)

const base = {
  estacionId: 'E', lote: '1002-010', categoriaClave: 'ferti-riego|inyeccion', temporada: 'Temp 26-27', ciclo: 'Ciclo 1', turnoAglId: 'T1',
  areaMz: 5, areaLote: 5, objetivos: ['PLAGA'], comentario: '', sinInventario: false,
  lineas: [{ material_id: 'A', cantidad: 10 }], fechaHora: '2026-11-22T15:00:00Z',
}

test('dosisPorMz = cantidad ÷ área; área 0 → null', () => {
  assert.equal(dosisPorMz(10, 4), 2.5)
  assert.equal(dosisPorMz(10, 0), null)
  assert.equal(dosisPorMz(10, -1), null)
  assert.equal(dosisPorMz(1, 3), 0.3333)
})

test('areaPropuesta usa el plan y cae al lote', () => {
  assert.equal(areaPropuesta({ areaPlan: 3, areaLote: 5 }), 3)
  assert.equal(areaPropuesta({ areaPlan: null, areaLote: 5 }), 5)
  assert.equal(areaPropuesta({ areaPlan: 0, areaLote: 5 }), 5)
  assert.equal(areaPropuesta({ areaPlan: null, areaLote: null }), null)
})

test('los objetivos son los cinco acordados', () => {
  assert.deepEqual(OBJETIVOS.map((o) => o.id), ['PLAGA', 'MALEZA', 'BACTERIA', 'ENFERMEDAD', 'HONGO'])
})

test('errores con el texto exacto: sin lote, área 0, sin objetivo, todo en 0', () => {
  assert.deepEqual(armarAplicacionLote({ ...base, lote: '  ' }), { error: 'Elige el lote' })
  assert.deepEqual(armarAplicacionLote({ ...base, areaMz: 0 }), { error: 'Indica el área cubierta' })
  assert.deepEqual(armarAplicacionLote({ ...base, areaMz: NaN }), { error: 'Indica el área cubierta' })
  assert.deepEqual(armarAplicacionLote({ ...base, objetivos: [] }), { error: 'Elige al menos un objetivo' })
  assert.deepEqual(armarAplicacionLote({ ...base, lineas: [{ material_id: 'A', cantidad: 0 }, { material_id: 'B', cantidad: 0 }] }), { error: 'Indica al menos un producto' })
})

test('descarta la línea en 0 y devuelve los datos de la operación', () => {
  const r = armarAplicacionLote({ ...base, lineas: [{ material_id: 'A', cantidad: 10 }, { material_id: 'B', cantidad: 0 }, { material_id: 'C', cantidad: 2.5 }] })
  assert.ok('datos' in r)
  assert.deepEqual(r.datos.lineas, [{ material_id: 'A', cantidad: 10 }, { material_id: 'C', cantidad: 2.5 }])
  assert.equal(r.datos.estacion_id, 'E')
  assert.equal(r.datos.lote, '1002-010')
  assert.equal(r.datos.area_mz, 5)
  assert.deepEqual(r.datos.objetivos, ['PLAGA'])
  assert.equal('acepta_negativo' in r.datos, false)
  assert.deepEqual(r.avisos, [])
})

test('«sin inventario» marca acepta_negativo', () => {
  const r = armarAplicacionLote({ ...base, sinInventario: true })
  assert.ok('datos' in r)
  assert.equal(r.datos.acepta_negativo, true)
})

test('área mayor que el lote: aviso y SIN error', () => {
  const r = armarAplicacionLote({ ...base, areaMz: 8, areaLote: 5 })
  assert.ok('datos' in r)
  assert.ok(!('error' in r))
  assert.ok(r.avisos.length > 0)
})

const plan = [
  { id: '1', estacion_id: 'E', temporada: 'T', ciclo: 'Ciclo 1', turno_agl_id: 'T0', turno: 'T0', lote: 'L1', categoria_clave: 'c', ddt: 5, fecha_plan: '2026-11-01', material_id: 'A', dosis_mz: 2, area_mz: 3, cantidad_plan: 6 },
  { id: '2', estacion_id: 'E', temporada: 'T', ciclo: 'Ciclo 1', turno_agl_id: 'T1', turno: 'T1', lote: 'L1', categoria_clave: 'c', ddt: 5, fecha_plan: '2026-11-21', material_id: 'A', dosis_mz: 2, area_mz: 5, cantidad_plan: 10 },
  { id: '3', estacion_id: 'E', temporada: 'T', ciclo: 'Ciclo 1', turno_agl_id: 'T1', turno: 'T1', lote: 'L1', categoria_clave: 'c', ddt: 5, fecha_plan: '2026-11-21', material_id: 'B', dosis_mz: 0.4, area_mz: 5, cantidad_plan: 2 },
  { id: '4', estacion_id: 'E', temporada: 'T', ciclo: 'Ciclo 1', turno_agl_id: 'T1', turno: 'T1', lote: 'L1', categoria_clave: 'c', ddt: 12, fecha_plan: '2026-11-28', material_id: 'A', dosis_mz: 1, area_mz: 5, cantidad_plan: 5 },
]

test('lineasDelPlan elige el DDT más cercano a la fecha (y la cohorte más cercana)', () => {
  const g = lineasDelPlan(plan, { lote: 'L1', categoriaClave: 'c', fecha: '2026-11-22' })
  assert.deepEqual(g.map((x) => [x.material_id, x.ddt, x.turno_agl_id]), [['A', 5, 'T1'], ['B', 5, 'T1']])
  const g2 = lineasDelPlan(plan, { lote: 'L1', categoriaClave: 'c', fecha: '2026-11-29' })
  assert.deepEqual(g2.map((x) => [x.material_id, x.ddt]), [['A', 12]])
  const g3 = lineasDelPlan(plan, { lote: 'L1', categoriaClave: 'c', fecha: '2026-11-02' })
  assert.equal(g3[0].turno_agl_id, 'T0')
})

test('lineasDelPlan pedido por DDT y vacío para un lote sin plan', () => {
  assert.deepEqual(lineasDelPlan(plan, { lote: 'L1', ddt: 12 }).map((x) => x.cantidad_plan), [5])
  assert.deepEqual(lineasDelPlan(plan, { lote: 'SIN-PLAN', fecha: '2026-11-22' }), [])
  assert.deepEqual(lineasDelPlan(plan, { lote: 'L1', categoriaClave: 'otra', fecha: '2026-11-22' }), [])
})

test('el saldo local resta APLICACION_LOTE: 100 → 70', () => {
  const estado = {
    yo: { id: 'U', nombre: 'Yo' }, estaciones: [], relevos: [], traslados: [], plan: [], aplicaciones: [], movimientos: [],
    saldos: [{ estacion_id: 'E', material_id: 'A', disponible: 100, en_transito: 0 }],
  }
  const op = { id: 'P', tipo: 'aplicacion_lote', estado_local: 'PENDIENTE', creado_en: '2026-11-22T15:00:00Z', en_nombre_de: null,
    datos: { estacion_id: 'E', lote: 'L1', lineas: [{ material_id: 'A', cantidad: 30 }, { material_id: 'B', cantidad: 0 }] } }
  assert.deepEqual(efectosDe(op, estado, () => 0), [{ estacion_id: 'E', material_id: 'A', cantidad: -30, tipo: 'APLICACION_LOTE' }])
  assert.equal(saldosLocales(estado, [op], 'E').get('A'), 70)
  assert.ok(NOMBRE_MOVIMIENTO.APLICACION_LOTE)
})

test('la ficha Inyección aparece con su permiso y el orden queda Fertirriego, Inyección, AgroMétricas', () => {
  const f = fichasCampo((p) => p === 'inyeccion')
  assert.equal(f.length, 1)
  assert.equal(f[0].ruta, '/inyeccion')
  const todas = fichasCampo((p, a) => a === 'ver' && ['fertirriego', 'inyeccion', 'agrometricas'].includes(p))
  assert.deepEqual(todas.map((x) => x.ruta), ['/fertirriego', '/inyeccion', '/agrometricas'])
})
