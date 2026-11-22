#!/usr/bin/env node
/**
 * Revisor de bucles infinitos y reconsultas sin freno (React + Supabase).
 *
 * Por qué existe: el 2026-11-21/22 la pantalla de Tickets entró en un bucle de reconsultas (55 000 llamadas a
 * `fn_tickets_pagina` en un día, 41 831 en una sola hora) y consumió el límite de logs de Supabase. La causa era un
 * efecto que dependía de una función que cambiaba en cada dibujo (`recargar`) y que, al consultar, volvía a
 * dibujar la pantalla. Este revisor busca ese tipo de patrones al editar código y avisa a Claude.
 *
 * Uso:
 *   - Como hook PostToolUse (Edit|Write): lee el JSON de stdin, revisa el archivo editado y, si hay hallazgos,
 *     devuelve `additionalContext` para que Claude los corrija o los justifique.
 *   - A mano: `node scripts/revisar-bucles.mjs --todo` (revisa src/) o `... --archivo ruta`.
 *
 * Silenciar un hallazgo verificado: comentario `// bucle-ok: motivo` en la misma línea o la anterior.
 * Es un análisis por patrones (heurístico): puede dar falsos positivos; nunca bloquea, solo avisa.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, extname, resolve, relative, sep } from 'node:path'

const RAIZ = resolve(process.cwd())
const EXT = new Set(['.ts', '.tsx'])
const RED = /(\.rpc\(|\bfetch\(|supabase\b[^;\n]*\.from\(|\.from\(\s*['"`]|leerPagina|\bleer\w*\(|consultar\(|recargar\(|refrescar\(|recontar\(|cargar\(|\.invoke\()/
const NOMBRES_RECARGA = ['recargar', 'refrescar', 'recontar', 'recargarTodo', 'consultar', 'refetch', 'reload', 'cargar', 'leer', 'actualizar', 'sincronizar']

/** Texto → posiciones de línea, sin cadenas ni comentarios largos (para parentizar sin confundirse). */
function limpiar(src) {
  // Sustituye por espacios el contenido de cadenas y comentarios, conservando longitud y saltos de línea
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    const d = src[i + 1]
    if (c === '/' && d === '/') {
      let j = i
      while (j < n && src[j] !== '\n') j++
      out += src.slice(i, j).replace(/[^\n]/g, ' ')
      i = j
    } else if (c === '/' && d === '*') {
      let j = src.indexOf('*/', i + 2)
      j = j === -1 ? n : j + 2
      out += src.slice(i, j).replace(/[^\n]/g, ' ')
      i = j
    } else if (c === '"' || c === "'" || c === '`') {
      let j = i + 1
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') j++
        j++
      }
      j = Math.min(j + 1, n)
      // Se conserva el delimitador, el contenido pasa a espacios (las plantillas pueden traer ${...}: se ignoran)
      out += c + src.slice(i + 1, j - 1).replace(/[^\n]/g, ' ') + (j - 1 < n ? c : '')
      i = j
    } else {
      out += c
      i++
    }
  }
  return out
}

function cerrar(txt, abre) {
  // abre = índice del '(' ; devuelve el índice del ')' que lo cierra
  let prof = 0
  for (let i = abre; i < txt.length; i++) {
    const c = txt[i]
    if (c === '(' || c === '[' || c === '{') prof++
    else if (c === ')' || c === ']' || c === '}') {
      prof--
      if (prof === 0) return i
    }
  }
  return -1
}

function lineaDe(src, pos) {
  let l = 1
  for (let i = 0; i < pos && i < src.length; i++) if (src[i] === '\n') l++
  return l
}

function argumentosTop(txt, abre, cierra) {
  // Separa los argumentos de primer nivel de la llamada txt[abre..cierra]
  const args = []
  let prof = 0
  let ini = abre + 1
  for (let i = abre; i <= cierra; i++) {
    const c = txt[i]
    if (c === '(' || c === '[' || c === '{') prof++
    else if (c === ')' || c === ']' || c === '}') {
      prof--
      if (prof === 0) {
        if (txt.slice(ini, i).trim()) args.push([ini, i])
        break
      }
    } else if (c === ',' && prof === 1) {
      args.push([ini, i])
      ini = i + 1
    }
  }
  return args
}

/**
 * ¿La función `id` está definida en este archivo con useCallback y es estable?
 * Estable = sus dependencias no incluyen un estado que el propio callback cambia (si no, se recrea al consultar).
 * Si no está definida aquí (viene de un hook externo), se asume NO estable y se avisa.
 */
function esEstable(txt, id) {
  const m = new RegExp('\\b' + id + '\\s*=\\s*useCallback\\s*\\(').exec(txt)
  if (!m) return false
  const abre = txt.indexOf('(', m.index + id.length)
  const cierra = cerrar(txt, abre)
  if (cierra < 0) return false
  const args = argumentosTop(txt, abre, cierra)
  const cuerpo = args[0] ? txt.slice(args[0][0], args[0][1]) : ''
  const deps = args[1] ? txt.slice(args[1][0], args[1][1]) : ''
  const lista = deps.replace(/[[\]]/g, '').split(',').map((s) => s.trim()).filter(Boolean)
  for (const d of lista) {
    const s = 'set' + d[0].toUpperCase() + d.slice(1)
    if (new RegExp('\\b' + s + '\\s*\\(').test(cuerpo)) return false
  }
  return true
}

export function revisar(fuente, nombre = 'archivo') {
  const hallazgos = []
  const crudo = fuente
  const txt = limpiar(fuente)
  const lineasCrudas = crudo.split('\n')
  const silenciado = (linea) =>
    /bucle-ok/.test(lineasCrudas[linea - 1] ?? '') || /bucle-ok/.test(lineasCrudas[linea - 2] ?? '')
  const agregar = (linea, regla, mensaje) => {
    if (silenciado(linea)) return
    hallazgos.push({ linea, regla, mensaje })
  }

  // 1) useEffect / useLayoutEffect
  const reEfecto = /\buse(?:Layout)?Effect\s*\(/g
  let m
  while ((m = reEfecto.exec(txt))) {
    const abre = txt.indexOf('(', m.index)
    const cierra = cerrar(txt, abre)
    if (cierra < 0) continue
    const linea = lineaDe(txt, m.index)
    const args = argumentosTop(txt, abre, cierra)
    const cuerpo = args[0] ? txt.slice(args[0][0], args[0][1]) : ''
    const deps = args[1] ? txt.slice(args[1][0], args[1][1]).trim() : null
    const hace = RED.test(cuerpo)

    if (deps === null && hace) {
      agregar(linea, 'efecto-sin-deps', 'useEffect con llamadas a la red y SIN arreglo de dependencias: se ejecuta en cada dibujo (bucle seguro si además cambia estado).')
    }
    if (deps && deps.startsWith('[')) {
      const lista = deps.slice(1, deps.lastIndexOf(']')).split(',').map((s) => s.trim()).filter(Boolean)
      for (const d of lista) {
        const id = d.replace(/[?!].*$/, '').split('.').pop()
        // Función de recarga en las dependencias Y llamada dentro del mismo efecto
        if (NOMBRES_RECARGA.includes(id) && new RegExp(`\\b${id}\\s*\\(`).test(cuerpo) && !esEstable(txt, id)) {
          agregar(linea, 'efecto-depende-de-recarga', `El efecto depende de «${d}» y también la llama: si «${d}» no es estable (useCallback con dependencias estables o ref), cada consulta vuelve a dibujar, cambia «${d}» y se dispara otra consulta (bucle). Usa un ref o asegúrate de que sea estable.`)
        }
        // Callbacks recibidos por props (onXxx) en las dependencias de un efecto que consulta
        if (/^on[A-Z]/.test(id) && hace) {
          agregar(linea, 'efecto-depende-de-callback', `El efecto que consulta depende del callback «${d}» recibido por props: el padre suele recrearlo en cada dibujo y se repite la consulta. Guárdalo en un ref.`)
        }
        // Objetos/arreglos creados en el render en dependencias de un efecto que consulta
        if (hace && /^(filtros?|opciones|params?|config)$/.test(id)) {
          agregar(linea, 'efecto-depende-de-objeto', `El efecto que consulta depende del objeto «${d}»: si se recrea en cada dibujo, hay reconsulta infinita. Usa una huella (JSON.stringify) o valores primitivos.`)
        }
      }
    }
    // Estado cambiado en el efecto y a la vez dependencia, con red de por medio
    if (deps && hace) {
      const sets = [...cuerpo.matchAll(/\bset([A-Z]\w*)\s*\(/g)].map((x) => x[1])
      for (const s of sets) {
        const estado = s[0].toLowerCase() + s.slice(1)
        if (new RegExp(`[\\[,\\s]${estado}[\\],\\s]`).test(deps)) {
          agregar(linea, 'efecto-cambia-su-dependencia', `El efecto consulta y cambia «${estado}» (set${s}) que también es dependencia: se vuelve a disparar solo.`)
        }
      }
    }
  }

  // 2) Temporizadores
  if (/\bsetInterval\s*\(/.test(txt) && !/\bclearInterval\s*\(/.test(txt)) {
    const pos = txt.search(/\bsetInterval\s*\(/)
    agregar(lineaDe(txt, pos), 'intervalo-sin-limpiar', 'setInterval sin clearInterval en el archivo: el intervalo se acumula en cada montaje.')
  }
  const reTemporizador = /\bsetTimeout\s*\(/g
  while ((m = reTemporizador.exec(txt))) {
    const abre = txt.indexOf('(', m.index)
    const cierra = cerrar(txt, abre)
    if (cierra < 0) continue
    const args = argumentosTop(txt, abre, cierra)
    const cuerpo = args[0] ? txt.slice(args[0][0], args[0][1]) : ''
    const espera = args[1] ? txt.slice(args[1][0], args[1][1]).trim() : ''
    // Temporizador que se reprograma a sí mismo con espera 0 o muy corta consultando la red
    if (/^(0|[1-9]\d?|[1-4]\d\d)$/.test(espera) && RED.test(cuerpo) && /\b(set\w+|reprogramar|agendar)\s*\(|setTimeout\s*\(/.test(cuerpo.replace(/^\s*\(\s*\)\s*=>/, ''))) {
      agregar(lineaDe(txt, m.index), 'reintento-rapido', `setTimeout de ${espera} ms que consulta la red: si falla o se repite, es una ráfaga. Usa espera ≥ 1500 ms con backoff y tope de intentos.`)
    }
  }

  // 3) Bucles sin fin
  for (const re of [/\bwhile\s*\(\s*(true|1)\s*\)/g, /\bfor\s*\(\s*;\s*;\s*\)/g]) {
    while ((m = re.exec(txt))) {
      const abre = txt.indexOf('{', m.index)
      const cierra = abre >= 0 ? cerrar(txt, abre) : -1
      const cuerpo = cierra > 0 ? txt.slice(abre, cierra) : ''
      if (RED.test(cuerpo) || /\bawait\b/.test(cuerpo)) {
        agregar(lineaDe(txt, m.index), 'bucle-infinito', 'Bucle sin fin con await/red: asegura una salida (break con tope de vueltas) y una espera entre vueltas.')
      }
    }
  }
  // Paginación sin tope: `for (...)`/`while` que repite lecturas por páginas
  const rePaginas = /\bwhile\s*\(\s*(?!true|1\b)[^)]*\)\s*\{/g
  while ((m = rePaginas.exec(txt))) {
    const abre = txt.indexOf('{', m.index)
    const cierra = cerrar(txt, abre)
    const cuerpo = cierra > 0 ? txt.slice(abre, cierra) : ''
    if (/\bawait\b/.test(cuerpo) && RED.test(cuerpo) && !/\b(vuelta|intentos?|pagina|iter|max|tope|limite)\w*\s*(<|>|>=|<=|\+\+)/i.test(m[0] + cuerpo)) {
      agregar(lineaDe(txt, m.index), 'paginacion-sin-tope', 'while que lee la red por páginas sin contador/tope visible: si el cursor no avanza, no termina. Pon un tope de vueltas y corta si el cursor no cambia.')
    }
  }

  // 4) router.refresh() en callbacks/efectos que pueden repetirse
  const reRefresh = /\brouter\.refresh\s*\(\s*\)/g
  while ((m = reRefresh.exec(txt))) {
    const antes = txt.slice(Math.max(0, m.index - 600), m.index)
    if (/(useEffect|postgres_changes|\.on\(|setInterval|visibilitychange|focus)/.test(antes)) {
      agregar(lineaDe(txt, m.index), 'refresh-en-evento', 'router.refresh() dentro de un efecto, aviso de Realtime o evento de foco: vuelve a pedir el layout del servidor, que sube estado y puede repetirse en cadena. Acota con un freno (intervalo mínimo).')
    }
  }

  // 5) Realtime sin limpiar
  if (/\.subscribe\s*\(/.test(txt) && /\.channel\s*\(/.test(txt) && !/removeChannel|unsubscribe\s*\(/.test(txt)) {
    const pos = txt.search(/\.subscribe\s*\(/)
    agregar(lineaDe(txt, pos), 'realtime-sin-limpiar', 'Canal de Realtime suscrito sin removeChannel/unsubscribe: cada montaje deja otro canal vivo.')
  }

  // 6) Reintentos inmediatos tras error
  if (/catch\s*\([^)]*\)\s*\{[^}]*\b(consultar|recargar|refrescar|cargar|leer\w*)\s*\(/.test(txt)) {
    const pos = txt.search(/catch\s*\([^)]*\)\s*\{[^}]*\b(consultar|recargar|refrescar|cargar|leer\w*)\s*\(/)
    agregar(lineaDe(txt, pos), 'reintento-en-catch', 'Un catch que vuelve a consultar al instante: si el error es permanente se forma un bucle. Usa backoff con tope y límite de intentos.')
  }

  return hallazgos.map((h) => ({ ...h, archivo: nombre }))
}

function recorrer(dir, acc = []) {
  for (const f of readdirSync(dir)) {
    if (f === 'node_modules' || f === '.next' || f.startsWith('.')) continue
    const p = join(dir, f)
    const s = statSync(p)
    if (s.isDirectory()) recorrer(p, acc)
    else if (EXT.has(extname(p)) && !/\.(test|spec)\./.test(p)) acc.push(p)
  }
  return acc
}

function formatear(h) {
  return h.map((x) => `- ${x.archivo}:${x.linea} [${x.regla}] ${x.mensaje}`).join('\n')
}

async function main() {
  const args = process.argv.slice(2)
  if (args[0] === '--todo') {
    const base = join(RAIZ, 'src')
    const todos = existsSync(base) ? recorrer(base) : []
    const hallazgos = todos.flatMap((p) => revisar(readFileSync(p, 'utf8'), relative(RAIZ, p).split(sep).join('/')))
    console.log(hallazgos.length ? formatear(hallazgos) : 'Sin hallazgos.')
    process.exit(hallazgos.length ? 1 : 0)
  }
  if (args[0] === '--archivo' && args[1]) {
    const p = resolve(args[1])
    const hallazgos = revisar(readFileSync(p, 'utf8'), relative(RAIZ, p).split(sep).join('/'))
    console.log(hallazgos.length ? formatear(hallazgos) : 'Sin hallazgos.')
    process.exit(hallazgos.length ? 1 : 0)
  }

  // Modo hook: JSON de la herramienta por stdin
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
  const rel = relative(RAIZ, ruta).split(sep).join('/')
  if (rel.startsWith('..') || !rel.startsWith('src/') || !EXT.has(extname(ruta)) || /\.(test|spec)\./.test(ruta)) process.exit(0)
  if (!existsSync(ruta)) process.exit(0)
  const hallazgos = revisar(readFileSync(ruta, 'utf8'), rel)
  if (hallazgos.length === 0) process.exit(0)
  const salida = {
    hookSpecificOutput: {
      hookEventName: 'PostToolUse',
      additionalContext:
        'REVISOR DE BUCLES (regla del proyecto: ningún efecto, temporizador o aviso puede reconsultar sin freno). ' +
        `Posibles bucles/reconsultas sin freno en ${rel}:\n${formatear(hallazgos)}\n` +
        'Corrígelos (ref, useCallback estable, huella, intervalo mínimo/backoff, tope de vueltas) o, si ya verificaste que es seguro, ' +
        'marca la línea con «// bucle-ok: motivo». Ver proyecto-seguimiento.md §2 «Bucles infinitos». Contexto del incidente: scripts/revisar-bucles.mjs.',
    },
  }
  process.stdout.write(JSON.stringify(salida))
  process.exit(0)
}

import { fileURLToPath } from 'node:url'
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main()
}
