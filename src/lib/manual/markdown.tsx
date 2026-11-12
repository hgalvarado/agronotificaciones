/**
 * Markdown mínimo para mostrar los manuales de usuario dentro de la app (docs/manuales/*.md), sin librerías.
 * Soporta lo que usan los manuales: títulos (#, ##, ###), párrafos, listas (- y 1.), tablas, citas (>), bloques de
 * código (```), separadores (---), **negrita**, `código` y enlaces [texto](url) (se muestra el texto).
 *
 * Puro: recibe texto y devuelve elementos de React. Nada se interpreta como HTML (sin riesgo de inyección).
 */

import type { ReactNode } from 'react'

export type Seccion = { id: string; titulo: string }

export function idDeTitulo(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** **negrita**, `código` y [texto](url) dentro de una línea. */
export function enLinea(texto: string, clave = 'l'): ReactNode[] {
  const partes: ReactNode[] = []
  const patron = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\([^)]+\)/g
  let ultimo = 0
  let m: RegExpExecArray | null
  let n = 0
  while ((m = patron.exec(texto))) {
    if (m.index > ultimo) partes.push(texto.slice(ultimo, m.index))
    if (m[1] !== undefined) partes.push(<strong key={`${clave}-${n++}`} className="font-semibold text-slate-900">{m[1]}</strong>)
    else if (m[2] !== undefined) partes.push(<code key={`${clave}-${n++}`} className="rounded bg-slate-100 px-1 text-[0.85em]">{m[2]}</code>)
    else partes.push(m[3])
    ultimo = m.index + m[0].length
  }
  if (ultimo < texto.length) partes.push(texto.slice(ultimo))
  return partes
}

const celdas = (fila: string) =>
  fila
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((c) => c.trim())

/** Las secciones (##) para el índice. */
export function secciones(md: string): Seccion[] {
  return md
    .split(/\r?\n/)
    .filter((l) => /^## /.test(l))
    .map((l) => {
      const titulo = l.slice(3).trim()
      return { id: idDeTitulo(titulo), titulo }
    })
}

export function renderizar(md: string): ReactNode[] {
  const lineas = md.split(/\r?\n/)
  const salida: ReactNode[] = []
  let i = 0
  let k = 0
  const clave = () => `b${k++}`

  while (i < lineas.length) {
    const l = lineas[i]
    if (!l.trim()) {
      i++
      continue
    }
    // Bloque de código
    if (l.startsWith('```')) {
      const cuerpo: string[] = []
      i++
      while (i < lineas.length && !lineas[i].startsWith('```')) cuerpo.push(lineas[i++])
      i++
      salida.push(
        <pre key={clave()} className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs leading-relaxed text-slate-100">
          {cuerpo.join('\n')}
        </pre>
      )
      continue
    }
    // Títulos
    const t = /^(#{1,3}) (.*)$/.exec(l)
    if (t) {
      const nivel = t[1].length
      const texto = t[2].trim()
      const cls =
        nivel === 1
          ? 'text-xl font-bold text-slate-900'
          : nivel === 2
            ? 'mt-4 scroll-mt-4 border-t border-slate-200 pt-4 text-lg font-bold text-slate-900'
            : 'mt-2 text-base font-bold text-slate-800'
      const Tag = (`h${nivel + 1}`) as 'h2' | 'h3' | 'h4'
      salida.push(
        <Tag key={clave()} id={nivel === 2 ? idDeTitulo(texto) : undefined} className={cls}>
          {enLinea(texto, `t${k}`)}
        </Tag>
      )
      i++
      continue
    }
    // Separador
    if (/^-{3,}\s*$/.test(l)) {
      i++
      continue
    }
    // Tabla
    if (l.trim().startsWith('|')) {
      const filas: string[] = []
      while (i < lineas.length && lineas[i].trim().startsWith('|')) filas.push(lineas[i++])
      const cabeza = celdas(filas[0])
      const cuerpo = filas.slice(1).filter((f) => !/^\s*\|?\s*:?-{2,}/.test(f)).map(celdas)
      salida.push(
        <div key={clave()} className="overflow-x-auto rounded-lg ring-1 ring-inset ring-slate-200">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-slate-600">
              <tr>{cabeza.map((c, j) => <th key={j} className="px-2.5 py-1.5 font-semibold">{enLinea(c, `h${k}${j}`)}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cuerpo.map((f, r) => (
                <tr key={r}>{f.map((c, j) => <td key={j} className="px-2.5 py-1.5 align-top text-slate-700">{enLinea(c, `c${k}${r}${j}`)}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
      )
      continue
    }
    // Cita
    if (l.startsWith('>')) {
      const cuerpo: string[] = []
      while (i < lineas.length && lineas[i].startsWith('>')) cuerpo.push(lineas[i++].replace(/^>\s?/, ''))
      salida.push(
        <div key={clave()} className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
          {enLinea(cuerpo.join(' '), `q${k}`)}
        </div>
      )
      continue
    }
    // Listas (con continuación indentada)
    const esViñeta = (x: string) => /^\s*[-*] /.test(x)
    const esNumero = (x: string) => /^\s*\d+\. /.test(x)
    if (esViñeta(l) || esNumero(l)) {
      const numerada = esNumero(l)
      const sangria = (x: string) => x.length - x.trimStart().length
      const base = sangria(l)
      const limpio = (x: string) => x.replace(/^\s*(?:[-*]|\d+\.) /, '').replace(/^\[[ x]\] /, '☐ ')
      // Un nivel de anidación: las viñetas con más sangría que la lista son hijas del punto anterior
      const items: { texto: string; hijos: string[]; despues: string }[] = []
      let sangriaHijo = 0
      while (i < lineas.length && lineas[i].trim() && (esViñeta(lineas[i]) || esNumero(lineas[i]) || /^\s{2,}\S/.test(lineas[i]))) {
        const x = lineas[i++]
        const ultimo = items[items.length - 1]
        if ((esViñeta(x) || esNumero(x)) && (sangria(x) <= base || !ultimo)) items.push({ texto: limpio(x), hijos: [], despues: '' })
        else if (esViñeta(x) || esNumero(x)) {
          ultimo.hijos.push(limpio(x))
          sangriaHijo = sangria(x)
        }
        // La continuación de una hija lleva más sangría que su viñeta; con la misma, vuelve al punto padre
        else if (ultimo.hijos.length && sangria(x) > sangriaHijo) ultimo.hijos[ultimo.hijos.length - 1] += ' ' + x.trim()
        else if (ultimo.hijos.length) ultimo.despues = `${ultimo.despues} ${x.trim()}`.trim()
        else ultimo.texto += ' ' + x.trim()
      }
      const Lista = numerada ? 'ol' : 'ul'
      salida.push(
        <Lista key={clave()} className={`flex flex-col gap-1 pl-5 text-sm text-slate-700 ${numerada ? 'list-decimal' : 'list-disc'}`}>
          {items.map((it, j) => (
            <li key={j}>
              {enLinea(it.texto, `i${k}${j}`)}
              {it.hijos.length > 0 && (
                <ul className="mt-1 flex list-[circle] flex-col gap-0.5 pl-5">
                  {it.hijos.map((h, n) => <li key={n}>{enLinea(h, `s${k}${j}${n}`)}</li>)}
                </ul>
              )}
              {it.despues && <span className="mt-1 block">{enLinea(it.despues, `d${k}${j}`)}</span>}
            </li>
          ))}
        </Lista>
      )
      continue
    }
    // Párrafo
    const cuerpo: string[] = []
    while (i < lineas.length && lineas[i].trim() && !/^(#{1,3} |```|\||>|\s*[-*] |\s*\d+\. |-{3,})/.test(lineas[i])) cuerpo.push(lineas[i++].trim())
    if (!cuerpo.length) {
      i++
      continue
    }
    salida.push(
      <p key={clave()} className="text-sm leading-relaxed text-slate-700">
        {enLinea(cuerpo.join(' '), `p${k}`)}
      </p>
    )
  }
  return salida
}
