// Pruebas de src/lib/agrometricas/registrosPura.ts (pantalla «Registros de la temporada»).
// Correr: node --test pruebas/unit/agrometricas_registros.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  GRUPOS, agruparPorDia, etiquetaDia, seriesPorDdt, indexarSparks, turnosDe, escalar, validarMotivo, validarEdicion,
  cambiosDeEdicion, valorGrupo, grupoFuera, paramsConsulta, filtrarLocal, unirPagina, FILTROS_VACIOS, POR_PAGINA,
} from '../../src/lib/agrometricas/registrosPura.ts'

const reg = (o) => ({ id: 'x', fecha: '2026-11-20', ddt: 10, turno: 'T1002-T36', temporada: '2026-2027', ciclo: 'Ciclo 1',
  estacion: null, zona_id: 'z1', zona: 'Z1', lotes: [], fuera_rango: [], comentario: null, puede_editar: false, puede_eliminar: false, ...o })
const G = (c) => GRUPOS.find((g) => g.clave === c)

test('etiquetaDia: hoy, ayer y fecha con día de la semana', () => {
  assert.equal(etiquetaDia('2026-11-21', '2026-11-21', '2026-11-20'), 'Hoy')
  assert.equal(etiquetaDia('2026-11-20', '2026-11-21', '2026-11-20'), 'Ayer')
  assert.equal(etiquetaDia('2026-11-15', '2026-11-21', '2026-11-20'), 'dom 15/11/2026')
})

test('agruparPorDia: día reciente primero, turnos en orden dentro del día', () => {
  const g = agruparPorDia([
    reg({ id: 'a', fecha: '2026-11-18', turno: 'T2' }), reg({ id: 'b', fecha: '2026-11-20', turno: 'T9' }),
    reg({ id: 'c', fecha: '2026-11-20', turno: 'T1' }),
  ], '2026-11-21', '2026-11-20')
  assert.deepEqual(g.map((x) => x.dia), ['2026-11-20', '2026-11-18'])
  assert.deepEqual(g[0].registros.map((r) => r.turno), ['T1', 'T9'])
  assert.equal(g[0].etiqueta, 'Ayer')
  assert.deepEqual(agruparPorDia([]), [])
})

test('valorGrupo promedia los campos con dato y redondea; null si no hay', () => {
  assert.equal(valorGrupo(reg({ tensiometro_12_am: 10, tensiometro_24_am: '20', tensiometro_12_pm: null }), G('tensiometros')), 15)
  assert.equal(valorGrupo(reg({ ce_gotero: 1.234 }), G('ce')), 1.23)
  assert.equal(valorGrupo(reg({}), G('ph')), null)
})

test('grupoFuera mira fuera_rango por campo', () => {
  assert.equal(grupoFuera(reg({ fuera_rango: ['ph_agua'] }), G('ph')), true)
  assert.equal(grupoFuera(reg({ fuera_rango: ['ph_agua'] }), G('ce')), false)
})

test('seriesPorDdt: ordena por DDT, omite series vacías y cuenta los sin DDT', () => {
  const regs = [
    reg({ id: '1', ddt: 12, fecha: '2026-11-22', ce_gotero: 2.0, fuera_rango: ['ce_gotero'] }),
    reg({ id: '2', ddt: 10, fecha: '2026-11-20', ce_gotero: 1.8, ce_agua: 0.5 }),
    reg({ id: '3', ddt: null, ce_gotero: 9 }),
  ]
  const { series, sinDdt } = seriesPorDdt(regs, G('ce'))
  assert.equal(sinDdt, 1)
  assert.deepEqual(series.map((s) => s.campo), ['ce_agua', 'ce_gotero'])
  const gotero = series[1].puntos
  assert.deepEqual(gotero.map((p) => p.x), [10, 12])
  assert.equal(gotero[1].fuera, true)
  assert.deepEqual(seriesPorDdt([], G('ph')).series, [])
})

test('indexarSparks: por turno y grupo, ordenado por DDT, sin DDT no entra', () => {
  const m = indexarSparks([reg({ id: '1', ddt: 5, ph_gotero: 6 }), reg({ id: '2', ddt: 3, ph_gotero: 7 }), reg({ id: '3', ddt: null, ph_gotero: 1 })])
  assert.deepEqual(m.get('T1002-T36').ph, [{ x: 3, y: 7 }, { x: 5, y: 6 }])
})

test('turnosDe cuenta y ordena', () => {
  assert.deepEqual(turnosDe([reg({ turno: 'B' }), reg({ turno: 'A' }), reg({ turno: 'B' })]), [{ turno: 'A', n: 1 }, { turno: 'B', n: 2 }])
})

test('escalar: dentro de la caja, un punto no divide por cero, banda del IC', () => {
  const caja = { ancho: 100, alto: 50, margen: 5 }
  const uno = escalar([{ campo: 'a', etiqueta: 'A', puntos: [{ x: 7, y: 3, fecha: '', fuera: false }] }], caja)
  assert.ok(Number.isFinite(uno.series[0].puntos[0].cx) && Number.isFinite(uno.series[0].puntos[0].cy))
  const dos = escalar([{ campo: 'a', etiqueta: 'A', puntos: [{ x: 1, y: 1, fecha: '', fuera: false }, { x: 9, y: 5, fecha: '', fuera: false }] }], caja,
    [{ x: 1, min: 0, max: 2 }, { x: 9, min: 4, max: 6 }])
  for (const p of dos.series[0].puntos) { assert.ok(p.cx >= 5 && p.cx <= 95); assert.ok(p.cy >= 5 && p.cy <= 45) }
  assert.ok(dos.banda.startsWith('M') && dos.banda.endsWith('Z'))
  assert.equal(escalar([], caja).series.length, 0)
  assert.equal(uno.banda, '')
})

test('validarMotivo: mínimo 15 letras sin contar espacios de los extremos', () => {
  assert.equal(validarMotivo('corto').ok, false)
  assert.equal(validarMotivo('corto').faltan, 10)
  assert.equal(validarMotivo('   ' + 'a'.repeat(14) + '   ').ok, false)
  assert.equal(validarMotivo('a'.repeat(15)).ok, true)
  assert.equal(validarMotivo(null).faltan, 15)
  assert.equal(validarMotivo('  hola  ').motivo, 'hola')
})

test('validarEdicion: coma decimal, vacío limpia, texto y enormes se rechazan', () => {
  const v = validarEdicion({ ce_agua: '1,5', ph_agua: '', ce_gotero: 'abc', ph_gotero: '99999999' })
  assert.equal(v.ok, false)
  assert.equal(v.numeros.ce_agua, 1.5)
  assert.equal(v.numeros.ph_agua, null)
  assert.ok(v.errores.ce_gotero && v.errores.ph_gotero)
  assert.equal(validarEdicion({ ce_agua: '2' }).ok, true)
})

test('cambiosDeEdicion: solo lo que cambió y solo columnas editables', () => {
  const orig = { ce_agua: 1.5, ph_agua: 7, ce_gotero: null }
  assert.deepEqual(cambiosDeEdicion(orig, { ce_agua: 1.5, ph_agua: 7.2, ce_gotero: null }), { ph_agua: 7.2 })
  assert.deepEqual(cambiosDeEdicion(orig, { ph_agua: null }), { ph_agua: null })
  assert.deepEqual(cambiosDeEdicion(orig, { eto: 5 }), {})
})

test('paramsConsulta: una selección va al servidor, varias se recortan en local', () => {
  const p = paramsConsulta({ ...FILTROS_VACIOS, turno: ['T1'], lotes: ['1002-120'], desde: '2026-11-01', texto: ' riego ' }, 2)
  assert.deepEqual(p, { limite: POR_PAGINA, pagina: 2, orden: 'desc', turno: 'T1', lotes: ['1002-120'], desde: '2026-11-01', texto: 'riego' })
  const varias = paramsConsulta({ ...FILTROS_VACIOS, turno: ['T1', 'T2'], zona: ['z1', 'z2'] }, 0)
  assert.equal(varias.turno, undefined)
  assert.equal(varias.zona_id, undefined)
  assert.equal(POR_PAGINA, 50)
})

test('filtrarLocal: turno exacto con selección múltiple (la base ya compara exacto)', () => {
  const regs = [reg({ id: '1', turno: 'T1002-T3' }), reg({ id: '2', turno: 'T1002-T36' }), reg({ id: '3', turno: 'T1002-T37', zona_id: 'z2' })]
  assert.deepEqual(filtrarLocal(regs, { ...FILTROS_VACIOS, turno: ['T1002-T3'] }).map((r) => r.id), ['1'])
  assert.deepEqual(filtrarLocal(regs, { ...FILTROS_VACIOS, zona: ['z2'] }).map((r) => r.id), ['3'])
  assert.equal(filtrarLocal(regs, FILTROS_VACIOS).length, 3)
})

test('unirPagina no repite ids; gana el nuevo', () => {
  const r = unirPagina([reg({ id: 'a', ce_agua: 1 }), reg({ id: 'b' })], [reg({ id: 'b', ce_agua: 9 }), reg({ id: 'c' })])
  assert.deepEqual(r.map((x) => x.id), ['a', 'b', 'c'])
  assert.equal(r[1].ce_agua, 9)
})
