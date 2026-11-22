// Pruebas de src/lib/agrometricas/historialPura.ts + el aviso `confirmado` de colaPura.ts.
// Correr: node --test pruebas/unit/agrometricas_historial.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resumirDatos, resumirRegistro, podar, unirItems, agruparPorDia, diaLocal, horaLocal, vistaDeResumen } from '../../src/lib/agrometricas/historialPura.ts'
import { procesarCola } from '../../src/lib/agrometricas/colaPura.ts'

const CAMPOS = [
  { clave: 'tensiometro_12_am', etiqueta: 'Tens 12 AM', unidad: 'cb' },
  { clave: 'ce_agua', etiqueta: 'CE agua', unidad: 'dS/m' },
  { clave: 'ph_agua', etiqueta: 'pH agua' },
  { clave: 'ce_gotero', etiqueta: 'CE gotero', unidad: 'dS/m' },
  { clave: 'eto', etiqueta: 'ETo', unidad: 'mm' },
]
const AHORA = Date.parse('2026-11-21T18:00:00Z')
const dh = (h) => new Date(AHORA - h * 3600_000).toISOString()
const e = (id, h) => ({ id, tipo: 'parametros', vista: vistaDeResumen(id), creado_en: dh(h), enviado_en: dh(h) })

test('resumen: máximo 3 datos, CE/pH antes que tensiómetro, ignora vacíos y no numéricos', () => {
  const r = resumirDatos({ tensiometro_12_am: 20, ce_agua: 1.5, ph_agua: 6.8, ce_gotero: 2, eto: 4, comentario: 'x' }, CAMPOS)
  assert.deepEqual(r, ['CE gotero 2 dS/m', 'CE agua 1.5 dS/m', 'pH agua 6.8'])
  assert.deepEqual(resumirDatos({ ce_agua: null, ph_agua: '', eto: 'abc' }, CAMPOS), [])
})

test('resumirRegistro: calicata, clima y parámetros', () => {
  const ctx = { turno: 'T1', lugar: 'Est 1', ddt: 12, fecha: '2026-11-20' }
  assert.deepEqual(resumirRegistro('calicata', { precision_m: 4.5 }, ctx, CAMPOS).datos, ['Calicata ±4.5 m'])
  assert.deepEqual(resumirRegistro('clima', { eto: 3 }, ctx, CAMPOS).datos, ['ETo 3 mm'])
  const v = resumirRegistro('parametros', { ce_agua: 1, comentario: 'nota' }, ctx, CAMPOS)
  assert.deepEqual(v, { fecha: '2026-11-20', turno: 'T1', lugar: 'Est 1', ddt: 12, datos: ['CE agua 1 dS/m', 'con comentario'] })
  assert.ok(JSON.stringify(v).length < 1024)
})

test('podar: quita >14 días, deja máx. 200 más recientes, ilegibles se borran', () => {
  const lista = [e('nuevo', 1), e('viejo', 15 * 24), e('limite', 13 * 24), { ...e('roto', 1), enviado_en: 'no-fecha' }]
  const { conservar, quitar } = podar(lista, AHORA)
  assert.deepEqual(conservar.map((x) => x.id), ['nuevo', 'limite'])
  assert.deepEqual(quitar.sort(), ['roto', 'viejo'])
  const muchos = Array.from({ length: 250 }, (_, i) => e(`m${i}`, i / 100))   // más nuevo = índice menor
  const r = podar(muchos, AHORA)
  assert.equal(r.conservar.length, 200)
  assert.equal(r.quitar.length, 50)
  assert.equal(r.conservar[0].id, 'm0')
  assert.ok(!r.conservar.some((x) => x.id === 'm249'))
  assert.deepEqual(podar([], AHORA), { conservar: [], quitar: [] })
})

test('unirItems: estados, prioridad rechazado > sin enviar > enviado, orden reciente primero, vista de respaldo', () => {
  const ahora = new Date(AHORA).toISOString()
  const items = unirItems(
    [{ id: 'a', resumen: 'Viejo A', creado_en: dh(3) }, { id: 'b', resumen: 'B', creado_en: dh(2) }],
    [{ id: 'b', resumen: 'B', creado_en: dh(2), mensaje: 'fecha no válida' }],
    [e('c', 5), e('a', 3)],
    ahora,
  )
  assert.deepEqual(items.map((i) => [i.id, i.estado]), [['b', 'rechazado'], ['a', 'sin_enviar'], ['c', 'enviado']])
  assert.equal(items[0].mensaje, 'fecha no válida')
  assert.equal(items[1].vista.turno, 'Viejo A')
})

test('diaLocal/horaLocal en UTC-6', () => {
  assert.equal(diaLocal('2026-11-21T03:30:00Z'), '2026-11-20')
  assert.equal(horaLocal('2026-11-21T03:30:00Z'), '21:30')
  assert.equal(diaLocal('basura'), '')
})

test('agruparPorDia: Hoy / Ayer / fecha, límite y orden', () => {
  const it = (id, iso) => ({ id, estado: 'enviado', cuando: iso, vista: vistaDeResumen(id) })
  const items = [it('1', '2026-11-21T20:00:00Z'), it('2', '2026-11-21T10:00:00Z'), it('3', '2026-11-21T03:00:00Z'), it('4', '2026-11-18T15:00:00Z')]
  const g = agruparPorDia(items, '2026-11-21', '2026-11-20')
  assert.deepEqual(g.map((x) => [x.etiqueta, x.items.map((i) => i.id)]), [['Hoy', ['1', '2']], ['Ayer', ['3']], ['2026-11-18', ['4']]])
  const corto = agruparPorDia(items, '2026-11-21', '2026-11-20', 3)
  assert.equal(corto.reduce((n, x) => n + x.items.length, 0), 3)
  assert.deepEqual(agruparPorDia([], '2026-11-21', '2026-11-20'), [])
})

test('procesarCola: avisa `confirmado` solo cuando la base confirma; si el aviso falla no frena la cola', async () => {
  const conf = []
  const quitados = []
  const lista = [
    { id: 'ok', tipo: 'parametros', datos: {}, resumen: 'ok' },
    { id: 'mal', tipo: 'parametros', datos: {}, resumen: 'mal' },
    { id: 'ok2', tipo: 'parametros', datos: {}, resumen: 'ok2' },
  ]
  const n = await procesarCola(lista, {
    subirFoto: async () => 'x',
    guardar: async (p) => (p.id === 'mal' ? { code: 'P0001', message: 'no' } : null),
    quitar: async (id) => { quitados.push(id) },
    rechazar: async () => {},
    confirmado: async (p) => { conf.push(p.id); if (p.id === 'ok') throw new Error('historial roto') },
  })
  assert.equal(n, 2)
  assert.deepEqual(conf, ['ok', 'ok2'])
  assert.deepEqual(quitados, ['ok', 'mal', 'ok2'])
})
