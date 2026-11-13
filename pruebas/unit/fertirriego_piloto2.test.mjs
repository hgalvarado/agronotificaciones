// Pruebas de las cuentas puras del piloto 2 de Fertirriego (calculadora, bitácora con envases y filtros, grupos).
// Correr: node --test pruebas/unit/fertirriego_piloto2.test.mjs   (Node 22.6+ quita los tipos de los .ts solo)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PESOS_BULTO, evaluar, leerNumero, multiplicarBultos, textoParaCampo } from '../../src/lib/fertirriego/calculadora.ts'
import { SIN_FILTROS, filasEnvases, filtrarBitacora, filtrosActivos, nombrePersona, ordenarRecientes } from '../../src/lib/fertirriego/bitacora.ts'
import { agruparPorClase, CLASE_SIN_GRUPO } from '../../src/lib/fertirriego/productos.ts'

const op = (tipo, datos, estado_local = 'PENDIENTE', extra = {}) => ({ id: datos.id ?? 'op-' + Math.random().toString(16).slice(2), tipo, creado_en: '2026-11-13T10:00:00-06:00', dispositivo: '', ubicacion: null, en_nombre_de: null, datos, estado_local, intentos: 0, resumen: '', ...extra })

test('leerNumero: coma o punto, vacío e inválido = null', () => {
  assert.equal(leerNumero('12,5'), 12.5)
  assert.equal(leerNumero(' 3 '), 3)
  assert.equal(leerNumero(''), null)
  assert.equal(leerNumero('.'), null)
  assert.equal(leerNumero('1.2.3'), null)
  assert.equal(leerNumero('abc'), null)
})

test('bultos × kg por bulto', () => {
  assert.deepEqual(PESOS_BULTO, [9, 12.5, 25, 50, 100])
  assert.equal(multiplicarBultos('4', '12.5'), 50)
  assert.equal(multiplicarBultos('3', '9'), 27)
  assert.equal(multiplicarBultos('2,5', '25'), 62.5)
  assert.equal(multiplicarBultos('', '25'), null)
  assert.equal(multiplicarBultos('3', ''), null)
})

test('calculadora: prioridad, decimales, signos y errores (sin eval)', () => {
  assert.equal(evaluar('2+3×4'), 14)
  assert.equal(evaluar('10−4÷2'), 8)
  assert.equal(evaluar('12,5*4+3'), 53)
  assert.equal(evaluar('0.1+0.2'), 0.3)
  assert.equal(evaluar('-5+10'), 5)
  assert.equal(evaluar('3×-2'), -6)
  assert.equal(evaluar('12+'), 12) // operador colgando: se muestra lo que va
  assert.equal(evaluar('7÷0'), null)
  assert.equal(evaluar(''), null)
  assert.equal(evaluar('2++3'), null)
  assert.equal(evaluar('abc'), null)
  assert.equal(evaluar('1/3'), 0.3333)
  assert.equal(textoParaCampo(62.5), '62.5')
  assert.equal(textoParaCampo(50), '50')
})

test('nombrePersona: nombres de la 100, si no las personas conocidas', () => {
  const estado = {
    nombres: { p1: 'Ana' },
    yo: { id: 'yo', nombre: 'Yo Mismo' },
    estaciones: [{ personas: [{ id: 'p2', nombre: 'Beto' }], custodio_id: 'p3', custodio: 'Carla' }],
    relevos: [{ entrega_id: 'p4', entrega: 'Dani', recibe_id: null, recibe: null }],
    traslados: [],
  }
  assert.equal(nombrePersona(estado, 'p1'), 'Ana')
  assert.equal(nombrePersona(estado, 'yo'), 'Yo Mismo')
  assert.equal(nombrePersona(estado, 'p2'), 'Beto')
  assert.equal(nombrePersona(estado, 'p3'), 'Carla')
  assert.equal(nombrePersona(estado, 'p4'), 'Dani')
  assert.equal(nombrePersona(estado, 'zz'), null)
  assert.equal(nombrePersona(estado, null), null)
})

test('filasEnvases: de envases_movimientos (100), anulados, y lo pendiente', () => {
  const estado = {
    yo: { id: 'yo', nombre: 'Yo' },
    recepciones: [{ id: 'r1', estacion_id: 'E', fecha_hora: '2026-11-12T08:00:00-06:00', turnos: ['T1'], anulado_at: '2026-11-12T09:00:00-06:00', registrado_por: 'p1', envases: [] }],
    envases_movimientos: [
      { id: 'm1', estacion_id: 'E', envase_id: 'barril', cantidad: 3, motivo: 'RECEPCION', documento_tipo: 'recepcion', documento_id: 'r1', fecha_hora: '2026-11-12T08:00:00-06:00', registrado_por: 'p1' },
      { id: 'm2', estacion_id: 'E', envase_id: 'barril', cantidad: -2, motivo: 'ENTREGA', documento_tipo: 'recepcion', documento_id: 'r2', fecha_hora: '2026-11-12T23:30:00-06:00', registrado_por: 'p2' },
      { id: 'm3', estacion_id: 'X', envase_id: 'barril', cantidad: 9, motivo: 'RECEPCION', documento_tipo: 'recepcion', documento_id: 'r9', fecha_hora: '2026-11-12T08:00:00-06:00', registrado_por: 'p2' },
    ],
  }
  const cola = [op('recepcion', { id: 'o1', estacion_id: 'E', lineas: [], solo_envases: true, envases: [{ envase_id: 'caneca', recibidos: 0, entregados: 4 }] }, 'PENDIENTE', { en_nombre_de: 'p5' })]
  const f = filasEnvases(estado, cola, 'E')
  assert.equal(f.length, 3)
  const m1 = f.find((x) => x.clave === 'env-m1')
  assert.equal(m1.anulado, true)
  assert.deepEqual(m1.turnos, ['T1'])
  const m2 = f.find((x) => x.clave === 'env-m2')
  assert.deepEqual([m2.entrada, m2.salida, m2.dia], [0, 2, '2026-11-12']) // 23:30 UTC-6 sigue siendo el 12
  const p = f.find((x) => x.pendiente)
  assert.deepEqual([p.salida, p.registrado_por, p.envase_id, p.tipo], [4, 'p5', 'caneca', 'ENVASE'])
})

test('filasEnvases: sin la 100, de las recepciones (recibidos +, entregados −)', () => {
  const estado = {
    yo: { id: 'yo', nombre: 'Yo' },
    recepciones: [{ id: 'r1', estacion_id: 'E', fecha_hora: '2026-11-12T08:00:00-06:00', turnos: null, anulado_at: null, registrado_por: 'p1', envases: [{ envase_id: 'barril', recibidos: 2, entregados: 1 }] }],
  }
  const f = filasEnvases(estado, [], 'E')
  assert.deepEqual(f.map((x) => [x.motivo, x.entrada, x.salida]).sort(), [['ENTREGA', 0, 1], ['RECEPCION', 2, 0]])
  assert.equal(filasEnvases({ recepciones: [] }, [], 'E').length, 0)
})

test('filtros: turno, producto, tipo, fecha (día y rango) y cantidad', () => {
  const fila = (x) => ({ clave: x.clave, fecha_hora: `${x.dia}T10:00:00-06:00`, dia: x.dia, tipo: x.tipo, material_id: x.material_id ?? null, envase_id: null, entrada: x.entrada ?? 0, salida: x.salida ?? 0, saldo: null, turnos: x.turnos ?? [], documento_tipo: 'x', documento_id: x.clave, pendiente: false, anulado: false, registrado_por: null })
  const filas = [
    fila({ clave: 'a', dia: '2026-11-10', tipo: 'RECEPCION', material_id: 'A', entrada: 25, turnos: ['T1', 'T2'] }),
    fila({ clave: 'b', dia: '2026-11-11', tipo: 'APLICACION', material_id: 'A', salida: 12.5, turnos: ['T1'] }),
    fila({ clave: 'c', dia: '2026-11-12', tipo: 'APLICACION', material_id: 'B', salida: 50, turnos: ['T2'] }),
    fila({ clave: 'd', dia: '2026-11-12', tipo: 'ENVASE', entrada: 3 }),
  ]
  const claves = (f) => filtrarBitacora(filas, { ...SIN_FILTROS, ...f }).map((x) => x.clave).join('')
  assert.equal(claves({}), 'abcd')
  assert.equal(claves({ turnos: ['T2'] }), 'ac')
  assert.equal(claves({ productos: ['A'] }), 'ab')
  assert.equal(claves({ tipos: ['APLICACION', 'ENVASE'] }), 'bcd')
  assert.equal(claves({ desde: '2026-11-12', hasta: '2026-11-12' }), 'cd')
  assert.equal(claves({ desde: '2026-11-11', hasta: '' }), 'bcd')
  assert.equal(claves({ cantidadMin: '12,5', cantidadMax: '12.5' }), 'b')
  assert.equal(claves({ cantidadMin: '20', cantidadMax: '' }), 'ac')
  assert.equal(claves({ cantidadMin: '', cantidadMax: '10' }), 'd')
  assert.equal(filtrosActivos({ ...SIN_FILTROS, turnos: ['T1'], desde: '2026-11-11', cantidadMin: '1' }), 3)
  assert.equal(filtrosActivos(SIN_FILTROS), 0)
  assert.deepEqual(ordenarRecientes(filas).map((x) => x.clave).slice(0, 2).sort(), ['c', 'd'])
})

test('agruparPorClase: Fertilizantes primero, sin grupo = Otros insumos, alfabético', () => {
  const mats = {
    n: { id: 'n', codigo: 'N', descripcion: 'Nitrato', grupo: 'FERT', analisis: true },
    a: { id: 'a', codigo: 'A', descripcion: 'Ácido', grupo: 'FERT', analisis: true },
    z: { id: 'z', codigo: 'Z', descripcion: 'Zeta', grupo: 'Químicos', analisis: false },
    s: { id: 's', codigo: 'S', descripcion: 'Sin grupo', grupo: null, analisis: false },
    b: { id: 'b', codigo: 'B', descripcion: 'Bolsa', grupo: 'Empaques', analisis: false },
  }
  assert.equal(CLASE_SIN_GRUPO, 'Otros insumos')
  const g = agruparPorClase([['z', 1], ['n', 2], ['s', 3], ['a', 4], ['b', 5], ['desconocido', 6]], ([id]) => mats[id])
  assert.deepEqual(g.map((x) => [x.clase, x.fertilizantes]), [
    ['Fertilizantes', true],
    ['Empaques', false],
    ['Otros insumos', false],
    ['Químicos', false],
  ])
  assert.deepEqual(g[0].items.map(([id]) => id), ['a', 'n']) // Ácido antes que Nitrato
  assert.deepEqual(g[2].items.map(([id]) => id).sort(), ['desconocido', 's'])
})
