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
const { dosisPorMz, areaPropuesta, armarAplicacionLote, lineasDelPlan } = await import(pathToFileURL(resolve('src/lib/inyeccion/aplicarLote.ts')).href)
const { normalizarObjetivo, buscarDuplicado, destinoVigente, objetivosElegibles, objetivosParaEnviar, crearObjetivoLocal, validarNombreObjetivo } = await import(pathToFileURL(resolve('src/lib/inyeccion/objetivos.ts')).href)
const { normLote, loteCanonico, temporadaDeLote, opcionesDeLotes } = await import(pathToFileURL(resolve('src/lib/inyeccion/lotes.ts')).href)
const { fichasCampo } = await import(pathToFileURL(resolve('src/lib/campo/fichas.ts')).href)

const base = {
  estacionId: 'E', lote: '1002-010', categoriaClave: 'ferti-riego|inyeccion', temporada: 'Temp 26-27', ciclo: 'Ciclo 1', turnoAglId: 'T1',
  areaMz: 5, areaLote: 5, objetivos: [{ id: 'O1', nombre: 'Plaga' }], comentario: '', sinInventario: false,
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

const obj = (id, nombre, extra = {}) => ({ id, nombre, tipo: 'Plaga', origen: 'AGL', activo: true, revisado: true, fusionado_en: null, ...extra })
const catalogo = [obj('O1', 'Plaga'), obj('O2', 'Maleza'), obj('O3', 'Ácaro rojo', { activo: false }), obj('O4', 'Trips'), obj('O5', 'Gallina ciega', { fusionado_en: 'O4' })]

test('normalización de objetivos: tildes, mayúsculas, signos, espacios y plural simple (igual que SQL y Python)', () => {
  assert.equal(normalizarObjetivo('  Ácaro  '), 'acaro')
  assert.equal(normalizarObjetivo('MOSCAS  BLANCAS!'), normalizarObjetivo('Mosca blanca'))
  assert.equal(normalizarObjetivo('Enfermedades'), normalizarObjetivo('enfermedad'))
  assert.equal(normalizarObjetivo('Hongos'), 'hongo')
  assert.equal(normalizarObjetivo('Trips'), 'trip')
  assert.equal(normalizarObjetivo('???'), '')
})

test('duplicado: compara normalizado contra activos, inactivos y fusionados y devuelve el vigente', () => {
  assert.deepEqual(buscarDuplicado('PLAGAS', catalogo), { duplicado: true, existente: catalogo[0] })
  const inactivo = buscarDuplicado(' acaros  ROJOS ', catalogo)
  assert.equal(inactivo.duplicado, true)
  assert.equal(inactivo.existente.id, 'O3')
  const fusionado = buscarDuplicado('gallinas ciegas', catalogo)
  assert.equal(fusionado.existente.id, 'O4') // el fusionado apunta a su destino
  assert.deepEqual(buscarDuplicado('Nematodos', catalogo), { duplicado: false })
  assert.deepEqual(buscarDuplicado('   ', catalogo), { duplicado: false })
})

test('duplicado: también contra lo creado sin señal que aún no sube (alta sin señal)', () => {
  const local = crearObjetivoLocal('  Gusano   cogollero ', 'Plaga', 'LOCAL-1')
  assert.equal(local.origen, 'CAMPO')
  assert.equal(local.revisado, false)
  assert.equal(local.nombre, 'Gusano cogollero')
  const r = buscarDuplicado('gusanos cogollero', catalogo, [local])
  assert.equal(r.duplicado, true)
  assert.equal(r.existente.id, 'LOCAL-1')
})

test('solo se pueden elegir activos y no fusionados; nombre inválido o largo se rechaza', () => {
  assert.deepEqual(objetivosElegibles(catalogo).map((o) => o.nombre), ['Maleza', 'Plaga', 'Trips'])
  assert.equal(validarNombreObjetivo('   '), 'Escribe el nombre del objetivo')
  assert.equal(validarNombreObjetivo('...'), 'Escribe el nombre del objetivo')
  assert.ok(validarNombreObjetivo('x'.repeat(81)))
  assert.equal(validarNombreObjetivo('Mildiu'), null)
})

test('objetivos para enviar: sin repetir y los fusionados van a su destino, con id y nombre', () => {
  assert.deepEqual(objetivosParaEnviar(['O1', 'O5', 'O4', 'O1'], catalogo), [
    { id: 'O1', nombre: 'Plaga', tipo: 'Plaga' },
    { id: 'O4', nombre: 'Trips', tipo: 'Plaga' },
  ])
  assert.equal(destinoVigente(catalogo, 'O5').id, 'O4')
})

test('armarAplicacionLote manda los objetivos por id y nombre, sin repetir, y exige al menos uno', () => {
  const r = armarAplicacionLote({ ...base, objetivos: [{ id: 'O1', nombre: 'Plaga' }, { id: 'O1', nombre: 'Plaga' }, { id: 'N1', nombre: ' Mildiu ', tipo: 'Hongo' }] })
  assert.deepEqual(r.datos.objetivos, [{ id: 'O1', nombre: 'Plaga' }, { id: 'N1', nombre: 'Mildiu', tipo: 'Hongo' }])
  assert.deepEqual(armarAplicacionLote({ ...base, objetivos: [{ id: 'O1', nombre: '  ' }] }), { error: 'Elige al menos un objetivo' })
})

const lotes = [
  { lote_temporada_id: 'LT1', nomenclatura: '1002-010', nombre: 'Lote A', temporada: 'Temp. 26-27', activa: true },
  { lote_temporada_id: 'LT2', nomenclatura: '1002-010', nombre: 'Lote A', temporada: 'Temp 25-26', activa: false },
  { lote_temporada_id: 'LT3', nomenclatura: '1003-020', nombre: null, temporada: 'Temp. 26-27', activa: true },
]

test('lote: solo del catálogo; nomenclatura normalizada; lo que no está no se acepta', () => {
  assert.equal(normLote(' 1002-010 '), '1002-010')
  assert.equal(loteCanonico(lotes, '1002-010 '), '1002-010')
  assert.equal(loteCanonico(lotes, ' 1002 - 010'), '1002-010')
  assert.equal(loteCanonico(lotes, '9999-999'), null)
  assert.equal(loteCanonico(lotes, '   '), null)
  assert.equal(loteCanonico([], '1002-010'), null)
})

test('lote: la temporada es la del plan si el lote está asignado a ella; si no, la activa', () => {
  assert.equal(temporadaDeLote(lotes, '1002-010', 'Temp 25-26'), 'Temp 25-26')
  assert.equal(temporadaDeLote(lotes, '1002-010', null), 'Temp. 26-27')
  assert.equal(temporadaDeLote(lotes, '1003-020', 'Temp 25-26'), 'Temp. 26-27')
  assert.equal(temporadaDeLote(lotes, 'NO-EXISTE', null), null)
})

test('selector de lote: con plan primero y marcados; todo el catálogo disponible; sin repetir', () => {
  const o = opcionesDeLotes(lotes, ['1003-020 '])
  assert.deepEqual(o.map((x) => x.id), ['1003-020', '1002-010'])
  assert.equal(o[0].destacado, true)
  assert.equal(o[1].destacado ?? false, false)
})

test('el formulario no ofrece escribir ni crear lotes (sin creación rápida ni lotesExtra)', () => {
  const src = readFileSync(resolve('src/components/inyeccion/FormAplicacionLote.tsx'), 'utf8')
  assert.equal(/lotesExtra/.test(src), false)
  assert.equal(/Lote que no está en el plan/.test(src), false)
  const ini = src.indexOf('data-selector-lote')
  assert.equal(/creacionRapida/.test(src.slice(ini, ini + 900)), false)
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
  assert.deepEqual(r.datos.lineas, [{ material_id: 'A', cantidad: 10, de_bodega: false }, { material_id: 'C', cantidad: 2.5, de_bodega: false }])   // 139
  assert.equal(r.datos.estacion_id, 'E')
  assert.equal(r.datos.lote, '1002-010')
  assert.equal(r.datos.area_mz, 5)
  assert.deepEqual(r.datos.objetivos, [{ id: 'O1', nombre: 'Plaga' }])
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

test('el saldo local NO resta si la línea no es de bodega (139)', () => {
  const estado = {
    yo: { id: 'U', nombre: 'Yo' }, estaciones: [], relevos: [], traslados: [], plan: [], aplicaciones: [], movimientos: [],
    saldos: [{ estacion_id: 'E', material_id: 'A', disponible: 100, en_transito: 0 }],
  }
  const op = { id: 'P', tipo: 'aplicacion_lote', estado_local: 'PENDIENTE', creado_en: '2026-11-22T15:00:00Z', en_nombre_de: null,
    datos: { estacion_id: 'E', lote: 'L1', lineas: [{ material_id: 'A', cantidad: 30 }] } }
  assert.deepEqual(efectosDe(op, estado, () => 0), [])
  assert.equal(saldosLocales(estado, [op], 'E').get('A'), 100)
})

test('el saldo local resta APLICACION_LOTE de bodega: 100 → 70', () => {
  const estado = {
    yo: { id: 'U', nombre: 'Yo' }, estaciones: [], relevos: [], traslados: [], plan: [], aplicaciones: [], movimientos: [],
    saldos: [{ estacion_id: 'E', material_id: 'A', disponible: 100, en_transito: 0 }],
  }
  const op = { id: 'P', tipo: 'aplicacion_lote', estado_local: 'PENDIENTE', creado_en: '2026-11-22T15:00:00Z', en_nombre_de: null,
    datos: { estacion_id: 'E', lote: 'L1', lineas: [{ material_id: 'A', cantidad: 30, de_bodega: true }, { material_id: 'B', cantidad: 0, de_bodega: true }] } }
  assert.deepEqual(efectosDe(op, estado, () => 0), [{ estacion_id: 'E', material_id: 'A', cantidad: -30, tipo: 'APLICACION_LOTE' }])
  assert.equal(saldosLocales(estado, [op], 'E').get('A'), 70)
  assert.ok(NOMBRE_MOVIMIENTO.APLICACION_LOTE)
})

test('la ficha Inyección aparece con su permiso y el orden queda Fertirriego, Inyección, AgroMétricas', () => {
  const f = fichasCampo((p) => p === 'inyeccion')
  assert.equal(f.length, 1)
  assert.equal(f[0].ruta, '/inyeccion')
  const todas = fichasCampo((p, a) => a === 'ver' && ['fertirriego', 'inyeccion', 'agrometricas'].includes(p))
  assert.deepEqual(todas.map((x) => x.ruta), ['/fertirriego', '/inyeccion', '/agrometricas/parametros', ''])
})
