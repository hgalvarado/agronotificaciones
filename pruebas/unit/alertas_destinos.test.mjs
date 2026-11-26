// Pruebas del catálogo de alertas (destinos, enlace profundo, payload). Correr: node --test pruebas/unit/alertas_destinos.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const { urlDeAlerta, leerDestino, hayDestino, rutaInternaSegura, haceCuanto, armarPayload, nombreTipo, TIPOS_ALERTA } = await import(
  pathToFileURL(resolve('src/lib/alertas/destinos.ts')).href
)

const E = '11111111-1111-4111-8111-111111111111'

test('los 4 tipos iniciales existen y tienen nombre', () => {
  for (const t of ['cuadre_combustible', 'mantenimiento_vencido', 'saldo_negativo', 'capacidad_llena']) {
    assert.ok(TIPOS_ALERTA.some((x) => x.id === t), t)
  }
  assert.equal(nombreTipo('no_existe'), 'Otros')
})

test('cuadre de combustible lleva al historial del tanque, en el día y registro exactos', () => {
  const u = urlDeAlerta({ destino: { pantalla: 'motores', pestana: 'historial', estacion_id: E, tanque_id: 'T1', fecha: '2026-11-17', registro_id: 'R9' } })
  assert.equal(u, `/motores?pestana=historial&estacion=${E}&tanque=T1&registro=R9&fecha=2026-11-17`)
})

test('mantenimiento lleva a la pestaña Motores con el motor', () => {
  assert.equal(urlDeAlerta({ destino: { pantalla: 'motores', pestana: 'motores', motor_id: 'M1' } }), '/motores?pestana=motores&motor=M1')
})

test('saldo negativo y capacidad llevan a la bitácora / General de Fertirriego', () => {
  assert.equal(urlDeAlerta({ destino: { pantalla: 'fertirriego', pestana: 'bitacora', estacion_id: E, documento_id: 'D1' } }), `/fertirriego?pestana=bitacora&estacion=${E}&registro=D1`)
  assert.equal(urlDeAlerta({ destino: { pantalla: 'fertirriego', pestana: 'general', estacion_id: E } }), `/fertirriego?pestana=general&estacion=${E}`)
})

test('sin destino usa la url guardada; una url externa se descarta', () => {
  assert.equal(urlDeAlerta({ destino: null, url: '/campo' }), '/campo')
  assert.equal(urlDeAlerta({ url: 'https://malo.example/x' }), '/campo')
  assert.equal(urlDeAlerta({ url: '//malo.example' }), '/campo')
  assert.equal(urlDeAlerta({ destino: { pantalla: 'desconocida' }, url: '/inyeccion' }), '/inyeccion')
  assert.equal(rutaInternaSegura('/a\\b'), '/campo')
})

test('leerDestino: lee y limpia los parámetros; ida y vuelta con urlDeAlerta', () => {
  const u = urlDeAlerta({ destino: { pantalla: 'motores', pestana: 'tanques', estacion_id: E, tanque_id: 'T 1&2' } })
  const d = leerDestino(u.split('?')[1])
  assert.equal(d.pestana, 'tanques')
  assert.equal(d.estacion, E)
  assert.equal(d.tanque, 'T 1&2')
  assert.equal(hayDestino(d), true)
  assert.equal(hayDestino(leerDestino('')), false)
  assert.equal(leerDestino('registro=%20%20').registro, undefined)
})

test('haceCuanto', () => {
  const ahora = Date.parse('2026-11-25T12:00:00Z')
  assert.equal(haceCuanto('2026-11-25T12:00:00Z', ahora), 'ahora')
  assert.equal(haceCuanto('2026-11-25T11:30:00Z', ahora), 'hace 30 min')
  assert.equal(haceCuanto('2026-11-25T09:00:00Z', ahora), 'hace 3 h')
  assert.equal(haceCuanto('2026-11-22T12:00:00Z', ahora), 'hace 3 d')
})

test('armarPayload recorta y deja la clave como tag', () => {
  const p = armarPayload({ titulo: 'x'.repeat(100), cuerpo: 'y'.repeat(300), url: 'https://x', clave: 'saldo|e|op' })
  assert.equal(p.titulo.length, 60)
  assert.equal(p.cuerpo.length, 140)
  assert.equal(p.url, '/campo')
  assert.equal(p.tag, 'saldo|e|op')
})
