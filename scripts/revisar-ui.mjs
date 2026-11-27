#!/usr/bin/env node
/**
 * Revisor de UI/UX (densidad, jerarquía, componentes, tema, táctil) para pantallas React (.tsx).
 *
 * Por qué existe: el usuario se cansó de corregir lo mismo en cada pantalla nueva (tarjetas gigantes por fila,
 * botones por fila, casillas de selección, colores fijos, selects nativos…). La guía está en docs/guia-ui-ux.md;
 * este revisor detecta por patrones las violaciones más repetidas y avisa a Claude. Nunca bloquea.
 *
 * AGL: también revisa las vistas .js de AGLGestion_App/frontend (revisarAgl) y recuerda la lista visual de AGL.
 *
 * Uso:
 *   - Hook PostToolUse (Edit|Write): revisa el archivo editado en src (solo .tsx) y devuelve `additionalContext`.
 *   - Hook Stop: `--recordatorio` imprime la lista de comprobación visual si hay .tsx cambiados en git.
 *   - A mano: `node scripts/revisar-ui.mjs --todo` | `--todo --agrupado` | `--archivo ruta`.
 *
 * Silenciar un hallazgo verificado: `// ui-ok: motivo` (en JSX: llaves con comentario ui-ok) en la misma línea o la anterior.
 * Heurístico: puede dar falsos positivos.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, extname, resolve, relative, sep, basename } from 'node:path'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const RAIZ = resolve(process.cwd())

/** Tonos que el tema oscuro ya redefine (globals.css): usar uno de ellos es seguro; otros no cambian en oscuro. */
const TEMA = (() => {
  try {
    const css = readFileSync(join(RAIZ, 'src/app/globals.css'), 'utf8')
    const s = new Set()
    for (const m of css.matchAll(/--color-([a-z]+-\d+)\s*:/g)) s.add(m[1])
    for (const m of css.matchAll(/\.(?:text|bg|border|ring|fill|stroke)-([a-z]+-\d+)/g)) s.add(m[1])
    return s
  } catch {
    return new Set()
  }
})()

/** Blanquea cadenas '…' y "…" cerradas en la misma línea y comentarios (conserva longitud y líneas). */
function limpiar(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .split('\n')
    .map((l) => {
      let r = l.replace(/(^|\s)\/\/.*$/, (m) => ' '.repeat(m.length))
      r = r.replace(/"[^"\n]*"/g, (m) => '"' + ' '.repeat(m.length - 2) + '"')
      r = r.replace(/'[^'\n]*'/g, (m) => "'" + ' '.repeat(m.length - 2) + "'")
      return r
    })
}

/** Por línea: true si el inicio de la línea está dentro de un paréntesis abierto por `.map(`. */
function lineasEnMap(limpias) {
  const pila = []
  const dentro = new Array(limpias.length).fill(false)
  limpias.forEach((l, i) => {
    dentro[i] = pila.some(Boolean)
    for (let k = 0; k < l.length; k++) {
      const c = l[k]
      if (c === '(') pila.push(/\.map\s*$/.test(l.slice(0, k)))
      else if (c === ')') pila.pop()
    }
    if (pila.length > 60) pila.length = 0
  })
  return dentro
}

/** Texto del tag abierto en la línea i hasta su `>` (máx. 8 líneas). */
function tag(lineas, i) {
  let t = ''
  for (let k = i; k < Math.min(lineas.length, i + 8); k++) {
    t += lineas[k] + ' '
    if (/>\s*$/.test(lineas[k]) && !/=>\s*$/.test(lineas[k])) break
  }
  return t
}

export function revisar(texto, nombre) {
  const orig = texto.split('\n')
  const lim = limpiar(texto)
  const enMap = lineasEnMap(lim)
  const hallazgos = []
  // global-error se dibuja fuera del tema (sin CSS global): sus colores fijos son a propósito
  const esUi = /^src\/components\/ui\/|global-error\.tsx$/.test(nombre)
  const esDetalle = /Detalle|Modal/.test(basename(nombre))
  const esSelector = /Selector|Filtro|Grupo|Casillas/.test(basename(nombre))
  const exento = (i) => /ui-ok:/.test(orig[i] ?? '') || /ui-ok:/.test(orig[i - 1] ?? '')
  const add = (i, regla, mensaje) => {
    if (!exento(i)) hallazgos.push({ archivo: nombre, linea: i + 1, regla, mensaje })
  }
  const tieneTope = /slice\(|verMas|Ver más|limite|paginaActual|\bpagina\b|visibles|DataGrid|useVentana/i.test(texto)
  let listasSinTope = 0
  const usaRotulo = /rotuloLote/.test(texto)

  lim.forEach((l, i) => {
    const o = orig[i]
    if (/^\s*import\s/.test(o)) return
    // (c) casillas por fila
    if (enMap[i] && /type=["']checkbox["']/.test(o) && !esUi && !esSelector)
      add(i, 'checkbox-en-fila', 'Casilla de selección por fila: la guía no usa selección por fila; tocar la fila abre el DETALLE (guía c).')
    // (c) botones de acción por fila
    if (enMap[i] && !esDetalle && !esUi && /<(button|Boton\w*)\b/.test(l)) {
      const t = tag(orig, i) + ' ' + (orig[i + 1] ?? '') + (orig[i + 2] ?? '')
      if (/>\s*(Eliminar|Anular|Editar|Borrar)\b/.test(t) || /title=["'](Eliminar|Anular|Editar)/.test(t))
        add(i, 'boton-accion-en-fila', 'Botón Eliminar/Anular/Editar dentro de una lista: esas acciones viven en el detalle del registro (guía c).')
    }
    // (a) alturas grandes en filas
    if (enMap[i] && !esUi) {
      const m = /\bmin-h-(\d+)\b|\bmin-h-\[(\d+)px\]/.exec(o)
      if (m) {
        const px = m[1] ? Number(m[1]) * 4 : Number(m[2])
        if (px >= 80) add(i, 'fila-alta', `Elemento de lista con min-h de ${px}px: las filas son compactas (~48–60 px) (guía a).`)
      }
      if (/<(Tarjeta|Card)\b/.test(l) && /\bp-(5|6|7|8)\b|\bp[xy]-(6|7|8)\b/.test(tag(orig, i)))
        add(i, 'tarjeta-grande-en-fila', 'Tarjeta con padding grande por cada registro: usa filas compactas agrupadas (guía a).')
    }
    // (l) elegancia: nada de negritas fuertes ni fondos de color en filas de lista
    if (enMap[i] && !esUi && /className|class=/.test(o)) {
      if (/font-(bold|extrabold|black)/.test(o))
        add(i, 'negrita-en-fila', 'font-bold/extrabold dentro de una lista: usa font-medium o font-semibold (guía «Elegancia»).')
      if (/bg-(?:red|green|blue|amber|yellow|orange|emerald|rose|sky|indigo|violet|purple|teal|cyan|lime|pink|fuchsia)-(?:50|100)/.test(o))
        add(i, 'fondo-color-en-fila', 'Fondo de color en una fila de lista: el color vive en la banda lateral (BandaLateral) y la insignia sobria (guía «Elegancia»).')
    }
    if (/var\(--mov-[a-z]+-fondo\)/.test(o) && !esUi) add(i, 'fondo-color-en-fila', 'Variable de fondo --mov-*-fondo en una fila: no se tiñe el fondo; usa BandaLateral + insignia sobria (guía «Elegancia»).')
    // (e) colores fijos
    if (!esUi) {
      const fuera = o.replace(/var\([^)]*\)/g, '')
      if (/["'`(:\s]#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{5})?\b/.test(fuera) && /className|style=/.test(o) && !/&#|href=|url\(#|themeColor/.test(o))
        add(i, 'color-hex', 'Color hexadecimal suelto: usa variables/clases del tema (claro y oscuro) (guía e).')
      if (/\brgba?\(/.test(fuera) && /className|style/.test(o)) add(i, 'color-rgb', 'Color rgb() suelto: usa variables del tema (guía e).')
      for (const cm of o.matchAll(/\b(?:text|bg|border|ring|fill|stroke)-((?:red|green|blue|amber|yellow|orange|emerald|rose|sky|indigo|violet|purple|teal|cyan|lime|pink|fuchsia)-\d{2,3})\b/g)) {
        if (/className|class=/.test(o) && !TEMA.has(cm[1]) && !/\bdark:/.test(o))
          add(i, 'color-fijo', `Clase de color «${cm[0]}» que el tema oscuro (globals.css) no redefine: usa un tono mapeado o una variable (guía e).`)
      }
    }
    // (f) select nativo
    if (/<select[\s>]/.test(l) && !esUi) add(i, 'select-nativo', '<select> nativo: usa SelectorBuscable/SelectorMultiple (búsqueda + única/múltiple) (guía f).')
    // accesibilidad / táctil
    if (/<div\b/.test(l)) {
      const t = tag(orig, i)
      if (/\bonClick=/.test(t) && !/role=|onKeyDown=|tabIndex=/.test(t))
        add(i, 'div-clicable', '<div onClick> sin role/tabIndex/teclado: usa <button> o añade role="button", tabIndex y onKeyDown (guía d/h).')
    }
    if (/<button\b/.test(l)) {
      const t = tag(orig, i)
      if (/\bonClick=/.test(t) && /\b(?:h-[5-9]|h-\[(?:[1-3]\d|40|4[0-3])px\])\b/.test(t) && !/min-h-|before:|after:|-inset-|touch/.test(t))
        add(i, 'boton-chico', 'Botón con altura < 44 px sin zona táctil ampliada: añade min-h-11 o un ::before que extienda el área (guía d).')
    }
    // seleccionar como botón, alert/confirm
    if (/>\s*Seleccionar(\s+todo\w*)?\s*</.test(o) && !esUi) add(i, 'boton-seleccionar', 'Botón «Seleccionar»: la guía no usa selección por fila; tocar la fila abre el detalle (guía c).')
    if (/(^|[^\w.])(?:window\.)?(alert|confirm)\s*\(/.test(l)) add(i, 'alert-confirm', 'alert()/confirm() nativos: usa Modal y AvisoFlotante del proyecto (guía f).')
    // fechas sin zona horaria
    if (/\.toLocale(?:Date|Time)?String\s*\(/.test(l)) {
      const resto = orig.slice(i, i + 4).join(' ')
      const p = resto.search(/toLocale/)
      const trozo = resto.slice(p, p + 200)
      const esFecha = /toLocale(Date|Time)String/.test(trozo) || /toLocaleString\s*\(\s*\)|toLocaleString\([^)]*(hour|day|month|year|dateStyle|timeStyle)/.test(trozo)
      if (esFecha && !/timeZone/.test(trozo)) add(i, 'fecha-sin-zona', "toLocale…String sin timeZone: forzar 'America/Tegucigalpa' (UTC-6).")
    }
    // lote sin nombre
    if (!usaRotulo && /(^\s*\{[\w.?]+\.(lote|nomenclatura|lote_codigo)\}\s*$|>\s*\{[\w.?]+\.(lote|nomenclatura|lote_codigo)\}\s*<)/.test(o))
      add(i, 'lote-sin-nombre', 'Lote mostrado solo con código: usa rotuloLote → «Nombre · código» (guía b).')
    // (a) listas sin tope (una vez por archivo)
    if (
      !enMap[i] &&
      !tieneTope &&
      !esUi &&
      /^src\/components\//.test(nombre) &&
      /\{\s*[\w.?]+\.map\s*\(\s*\(?\w+[^)]*\)?\s*=>\s*(\(|<)?\s*$/.test(o) &&
      /(registros|filas|movimientos|aplicaciones|historial|lecturas|tickets|envios|lineas|dias|resultados|eventos)\w*\??\.map/i.test(o)
    ) {
      listasSinTope++
      if (listasSinTope === 1) add(i, 'lista-sin-limite', 'Lista .map sobre datos sin slice/«Ver más»/paginación en este archivo: sin scroll infinito (guía a).')
    }
  })
  return hallazgos
}

function recorrer(dir, acc = []) {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f === '.next' || f.startsWith('.')) continue
    const p = join(dir, f)
    if (statSync(p).isDirectory()) recorrer(p, acc)
    else if (extname(p) === '.tsx' && !/\.(test|spec)\./.test(p)) acc.push(p)
  }
  return acc
}
const fmt = (h) => h.map((x) => `- ${x.archivo}:${x.linea} [${x.regla}] ${x.mensaje}`).join('\n')
const relp = (p) => relative(RAIZ, p).split(sep).join('/')

const LISTA = [
  'Tema claro Y oscuro (contraste; nada de hex suelto).',
  'A 412 px de ancho: sin desborde horizontal, áreas táctiles >= 44 px.',
  'Con datos DEMO reales (scripts/sembrar-demo-campo.sql), no con 1-2 filas inventadas.',
  'Estado vacío, de carga y de error claros; botón «Regresar».',
  'Elegancia: sin fondos de color en filas, sin puntos (banda lateral fina), sin font-bold en listas.',
  'Filas compactas agrupadas, sin scroll infinito; tocar la fila abre el detalle (Anular/Eliminar/Editar solo ahí).',
]


// ---------------------------------------------------------------- AGL (vanilla JS + CSS, C:\HENRYALVARADO2022\AGLGestion_App\frontend)
// Por qué: el usuario se quejó (2026-11-25) de que en AGL había fechas sin borde, alertas gigantes con botones estirados y
// tarjetas que no hacían nada al tocarlas, y que este revisor no avisaba (solo miraba .tsx de AgroNoti).
const AGL_FRONT = /[\\/]AGLGestion_App[\\/]frontend[\\/]/i

function revisarAgl(src, rel) {
  const h = []
  const lineas = src.split('\n')
  lineas.forEach((l, i) => {
    const okMarca = /ui-ok:/.test(l) || /ui-ok:/.test(lineas[i - 1] ?? '')
    if (okMarca || /^\s*(\/\/|\*|\/\*)/.test(l)) return
    const add = (regla, txt) => h.push({ archivo: rel, linea: i + 1, regla, mensaje: txt })
    if (/type:\s*"date"/.test(l) && !/className/.test(l))
      add('fecha-sin-estilo', 'Campo de fecha sin clase: queda sin borde. Use className "fr-fecha" (o el de su módulo) dentro de una barra con etiqueta arriba.')
    if (/el\("(input|select|textarea)"/.test(l) && !/className/.test(l) && !/type:\s*"(checkbox|radio|hidden|file)"/.test(l))
      add('campo-nativo', 'Campo sin clase de estilo: se ve nativo (de los 90). Use INPUT de ui/clases.js o la clase del módulo.')
    if (/el\("label",\s*\{\s*\},\s*"[^"]*\s",\s*\w+\)/.test(l))
      add('etiqueta-en-linea', 'Etiqueta y campo pegados en línea («Desde [ ]»): use label.fr-campo (texto arriba, campo abajo).')
    if (/#[0-9a-fA-F]{3,8}\b/.test(l) && /["'`]/.test(l) && !/href|url\(|data-|aria-/.test(l))
      add('color-fijo', 'Color fijo en JS: no cambia con el tema oscuro. Use una clase CSS con variables (--c-*).')
    if (/\bstyle:\s*["{]|\.style\.\w+\s*=/.test(l) && !/display|width|height|transform|--/.test(l))
      add('estilo-en-linea', 'Estilo en línea: muévalo a una clase CSS del módulo.')
    if (/\.map\(/.test(l) && /el\("li"/.test(l) && /BTN\.(primario|secundario|alerta|contorno)\b(?!\}?\$\{BTN_CHICO)/.test(l))
      add('boton-grande-por-fila', 'Botón grande en cada fila de una lista: use BTN_CHICO y agrupe las acciones a la derecha de una fila compacta.')
  })
  if (/el\("li"[^)]*fr-[a-z-]*alerta/.test(src) && !/BTN_CHICO/.test(src))
    h.push({ archivo: rel, linea: 1, regla: 'alertas-gigantes', mensaje: 'Lista de alertas con botones normales: use la lista compacta (views/motoresAlertas.js: listaAlertas).' })
  return h
}

const LISTA_AGL = [
  'Abrí la pantalla de AGL en Chrome (copia aislada o 5001, nunca escribir en 5000) con datos reales o DEMO',
  'Fechas y selectores con borde, mismo alto, etiqueta arriba',
  'Listas compactas: una línea por fila, acciones chicas a la derecha, nada estirado a lo ancho',
  'Todo lo que tiene color (tarjeta, semáforo) explica qué significa y al tocarlo muestra el detalle',
  'Alertas: se pueden descartar con motivo; repetidas por día se agrupan',
  'Tema oscuro y ventana angosta sin desbordes',
]

async function main() {
  const args = process.argv.slice(2)
  if (args[0] === '--todo') {
    const base = join(RAIZ, 'src')
    const h = (existsSync(base) ? recorrer(base) : []).flatMap((p) => revisar(readFileSync(p, 'utf8'), relp(p)))
    if (args.includes('--agrupado')) {
      const g = {}
      for (const x of h) (g[x.archivo] ??= []).push(x)
      for (const [a, l] of Object.entries(g).sort((x, y) => y[1].length - x[1].length)) {
        const reglas = {}
        l.forEach((x) => (reglas[x.regla] = (reglas[x.regla] || 0) + 1))
        console.log(`${a}: ${l.length} (${Object.entries(reglas).map(([r, n]) => `${r}x${n}`).join(', ')})`)
      }
      const porRegla = {}
      h.forEach((x) => (porRegla[x.regla] = (porRegla[x.regla] || 0) + 1))
      console.log('POR REGLA', JSON.stringify(porRegla))
      console.log(`TOTAL ${h.length} en ${Object.keys(g).length} archivos`)
    } else console.log(h.length ? fmt(h) + `\nTOTAL ${h.length}` : 'Sin hallazgos.')
    process.exit(0)
  }
  if (args[0] === '--archivo' && args[1]) {
    const p = resolve(args[1])
    const h = AGL_FRONT.test(p) ? revisarAgl(readFileSync(p, 'utf8'), p) : revisar(readFileSync(p, 'utf8'), relp(p))
    console.log(h.length ? fmt(h) : 'Sin hallazgos.')
    process.exit(0)
  }
  if (args[0] === '--recordatorio') {
    let cambios = ''
    try {
      cambios = execSync('git status --porcelain -- src', { cwd: RAIZ, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    } catch {
      process.exit(0)
    }
    const tsx = cambios.split('\n').filter((l) => /\.tsx\s*$/.test(l))
    if (!tsx.length) process.exit(0)
    process.stdout.write(
      JSON.stringify({
        systemMessage:
          `RECORDATORIO UI/UX: hay ${tsx.length} archivo(s) .tsx sin confirmar. Antes de decir «listo» (docs/guia-ui-ux.md §k):\n` +
          LISTA.map((x) => '  [ ] ' + x).join('\n'),
      }),
    )
    process.exit(0)
  }
  let entrada = ''
  for await (const parte of process.stdin) entrada += parte
  let datos
  try {
    datos = JSON.parse(entrada)
  } catch {
    process.exit(0)
  }
  const archivo = datos?.tool_input?.file_path || datos?.tool_response?.filePath
  if (!archivo) process.exit(0)
  const ruta = resolve(archivo)
  const rel = relp(ruta)
  if (AGL_FRONT.test(ruta) && extname(ruta) === '.js' && existsSync(ruta)) {
    const h = revisarAgl(readFileSync(ruta, 'utf8'), ruta.replace(/.*AGLGestion_App[\\/]/i, 'AGL/'))
    if (!h.length) process.exit(0)
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext:
      `REVISOR DE UI/UX · AGL (el usuario se quejó de pantallas «de los 90»). Posibles violaciones:
${fmt(h)}
` +
      'Corrígelas o marca la línea con «// ui-ok: motivo». Verifica en Chrome (copia aislada de AGL).' } }))
    process.exit(0)
  }
  if (rel.startsWith('..') || !rel.startsWith('src/') || extname(ruta) !== '.tsx' || /\.(test|spec)\./.test(ruta) || !existsSync(ruta)) process.exit(0)
  const h = revisar(readFileSync(ruta, 'utf8'), rel)
  if (!h.length) process.exit(0)
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext:
          `REVISOR DE UI/UX (docs/guia-ui-ux.md; el usuario ya pidió esto muchas veces). Posibles violaciones en ${rel}:\n${fmt(h)}\n` +
          'Corrígelas o, si es una excepción verificada, marca la línea con «// ui-ok: motivo». Recuerda comprobar en el navegador (claro/oscuro/412 px/datos DEMO/vacío).',
      },
    }),
  )
  process.exit(0)
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
