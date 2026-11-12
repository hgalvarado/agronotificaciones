/**
 * El código de 12 horas del teléfono (lib/fertirriego/codigo.ts) debe dar EXACTAMENTE lo mismo que la base
 * (fn_fert_codigo_largo, sql/99). Vectores sacados de la réplica local con una llave de PRUEBA (no es de nadie).
 * Correr: node pruebas/unit/codigo_largo.test.mjs
 */
import { codigoEn, codigoLargoEn, importarLlave, pasoLargoDe, verificarCodigo, verificarCodigoLargo, venceCodigoLargo } from '../../src/lib/fertirriego/codigo.ts'

const SECRETO = '3guHsUtQZkkCEfW93jdlqgvefmM='
const VECTORES = [
  [2945000, '62133716'],
  [2945077, '61614383'],
  [4294967297, '34175321'], // paso > 2^32: prueba la parte alta del contador
]
let fallas = 0
const ok = (c, m) => {
  console.log(`${c ? 'ok ' : 'FALLA'}  ${m}`)
  if (!c) fallas++
}

const llave = await importarLlave(SECRETO)
for (const [paso, esperado] of VECTORES) ok((await codigoLargoEn(llave, paso)) === esperado, `paso ${paso} = ${esperado} (igual que la base)`)
ok((await codigoEn(llave, 59000000)) === '632647', 'el código de 30 s sigue igual que la base')

const yo = { perfil_id: 'yo', nombre: 'Yo', llave: await importarLlave('AAAAAAAAAAAAAAAAAAAAAAAAAAA=') }
const comp = { perfil_id: 'e2', nombre: 'Compañero', llave }
const entrega = Date.UTC(2026, 10, 12, 6, 5) // 00:05 hora de Honduras
const cod = await codigoLargoEn(llave, pasoLargoDe(entrega))
ok((await verificarCodigoLargo(cod, [yo, comp], 'yo', entrega + 7 * 3600_000))?.perfil_id === 'e2', 'vale 7 horas después')
ok((await verificarCodigoLargo(cod, [yo, comp], 'yo', entrega + 11.8 * 3600_000))?.perfil_id === 'e2', 'vale casi 12 horas después')
ok((await verificarCodigoLargo(cod, [yo, comp], 'yo', entrega + 12.5 * 3600_000)) === null, 'a las 12 h y media ya no vale')
ok((await verificarCodigoLargo(cod, [yo, comp], 'e2', entrega + 3600_000)) === null, 'nadie se recibe a sí mismo')
ok((await verificarCodigoLargo('12345678', [yo, comp], 'yo', entrega + 3600_000)) === null, 'un código inventado no pasa')
ok((await verificarCodigo(cod.slice(0, 6), [yo, comp], 'yo', entrega)) === null, 'no sirve como código de 30 s')
ok(venceCodigoLargo(entrega) > entrega + 12 * 3600_000 && venceCodigoLargo(entrega) <= entrega + 12.2 * 3600_000, 'vence a las ~12 horas')

console.log(fallas ? `=== ${fallas} FALLA(S) ===` : '=== TODAS PASARON ===')
if (fallas) process.exit(1)
