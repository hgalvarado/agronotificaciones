// Pruebas de las cuentas puras del piloto 1 de Fertirriego (DDT, envases, productos por clase).
// Correr: node --test pruebas/unit/fertirriego_piloto1.test.mjs   (Node 22.6+ quita los tipos de los .ts solo)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  aplicacionesDelTurno,
  ddtReal,
  ddtsDelTurno,
  diasEntre,
  fechasPlanAplicadas,
  ordenarDdtsParaElegir,
  tarjetasDelTurno,
} from '../../src/lib/fertirriego/ddt.ts'
import { envasesPendientes, leerEnvases, saldosEnvasesLocales } from '../../src/lib/fertirriego/envases.ts'
import { clasesParaCrear, materialDeCampo, ordenarPorClase, productosPendientes, productosUsados } from '../../src/lib/fertirriego/productos.ts'

const T = 'turno-1'
const plan = [
  { turno_ciclo_id: T, fecha: '2026-11-01', ddt: 30, material_id: 'A', cantidad: 10, horas_riego: null },
  { turno_ciclo_id: T, fecha: '2026-11-01', ddt: 30, material_id: 'B', cantidad: 5, horas_riego: null },
  { turno_ciclo_id: T, fecha: '2026-11-05', ddt: 34, material_id: 'A', cantidad: 12, horas_riego: null },
  { turno_ciclo_id: T, fecha: '2026-11-10', ddt: 39, material_id: 'A', cantidad: 8, horas_riego: null },
  { turno_ciclo_id: 'otro', fecha: '2026-11-05', ddt: 1, material_id: 'A', cantidad: 99, horas_riego: null },
]
const apl = (x) => ({ estacion_id: 'E', turno_ciclo_id: T, fecha_hora: '', ejecutor_id: null, ejecutor2_id: null, comentario: null, registrado_por: 'p', anulado_at: null, motivo_anulacion: null, ...x })
const op = (tipo, datos, estado_local = 'PENDIENTE') => ({ id: datos.id ?? Math.random().toString(16), tipo, creado_en: '2026-11-12T10:00:00-06:00', dispositivo: '', ubicacion: null, en_nombre_de: null, datos, estado_local, intentos: 0, resumen: '' })

test('diasEntre y DDT real', () => {
  assert.equal(diasEntre('2026-10-01', '2026-11-01'), 31)
  assert.equal(diasEntre('2026-11-05', '2026-11-01'), -4)
  assert.equal(ddtReal('2026-10-02', '2026-11-03'), 32)
  assert.equal(ddtReal(null, '2026-11-03'), null)
})

test('ddtsDelTurno agrupa por fecha y solo el turno', () => {
  const d = ddtsDelTurno(plan, T)
  assert.deepEqual(d.map((x) => [x.fecha, x.ddt]), [['2026-11-01', 30], ['2026-11-05', 34], ['2026-11-10', 39]])
  assert.equal(d[0].productos.get('B'), 5)
  assert.equal(d[1].productos.get('A'), 12)
})

test('aplicadas: con fecha_plan, viejas por fecha, pendientes; extra no cuenta; anuladas no', () => {
  const ddts = ddtsDelTurno(plan, T)
  const aplicaciones = [
    apl({ id: '1', fecha: '2026-11-02', ddt_plan: 30, fecha_plan: '2026-11-01', lineas: [{ material_id: 'A', cantidad: 9 }] }),
    apl({ id: '2', fecha: '2026-11-05', lineas: [{ material_id: 'A', cantidad: 12 }] }), // vieja, sin ddt
    apl({ id: '3', fecha: '2026-11-10', extra: true, lineas: [{ material_id: 'C', cantidad: 1 }] }),
    apl({ id: '4', fecha: '2026-11-10', fecha_plan: '2026-11-10', anulado_at: 'x', lineas: [] }),
  ]
  const vista = aplicacionesDelTurno(aplicaciones, [], T, '2026-10-02')
  assert.equal(vista.length, 3)
  assert.deepEqual([...fechasPlanAplicadas(ddts, vista)].sort(), ['2026-11-01', '2026-11-05'])
  const cola = [op('aplicacion', { turno_ciclo_id: T, fecha: '2026-11-11', ddt_plan: 39, fecha_plan: '2026-11-10', lineas: [{ material_id: 'A', cantidad: 8 }] })]
  const conCola = aplicacionesDelTurno(aplicaciones, cola, T, '2026-10-02')
  assert.ok(fechasPlanAplicadas(ddts, conCola).has('2026-11-10'))
  assert.equal(conCola.find((a) => a.pendiente).ddt_real, 40)
})

test('ordenarDdtsParaElegir: sin aplicar primero, luego cercanía al día', () => {
  const ddts = ddtsDelTurno(plan, T)
  const o = ordenarDdtsParaElegir(ddts, new Set(['2026-11-10']), '2026-11-09')
  assert.deepEqual(o.map((x) => x.fecha), ['2026-11-05', '2026-11-01', '2026-11-10'])
  assert.equal(o[2].aplicado, true)
})

test('tarjetasDelTurno: plan · real · variación, extra aparte, pendientes cuentan', () => {
  const ddts = ddtsDelTurno(plan, T)
  const aplicaciones = [
    apl({ id: '1', fecha: '2026-11-02', ddt_plan: 30, fecha_plan: '2026-11-01', ddt_real: 31, lineas: [{ material_id: 'A', cantidad: 9 }] }),
    apl({ id: '3', fecha: '2026-11-07', extra: true, lineas: [{ material_id: 'C', cantidad: 1 }] }),
    apl({ id: '5', fecha: '2026-11-08', lineas: [{ material_id: 'D', cantidad: 2 }] }), // vieja sin plan ese día
  ]
  const cola = [op('aplicacion', { turno_ciclo_id: T, fecha: '2026-11-02', ddt_plan: 30, fecha_plan: '2026-11-01', lineas: [{ material_id: 'B', cantidad: 5 }] })]
  const t = tarjetasDelTurno(ddts, aplicacionesDelTurno(aplicaciones, cola, T, '2026-10-02'))
  assert.deepEqual(t.map((x) => x.clave), ['plan-2026-11-10', 'extra-5', 'extra-3', 'plan-2026-11-05', 'plan-2026-11-01'])
  const d30 = t.find((x) => x.ddtPlan === 30)
  assert.deepEqual(d30.fechasReales, ['2026-11-02'])
  assert.deepEqual(d30.ddtsReales, [31])
  const a = d30.productos.find((p) => p.material_id === 'A')
  const b = d30.productos.find((p) => p.material_id === 'B')
  assert.deepEqual([a.plan, a.real, a.pendiente, a.variacion], [10, 9, 0, -1])
  assert.deepEqual([b.plan, b.real, b.pendiente, b.variacion], [5, 0, 5, 0])
  assert.equal(t.find((x) => x.clave === 'extra-3').declarada, true)
  assert.equal(t.find((x) => x.clave === 'extra-5').declarada, false)
  assert.equal(t.find((x) => x.ddtPlan === 39).fechasReales.length, 0)
})

test('envases: servidor + recepción + conteo + anulación', () => {
  const estado = {
    envases_saldos: [{ estacion_id: 'E', envase_id: 'barril', saldo: 4 }, { estacion_id: 'X', envase_id: 'barril', saldo: 100 }],
    recepciones: [{ id: 'r1', anulado_at: null, envases: [{ envase_id: 'caneca', recibidos: 3, entregados: 1 }] }],
  }
  const cola = [
    op('recepcion', { estacion_id: 'E', envases: [{ envase_id: 'barril', recibidos: 2, entregados: 5 }] }),
    op('conteo', { estacion_id: 'E', envases: [{ envase_id: 'tote', cantidad_real: 7 }] }),
    op('anulacion', { estacion_id: 'E', documento_id: 'r1' }),
    op('recepcion', { estacion_id: 'E', envases: [{ envase_id: 'barril', recibidos: 9, entregados: 0 }] }, 'ACEPTADO'),
  ]
  const s = saldosEnvasesLocales(estado, cola, 'E')
  assert.equal(s.get('barril'), 1)
  assert.equal(s.get('tote'), 7)
  assert.equal(s.get('caneca'), -2)
  assert.equal(saldosEnvasesLocales({}, [], 'E').size, 0)
})

test('leerEnvases: vacío = 0, filas en 0 no van, solo enteros', () => {
  assert.deepEqual(leerEnvases([{ envase_id: 'a', recibidos: '2', entregados: '' }, { envase_id: 'b', recibidos: '', entregados: '' }]), {
    envases: [{ envase_id: 'a', recibidos: 2, entregados: 0 }],
  })
  assert.ok('error' in leerEnvases([{ envase_id: 'a', recibidos: '1.5', entregados: '' }]))
  assert.deepEqual(envasesPendientes([op('envase_tipo', { envase_id: 'n1', nombre: 'Tote' })]), [{ id: 'n1', nombre: 'Tote', validado: false, pendiente: true }])
})

test('productos por clase: Fertilizantes primero, después alfabético', () => {
  const mats = [
    { id: '1', codigo: 'Z', descripcion: 'Zeta', unidad: 'L', grupo: 'Químicos', analisis: false },
    { id: '2', codigo: 'N', descripcion: 'Nitrato', unidad: 'kg', grupo: 'FERT', analisis: true },
    { id: '3', codigo: 'A', descripcion: 'Ácido', unidad: 'L', grupo: 'FERT', analisis: true },
    { id: '4', codigo: 'G', descripcion: 'Guantes', unidad: 'par', grupo: 'Otros objetos', analisis: false },
  ]
  assert.deepEqual(ordenarPorClase(mats).map((x) => `${x.clase}:${x.material.codigo}`), ['Fertilizantes:A', 'Fertilizantes:N', 'Otros objetos:G', 'Químicos:Z'])
  assert.deepEqual(clasesParaCrear(mats), ['Otros insumos', 'Otros objetos', 'Químicos'])
  const m = materialDeCampo('abcdef12-3456', ' Cal ', 'kg', '')
  assert.equal(m.codigo, 'CAMPO-abcdef12')
  assert.equal(m.grupo, 'Otros insumos')
  assert.equal(m.analisis, false)
  const ops = [op('producto', { id: 'p1', material_id: 'p1', descripcion: 'Cal', unidad: 'kg', grupo: 'Otros insumos' }), op('producto', { id: 'p2', material_id: 'p2', descripcion: 'X', unidad: 'L', grupo: 'G' })]
  assert.deepEqual(productosPendientes(ops).map((x) => x.id), ['p1', 'p2'])
  assert.deepEqual(productosUsados(ops, ['p2']).map((x) => x.datos.material_id), ['p2'])
})
