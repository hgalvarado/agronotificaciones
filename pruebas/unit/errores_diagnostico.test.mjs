// Pruebas del catálogo de diagnóstico de la bitácora de errores (118). Correr: node --test pruebas/unit/errores_diagnostico.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const { diagnosticar, diagnosticarLatido, semaforo, textoDelInforme, UMBRALES } = await import(pathToFileURL(resolve('src/lib/errores/diagnostico.ts')).href)

const casos = [
  ['sin red', { mensaje: 'TypeError: Failed to fetch' }, 'sin_red'],
  ['sesión vencida', { mensaje: 'JWT expired', codigo: 'PGRST301' }, 'sesion_vencida'],
  ['sesión (texto)', { mensaje: 'Tu sesión venció. Vuelve a entrar' }, 'sesion_vencida'],
  ['permiso 42501', { codigo: '42501', mensaje: 'new row violates row-level security policy' }, 'permiso'],
  ['permiso por rol', { mensaje: 'Tu rol no tiene «Aplicar» en Fertirriego' }, 'permiso'],
  ['saldo', { resultado: 'RECHAZADO', mensaje: 'No alcanza el saldo de UREA en la bodega: quedaría en -5.' }, 'saldo_insuficiente'],
  ['saldo negativo aceptado', { resultado: 'ACEPTADO_CON_OBSERVACIONES', observaciones: ['SALDO_NEGATIVO'] }, 'saldo_insuficiente'],
  ['custodia', { resultado: 'RECHAZADO', mensaje: 'La estación no está a tu cargo. Recíbela primero (relevo)' }, 'custodia'],
  ['turno archivado', { resultado: 'RECHAZADO', mensaje: 'El turno T1 ya terminó su ciclo: se cerró en AGL el 01/11/2026.' }, 'turno_archivado'],
  ['duplicado', { mensaje: 'YA_EXISTIA' }, 'duplicado'],
  ['posible duplicado', { resultado: 'ACEPTADO_CON_OBSERVACIONES', observaciones: ['POSIBLE_DUPLICADO'] }, 'duplicado'],
  ['reloj', { resultado: 'ACEPTADO_CON_OBSERVACIONES', observaciones: ['RELOJ'] }, 'reloj_desfasado'],
  ['versión vieja', { resultado: 'RECHAZADO', mensaje: 'Tipo de registro desconocido: nuevo_tipo. Actualiza la aplicación.' }, 'version_vieja'],
  ['almacenamiento lleno', { mensaje: 'QuotaExceededError: The quota has been exceeded', codigo: 'QuotaExceededError' }, 'almacenamiento'],
  ['IndexedDB bloqueado', { mensaje: 'No se pudo abrir el almacén del teléfono: SecurityError' }, 'almacenamiento'],
  ['40001', { codigo: '40001', mensaje: 'could not serialize access' }, 'serializacion'],
  ['timeout', { mensaje: 'canceling statement due to statement timeout', codigo: '57014' }, 'timeout'],
  ['5xx', { codigo: '503', mensaje: 'Service Unavailable' }, 'servidor_5xx'],
  ['turno inexistente (versión vieja)', { resultado: 'RECHAZADO', mensaje: 'El turno no existe. Actualiza la aplicación.' }, 'version_vieja'],
  ['estación inexistente', { resultado: 'RECHAZADO', mensaje: 'La estación no existe' }, 'turno_o_producto_inexistente'],
  ['cantidad inválida', { resultado: 'RECHAZADO', mensaje: '«Cantidad» debe ser mayor que cero.' }, 'cantidad_invalida'],
  ['ubicación', { mensaje: 'User denied Geolocation' }, 'ubicacion'],
  ['cola atascada', { mensaje: 'x', detalle: { intentos: 7 } }, 'cola_atascada'],
  ['render JS', { origen: 'pantalla', mensaje: "Cannot read properties of undefined (reading 'id')" }, 'render_js'],
  ['guardado de fondo', { origen: 'guardado', mensaje: 'falló algo raro' }, 'guardado_fondo'],
  ['desconocido', { origen: 'otro', mensaje: 'algo nunca visto' }, 'desconocido'],
]

for (const [nombre, entrada, clave] of casos) {
  test(`diagnóstico: ${nombre} → ${clave}`, () => {
    const d = diagnosticar(entrada)
    assert.equal(d.clave, clave)
    for (const campo of ['titulo', 'quePaso', 'causa', 'porQue', 'alUsuario', 'alAdministrador', 'comoVerificar']) {
      assert.ok(typeof d[campo] === 'string' && d[campo].length > 15, `${campo} vacío en ${clave}`)
    }
    assert.ok(['info', 'aviso', 'error', 'critico'].includes(d.gravedad))
    assert.ok(['si', 'no', 'pendiente'].includes(d.seperdio))
  })
}

test('un número en un mensaje no se confunde con un código 5xx ni 401', () => {
  assert.equal(diagnosticar({ mensaje: 'Se aplicaron 500 kg y 401 litros', origen: 'otro' }).clave, 'desconocido')
})

test('desconocido muestra los datos técnicos y sugiere qué recoger', () => {
  const d = diagnosticar({ mensaje: 'algo nunca visto', codigo: 'ZZ999', resultado: 'RECHAZADO' })
  assert.match(d.causa, /algo nunca visto/)
  assert.match(d.causa, /ZZ999/)
  assert.match(d.alAdministrador, /Recoge/)
  assert.equal(d.seperdio, 'si')
})

test('rechazo por saldo = se perdió (hay que registrar de nuevo); aceptado con observación = no', () => {
  assert.equal(diagnosticar({ resultado: 'RECHAZADO', mensaje: 'No alcanza el saldo' }).seperdio, 'si')
  assert.equal(diagnosticar({ resultado: 'ACEPTADO_CON_OBSERVACIONES', observaciones: ['SALDO_NEGATIVO'] }).seperdio, 'no')
})

test('almacenamiento lleno es crítico', () => {
  assert.equal(diagnosticar({ mensaje: 'QuotaExceededError' }).gravedad, 'critico')
})

test('una regla que revienta no rompe el diagnóstico', () => {
  assert.equal(diagnosticar({ mensaje: null, codigo: null, detalle: { intentos: 'x' } }).clave, 'desconocido')
})

const ahora = new Date('2026-11-18T12:00:00Z')
const hace = (h) => new Date(ahora.getTime() - h * 3_600_000).toISOString()

test('latido: pendiente de más de 6 h → error; de 24 h → crítico', () => {
  assert.equal(diagnosticarLatido({ pendientes: 2, pendiente_mas_viejo_h: 7 }, ahora)[0].gravedad, 'error')
  assert.equal(diagnosticarLatido({ pendientes: 2, pendiente_mas_viejo_h: 30 }, ahora)[0].gravedad, 'critico')
  assert.equal(diagnosticarLatido({ pendientes: 2, pendiente_mas_viejo_h: 1 }, ahora).length, 0)
  assert.equal(diagnosticarLatido({ pendientes: 0, pendiente_mas_viejo_h: 40 }, ahora).length, 0)
})
test('latido: reloj desfasado y versión vieja', () => {
  assert.equal(diagnosticarLatido({ desfase_reloj_s: 7200 }, ahora)[0].gravedad, 'error')
  assert.equal(diagnosticarLatido({ desfase_reloj_s: -400 }, ahora)[0].clave, 'reloj_desfasado')
  assert.equal(diagnosticarLatido({ desfase_reloj_s: 30 }, ahora).length, 0)
  assert.equal(diagnosticarLatido({ version_app: '0.1.0' }, ahora, '0.2.0')[0].clave, 'version_desactualizada')
  assert.equal(diagnosticarLatido({ version_app: '0.2.0' }, ahora, '0.2.0').length, 0)
})
test('latido: sin latido en 3 días', () => {
  assert.equal(diagnosticarLatido({ ultimo_latido: hace(24 * 4) }, ahora)[0].clave, 'sin_latido')
  assert.equal(diagnosticarLatido({ ultimo_latido: hace(5) }, ahora).length, 0)
})
test('latido: sin sincronizar hace más de un día con pendientes', () => {
  const r = diagnosticarLatido({ pendientes: 1, ultima_sync_ok: hace(30) }, ahora)
  assert.equal(r[0].clave, 'sin_sincronizar')
})
test('semáforo', () => {
  assert.equal(semaforo({}, ahora), 'gris')
  assert.equal(semaforo({ ultimo_latido: hace(1), pendientes: 0 }, ahora), 'verde')
  assert.equal(semaforo({ ultimo_latido: hace(1), rechazos_7d: 1 }, ahora), 'ambar')
  assert.equal(semaforo({ ultimo_latido: hace(1), graves_nuevos: 1 }, ahora), 'rojo')
  assert.equal(semaforo({ ultimo_latido: hace(1), pendientes: 3, pendiente_mas_viejo_h: UMBRALES.pendienteGrave + 1 }, ahora), 'rojo')
})
test('texto del informe incluye lo esencial y los datos técnicos', () => {
  const e = { origen: 'sincronizacion', modulo: 'fertirriego', codigo: '42501', mensaje: 'x', detalle: { version: '0.1.0' } }
  const txt = textoDelInforme(e, diagnosticar(e), { Usuario: 'Ana' })
  assert.match(txt, /INFORME DE ERROR/)
  assert.match(txt, /Usuario: Ana/)
  assert.match(txt, /"version":"0.1.0"/)
})
