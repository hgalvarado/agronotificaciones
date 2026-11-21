// Pruebas de src/lib/agrometricas/colaPura.ts. Correr: node --test pruebas/unit/agrometricas_cola.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { migrarLocal, agregarPorId, procesarCola, dataUrlABlob, claveLocal, esDefinitivo, fotoRechazada } from '../../src/lib/agrometricas/colaPura.ts'

const U = 'u1'
const JPG = 'data:image/jpeg;base64,' + Buffer.from('abc').toString('base64')
const almacenFalso = (obj) => (k) => (k in obj ? obj[k] : null)

test('migración: cola vieja con foto data URL -> pendiente con tieneFoto + Blob', async () => {
  const viejo = [
    { id: 'a', tipo: 'parametros', datos: { x: 1 }, resumen: 'A', foto: JPG },
    { id: 'b', tipo: 'clima', datos: { y: 2 }, resumen: 'B' },
  ]
  const m = migrarLocal(U, almacenFalso({ [claveLocal(U, 'cola')]: JSON.stringify(viejo) }))
  assert.equal(m.cola.length, 2)
  assert.equal(m.cola[0].tieneFoto, true)
  assert.equal('foto' in m.cola[0], false)
  assert.equal(m.cola[1].tieneFoto, undefined)
  assert.deepEqual(m.cola.map((p) => p.orden), [0, 1])
  assert.equal(m.fotos.length, 1)
  assert.equal(m.fotos[0].id, 'a')
  assert.equal(Buffer.from(await m.fotos[0].blob.arrayBuffer()).toString(), 'abc')
  assert.deepEqual(m.claves, [claveLocal(U, 'cola')])
})

test('migración: rechazados y datos pasan; JSON dañado no rompe ni pierde lo demás', () => {
  const m = migrarLocal(U, almacenFalso({
    [claveLocal(U, 'cola')]: '{no es json',
    [claveLocal(U, 'rechazados')]: JSON.stringify([{ id: 'r', tipo: 'clima', datos: {}, resumen: 'R', mensaje: 'mal' }]),
    [claveLocal(U, 'datos')]: JSON.stringify({ turnos: [], rangos: [], bajado: 'z' }),
  }))
  assert.equal(m.cola.length, 0)
  assert.equal(m.rechazados.length, 1)
  assert.equal(m.rechazados[0].mensaje, 'mal')
  assert.deepEqual(m.datos, { turnos: [], rangos: [], bajado: 'z' })
  assert.equal(m.claves.length, 3)
})

test('migración: foto ilegible no pierde el pendiente; sin nada que migrar = vacío', () => {
  const m = migrarLocal(U, almacenFalso({ [claveLocal(U, 'cola')]: JSON.stringify([{ id: 'a', tipo: 'calicata', datos: {}, resumen: 'A', foto: 'no-es-url' }]) }))
  assert.equal(m.cola.length, 1)
  assert.equal(m.cola[0].tieneFoto, undefined)
  assert.equal(migrarLocal(U, () => null).claves.length, 0)
  assert.equal(dataUrlABlob('xyz'), null)
})

test('migración: ids repetidos se quedan con uno solo (el último)', () => {
  const m = migrarLocal(U, almacenFalso({ [claveLocal(U, 'cola')]: JSON.stringify([
    { id: 'a', tipo: 'parametros', datos: { v: 1 }, resumen: 'A' },
    { id: 'a', tipo: 'parametros', datos: { v: 2 }, resumen: 'A' },
  ]) }))
  assert.equal(m.cola.length, 1)
  assert.equal(m.cola[0].datos.v, 2)
})

test('cola idempotente por id: reemplaza y conserva su orden', () => {
  let l = []
  l = agregarPorId(l, { id: 'a', tipo: 'parametros', datos: { v: 1 }, resumen: 'A' })
  l = agregarPorId(l, { id: 'b', tipo: 'clima', datos: {}, resumen: 'B' })
  l = agregarPorId(l, { id: 'a', tipo: 'parametros', datos: { v: 9 }, resumen: 'A' })
  assert.equal(l.length, 2)
  assert.deepEqual(l.map((p) => p.id), ['a', 'b'])
  assert.equal(l[0].datos.v, 9)
})

function operaciones(respuestas, registro = { quitados: [], rechazados: [], llamadas: [] }) {
  return {
    registro,
    op: {
      subirFoto: async (p) => `ruta/${p.id}.jpg`,
      guardar: async (p, datos) => {
        registro.llamadas.push({ id: p.id, datos })
        const r = respuestas[p.id]
        if (r instanceof Error) throw r
        return r ?? null
      },
      quitar: async (id) => { registro.quitados.push(id) },
      rechazar: async (r) => { registro.rechazados.push(r) },
      quitarFoto: async () => {},
    },
  }
}
const P = (id, extra = {}) => ({ id, tipo: 'parametros', datos: { id }, resumen: id, ...extra })

test('enviar: éxito quita de la cola y cuenta', async () => {
  const { op, registro } = operaciones({})
  assert.equal(await procesarCola([P('a'), P('b')], op), 2)
  assert.deepEqual(registro.quitados, ['a', 'b'])
})

test('enviar: error de red (lanza) NO borra nada y se detiene', async () => {
  const { op, registro } = operaciones({ a: new TypeError('Failed to fetch') })
  assert.equal(await procesarCola([P('a'), P('b')], op), 0)
  assert.deepEqual(registro.quitados, [])
  assert.equal(registro.llamadas.length, 1)
})

test('enviar: error de servidor no definitivo NO borra', async () => {
  const { op, registro } = operaciones({ a: { code: '57014', message: 'timeout' } })
  assert.equal(await procesarCola([P('a')], op), 0)
  assert.deepEqual(registro.quitados, [])
  assert.equal(registro.rechazados.length, 0)
})

test('enviar: error definitivo pasa a rechazados con mensaje, se quita y sigue con el siguiente', async () => {
  const { op, registro } = operaciones({ a: { code: '22003', message: 'x' } })
  assert.equal(await procesarCola([P('a'), P('b')], op), 1)
  assert.deepEqual(registro.quitados, ['a', 'b'])
  assert.equal(registro.rechazados.length, 1)
  assert.match(registro.rechazados[0].mensaje, /demasiado grande/)
  assert.equal(esDefinitivo('42501'), true)
  assert.equal(esDefinitivo('08006'), false)
})

test('enviar: la foto va a la ruta y se manda en foto_calicata; foto rechazada no bloquea los números', async () => {
  const { op, registro } = operaciones({})
  await procesarCola([P('a', { tieneFoto: true })], op)
  assert.equal(registro.llamadas[0].datos.foto_calicata, 'ruta/a.jpg')

  const r2 = operaciones({})
  r2.op.subirFoto = async () => { throw Object.assign(new Error('muy grande'), { status: 413 }) }
  assert.equal(await procesarCola([P('b', { tieneFoto: true })], r2.op), 1)
  assert.equal(r2.registro.rechazados[0].id, 'b-foto')
  assert.equal('foto_calicata' in r2.registro.llamadas[0].datos, false)
  assert.equal(fotoRechazada({ status: 429 }), false)
  assert.equal(fotoRechazada(new TypeError('Failed to fetch')), false)
})

test('enviar: foto sin red (sin status) detiene y NO borra', async () => {
  const { op, registro } = operaciones({})
  op.subirFoto = async () => { throw new TypeError('Failed to fetch') }
  assert.equal(await procesarCola([P('a', { tieneFoto: true })], op), 0)
  assert.deepEqual(registro.quitados, [])
  assert.equal(registro.llamadas.length, 0)
})
