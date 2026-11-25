// Pruebas de la lógica pura de Motores (sql/147): semáforos, «qué toca ahora», señales por día, alertas del formulario,
// horas estimadas, normalización de lo que baja y filtros del auditor.
// Correr: node --test pruebas/unit/motores_senales.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'

const cargar = (p) => import(pathToFileURL(resolve(p)).href)
const S = await cargar('src/lib/motores/senales.ts')
const E = await cargar('src/lib/motores/estado.ts')
const A = await cargar('src/lib/motores/auditoria.ts')

const HOY = '2026-11-24'
const pend = (tipo, datos, estado_local = 'PENDIENTE') => ({ id: Math.random().toString(36), tipo, datos, estado_local })
const reg = (fecha, extra = {}) => ({
  id: `r-${fecha}`, equipo_id: 'M', fecha, estacion_id: 'E', tanque_id: 'T',
  horo_ini: 100, horo_fin: 106, horas: 6, visor_ini: 200, visor_fin: 188, recibido_gal: 0, gastado_gal: 12, rendimiento_gal_h: 2,
  rpm: 1400, horo_cambiado: false, visor_cambiado: false, dif_visor_gal: null, horas_estimadas: null, rend_ref_gal_h: null, anulado_at: null, ...extra,
})

test('semáforo de mantenimiento: verde, amarillo (aviso 10 %), rojo, gris y «incluye N h estimadas»', () => {
  const m = { intervalo_horas: 500, aviso_horas: null }
  assert.deepEqual(S.semaforoMantenimiento(m, 100), { nivel: 'verde', faltan: 400, texto: 'Faltan 400 h' })
  assert.deepEqual(S.semaforoMantenimiento(m, 460), { nivel: 'amarillo', faltan: 40, texto: 'Faltan 40 h' })
  assert.equal(S.semaforoMantenimiento(m, 505).texto, 'Vencido hace 5 h')
  assert.equal(S.semaforoMantenimiento(m, 505).nivel, 'rojo')
  assert.equal(S.semaforoMantenimiento({ intervalo_horas: null, aviso_horas: null }, 5).nivel, 'gris')
  assert.equal(S.semaforoMantenimiento({ intervalo_horas: 500, aviso_horas: 100 }, 410).nivel, 'amarillo')
  assert.match(S.semaforoMantenimiento(m, 460, 4).texto, / · 4 h estimadas$/)
})

test('semáforo del registro: al día = verde; días sin registro NO son alerta (gris); sin registros amarillo', () => {
  assert.equal(S.semaforoRegistro('2026-11-23', HOY).nivel, 'verde')
  assert.equal(S.semaforoRegistro('2026-11-22', HOY).nivel, 'gris')
  const r = S.semaforoRegistro('2026-11-20', HOY)
  assert.equal(r.nivel, 'gris')
  assert.equal(r.texto, 'Último registro hace 4 días.')
  assert.equal(S.semaforoRegistro(null, HOY).nivel, 'amarillo')
})

test('semáforo del tanque: vacío rojo, ≤15 % amarillo, verde y sin tanque', () => {
  assert.equal(S.semaforoTanque(0, 600).nivel, 'rojo')
  const bajo = S.semaforoTanque(80, 600)
  assert.equal(bajo.nivel, 'amarillo')
  assert.equal(bajo.texto, 'Tanque bajo: 80 gal.')
  assert.equal(bajo.pct, 13)
  assert.equal(S.semaforoTanque(300, 600).nivel, 'verde')
  assert.equal(S.semaforoTanque(null, null).texto, 'Sin tanque conectado.')
})

test('«qué toca ahora»: ordena por urgencia y el motor retirado no pide registro ni tanque', () => {
  const motor = { estado: 'EN_ESTACION', intervalo_horas: 500, aviso_horas: null, tanque: { id: 'T', nombre: 'T', capacidad_gal: 600, saldo_gal: 80 } }
  const a = S.ayudaLocal({ motor, saldoTanque: 80, horasDesdeMant: 460, horasEstimadas: 0, fechaUltima: '2026-11-20', hoy: HOY })
  assert.equal(a.nivel, 'amarillo')
  assert.deepEqual(a.ahora.map((x) => x.codigo), ['MANTENIMIENTO', 'TANQUE'])
  const taller = S.ayudaLocal({ motor: { ...motor, estado: 'TALLER' }, saldoTanque: null, horasDesdeMant: 10, horasEstimadas: 0, fechaUltima: null, hoy: HOY })
  assert.equal(taller.registro, null)
  assert.deepEqual(taller.ahora, [])
  const lista = S.queTocaAhora([
    { motor: { equipo_id: 'B', codigo: 'M2' }, ayuda: S.ayudaLocal({ motor, saldoTanque: 300, horasDesdeMant: 460, horasEstimadas: 0, fechaUltima: '2026-11-23', hoy: HOY }) },
    { motor: { equipo_id: 'A', codigo: 'M1' }, ayuda: a },
  ])
  assert.equal(lista[0].motor, 'M1') // lo rojo primero
  assert.equal(lista[0].codigo, 'MANTENIMIENTO')
  assert.equal(lista[lista.length - 1].motor, 'M2')
})

test('fecha del último registro cuenta lo pendiente de enviar', () => {
  const motor = { equipo_id: 'M', fecha_ultimo: '2026-11-20' }
  assert.equal(S.fechaUltimaLocal(motor, [pend('motor_registro_diario', { equipo_id: 'M', fecha: '2026-11-23' })]), '2026-11-23')
  assert.equal(S.fechaUltimaLocal(motor, [pend('motor_registro_diario', { equipo_id: 'M', fecha: '2026-11-23' }, 'ACEPTADO')]), '2026-11-20')
})

test('rendimiento de referencia: mediana de 30 días con horas y consumo, mínimo 5 días', () => {
  const dias = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']
  const regs = dias.map((d, i) => reg(d, { rendimiento_gal_h: [2, 2.2, 1.8, 2, 4][i] }))
  assert.equal(S.rendimientoReferencia(regs, 'M', '2026-11-20'), 2)
  assert.equal(S.rendimientoReferencia(regs.slice(0, 4), 'M', '2026-11-20'), null)
  assert.equal(S.rendimientoReferencia(regs, 'M', '2026-12-30'), null) // fuera de los 30 días
  assert.equal(S.horasEstimadas(0, 8, 2), 4)
  assert.equal(S.horasEstimadas(0, 8, null), null)
  assert.equal(S.horasEstimadas(3, 8, 2), null)
})

test('horas del mantenimiento con lo pendiente: las ESTIMADAS suman aparte y un mantenimiento en cola reinicia', () => {
  const dias = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14']
  const regs = dias.map((d) => reg(d, { rendimiento_gal_h: 2 }))
  const motor = { equipo_id: 'M', horas_desde_mant: 100, horas_est_desde_mant: 4 }
  // horómetro sin avance (horas 0) y 8 gal: se estiman 4 h; el otro día trabajó 5 h reales
  const cola = [
    pend('motor_registro_diario', { equipo_id: 'M', fecha: '2026-11-20', horo_ini: 50, horo_fin: 50, visor_ini: 108, visor_fin: 100, gastado_local: 8 }),
    pend('motor_registro_diario', { equipo_id: 'M', fecha: '2026-11-21', horo_ini: 50, horo_fin: 55, visor_ini: 100, visor_fin: 90 }),
  ]
  assert.deepEqual(S.horasMantDetalle(motor, regs, cola), { horas: 109, estimadas: 8 })
  assert.deepEqual(S.horasMantDetalle(motor, regs, []), { horas: 100, estimadas: 4 })
  const mant = pend('motor_mantenimiento', { equipo_id: 'M', fecha_hora: '2026-11-20T18:00:00Z' })
  assert.deepEqual(S.horasMantDetalle(motor, regs, [mant, ...cola]), { horas: 5, estimadas: 0 })
})

test('señales por día: horómetro retrocede y salta, hueco, visor, rendimiento, sin avance con consumo, sin RPM', () => {
  const previo = reg('2026-11-10', { horo_fin: 1015 })
  const sin = (r, p = previo, h = [], rec = []) => S.senalesDeRegistro(r, p, h, rec).map((x) => x.codigo)
  assert.deepEqual(sin(reg('2026-11-11', { horo_ini: 1000, visor_ini: 188 })), ['HORO_RETROCEDE'])
  const retro = S.senalesDeRegistro(reg('2026-11-11', { horo_ini: 1000, visor_ini: 188 }), previo, [], [])[0]
  assert.equal(retro.nivel, 'rojo')
  assert.equal(retro.texto, 'Horómetro retrocede: inicia 1000, antes 1015.')
  assert.deepEqual(sin(reg('2026-11-11', { horo_ini: 1020, visor_ini: 188 })), ['HORO_SALTA'])
  assert.ok(!sin(reg('2026-11-13', { horo_ini: 1015, visor_ini: 188 })).includes('HUECO_DIAS')) // días sin registro ya no alertan si la continuidad cuadra
  assert.ok(sin(reg('2026-11-11', { horo_ini: 1015, visor_ini: 150 })).includes('VISOR_FALTA'))
  assert.ok(sin(reg('2026-11-11', { horo_ini: 1015, visor_ini: 230 })).includes('VISOR_SOBRA'))
  // un suministro recibido en el tanque explica el visor más alto
  const rec = [{ tanque_id: 'T', galones: 42, fecha_hora: '2026-11-11T15:00:00Z', anulado_at: null }]
  assert.ok(!sin(reg('2026-11-11', { horo_ini: 1015, visor_ini: 230 }), previo, [], rec).includes('VISOR_SOBRA'))
  assert.ok(sin(reg('2026-11-11', { horo_ini: 1015, rpm: null })).includes('SIN_RPM'))
  const base = { horo_ini: 1015, visor_ini: 188 }
  const hist = Array.from({ length: 6 }, (_, i) => reg(`2026-11-0${i + 1}`, { rendimiento_gal_h: 2 })).reverse()
  const rara = S.senalesDeRegistro(reg('2026-11-11', { ...base, horas: 5, gastado_gal: 30, rendimiento_gal_h: 6, horo_fin: 1020 }), previo, hist, []).find((x) => x.codigo === 'RENDIMIENTO')
  assert.equal(rara.nivel, 'rojo')
  assert.equal(rara.texto, 'Rinde 6 gal/h; lo normal 2.')
  const sa = S.senalesDeRegistro(reg('2026-11-11', { ...base, horas: 0, horo_fin: 1015, gastado_gal: 8, rendimiento_gal_h: null, horas_estimadas: 4, rend_ref_gal_h: 2 }), previo, [], []).find((x) => x.codigo === 'HORO_SIN_AVANCE_CON_CONSUMO')
  assert.match(sa.texto, /Se estiman 4 h\.$/)
  assert.ok(S.senalesDeRegistro(reg('2026-11-11', { ...base, horas: 6, gastado_gal: 0, rendimiento_gal_h: 0 }), previo, [], []).some((x) => x.codigo === 'HORAS_SIN_CONSUMO'))
  assert.ok(S.senalesDeRegistro(reg('2026-11-11', { ...base, horas: 30 }), previo, [], []).some((x) => x.codigo === 'HORAS_IMPOSIBLES'))
})

test('señales por registro de todo el estado: el primer registro no se compara y el anulado no cuenta', () => {
  const regs = [reg('2026-11-10'), reg('2026-11-11', { horo_ini: 90 }), reg('2026-11-12', { anulado_at: '2026-11-13T00:00:00Z', horo_ini: 5 })]
  const mapa = S.senalesPorRegistro(regs, [])
  assert.ok(!(mapa.get('r-2026-11-10') ?? []).some((x) => x.codigo.startsWith('HORO_')))
  assert.ok(mapa.get('r-2026-11-11').some((x) => x.codigo === 'HORO_RETROCEDE'))
  assert.equal(mapa.has('r-2026-11-12'), false)
})

test('alertas del formulario: horómetro retrocede, tanque contra visor, rendimiento y horas estimadas', () => {
  const dias = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']
  const regs = dias.map((d) => reg(d, { rendimiento_gal_h: 2 }))
  const e = {
    fecha: '2026-11-20', horoIni: 100, horoFin: 106, visorIni: 200, visorFin: 188, suministro: 0, horoCambiado: false, visorCambiado: false,
    previo: { horoIni: 106, visorIni: 200, fechaBase: '2026-11-19' }, saldoTanque: 200, recibidoHoyTanque: 0, registros: regs, equipoId: 'M',
  }
  const cod = (x) => S.alertasRegistro(x).map((a) => a.codigo)
  assert.deepEqual(cod(e), ['HORO_RETROCEDE'])
  assert.deepEqual(cod({ ...e, horoIni: 106, horoFin: 112 }), []) // continúa, el libro cuadra y gasta 12 en 6 h = 2 gal/h
  const falta = S.alertasRegistro({ ...e, horoIni: 106, horoFin: 112, visorIni: 190, visorFin: 178, saldoTanque: 200 }).find((a) => a.codigo === 'SALDO_FALTA')
  assert.equal(falta.nivel, 'rojo')
  assert.equal(falta.texto, 'Faltan 10 gal contra el tanque.')
  assert.ok(cod({ ...e, horoIni: 106, horoFin: 112, visorFin: 150 }).includes('RENDIMIENTO')) // 50 gal en 6 h = 8.3 gal/h
  const sin = S.alertasRegistro({ ...e, horoIni: 106, horoFin: 106, visorFin: 192 }).find((a) => a.codigo === 'HORO_SIN_AVANCE_CON_CONSUMO')
  assert.equal(sin.texto, 'Horómetro sin avance: se estiman 4 h.')
  // un histórico no compara con el libro
  assert.ok(!cod({ ...e, horoIni: 106, horoFin: 112, visorIni: 190, visorFin: 178, historico: true }).includes('SALDO_FALTA'))
})

test('normalizarEstado: una clave ausente es null y las listas nuevas son []', () => {
  const crudo = {
    servidor_en: 'x', permisos: { ver: true, registrar: true, anular: false, configurar: false },
    material_diesel_id: null,
    motores: [{ equipo_id: 'M', codigo: 'M1', nombre: 'n', estado: 'EN_ESTACION', horas_desde_mant: 0 }],
    registros: [{ id: 'r', equipo_id: 'M', fecha: '2026-11-20' }],
    recepciones: [{ id: 'c', estacion_id: 'E', galones: 5, fecha_hora: 'x' }],
    asignaciones: [{ id: 'a', equipo_id: 'M' }],
  }
  const n = E.normalizarEstado(crudo)
  assert.equal(n.motores[0].tanque, null)
  assert.equal(n.motores[0].horo_ultimo, null)
  assert.equal(n.registros[0].operador, null)
  assert.equal(n.registros[0].dif_visor_gal, null)
  assert.equal(n.recepciones[0].tanque_id, null)
  assert.deepEqual([n.tanques, n.tramos, n.senales, n.ayuda, n.personas, n.tanques_sin_motor], [[], [], [], [], {}, []])
})

test('tanques por estación y libres para un motor; nombre de quien registró', () => {
  const estado = E.normalizarEstado({
    servidor_en: 'x', permisos: { ver: true, registrar: true, anular: false, configurar: false }, material_diesel_id: null, motores: [], registros: [], recepciones: [], mantenimientos: [], asignaciones: [],
    tanques: [
      { id: 'T1', nombre: 'T-1', estacion_id: 'E', capacidad_gal: 600, saldo_gal: 10, motor_equipo_id: 'M1' },
      { id: 'T2', nombre: 'T-2', estacion_id: 'E', capacidad_gal: 600, saldo_gal: 0 },
      { id: 'T3', nombre: 'T-3', estacion_id: 'F', capacidad_gal: 600, saldo_gal: 0 },
    ],
    personas: { u1: 'Ana' },
  })
  assert.deepEqual(E.tanquesDeEstacion(estado, 'E').map((t) => t.id), ['T1', 'T2'])
  assert.deepEqual(E.tanquesLibres(estado, 'E', 'M9').map((t) => t.id), ['T2'])
  assert.deepEqual(E.tanquesLibres(estado, 'E', 'M1').map((t) => t.id), ['T1', 'T2'])
  assert.equal(E.nombreQuien(estado, 'u1'), 'Ana')
  assert.equal(E.nombreQuien(estado, 'zz'), null)
  assert.equal(E.recibidoEnDia('T2', '2026-11-20', estado, [pend('diesel_recibir', { tanque_id: 'T2', galones: 30, fecha_hora: '2026-11-20T15:00:00Z' })]), 30)
})

test('auditor: filtros por texto, dónde está, estación y semáforo; lo urgente primero', () => {
  const m = (codigo, estado, estacion, nivel) => ({ equipo_id: codigo, codigo, nombre: 'Bomba', modelo: null, estado, estacion_id: null, estacion, zona: 'Zona-2A', tanque_id: null, tanque: null, horo_ultimo: null, fecha_ultimo: null, tramos: 1, ayuda: nivel ? { nivel } : null })
  const lista = [m('M3', 'EN_ESTACION', 'Papalón-1', 'verde'), m('M1', 'TALLER', null, 'rojo'), m('M2', 'EN_ESTACION', 'Espino', 'amarillo'), m('M4', 'RETIRADO', null, null)]
  const f = (x) => A.filtrarResumen(lista, { texto: '', estados: [], estaciones: [], niveles: [], ...x }).map((r) => r.codigo)
  assert.deepEqual(f({}), ['M1', 'M2', 'M4', 'M3'])
  assert.deepEqual(f({ estados: ['EN_ESTACION'] }), ['M2', 'M3'])
  assert.deepEqual(f({ estaciones: ['Espino'] }), ['M2'])
  assert.deepEqual(f({ niveles: ['rojo', 'gris'] }), ['M1', 'M4'])
  assert.deepEqual(f({ texto: 'papalon' }), ['M3'])
})
