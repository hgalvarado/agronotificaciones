// Pruebas del menú por rol (103): equivalencia con el menú de antes, unión de roles, permisos, «Otros», inicio.
// Correr: node --test pruebas/unit/menu_por_rol.test.mjs   (Node 22.6+ quita los tipos de los .ts solo)
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'

// Los .ts importan sin extensión ('./menuBase'), como pide Next; aquí se completa con .ts
register(
  'data:text/javascript,' +
    encodeURIComponent(
      `export async function resolve(s, c, n) { try { return await n(s, c) } catch (e) { if (s.startsWith('.') && !/\\.[cm]?[jt]sx?$/.test(s)) return n(s + '.ts', c); throw e } }`
    )
)
const { menuDeSiempre, catalogoDestinos } = await import('../../src/lib/navegacion/destinos.ts')
const { construirMenu, nodosDeSiempre, tieneDesde, destinosDe } = await import('../../src/lib/navegacion/menuRol.ts')
const { entradasDeLaBase } = await import('../../src/lib/navegacion/menuBase.ts')
const { PANTALLAS_CATALOGO } = await import('../../src/lib/catalogos/grupos.ts')

const PANTALLAS_MENU = [
  { codigo: 'fertirriego', nombre: 'Fertirriego · Estaciones', ruta: '/fertirriego', icono: 'gota', modulo: 'Fertirriego' },
  { codigo: 'combustible', nombre: 'Combustible · Despachos', ruta: '/combustible', icono: null, modulo: 'Combustible' },
  { codigo: 'combustible_tanques', nombre: 'Combustible · Tanques', ruta: '/combustible/tanques', icono: 'gauge', modulo: 'Combustible' },
  { codigo: 'tickets', nombre: 'Tickets duplicado', ruta: '/tickets', icono: null, modulo: 'Operación' },
]

// ---- Copia FIEL del armado de AppShell antes de la 103 (src/components/ui/AppShell.tsx en 171108f) ----
function menuDeAntes(permisos, pantallasMenu) {
  const sinMigracion = permisos.includes('__sin_migracion__')
  const concedidos = new Set(permisos)
  const ve = (p) => sinMigracion || concedidos.has(`${p}:ver`)
  const items = [
    { href: '/tickets', pantalla: 'tickets', etiqueta: 'Tickets', icono: 'ticket', visible: ve('tickets') },
    { href: '/horometros', pantalla: 'horometros', etiqueta: 'Horómetros', icono: 'gauge', visible: ve('horometros') },
    { href: '/labores', pantalla: 'labores', etiqueta: 'Labores', icono: 'mappin', visible: ve('labores') },
    { href: '/dashboard', pantalla: 'avance', etiqueta: 'Avance', icono: 'chart', visible: ve('avance') },
    {
      href: '/plan', pantalla: 'plan', etiqueta: 'Controles', icono: 'plan',
      visible: ve('plan') || ve('rotacion') || ve('desinfeccion_plan') || ve('desinfeccion_ejecucion') || ve('desinfeccion_logistica') || ve('desinfeccion_reporte'),
      hijos: [
        { href: '/plan/APS', pantalla: 'plan_aps', etiqueta: 'Emplasticado', icono: 'plan', visible: ve('plan_aps') },
        { href: '/controles/rotacion', pantalla: 'rotacion', etiqueta: 'Cultivos de Rotación', icono: 'chart', visible: ve('rotacion') },
        { href: '/controles/desinfeccion', pantalla: 'desinfeccion_ejecucion', etiqueta: 'Desinfección de suelo', icono: 'gota',
          visible: ve('desinfeccion_plan') || ve('desinfeccion_ejecucion') || ve('desinfeccion_logistica') || ve('desinfeccion_reporte') },
      ],
    },
    { href: '/costos', pantalla: 'costos', etiqueta: 'Costos', icono: 'dinero', visible: ve('costos') },
    { href: '/admin/catalogos', pantalla: PANTALLAS_CATALOGO[0], etiqueta: 'Catálogos', icono: 'ajustes', visible: PANTALLAS_CATALOGO.some(ve) },
    { href: '/admin/reporte-publico', pantalla: 'reporte_publico', etiqueta: 'Reporte público', icono: 'ajustes', visible: ve('reporte_publico') },
    { href: '/admin/usuarios', pantalla: 'usuarios', etiqueta: 'Usuarios', icono: 'usuario', visible: ve('usuarios') },
  ]
  const yaEnMenu = {
    codigos: new Set([...items.flatMap((i) => [i.pantalla, ...(i.hijos ?? []).map((h) => h.pantalla)]), ...PANTALLAS_CATALOGO]),
    hrefs: new Set(items.flatMap((i) => [i.href, ...(i.hijos ?? []).map((h) => h.href)])),
  }
  for (const e of entradasDeLaBase(pantallasMenu, ve, yaEnMenu)) {
    items.push({ href: e.href, pantalla: e.pantalla, etiqueta: e.etiqueta, icono: e.icono || 'plan', visible: true,
      hijos: e.hijos?.map((h) => ({ href: h.href, pantalla: h.pantalla, etiqueta: h.etiqueta, icono: h.icono || 'plan', visible: true })) })
  }
  const quitar = ({ visible, hijos, ...r }) => (hijos ? { ...r, hijos: hijos.map(quitar) } : r)
  return items
    .map((i) => (i.hijos ? { ...i, hijos: i.hijos.filter((h) => h.visible) } : i))
    .filter((i) => i.visible && (!i.hijos || i.hijos.length > 0))
    .map(quitar)
}

const CODIGOS = [
  'tickets', 'horometros', 'labores', 'avance', 'plan', 'plan_aps', 'rotacion', 'desinfeccion_plan', 'desinfeccion_ejecucion',
  'desinfeccion_logistica', 'desinfeccion_reporte', 'costos', ...PANTALLAS_CATALOGO, 'reporte_publico', 'usuarios',
  'fertirriego', 'combustible', 'combustible_tanques', 'permisos', 'tarifas', 'lotes',
]
let semilla = 7
const azar = () => ((semilla = (semilla * 1103515245 + 12345) % 2 ** 31) / 2 ** 31)
const conjuntoAlAzar = () => CODIGOS.filter(() => azar() < 0.4).map((c) => `${c}:ver`)
const limpio = (x) => JSON.parse(JSON.stringify(x))
const armar = (menus, permisos, pm = PANTALLAS_MENU) =>
  construirMenu({ menus, tiene: tieneDesde(permisos), pantallasMenu: pm, pantallasCatalogo: PANTALLAS_CATALOGO })

test('EQUIVALENCIA: sin menú diseñado, 2000 combinaciones de permisos dan el menú de antes', () => {
  const sinDiseno = [
    { rol_id: 2, principal: true, disenado: false, nodos: null, inicio: null, incluir_resto: true },
    { rol_id: 5, principal: false, disenado: false, nodos: null, inicio: null, incluir_resto: true },
  ]
  for (let k = 0; k < 2000; k++) {
    const permisos = conjuntoAlAzar()
    const pm = k % 3 === 0 ? [] : PANTALLAS_MENU
    for (const menus of [[], sinDiseno]) {
      const r = armar(menus, permisos, pm)
      assert.equal(r.disenado, false)
      assert.equal(r.inicio, null)
      assert.deepEqual(limpio(r.entradas), limpio(menuDeAntes(permisos, pm)), `permisos: ${permisos.join(',')}`)
    }
  }
  // Todo, nada y «sin migración»
  for (const p of [CODIGOS.map((c) => `${c}:ver`), [], ['__sin_migracion__']]) {
    assert.deepEqual(limpio(armar([], p).entradas), limpio(menuDeAntes(p, PANTALLAS_MENU)))
  }
})

test('nodosDeSiempre describe el menú de siempre (diseñarlo tal cual no cambia nada)', () => {
  // (Un módulo de la base con varias pantallas es grupo en el diseño; si solo ve una, el de siempre la ponía suelta)
  const PM = PANTALLAS_MENU.filter((p) => !p.codigo.startsWith('combustible'))
  const nodos = nodosDeSiempre(PM, PANTALLAS_CATALOGO)
  for (let k = 0; k < 300; k++) {
    const permisos = conjuntoAlAzar()
    const r = armar([{ rol_id: 1, principal: true, disenado: true, nodos, inicio: null, incluir_resto: false }], permisos, PM)
    // Única diferencia admitida: «Controles» con plan_aps visible y sin plan/rotación/desinfección (antes se escondía)
    // (y la llave interna de un grupo diseñado es la de su primera pantalla, no '/plan')
    const sinLlaveDeGrupo = (l) => l.map((e) => (e.hijos ? { ...e, href: '', pantalla: '' } : e))
    const antes = sinLlaveDeGrupo(limpio(menuDeAntes(permisos, PM)))
    const despues = sinLlaveDeGrupo(limpio(r.entradas)).filter((e) => !(e.etiqueta === 'Controles' && !antes.some((a) => a.etiqueta === 'Controles')))
    assert.deepEqual(despues, antes)
  }
  const claves = new Set(catalogoDestinos(PANTALLAS_MENU, PANTALLAS_CATALOGO).map((d) => d.clave))
  assert.ok(destinosDe(nodos).every((c) => claves.has(c)), 'todo destino del menú de siempre existe en el catálogo')
})

test('el catálogo de destinos no repite llave ni ruta', () => {
  const d = catalogoDestinos(PANTALLAS_MENU, PANTALLAS_CATALOGO)
  assert.equal(new Set(d.map((x) => x.clave)).size, d.length)
  assert.equal(new Set(d.map((x) => x.href)).size, d.length)
  assert.ok(d.some((x) => x.clave === 'combustible_tanques'), 'los módulos de la base entran')
  assert.ok(!d.some((x) => x.etiqueta === 'Tickets duplicado'), 'una pantalla de la base con ruta ya cubierta no se repite')
})

const CAMPO = [
  { tipo: 'grupo', etiqueta: 'Campo', icono: 'gota', hijos: [
    { tipo: 'pantalla', destino: 'fertirriego', etiqueta: 'Mi estación' },
    { tipo: 'pantalla', destino: 'tickets' },
  ] },
  { tipo: 'pantalla', destino: 'costos', etiqueta: 'Plata' },
]

test('el menú no da acceso: lo que no puede abrir no sale; grupo vacío no sale', () => {
  const r = armar([{ rol_id: 3, principal: true, disenado: true, nodos: CAMPO, inicio: 'costos', incluir_resto: false }], ['fertirriego:ver'])
  assert.deepEqual(limpio(r.entradas), [
    { href: '/fertirriego', pantalla: 'fertirriego', etiqueta: 'Campo', icono: 'gota',
      hijos: [{ href: '/fertirriego', pantalla: 'fertirriego', etiqueta: 'Mi estación', icono: 'gota' }] },
  ])
  assert.equal(r.inicio, null, 'el inicio que no puede abrir se ignora')
  const nada = armar([{ rol_id: 3, principal: true, disenado: true, nodos: CAMPO, inicio: null, incluir_resto: false }], [])
  assert.deepEqual(nada.entradas, [])
})

test('etiquetas e íconos propios, inicio y destinos de Administración con acción', () => {
  const nodos = [...CAMPO, { tipo: 'pantalla', destino: 'admin_menu' }, { tipo: 'pantalla', destino: 'no_existe' }]
  const r = armar([{ rol_id: 3, principal: true, disenado: true, nodos, inicio: 'fertirriego', incluir_resto: false }],
    ['fertirriego:ver', 'tickets:ver', 'costos:ver', 'permisos:disenar_menu'])
  assert.deepEqual(r.entradas.map((e) => e.etiqueta), ['Campo', 'Plata', 'Menú por rol'])
  assert.deepEqual(r.entradas[0].hijos.map((h) => h.etiqueta), ['Mi estación', 'Tickets'])
  assert.equal(r.inicio, '/fertirriego')
  const sinAccion = armar([{ rol_id: 3, principal: true, disenado: true, nodos, inicio: null, incluir_resto: false }], ['permisos:ver'])
  assert.deepEqual(sinAccion.entradas, [], '«Ver» Permisos no basta para «Menú por rol»')
})

test('«Otros»: lo que el menú de siempre le daría y el diseño no puso va al final', () => {
  const r = armar([{ rol_id: 3, principal: true, disenado: true, nodos: [{ tipo: 'pantalla', destino: 'tickets' }], inicio: null, incluir_resto: true }],
    ['tickets:ver', 'fertirriego:ver', 'horometros:ver', 'lotes:ver'])
  assert.deepEqual(limpio(r.entradas).map((e) => [e.etiqueta, (e.hijos ?? []).map((h) => h.pantalla)]), [
    ['Tickets', []],
    ['Otros', ['horometros', 'fertirriego']],
  ])
  const sin = armar([{ rol_id: 3, principal: true, disenado: true, nodos: [{ tipo: 'pantalla', destino: 'tickets' }], inicio: null, incluir_resto: false }],
    ['tickets:ver', 'fertirriego:ver'])
  assert.deepEqual(sin.entradas.map((e) => e.etiqueta), ['Tickets'])
})

test('varios roles: principal primero, grupos con el mismo nombre se juntan, sin repetir', () => {
  const a = { rol_id: 9, principal: false, disenado: true, incluir_resto: false, inicio: 'horometros', nodos: [
    { tipo: 'grupo', etiqueta: 'campo', hijos: [{ tipo: 'pantalla', destino: 'tickets' }, { tipo: 'pantalla', destino: 'horometros' }] },
    { tipo: 'pantalla', destino: 'labores' },
  ] }
  const b = { rol_id: 4, principal: true, disenado: true, incluir_resto: false, inicio: 'fertirriego', nodos: CAMPO }
  const r = armar([a, b], ['fertirriego:ver', 'tickets:ver', 'horometros:ver', 'labores:ver'])
  assert.deepEqual(limpio(r.entradas).map((e) => [e.etiqueta, (e.hijos ?? []).map((h) => h.pantalla)]), [
    ['Campo', ['fertirriego', 'tickets', 'horometros']],
    ['Labores', []],
  ])
  assert.equal(r.inicio, '/fertirriego', 'manda el inicio del rol principal')
  // Un rol diseñado y otro sin diseño: el segundo aporta el menú de siempre
  const mixto = armar([b, { rol_id: 2, principal: false, disenado: false, nodos: null, inicio: null, incluir_resto: true }],
    ['fertirriego:ver', 'tickets:ver', 'horometros:ver'])
  assert.deepEqual(limpio(mixto.entradas).map((e) => e.etiqueta), ['Campo', 'Horómetros'])
})
