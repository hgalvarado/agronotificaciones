// Pruebas de src/lib/agrometricas/registrosIC.ts (Registros de la temporada › Índice de crecimiento).
// Correr: node --test pruebas/unit/agrometricas_registros_ic.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

// registrosIC.ts importa './registrosPura' sin extensión (estilo del proyecto): se resuelve a .ts.
register(
  'data:text/javascript,' +
    encodeURIComponent(
      `export async function resolve(s, c, n) { try { return await n(s, c) } catch (e) { if (s.startsWith('.') && !/\\.[cm]?[jt]sx?$/.test(s)) return n(s + '.ts', c); throw e } }`
    )
)
const { textoIC, diferenciaIC, estadoContraPlan, seriesIC, seriesHojas, sparksIC, validarHojas, DECIMALES_IC, planEnDdt, resumenTurnoIC, resumenPorTurno } =
  await import('../../src/lib/agrometricas/registrosIC.ts')

const reg = (o) => ({ id: 'x', fecha: '2026-11-20', ddt: 10, turno: 'T1', temporada: '2026-2027', ciclo: 'Ciclo 1',
  estacion: null, zona_id: 'z1', zona: 'Z1', lotes: [], fuera_rango: [], comentario: null, puede_editar: false,
  puede_eliminar: false, hojas: null, ic_real: null, ic_plan: null, ...o })

test('textoIC: 3 decimales y «—» sin dato', () => {
  assert.equal(DECIMALES_IC, 3)
  assert.equal(textoIC(null), '—')
  assert.equal(textoIC(0.123456), '0.123')
  assert.equal(textoIC(0.1), '0.1')
  assert.equal(textoIC(1.23456, 1), '1.2')
  assert.equal(textoIC(0), '0')
})

test('diferenciaIC: real − plan redondeado; null si falta uno; acepta texto numérico', () => {
  assert.equal(diferenciaIC(reg({ ic_real: 0.27, ic_plan: 0.25 })), 0.02)
  assert.equal(diferenciaIC(reg({ ic_real: '0.2', ic_plan: 0.25 })), -0.05)
  assert.equal(diferenciaIC(reg({ ic_real: 0.2 })), null)
  assert.equal(diferenciaIC(reg({ ic_plan: 0.2 })), null)
})

test('estadoContraPlan: sobre (≥), bajo (<) o null', () => {
  assert.equal(estadoContraPlan(reg({ ic_real: 0.3, ic_plan: 0.3 })), 'sobre')
  assert.equal(estadoContraPlan(reg({ ic_real: 0.31, ic_plan: 0.3 })), 'sobre')
  assert.equal(estadoContraPlan(reg({ ic_real: 0.29, ic_plan: 0.3 })), 'bajo')
  assert.equal(estadoContraPlan(reg({ ic_real: 0.29 })), null)
})

test('seriesIC: real ordenado por DDT, plan un punto por DDT, sin DDT se cuenta aparte', () => {
  const { series, sinDdt } = seriesIC([
    reg({ id: 'a', ddt: 12, ic_real: 0.3, ic_plan: 0.28 }),
    reg({ id: 'b', ddt: 6, ic_real: 0.2, ic_plan: 0.15 }),
    reg({ id: 'c', ddt: 12, ic_real: 0.32, ic_plan: 0.28 }),
    reg({ id: 'd', ddt: null, ic_real: 0.5, ic_plan: 0.5 }),
  ])
  assert.equal(sinDdt, 1)
  assert.deepEqual(series.map((s) => s.campo), ['ic_real', 'ic_plan'])
  assert.deepEqual(series[0].puntos.map((p) => [p.x, p.y]), [[6, 0.2], [12, 0.3], [12, 0.32]])
  assert.deepEqual(series[1].puntos.map((p) => [p.x, p.y]), [[6, 0.15], [12, 0.28]])
  assert.equal(series[0].etiqueta, 'IC real')
  assert.equal(series[1].etiqueta, 'IC plan')
  assert.deepEqual(seriesIC([]), { series: [], sinDdt: 0 })
  // sin plan: solo la serie real
  assert.deepEqual(seriesIC([reg({ ic_real: 0.2 })]).series.map((s) => s.campo), ['ic_real'])
})

test('seriesHojas: hojas por DDT ordenadas; vacío sin datos', () => {
  const s = seriesHojas([reg({ ddt: 15, hojas: 30 }), reg({ ddt: 5, hojas: '12' }), reg({ ddt: 8, hojas: null })])
  assert.equal(s.length, 1)
  assert.equal(s[0].etiqueta, 'Hojas')
  assert.deepEqual(s[0].puntos.map((p) => [p.x, p.y]), [[5, 12], [15, 30]])
  assert.deepEqual(seriesHojas([reg({ hojas: null })]), [])
})

test('sparksIC: por turno, ordenado por DDT, salta sin DDT o sin IC real', () => {
  const m = sparksIC([
    reg({ turno: 'T1', ddt: 10, ic_real: 0.3 }), reg({ turno: 'T1', ddt: 5, ic_real: 0.2 }),
    reg({ turno: 'T2', ddt: 7, ic_real: 0.25 }), reg({ turno: 'T2', ddt: null, ic_real: 0.9 }),
    reg({ turno: 'T3', ddt: 7, ic_real: null }),
  ])
  assert.deepEqual([...m.keys()].sort(), ['T1', 'T2'])
  assert.deepEqual(m.get('T1'), [{ x: 5, y: 0.2 }, { x: 10, y: 0.3 }])
  assert.deepEqual(m.get('T2'), [{ x: 7, y: 0.25 }])
})

test('validarHojas: número válido, coma decimal, errores en español', () => {
  assert.deepEqual(validarHojas('27'), { ok: true, hojas: 27 })
  assert.deepEqual(validarHojas(' 27,5 '), { ok: true, hojas: 27.5 })
  for (const malo of ['', null, undefined, 'abc', '-3', '1e3', '2.']) {
    const r = validarHojas(malo)
    assert.equal(r.ok, false, `«${malo}» debía fallar`)
    assert.match(r.error, /hojas/)
  }
  assert.deepEqual(validarHojas('100000'), { ok: false, error: 'El número de hojas es demasiado grande.' })
  assert.equal(validarHojas('99999').ok, true)
})

const PLAN = [{ ddt: 5, ic_plan: 0.3 }, { ddt: 10, ic_plan: 0.5 }, { ddt: 20, ic_plan: 1.0 }]

test('planEnDdt: exacto, interpolado y fuera de la tabla', () => {
  assert.equal(planEnDdt(PLAN, 10), 0.5)
  assert.equal(planEnDdt(PLAN, 15), 0.75)
  assert.equal(planEnDdt(PLAN, 4), null)
  assert.equal(planEnDdt([], 10), null)
})

test('resumenTurnoIC: % del plan, tendencia y frase', () => {
  const r = resumenTurnoIC([
    reg({ id: 'a', ddt: 6, ic_real: 0.3, ic_plan: 0.32 }),
    reg({ id: 'b', ddt: 12, ic_real: 0.6, ic_plan: 0.6 }),
    reg({ id: 'c', ddt: 18, ic_real: 0.7, ic_plan: 0.9 }),
  ], PLAN)
  assert.equal(r.ddt, 18)
  assert.equal(r.pct, 78)
  assert.equal(r.dif, -0.2)
  assert.equal(r.tendencia, 'sube')
  assert.match(r.frase, /78 % del plan en el DDT 18.*por debajo/)
})

test('resumenTurnoIC: sin plan en el registro usa la tabla; sin IC avisa; fuera de ventana se cuenta', () => {
  const r = resumenTurnoIC([reg({ ddt: 10, ic_real: 0.5 }), reg({ id: 'z', ddt: 3, ic_real: 0.1 })], PLAN)
  assert.equal(r.pct, 100)
  assert.equal(r.fueraVentana, 1)
  const v = resumenTurnoIC([reg({ ddt: null, ic_real: null })], PLAN)
  assert.equal(v.pct, null)
  assert.match(v.frase, /todavía no hay IC/)
})

test('resumenPorTurno: del más atrasado al más adelantado', () => {
  const regs = [reg({ turno: 'A', ddt: 10, ic_real: 0.6, ic_plan: 0.5 }), reg({ turno: 'B', ddt: 10, ic_real: 0.25, ic_plan: 0.5 }), reg({ turno: 'C', ddt: null })]
  assert.deepEqual(resumenPorTurno(regs, ['A', 'B', 'C'], PLAN).map((x) => x.turno), ['B', 'A', 'C'])
})
