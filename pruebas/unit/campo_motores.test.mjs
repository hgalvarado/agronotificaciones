// Pruebas de Motores y combustible (Campo, bloque 3): registro diario (hoja FTR_F-MA-103), continuidad, mantenimiento y saldo local.
// Correr: node --test pruebas/unit/campo_motores.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const cargar = (p) => import(pathToFileURL(resolve(p)).href)
const { calcularRegistro, proponerInicial, avisosContinuidad, armarRegistroDiario, armarRecepcionDiesel, armarMovimientoMotor } =
  await cargar('src/lib/motores/registroDiario.ts')
const { horasParaMantenimiento, estadoMantenimiento, horasDesdeMantLocal } = await cargar('src/lib/motores/mantenimiento.ts')
const { saldoTanqueLocal } = await cargar('src/lib/motores/estado.ts')
const { fichasCampo } = await cargar('src/lib/campo/fichas.ts')

const pend = (tipo, datos, estado_local = 'PENDIENTE') => ({ id: Math.random().toString(36), tipo, datos, estado_local })
const estadoBase = (extra = {}) => ({
  servidor_en: '2026-11-22T00:00:00Z',
  permisos: { ver: true, registrar: true, anular: false, configurar: false },
  material_diesel_id: 'D',
  motores: [],
  tanques_sin_motor: [],
  registros: [],
  recepciones: [],
  mantenimientos: [],
  asignaciones: [],
  ...extra,
})

test('hoja real: 11/11 → 5.1 h, 10 gal, 1.96 gal/h', () => {
  const r = calcularRegistro({ horoIni: 19185.6, horoFin: 19190.7, visorIni: 257, visorFin: 247, recibido: 0 })
  assert.equal(r.horas, 5.1)
  assert.equal(r.gastado, 10)
  assert.equal(r.rendimiento, 1.96)
  assert.deepEqual(r.errores, [])
})

test('hoja real: 18/11 → 17.8 h, 26 gal, 1.46 gal/h', () => {
  const r = calcularRegistro({ horoIni: 19225.9, horoFin: 19243.7, visorIni: 184, visorFin: 158, recibido: 0 })
  assert.equal(r.horas, 17.8)
  assert.equal(r.gastado, 26)
  assert.equal(r.rendimiento, 1.46)
})

test('horas 0 → rendimiento null y sin error', () => {
  const r = calcularRegistro({ horoIni: 100, horoFin: 100, visorIni: 50, visorFin: 50, recibido: 0 })
  assert.equal(r.rendimiento, null)
  assert.deepEqual(r.errores, [])
  assert.deepEqual(r.avisos, [])
})

test('gastó diésel sin horas: aviso', () => {
  const r = calcularRegistro({ horoIni: 100, horoFin: 100, visorIni: 50, visorFin: 48, recibido: 0 })
  assert.deepEqual(r.avisos, ['Gastó diésel sin horas de trabajo.'])
})

test('el visor sube sin suministro → error exacto; la hoja real 20/11: 279→265 con suministro 140 gasta 14 (no 154)', () => {
  const e = calcularRegistro({ horoIni: 1, horoFin: 2, visorIni: 100, visorFin: 150, recibido: 0 })
  assert.deepEqual(e.errores, ['Subió el visor: recibe combustible primero.'])
  assert.equal(e.gastado, null)
  // hoja física: galones iniciales 279, finales 265, gastados 14, suministro 140 (el visor inicial ya incluye el suministro)
  const r = calcularRegistro({ horoIni: 19252.6, horoFin: 19259.4, visorIni: 279, visorFin: 265, recibido: 140 })
  assert.equal(r.gastado, 14)
  assert.equal(r.rendimiento, 2.06)
  assert.deepEqual(r.errores, [])
  assert.equal(r.duranteDia, false)
})

test('entró diésel durante el día: visor final mayor explicado por el suministro (inicial + suministro − final)', () => {
  const r = calcularRegistro({ horoIni: 1, horoFin: 11, visorIni: 100, visorFin: 120, recibido: 50 })
  assert.equal(r.gastado, 30)
  assert.equal(r.duranteDia, true)
  assert.deepEqual(r.errores, [])
  // suministro que no alcanza a explicar la subida
  assert.equal(calcularRegistro({ horoIni: 1, horoFin: 11, visorIni: 100, visorFin: 200, recibido: 50 }).errores.length, 1)
})

test('horómetro final menor: error; con «cambiado» no', () => {
  const e = calcularRegistro({ horoIni: 20, horoFin: 10, visorIni: 5, visorFin: 4, recibido: 0 })
  assert.deepEqual(e.errores, ['Horómetro final menor que el inicial.'])
  const c = calcularRegistro({ horoIni: 20, horoFin: 10, visorIni: 5, visorFin: 4, recibido: 0 }, { horoCambiado: true })
  assert.deepEqual(c.errores, [])
  assert.equal(c.horas, 0)
})

test('números vacíos → «Escribe un número válido.»', () => {
  const r = calcularRegistro({ horoIni: null, horoFin: 2, visorIni: 1, visorFin: 1, recibido: 0 })
  assert.deepEqual(r.errores, ['Escribe un número válido.'])
})

test('proponerInicial: usa la cola antes que lo bajado y no usa fechas iguales o posteriores (lunes, jueves, martes)', () => {
  const estado = estadoBase({
    registros: [{ equipo_id: 'M', fecha: '2026-11-16', horo_fin: 100, visor_fin: 50, anulado_at: null }, { equipo_id: 'M', fecha: '2026-11-19', horo_fin: 130, visor_fin: 40, anulado_at: null }],
    motores: [{ equipo_id: 'M', fecha_ultimo: '2026-11-19', horo_ultimo: 130, visor_ultimo: 40 }],
  })
  // martes 17: la anterior es la del lunes 16 (no la del jueves 19)
  const m = proponerInicial({ equipoId: 'M', fecha: '2026-11-17', estado, pendientes: [] })
  assert.deepEqual([m.horoIni, m.visorIni, m.origen, m.fechaBase], [100, 50, 'registro', '2026-11-16'])
  // con un registro pendiente del viernes 20 y se pide el sábado 21: gana la cola
  const c = proponerInicial({ equipoId: 'M', fecha: '2026-11-21', estado, pendientes: [pend('motor_registro_diario', { equipo_id: 'M', fecha: '2026-11-20', horo_fin: 150, visor_fin: 30 })] })
  assert.deepEqual([c.horoIni, c.visorIni, c.origen], [150, 30, 'cola'])
  // misma fecha que la pedida: se ignora
  const i = proponerInicial({ equipoId: 'M', fecha: '2026-11-19', estado: null, pendientes: [pend('motor_registro_diario', { equipo_id: 'M', fecha: '2026-11-19', horo_fin: 999, visor_fin: 1 })] })
  assert.equal(i.horoIni, null)
  // otro motor o ya enviado: no cuenta
  const o = proponerInicial({ equipoId: 'M', fecha: '2026-11-21', estado: null, pendientes: [pend('motor_registro_diario', { equipo_id: 'X', fecha: '2026-11-20', horo_fin: 5, visor_fin: 1 }), pend('motor_registro_diario', { equipo_id: 'M', fecha: '2026-11-20', horo_fin: 5, visor_fin: 1 }, 'ACEPTADO')] })
  assert.equal(o.origen, null)
})

test('proponerInicial sin base → null', () => {
  const p = proponerInicial({ equipoId: 'M', fecha: '2026-11-21', estado: estadoBase(), pendientes: [] })
  assert.deepEqual(p, { horoIni: null, visorIni: null, origen: null, fechaBase: null })
})

test('avisosContinuidad: avisa sin bloquear y se calla con la casilla marcada', () => {
  const propuesta = { horoIni: 100, visorIni: 50, origen: 'registro', fechaBase: '2026-11-16' }
  const a = avisosContinuidad({ horoIni: 105, visorIni: 40, horoCambiado: false, visorCambiado: false, propuesta })
  assert.equal(a.length, 2)
  assert.match(a[0], /^Horómetro no continúa/)
  assert.match(a[1], /^Visor no continúa/)
  assert.deepEqual(avisosContinuidad({ horoIni: 105, visorIni: 40, horoCambiado: true, visorCambiado: true, propuesta }), [])
  assert.deepEqual(avisosContinuidad({ horoIni: 105, visorIni: 40, horoCambiado: false, visorCambiado: false, propuesta: { horoIni: null, visorIni: null, origen: null, fechaBase: null } }), [])
  assert.deepEqual(avisosContinuidad({ horoIni: 100, visorIni: 50, horoCambiado: false, visorCambiado: false, propuesta }), [])
})

test('armarRegistroDiario: «cambiado» sin comentario, fecha futura y rpm fuera de rango', () => {
  const base = { equipoId: 'M', fecha: '2026-11-20', fechaHora: '2026-11-21T15:00:00Z', horoIni: 1, horoFin: 2, visorIni: 10, visorFin: 9, rpm: null, horoCambiado: false, visorCambiado: false, comentario: '', hoy: '2026-11-22' }
  assert.ok('datos' in armarRegistroDiario(base))
  assert.match(armarRegistroDiario({ ...base, horoCambiado: true }).error, /Explica el cambio/)
  assert.equal(armarRegistroDiario({ ...base, fecha: '2026-11-23' }).error, 'La fecha no puede ser futura.')
  assert.match(armarRegistroDiario({ ...base, rpm: 7000 }).error, /0 y 6000/)
  assert.equal(armarRegistroDiario({ ...base, horoFin: 0 }).error, 'Horómetro final menor que el inicial.')
  const ok = armarRegistroDiario({ ...base, horoCambiado: true, comentario: 'cambio de horómetro', horoFin: 0 })
  assert.ok('datos' in ok)
  assert.equal(ok.datos.gastado_local, 1)
})

test('armarRecepcionDiesel: va al TANQUE elegido, galones > 0', () => {
  const base = { estacionId: 'E', tanqueId: 'T', galones: 50, fechaHora: '2026-11-20T15:00:00Z', choferId: null, vehiculoId: null, comentario: '' }
  assert.equal(armarRecepcionDiesel({ ...base, tanqueId: null }).error, 'Elige el tanque.')
  assert.equal(armarRecepcionDiesel({ ...base, galones: 0 }).error, 'Escribe los galones.')
  const r = armarRecepcionDiesel(base)
  assert.ok('datos' in r)
  assert.equal(r.datos.estacion_id, 'E')
  assert.equal(r.datos.tanque_id, 'T')
  assert.equal(r.datos.diesel_material_id, undefined)
})

test('armarRegistroDiario: gastado = inicial − final; suministro, caudal y operador viajan; negativo no vale', () => {
  const base = { equipoId: 'M', fecha: '2026-11-20', fechaHora: '2026-11-21T15:00:00Z', horoIni: 1, horoFin: 2, visorIni: 50, visorFin: 30, rpm: null, horoCambiado: false, visorCambiado: false, comentario: '', hoy: '2026-11-22' }
  const ok = armarRegistroDiario({ ...base, suministro: 40, caudalIni: 12, caudalFin: 13.5, operador: ' Jeninjnr ' })
  assert.equal(ok.datos.gastado_local, 20)
  assert.equal(ok.datos.suministro_gal, 40)
  assert.equal(ok.datos.caudal_ini, 12)
  assert.equal(ok.datos.caudal_fin, 13.5)
  assert.equal(ok.datos.operador, 'Jeninjnr')
  assert.equal(ok.datos.diesel_material_id, undefined)
  assert.equal(armarRegistroDiario({ ...base, suministro: -1 }).error, 'Suministro no válido.')
  assert.equal(armarRegistroDiario({ ...base, caudalIni: -5 }).error, 'Caudal: escribe un número.')
  assert.equal(armarRegistroDiario(base).datos.suministro_gal, undefined)
})

test('armarMovimientoMotor: ya no pregunta por el diésel; entrar pide estación y tanque libre; motivo vacío', () => {
  const base = { equipoId: 'M', tipo: 'RETIRADO', fechaHora: '2026-11-20T15:00:00Z', estacionDestino: null, tanqueId: null, tanqueNuevo: null, motivo: 'Fin de temporada', motivoCodigo: 'FIN_TEMPORADA', horasBase: null }
  const ok = armarMovimientoMotor(base)
  assert.equal(ok.operacion, 'motor_retiro')
  assert.equal(ok.datos.destino_saldo, undefined)
  assert.equal(armarMovimientoMotor({ ...base, motivo: ' ', motivoCodigo: '' }).error, 'Elige el motivo.')
  // instalar pide estación y tanque libre
  const i = { ...base, tipo: 'INSTALADO' }
  assert.equal(armarMovimientoMotor(i).error, 'Elige la estación de destino.')
  assert.match(armarMovimientoMotor({ ...i, estacionDestino: 'E' }).error, /Elige un tanque libre/)
  const inst = armarMovimientoMotor({ ...i, estacionDestino: 'E', tanqueId: 'T' })
  assert.equal(inst.operacion, 'motor_asignar')
  assert.equal(inst.datos.tipo, 'INSTALADO')
  assert.equal(inst.datos.tanque_id, 'T')
  // trasladar también necesita el tanque libre del destino
  assert.match(armarMovimientoMotor({ ...base, tipo: 'TRASLADADO', estacionDestino: 'E2', motivoCodigo: 'CAMBIO_ESTACION', motivo: 'x' }).error, /Elige un tanque libre/)
  // crear un tanque nuevo (solo «Configurar»): pide nombre
  assert.equal(armarMovimientoMotor({ ...i, estacionDestino: 'E', tanqueNuevo: { nombre: ' ', capacidadGal: 300 } }).error, 'Escribe el nombre del tanque nuevo.')
})

test('estadoMantenimiento: sin intervalo, al día, próximo y vencido', () => {
  assert.equal(estadoMantenimiento({ intervaloHoras: null, avisoHoras: null, horasDesdeMant: 10 }), 'sin_intervalo')
  assert.equal(estadoMantenimiento({ intervaloHoras: 500, avisoHoras: null, horasDesdeMant: 100 }), 'al_dia')
  assert.equal(estadoMantenimiento({ intervaloHoras: 500, avisoHoras: null, horasDesdeMant: 460 }), 'proximo')
  assert.equal(estadoMantenimiento({ intervaloHoras: 500, avisoHoras: 100, horasDesdeMant: 410 }), 'proximo')
  assert.equal(estadoMantenimiento({ intervaloHoras: 500, avisoHoras: null, horasDesdeMant: 500 }), 'vencido')
  assert.equal(horasParaMantenimiento({ intervaloHoras: 500, horasDesdeMant: 460 }), 40)
  assert.equal(horasParaMantenimiento({ intervaloHoras: null, horasDesdeMant: 460 }), null)
})

test('horasDesdeMantLocal: suma lo que está en cola; un mantenimiento en cola reinicia', () => {
  const m = { equipo_id: 'M', horas_desde_mant: 100 }
  const reg = (fecha, hi, hf, motor = 'M') => pend('motor_registro_diario', { equipo_id: motor, fecha, horo_ini: hi, horo_fin: hf })
  assert.equal(horasDesdeMantLocal(m, []), 100)
  assert.equal(horasDesdeMantLocal(m, [reg('2026-11-20', 10, 15.5), reg('2026-11-21', 15.5, 20), reg('2026-11-21', 1, 100, 'OTRO')]), 110)
  assert.equal(horasDesdeMantLocal(m, [reg('2026-11-20', 10, 15, 'M')].map((o) => ({ ...o, estado_local: 'ACEPTADO' }))), 100)
  const mant = pend('motor_mantenimiento', { equipo_id: 'M', fecha_hora: '2026-11-20T15:00:00Z' })
  assert.equal(horasDesdeMantLocal(m, [mant, reg('2026-11-20', 10, 15), reg('2026-11-21', 15, 18)]), 3)
})

test('saldoTanqueLocal (147): recibir diésel pendiente SÍ sube el tanque; el suministro declarado suma solo lo que falta; consumo = visor inicial − final', () => {
  const estado = estadoBase({
    motores: [{ equipo_id: 'M', tanque: { id: 'T', nombre: 'T', capacidad_gal: 300, saldo_gal: 200 } }],
    tanques_sin_motor: [{ id: 'S', nombre: 'S', estacion_id: 'E', capacidad_gal: null, saldo_gal: 30 }],
  })
  const pendientes = [
    pend('diesel_recibir', { estacion_id: 'E', tanque_id: 'T', galones: 140, fecha_hora: '2026-11-20T15:00:00Z' }),
    // declara 140 de suministro (los mismos de la recepción pendiente: no se cuenta doble) y gasta 14
    pend('motor_registro_diario', { equipo_id: 'M', fecha: '2026-11-20', visor_ini: 279, visor_fin: 265, suministro_gal: 140, gastado_local: 14 }),
    pend('diesel_recibir', { estacion_id: 'E', tanque_id: 'T', galones: 999, fecha_hora: '2026-11-20T15:00:00Z' }, 'ACEPTADO'),
  ]
  assert.equal(saldoTanqueLocal('T', estado, pendientes), 326)
  assert.equal(saldoTanqueLocal('S', estado, pendientes), 30)
  assert.equal(saldoTanqueLocal('Z', estado, pendientes), 0)
  // sin recepción: el suministro declarado sube el tanque por lo que falta (50) y baja lo gastado (14)
  assert.equal(saldoTanqueLocal('T', estado, [pend('motor_registro_diario', { equipo_id: 'M', fecha: '2026-11-20', visor_ini: 100, visor_fin: 86, suministro_gal: 50 })]), 236)
})

test('la tarjeta del motor depende solo de funciones puras: sin intervalo no hay error', () => {
  const motor = { intervalo_horas: null, aviso_horas: null, horas_desde_mant: 0 }
  assert.equal(estadoMantenimiento({ intervaloHoras: motor.intervalo_horas, avisoHoras: motor.aviso_horas, horasDesdeMant: motor.horas_desde_mant }), 'sin_intervalo')
})

test('ficha «Motores y combustible»: ruta /motores, entre Inyección y AgroMétricas', () => {
  const f = fichasCampo((p, a) => a === 'ver' && p === 'motores')
  assert.equal(f.length, 1)
  assert.equal(f[0].ruta, '/motores')
  assert.equal(f[0].nombre, 'Motores y combustible')
  const todas = fichasCampo((p, a) => a === 'ver' && ['fertirriego', 'inyeccion', 'motores', 'agrometricas'].includes(p))
  assert.deepEqual(todas.map((x) => x.ruta), ['/fertirriego', '/inyeccion', '/motores', '/agrometricas/parametros', ''])
})
