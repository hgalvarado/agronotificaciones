// Pruebas de src/lib/agrometricas/indicePura.ts (IC) + el tipo 'indice' en la cola y el historial. Base: sql/127.
// Correr: node --test pruebas/unit/agrometricas_indice.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  calcularIC, versionVigente, planIC, resultadoIC, ddtEnRangoIC, normalizarVersiones, armarDatosIC,
  validarHojas, validarFormula, planParaGuardar,
} from '../../src/lib/agrometricas/indicePura.ts'
import { agregarPorId, procesarCola } from '../../src/lib/agrometricas/colaPura.ts'
import { resumirRegistro, unirItems } from '../../src/lib/agrometricas/historialPura.ts'

const PLAN = [5, 6, 7].map((ddt, i) => ({ ddt, ic_plan: [0.3, 0.33, 0.35][i] }))
const V1 = { id: 'v1', vigente_desde: '2000-01-01', divisor: 10, exponente_ddt: 1, notas: null, plan: PLAN }
const V2 = { id: 'v2', vigente_desde: '2026-12-01', divisor: 12, exponente_ddt: 1, notas: 'nueva', plan: [{ ddt: 5, ic_plan: 0.4 }] }

test('IC = hojas / DDT / 10 (valores reales del histórico de AppSheet)', () => {
  assert.equal(calcularIC(20, 5, 10, 1), 0.4)     // fila real: 20 hojas, DDT 5, IC real 0.40
  assert.equal(calcularIC(24, 6, 10, 1), 0.4)
  assert.equal(calcularIC(30, 7, 10, 1), 0.4286)  // AppSheet lo redondeaba a 0.43
  assert.equal(calcularIC(47, 10, 10, 1), 0.47)
})

test('IC con divisor y exponente distintos; sin datos o DDT no positivo = null', () => {
  assert.equal(calcularIC(36, 6, 12, 1), 0.5)
  assert.equal(calcularIC(36, 6, 1, 2), 1)        // 36 / 6^2 / 1
  assert.equal(calcularIC(36, 6, 1, 0), 36)       // exponente 0: no divide por el DDT
  assert.equal(calcularIC(null, 6, 10, 1), null)
  assert.equal(calcularIC(20, null, 10, 1), null)
  assert.equal(calcularIC(20, 0, 10, 1), null)
  assert.equal(calcularIC(20, -3, 10, 1), null)
  assert.equal(calcularIC(20, 5, 0, 1), null)
})

test('versión vigente por fecha: la más reciente que no pase de la fecha; antes de todas, la primera', () => {
  const vs = [V2, V1]   // desordenadas a propósito
  assert.equal(versionVigente(vs, '2026-11-30').id, 'v1')
  assert.equal(versionVigente(vs, '2026-12-01').id, 'v2')
  assert.equal(versionVigente(vs, '2027-03-01').id, 'v2')
  assert.equal(versionVigente([V2], '2020-01-01').id, 'v2')   // sin ninguna anterior: la primera
  assert.equal(versionVigente([], '2026-12-01'), null)
  assert.equal(versionVigente(null, '2026-12-01'), null)
})

test('plan por DDT y avisos (nunca bloquean)', () => {
  assert.equal(planIC(V1, 6), 0.33)
  assert.equal(planIC(V1, 12), null)
  assert.equal(planIC(null, 6), null)
  assert.equal(ddtEnRangoIC(5), true)
  assert.equal(ddtEnRangoIC(20), true)
  assert.equal(ddtEnRangoIC(4), false)
  assert.equal(ddtEnRangoIC(21), false)
  assert.equal(ddtEnRangoIC(null), false)

  const dentro = resultadoIC(20, 5, '2026-11-20', [V1, V2])
  assert.equal(dentro.ic, 0.4)
  assert.equal(dentro.plan, 0.3)
  assert.equal(dentro.diferencia, 0.1)
  assert.deepEqual(dentro.avisos, [])
  assert.equal(dentro.version.id, 'v1')

  const nueva = resultadoIC(20, 5, '2026-12-05', [V1, V2])   // rige la versión 2: divisor 12
  assert.equal(nueva.ic, 0.3333)
  assert.equal(nueva.plan, 0.4)

  const fuera = resultadoIC(40, 25, '2026-11-20', [V1])
  assert.equal(fuera.ic, 0.16)
  assert.equal(fuera.plan, null)
  assert.equal(fuera.diferencia, null)
  assert.equal(fuera.avisos.length, 1)
  assert.match(fuera.avisos[0], /DDT 25/)

  assert.match(resultadoIC(10, null, '2026-11-20', [V1]).avisos[0], /fecha de siembra/)
  assert.match(resultadoIC(10, -2, '2026-11-20', [V1]).avisos[0], /anterior a la siembra/)
  const sinFormula = resultadoIC(10, 6, '2026-11-20', [])
  assert.equal(sinFormula.ic, null)
  assert.match(sinFormula.avisos.at(-1), /fórmula/)
})

test('normalizarVersiones: números como texto, orden por fecha, descarta lo inservible', () => {
  const v = normalizarVersiones({ versiones: [
    { id: 'b', vigente_desde: '2026-12-01T00:00:00', divisor: '12.0000', exponente_ddt: '1.000', notas: 'x', plan: [{ ddt: '6', ic_plan: '0.4100' }, { ddt: '5', ic_plan: '0.3' }] },
    { id: 'a', vigente_desde: '2000-01-01', divisor: 10, exponente_ddt: 1, plan: [] },
    { id: 'malo1', vigente_desde: 'ayer', divisor: 10, exponente_ddt: 1, plan: [] },
    { id: 'malo2', vigente_desde: '2026-01-01', divisor: 0, exponente_ddt: 1, plan: [] },
    { vigente_desde: '2026-01-01', divisor: 10, exponente_ddt: 1, plan: [] },
  ] })
  assert.deepEqual(v.map((x) => x.id), ['a', 'b'])
  assert.equal(v[1].divisor, 12)
  assert.equal(v[1].vigente_desde, '2026-12-01')
  assert.deepEqual(v[1].plan, [{ ddt: 5, ic_plan: 0.3 }, { ddt: 6, ic_plan: 0.41 }])
  assert.deepEqual(normalizarVersiones(null), [])
  assert.deepEqual(normalizarVersiones({ versiones: 'no' }), [])
})

test('hojas: acepta coma, rechaza texto, negativos y enormes; vacío no es error', () => {
  assert.deepEqual(validarHojas('30'), { valor: 30 })
  assert.deepEqual(validarHojas(' 12,5 '), { valor: 12.5 })
  assert.deepEqual(validarHojas(''), { vacio: true })
  assert.deepEqual(validarHojas(null), { vacio: true })
  assert.ok('error' in validarHojas('abc'))
  assert.ok('error' in validarHojas('-3'))
  assert.ok('error' in validarHojas('100000'))
  assert.deepEqual(validarHojas('99999.5'), { valor: 99999.5 })
})

test('datos de la cola: no mandan el IC; la corrección solo si se confirmó', () => {
  const base = { id: 'u1', turnoId: 't1', fecha: '2026-11-20', hojas: 30 }
  assert.deepEqual(armarDatosIC(base), { id: 'u1', turno_ciclo_id: 't1', fecha: '2026-11-20', hojas: 30 })
  assert.deepEqual(armarDatosIC({ ...base, correccion: true, comentario: ' nota ' }),
    { id: 'u1', turno_ciclo_id: 't1', fecha: '2026-11-20', hojas: 30, comentario: 'nota', correccion: true })
  assert.equal('ic_real' in armarDatosIC(base), false)
})

test('cola: un registro de IC es idempotente por id (reemplaza, no duplica) y conserva el orden', () => {
  const p = (id, hojas) => ({ id, tipo: 'indice', resumen: `IC ${id}`, datos: armarDatosIC({ id, turnoId: 't', fecha: '2026-11-20', hojas }) })
  let l = agregarPorId([], p('a', 20))
  l = agregarPorId(l, p('b', 25))
  l = agregarPorId(l, p('a', 21))   // misma id: reemplaza
  assert.deepEqual(l.map((x) => x.id), ['a', 'b'])
  assert.equal(l[0].datos.hojas, 21)
})

test('cola: procesarCola envía el IC con su función y los errores definitivos pasan a rechazados', async () => {
  const lista = [
    { id: 'i1', tipo: 'indice', resumen: 'IC 1', datos: { hojas: 20 }, orden: 1 },
    { id: 'i2', tipo: 'indice', resumen: 'IC 2', datos: { hojas: 22 }, orden: 2 },
  ]
  const enviados = [], rechazados = [], quitados = []
  const n = await procesarCola(lista, {
    subirFoto: async () => 'x',
    guardar: async (pe) => (pe.id === 'i2' ? { code: '22023', message: 'Este turno ya tiene su índice de crecimiento de ese día.' } : (enviados.push(pe.id), null)),
    quitar: async (id) => { quitados.push(id) },
    rechazar: async (r) => { rechazados.push(r) },
  })
  assert.equal(n, 1)
  assert.deepEqual(enviados, ['i1'])
  assert.deepEqual(quitados, ['i1', 'i2'])
  assert.equal(rechazados[0].id, 'i2')
  assert.match(rechazados[0].mensaje, /índice de crecimiento/)
})

test('historial: la vista del IC resume las hojas y marca la corrección', () => {
  const ctx = { turno: 'T1', lugar: 'Est 1', ddt: 8, fecha: '2026-11-20' }
  assert.deepEqual(resumirRegistro('indice', { hojas: 35 }, ctx, []).datos, ['IC: 35 hojas'])
  assert.deepEqual(resumirRegistro('indice', { hojas: 35, correccion: true }, ctx, []).datos, ['IC: 35 hojas', 'corrección'])
  const vista = resumirRegistro('indice', { hojas: 35 }, ctx, [])
  const items = unirItems([{ id: 'i1', resumen: 'IC', vista, creado_en: '2026-11-20T10:00:00Z' }], [], [], '2026-11-20T11:00:00Z')
  assert.equal(items[0].estado, 'sin_enviar')
})

test('fórmula: validación de la pantalla de administración', () => {
  const ok = { vigente_desde: '2026-12-01', divisor: '12', exponente_ddt: '1', plan: [{ ddt: '5', ic_plan: '0.3' }, { ddt: '', ic_plan: '' }] }
  assert.deepEqual(validarFormula(ok), [])
  assert.ok(validarFormula({ ...ok, vigente_desde: '' }).some((p) => p.campo === 'vigente_desde'))
  assert.ok(validarFormula({ ...ok, divisor: '0' }).some((p) => p.campo === 'divisor'))
  assert.ok(validarFormula({ ...ok, divisor: '' }).some((p) => p.campo === 'divisor'))
  assert.ok(validarFormula({ ...ok, exponente_ddt: '4' }).some((p) => p.campo === 'exponente_ddt'))
  assert.ok(validarFormula({ ...ok, plan: [{ ddt: '5', ic_plan: '0.3' }, { ddt: '5', ic_plan: '0.4' }] }).some((p) => p.campo === 'plan.1.ddt'))
  assert.ok(validarFormula({ ...ok, plan: [{ ddt: '5.5', ic_plan: '0.3' }] }).some((p) => p.campo === 'plan.0.ddt'))
  assert.ok(validarFormula({ ...ok, plan: [{ ddt: '5', ic_plan: '' }] }).some((p) => p.campo === 'plan.0.ic_plan'))
  assert.deepEqual(planParaGuardar([{ ddt: '6', ic_plan: '0,33' }, { ddt: '5', ic_plan: '0.3' }, { ddt: '', ic_plan: '' }]),
    [{ ddt: 5, ic_plan: 0.3 }, { ddt: 6, ic_plan: 0.33 }])
})
