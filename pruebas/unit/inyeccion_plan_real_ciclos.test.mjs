// Plan contra real: el Ciclo 1 y el Ciclo 2 no se mezclan (mismo lote, DDT y producto).
// Correr: node --test pruebas/unit/inyeccion_plan_real_ciclos.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { join, resolve } from 'node:path'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'

// Los imports sin extensión no los resuelve Node: se copian planGeneral y cumplimiento a una carpeta temporal con la ruta completa
const dir = mkdtempSync(join(tmpdir(), 'ciclos-'))
writeFileSync(join(dir, 'planGeneral.ts'), readFileSync(resolve('src/lib/inyeccion/planGeneral.ts'), 'utf8'))
writeFileSync(join(dir, 'cumplimiento.ts'), readFileSync(resolve('src/lib/inyeccion/cumplimiento.ts'), 'utf8').replace("'./planGeneral'", "'./planGeneral.ts'"))
const C = await import(pathToFileURL(join(dir, 'cumplimiento.ts')).href)
const fp = (ciclo, fecha) => ({ lote: '1002-010', ddt: 5, ciclo, material_id: 'M1', categoria_clave: 'x', fecha_plan: fecha, fecha_estimada: false, dosis_mz: 2, area_mz: 10, cantidad_plan: 20 })
const ap = (id, ciclo, fecha) => ({ id, lote: '1002-010', ciclo, fecha, fecha_hora: `${fecha}T10:00:00-06:00`, area_mz: 10, anulado_at: null, registrado_por: null, objetivos: [], lineas: [{ material_id: 'M1', ddt_plan: 5, cantidad: 20, dosis_mz: 2 }] })

test('dos ciclos con el mismo lote, DDT y producto quedan en filas separadas', () => {
  const f = C.comparativaPlanReal([fp('Ciclo 1', '2026-03-01'), fp('Ciclo 2', '2026-09-01')], [ap('a', 'Ciclo-1', '2026-03-01')], '2026-11-25')
  assert.equal(f.length, 2)
  const c1 = f.find((x) => x.ciclo === 'Ciclo 1'), c2 = f.find((x) => x.ciclo === 'Ciclo 2')
  assert.equal(c1.aplicaciones.length, 1)
  assert.equal(c2.aplicaciones.length, 0)
  assert.equal(c2.tiempo, 'vencido')
})

test('una aplicación sin ciclo cae en el único ciclo que tiene ese lote, DDT y producto', () => {
  const f = C.comparativaPlanReal([fp('Ciclo 2', '2026-09-01')], [ap('a', null, '2026-09-01')], '2026-11-25')
  assert.equal(f[0].aplicaciones.length, 1)
})
