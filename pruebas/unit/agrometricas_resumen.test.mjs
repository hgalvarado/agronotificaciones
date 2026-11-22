// Pruebas de src/lib/agrometricas/resumenPura.ts y de los ayudantes nuevos de registrosPura.ts (Resumen, horas/%, zona, quién registró).
// Correr: node --test pruebas/unit/agrometricas_resumen.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  PARAMETROS_RESUMEN, FILTROS_RESUMEN_VACIOS, sumarDias, rangoPorDefecto, rangoEfectivo, etiquetaCiclo, paramsResumen, filtrarResumen,
  campoDe, marcasEje, armarResumen,
} from '../../src/lib/agrometricas/resumenPura.ts'
import { GRUPOS, nombreZona, quienRegistro, valorGrupo } from '../../src/lib/agrometricas/registrosPura.ts'

const HOY = '2026-11-22'
const reg = (o) => ({ id: Math.random().toString(36).slice(2), fecha: '2026-11-20', ddt: 10, turno: 'T1', temporada: '2026-2027', ciclo: 'Ciclo 1',
  estacion: null, zona_id: 'z1', zona: '2A', lotes: [], fuera_rango: [], comentario: null, puede_editar: false, puede_eliminar: false, solo_horas: false, ...o })
const R = (campo, extra = {}) => ({ campo, ...extra })

test('sumarDias y rango por defecto: 14 días terminando hoy', () => {
  assert.equal(sumarDias('2026-11-22', -13), '2026-11-09')
  assert.equal(sumarDias('2026-12-31', 1), '2027-01-01')
  assert.deepEqual(rangoPorDefecto(HOY), { desde: '2026-11-09', hasta: HOY })
})

test('rangoEfectivo: vacío = últimos 14 días; solo «hasta» = 14 días hacia atrás; al revés se intercambia', () => {
  assert.deepEqual(rangoEfectivo({ desde: '', hasta: '' }, HOY), { desde: '2026-11-09', hasta: HOY })
  assert.deepEqual(rangoEfectivo({ desde: '', hasta: '2026-11-10' }, HOY), { desde: '2026-10-28', hasta: '2026-11-10' })
  assert.deepEqual(rangoEfectivo({ desde: '2026-11-20', hasta: '2026-11-01' }, HOY), { desde: '2026-11-01', hasta: '2026-11-20' })
  assert.deepEqual(rangoEfectivo({ desde: 'basura', hasta: '' }, HOY), { desde: '2026-11-09', hasta: HOY })
})

test('etiquetaCiclo normaliza «Ciclo-1», «ciclo 1» y «CICLO1»', () => {
  assert.equal(etiquetaCiclo('Ciclo-1'), 'Ciclo 1')
  assert.equal(etiquetaCiclo('ciclo 2'), 'Ciclo 2')
  assert.equal(etiquetaCiclo('CICLO03'), 'Ciclo 3')
  assert.equal(etiquetaCiclo(null), '')
  assert.equal(etiquetaCiclo('Especial'), 'Especial')
})

test('paramsResumen: rango ampliado hasta hoy, lotes y zona única a la base; ciclo y turnos NO van', () => {
  const p = paramsResumen({ ...FILTROS_RESUMEN_VACIOS, lotes: ['1002-120'], zona: ['z1'], ciclo: ['Ciclo 1'], turno: ['T1'], desde: '2026-11-18', hasta: '2026-11-19' }, 2, HOY)
  assert.equal(p.limite, 1000); assert.equal(p.pagina, 2); assert.equal(p.orden, 'asc')
  assert.equal(p.desde, '2026-11-09')   // las tarjetas necesitan los últimos 14 días
  assert.equal(p.hasta, HOY)            // y «hoy»
  assert.deepEqual(p.lotes, ['1002-120']); assert.equal(p.zona_id, 'z1')
  assert.equal('turno' in p, false); assert.equal('ciclo' in p, false)
  const q = paramsResumen({ ...FILTROS_RESUMEN_VACIOS, zona: ['a', 'b'], desde: '2026-10-01', hasta: '2026-10-31' }, 0, HOY)
  assert.equal(q.desde, '2026-10-01'); assert.equal('zona_id' in q, false)
  assert.equal(q.hasta, HOY)
})

test('filtrarResumen: ciclo normalizado, zona y turno', () => {
  const rs = [reg({ id: 'a', ciclo: 'Ciclo-1' }), reg({ id: 'b', ciclo: 'Ciclo 2', turno: 'T2' }), reg({ id: 'c', zona_id: 'z2', turno: 'T3' })]
  assert.deepEqual(filtrarResumen(rs, { ciclo: ['Ciclo 1'], zona: [], turno: [] }).map((r) => r.id), ['a', 'c'])
  assert.deepEqual(filtrarResumen(rs, { ciclo: [], zona: ['z2'], turno: [] }).map((r) => r.id), ['c'])
  assert.deepEqual(filtrarResumen(rs, { ciclo: [], zona: [], turno: ['T2', 'T3'] }).map((r) => r.id), ['b', 'c'])
  assert.equal(filtrarResumen(rs, { ciclo: [], zona: [], turno: [] }).length, 3)
})

test('campoDe: la medida que no es del parámetro vuelve a la primera', () => {
  assert.equal(campoDe('ce', 'ce_gotero'), 'ce_gotero')
  assert.equal(campoDe('ph', 'ce_gotero'), 'ph_agua')
  assert.equal(campoDe('horas', ''), 'horas_riego')
  assert.equal(campoDe('pct', 'x'), 'pct_fertilizacion')
  assert.equal(PARAMETROS_RESUMEN.length, 6)
})

test('marcasEje cubre el rango con pasos 1/2/5', () => {
  const m = marcasEje(0, 9, 5)
  assert.equal(m[0], 0); assert.ok(m[m.length - 1] >= 9)
  assert.deepEqual(marcasEje(3, 3, 5).length > 1, true)
})

const base = [
  reg({ id: '1', turno: 'T1', fecha: '2026-11-22', ddt: 20, ph_agua: 6.0, horas_riego: 4, pct_fertilizacion: 50 }),
  reg({ id: '2', turno: 'T1', fecha: '2026-11-21', ddt: 19, ph_agua: 6.2 }),
  reg({ id: '3', turno: 'T2', fecha: '2026-11-21', ddt: 20, ph_agua: 7.0, fuera_rango: ['ph_agua'] }),
  reg({ id: '4', turno: 'T3', fecha: '2026-11-05', ddt: 5, ph_agua: 6.5 }),                 // fuera de «activos» (más de 14 días)
  reg({ id: '5', turno: 'T2', fecha: '2026-11-20', ddt: 19, id_x: 1, solo_horas: true, ph_agua: null, horas_riego: 6 }), // día solo con horas
]
const opt = (extra = {}) => ({ hoy: HOY, desde: '2026-11-09', hasta: HOY, parametro: 'ph', medida: '', ...extra })

test('tarjetas: activos, con registro hoy, sin registro hoy, registros de la semana (los solo-horas no cuentan)', () => {
  const t = armarResumen(base, opt()).tarjetas
  assert.equal(t.turnos_activos, 2)                      // T1 y T2 (T3 es de hace 17 días; el solo-horas de T2 no cuenta, pero T2 tiene el de 21)
  assert.equal(t.con_registro_hoy, 1)                    // T1
  assert.deepEqual(t.sin_registro_hoy.map((x) => x.turno), ['T2'])
  assert.equal(t.sin_registro_hoy[0].ultimo, '2026-11-21')
  assert.equal(t.registros_semana, 3)                    // 1, 2, 3 (el 4 es viejo, el 5 es solo horas)
})

test('mapa de calor: días del rango, celdas valor / sin medida / sin registro, y fuera de rango', () => {
  const m = armarResumen(base, opt()).mapa
  assert.equal(m.dias.length, 14); assert.equal(m.dias[13], HOY); assert.equal(m.dias[0], '2026-11-09')
  const t1 = m.filas.find((f) => f.turno === 'T1'), t2 = m.filas.find((f) => f.turno === 'T2')
  assert.equal(t1.celdas[13].v, 6); assert.equal(t1.celdas[13].estado, 'valor'); assert.equal(t1.celdas[13].ddt, 20)
  assert.equal(t1.celdas[12].v, 6.2)
  assert.equal(t1.celdas[10].estado, 'sin_registro')
  assert.equal(t2.celdas[12].fuera, true)
  assert.equal(t2.celdas[11].estado, 'sin_medida')       // 20-nov: solo horas, sin pH
  assert.equal(m.filas.some((f) => f.turno === 'T3'), false)   // sin datos en la ventana
})

test('con turnos elegidos el mapa muestra esas filas aunque estén vacías', () => {
  const m = armarResumen(base, opt({ turnos: ['T3', 'T1'] })).mapa
  assert.deepEqual(m.filas.map((f) => f.turno), ['T1', 'T3'])
  assert.ok(m.filas[1].celdas.every((c) => c.estado === 'sin_registro'))
})

test('horas de riego y % de fertilización son parámetros: sirven en mapa y líneas, y un día solo-horas cuenta como dato', () => {
  const h = armarResumen(base, opt({ parametro: 'horas' }))
  assert.equal(h.campo, 'horas_riego')
  assert.equal(h.mapa.filas.find((f) => f.turno === 'T2').celdas[11].v, 6)   // el día solo-horas de T2
  assert.deepEqual(h.lineas.find((l) => l.turno === 'T2').puntos, [[19, 6]])
  const p = armarResumen(base, opt({ parametro: 'pct' }))
  assert.deepEqual(p.lineas.map((l) => l.turno), ['T1'])
  assert.deepEqual(p.lineas[0].puntos, [[20, 50]])
})

test('líneas por DDT: promedio por DDT, sin DDT inválido, máximo de series; el rango recorta', () => {
  const rs = [
    reg({ turno: 'T1', fecha: '2026-11-20', ddt: 18, ph_agua: 6 }), reg({ turno: 'T1', fecha: '2026-11-21', ddt: 19, ph_agua: 6.4 }),
    reg({ turno: 'T1', fecha: '2026-11-21', ddt: 19, ph_agua: 6.6 }),
    reg({ turno: 'T1', fecha: '2026-11-21', ddt: 20435, ph_agua: 5 }), reg({ turno: 'T1', fecha: '2026-11-21', ddt: null, ph_agua: 5 }),
    reg({ turno: 'T1', fecha: '2026-10-01', ddt: 2, ph_agua: 9 }),
  ]
  const l = armarResumen(rs, opt()).lineas
  assert.equal(l.length, 1)
  assert.deepEqual(l[0].puntos, [[18, 6], [19, 6.5]])
  const muchos = Array.from({ length: 12 }, (_, i) => reg({ turno: `T${i + 1}`, fecha: sumarDias(HOY, -i % 5), ddt: 10, ph_agua: 6 }))
  assert.equal(armarResumen(muchos, opt()).lineas.length, 8)
})

test('comparación al mismo DDT: elige el DDT más alto con ≥ 2 turnos y ordena de mayor a menor', () => {
  const rs = [
    reg({ turno: 'A', ddt: 20, ph_agua: 6.0 }), reg({ turno: 'B', ddt: 20, ph_agua: 7.1 }), reg({ turno: 'C', ddt: 19, ph_agua: 6.5 }),
    reg({ turno: 'D', ddt: 30, ph_agua: 5.0 }),
  ]
  const c = armarResumen(rs, opt()).comparacion
  assert.equal(c.ddt, 20)
  assert.deepEqual(c.barras.map((b) => [b.turno, b.valor]), [['B', 7.1], ['C', 6.5], ['A', 6]])   // C a ±1 día; D está lejos
  assert.equal(armarResumen(rs, opt({ ddtComparar: 30 })).comparacion.barras.length, 1)
  assert.deepEqual(armarResumen([], opt()).comparacion, { ddt: null, barras: [] })
})

test('sin registros: todo vacío y sin errores', () => {
  const r = armarResumen([], opt())
  assert.equal(r.tarjetas.turnos_activos, 0); assert.deepEqual(r.mapa.filas, []); assert.deepEqual(r.lineas, []); assert.deepEqual(r.catalogo, [])
})

test('GRUPOS incluye % de fertilización y las horas salen del registro', () => {
  assert.ok(GRUPOS.some((g) => g.clave === 'pct'))
  const g = GRUPOS.find((x) => x.clave === 'horas')
  assert.equal(valorGrupo({ horas_riego: '4.25' }, g), 4.3)
  assert.equal(valorGrupo({}, g), null)
  assert.equal(valorGrupo({ pct_fertilizacion: 60 }, GRUPOS.find((x) => x.clave === 'pct')), 60)
})

test('nombreZona: «Zona-2A» como AGL; si ya empieza por «Zona» se deja tal cual; nunca un UUID', () => {
  assert.equal(nombreZona('2A'), 'Zona-2A')
  assert.equal(nombreZona('Zona-2A'), 'Zona-2A')
  assert.equal(nombreZona('Zona 1'), 'Zona 1')
  assert.equal(nombreZona('zona_3'), 'zona_3')
  assert.equal(nombreZona(' 1 '), 'Zona-1')
  assert.equal(nombreZona(null), '')
  assert.equal(nombreZona('3f2b8a52-0c6d-4d57-9a8e-123456789abc'), '')
})

test('quienRegistro: nombre, si no el correo; nunca el UUID', () => {
  assert.equal(quienRegistro({ creado_por_nombre: 'Glopez', creado_por_email: 'a@b.c' }), 'Glopez')
  assert.equal(quienRegistro({ creado_por_nombre: null, creado_por_email: 'a@b.c' }), 'a@b.c')
  assert.equal(quienRegistro({ creado_por_nombre: '  ', creado_por_email: 'a@b.c' }), 'a@b.c')
  assert.equal(quienRegistro({ creado_por_nombre: '3f2b8a52-0c6d-4d57-9a8e-123456789abc', creado_por_email: 'x@y.z' }), 'x@y.z')
  assert.equal(quienRegistro({ creado_por_nombre: '3f2b8a52-0c6d-4d57-9a8e-123456789abc' }), '')
  assert.equal(quienRegistro({}), '')
})
