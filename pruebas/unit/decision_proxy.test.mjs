// Pruebas de la decisión del proxy. Correr: node --test pruebas/unit/decision_proxy.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const { decidirProxy, esPrefetch, leerTokenDeCookies, expDelToken } = await import(pathToFileURL(resolve('src/lib/supabase/decisionProxy.ts')).href)

const b64u = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url')
const jwt = (exp) => `${b64u({ alg: 'ES256' })}.${b64u({ sub: 'u1', exp })}.firma`
const cab = (o = {}) => ({ get: (n) => o[n.toLowerCase()] ?? null })
const cookieSesion = (token, prefijo = true) => {
  const v = JSON.stringify({ access_token: token, refresh_token: 'r' })
  return { name: 'sb-abc-auth-token', value: prefijo ? 'base64-' + b64u(v) : v }
}
const AHORA = 1_000_000

test('detecta precargas por las tres cabeceras', () => {
  assert.equal(esPrefetch(cab({ 'next-router-prefetch': '1' })), true)
  assert.equal(esPrefetch(cab({ purpose: 'prefetch' })), true)
  assert.equal(esPrefetch(cab({ 'sec-purpose': 'prefetch;prerender' })), true)
  assert.equal(esPrefetch(cab()), false)
})

test('navegacion real siempre valida en red (getClaims)', () => {
  assert.equal(decidirProxy({ cabeceras: cab(), cookies: [cookieSesion(jwt(AHORA + 3000))], ahoraSeg: AHORA }), 'validar-en-red')
  assert.equal(decidirProxy({ cabeceras: cab(), cookies: [], ahoraSeg: AHORA }), 'validar-en-red')
})

test('precarga con token vigente: local, sin red', () => {
  const c = cab({ 'next-router-prefetch': '1' })
  assert.equal(decidirProxy({ cabeceras: c, cookies: [cookieSesion(jwt(AHORA + 3000))], ahoraSeg: AHORA }), 'validar-local')
  assert.equal(decidirProxy({ cabeceras: c, cookies: [cookieSesion(jwt(AHORA + 3000), false)], ahoraSeg: AHORA }), 'validar-local')
})

test('precarga con token vencido o por vencer: no confia, valida como navegacion real', () => {
  const c = cab({ 'next-router-prefetch': '1' })
  assert.equal(decidirProxy({ cabeceras: c, cookies: [cookieSesion(jwt(AHORA - 5))], ahoraSeg: AHORA }), 'validar-en-red')
  assert.equal(decidirProxy({ cabeceras: c, cookies: [cookieSesion(jwt(AHORA + 5))], ahoraSeg: AHORA }), 'validar-en-red')
})

test('precarga sin cookie de sesion: redirigir; cookie ilegible: valida en red', () => {
  const c = cab({ 'next-router-prefetch': '1' })
  assert.equal(decidirProxy({ cabeceras: c, cookies: [{ name: 'otra', value: 'x' }], ahoraSeg: AHORA }), 'redirigir')
  assert.equal(decidirProxy({ cabeceras: c, cookies: [{ name: 'sb-abc-auth-token', value: 'base64-@@@' }], ahoraSeg: AHORA }), 'validar-en-red')
})

test('cookie partida en trozos se recompone en orden', () => {
  const v = 'base64-' + b64u(JSON.stringify({ access_token: jwt(AHORA + 3000) }))
  const mitad = Math.floor(v.length / 2)
  const cookies = [
    { name: 'sb-abc-auth-token.1', value: v.slice(mitad) },
    { name: 'sb-abc-auth-token.0', value: v.slice(0, mitad) },
  ]
  assert.equal(leerTokenDeCookies(cookies), jwt(AHORA + 3000))
})

test('exp ilegible: se trata como no confiable', () => {
  assert.equal(expDelToken('basura'), null)
  const c = cab({ 'next-router-prefetch': '1' })
  assert.equal(decidirProxy({ cabeceras: c, cookies: [cookieSesion('basura')], ahoraSeg: AHORA }), 'validar-en-red')
})
