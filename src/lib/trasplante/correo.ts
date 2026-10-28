/**
 * El reporte de trasplante como cuerpo de correo para Outlook.
 *
 * Outlook (Word como motor de HTML) ignora CSS moderno: ni flex, ni grid,
 * ni variables, ni clases. Lo que sobrevive al pegar es una tabla con
 * estilos en línea, `bgcolor` y fuentes del sistema. Por eso esto NO
 * reutiliza el JSX del reporte: arma su propia tabla, con la paleta
 * corporativa en hex exacto. Puro: sin DOM, se prueba en Node.
 */

import { totalGeneral } from './servicio'
import { COLOR_SEMAFORO, CORP, ETIQUETA_CICLO, fechaCorta, fechaLarga, n0, n2, pct, semaforo } from './formato'
import type { FilaAvanceDiario, FilaEstadistica } from './tipos'

/** Por encima de esto Outlook se vuelve lento al pegar; se avisa y se corta. */
export const MAX_FILAS_CORREO = 400

const FUENTE = "font-family:Montserrat,'Segoe UI',Arial,sans-serif"
const TITULAR = "font-family:Merriweather,Georgia,'Times New Roman',serif"

const esc = (s: unknown) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const conSigno = (v: number) => `${v > 0.004 ? '+' : ''}${n2(v)}`

function dif(v: number): string {
  if (Math.abs(v) <= 0.004) return `<span style="color:#94A3B8">0,00</span>`
  const color = v < 0 ? CORP.naranja : '#4F7A1F'
  return `<span style="color:${color};font-weight:bold">${v < 0 ? '&#9660;' : '&#9650;'} ${esc(conSigno(v))}</span>`
}

const th = (t: string, derecha = false) =>
  `<th bgcolor="${CORP.verde}" style="background:${CORP.verde};color:#FFFFFF;${FUENTE};font-size:11px;text-transform:uppercase;padding:6px 8px;border:1px solid ${CORP.verde};text-align:${derecha ? 'right' : 'left'}">${t}</th>`

const td = (t: string, derecha = false, extra = '') =>
  `<td style="${FUENTE};font-size:12px;color:${CORP.marino};padding:5px 8px;border:1px solid ${CORP.borde};text-align:${derecha ? 'right' : 'left'};${extra}">${t}</td>`

function titulo(n: number, texto: string): string {
  return `<p style="${TITULAR};font-size:15px;font-weight:bold;color:${CORP.marino};margin:18px 0 6px 0;border-left:4px solid ${CORP.lima};padding-left:8px">${n} · ${esc(texto)}</p>`
}

export type DatosCorreo = {
  temporada: string
  desde: string
  hasta: string
  estadisticas: FilaEstadistica[]
  diario: FilaAvanceDiario[]
}

export function asuntoCorreo(hasta: string): string {
  return `Reporte Gerencial Trasplante - ${fechaLarga(hasta)}`
}

/** El HTML completo, listo para `text/html` en el portapapeles. */
export function htmlCorreoTrasplante(d: DatosCorreo): string {
  const total = totalGeneral(d.estadisticas)
  const color = (p: number | null) => {
    const s = semaforo(p)
    return s ? COLOR_SEMAFORO[s] : CORP.borde
  }

  // ---------------------------------------------------------- membrete
  const membrete = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">
  <tr><td bgcolor="${CORP.verde}" style="background:${CORP.verde};height:6px;font-size:0;line-height:0">&nbsp;</td></tr>
  <tr><td align="center" style="padding:12px 8px">
    <p style="${TITULAR};font-size:20px;font-weight:bold;color:${CORP.marino};margin:0">Agropecuaria Montelíbano S.A.</p>
    <p style="${FUENTE};font-size:10px;letter-spacing:3px;text-transform:uppercase;color:${CORP.marino};margin:2px 0 0 0">Grupo Agrolíbano</p>
    <p style="${TITULAR};font-size:16px;font-weight:bold;color:${CORP.verde};margin:8px 0 0 0">Reporte de avance diario de trasplante</p>
    <p style="${FUENTE};font-size:12px;color:${CORP.marino};margin:2px 0 0 0">Del ${esc(fechaLarga(d.desde))} al ${esc(fechaLarga(d.hasta))} · ${esc(d.temporada)}</p>
  </td></tr>
  <tr><td bgcolor="${CORP.marino}" style="background:${CORP.marino};height:2px;font-size:0;line-height:0">&nbsp;</td></tr>
</table>`

  // ------------------------------------------------- 1 · estadísticas
  const kpi = (etq: string, val: string, fuerte = false, barra?: number | null) => `
    <td width="25%" valign="top" style="padding:4px">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;border:1px solid ${CORP.borde}">
        <tr><td style="padding:8px 10px;background:#FFFFFF">
          <p style="${FUENTE};font-size:10px;text-transform:uppercase;color:#64748B;margin:0">${etq}</p>
          <p style="${FUENTE};font-size:18px;font-weight:bold;color:${fuerte ? CORP.verde : CORP.marino};margin:2px 0 0 0">${esc(val)}</p>
          ${
            barra === undefined
              ? ''
              : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:4px;border-collapse:collapse"><tr>
                  <td bgcolor="${color(barra)}" width="${Math.max(1, Math.min(100, Math.round(barra ?? 0)))}%" style="background:${color(barra)};height:5px;font-size:0;line-height:0">&nbsp;</td>
                  <td bgcolor="${CORP.fondo}" style="background:${CORP.fondo};height:5px;font-size:0;line-height:0">&nbsp;</td>
                 </tr></table>`
          }
        </td></tr>
      </table>
    </td>`

  const kpis = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse"><tr>
  ${kpi('Área planificada', `${n2(total.area_plan)} mz`)}
  ${kpi('Área sembrada', `${n2(total.area_real)} mz`, true)}
  ${kpi('Pendiente', `${n2(total.pendiente)} mz`)}
  ${kpi('% Avance', pct(total.pct), true, total.pct)}
</tr></table>`

  const ciclos =
    d.estadisticas.length === 0
      ? ''
      : `
<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:8px;width:100%">
  <tr>${th('Ciclo')}${th('Plan (mz)', true)}${th('Sembrado (mz)', true)}${th('Pendiente (mz)', true)}${th('% Avance', true)}${th('Lotes', true)}</tr>
  ${d.estadisticas
    .map(
      (e, i) => `<tr${i % 2 ? ' bgcolor="#FAFAFA"' : ''}>
      ${td(`<b>${esc(ETIQUETA_CICLO(e.ciclo))}</b>`)}
      ${td(esc(n2(e.area_plan)), true)}
      ${td(`<b>${esc(n2(e.area_real))}</b>`, true)}
      ${td(esc(n2(e.pendiente)), true)}
      ${td(`<span style="display:inline-block;padding:1px 6px;background:${color(e.pct)};color:${semaforo(e.pct) === 'atraso' ? '#FFFFFF' : CORP.marino};font-weight:bold">${esc(pct(e.pct))}</span>`, true)}
      ${td(esc(n0(e.lotes)), true)}
    </tr>`
    )
    .join('')}
</table>`

  // ------------------------------------------- 2 · avance diario
  const filas = [...d.diario].sort(
    (a, b) =>
      b.fecha.localeCompare(a.fecha) ||
      a.ut.localeCompare(b.ut, 'es', { numeric: true }) ||
      a.ciclo - b.ciclo ||
      a.variedad.localeCompare(b.variedad, 'es')
  )
  const cortadas = filas.length > MAX_FILAS_CORREO
  const enCorreo = filas.slice(0, MAX_FILAS_CORREO)
  const sum = (xs: FilaAvanceDiario[], k: 'mz_real' | 'mz_plan' | 'plantas') =>
    xs.reduce((a, x) => a + Number(x[k] ?? 0), 0)

  let cuerpo = ''
  let i = 0
  const porDia = new Map<string, FilaAvanceDiario[]>()
  for (const f of enCorreo) porDia.set(f.fecha, [...(porDia.get(f.fecha) ?? []), f])
  for (const [fecha, lista] of porDia) {
    for (const f of lista) {
      const marca =
        f.origen === 'plan'
          ? ` <span style="font-size:9px;font-weight:bold;color:#B0480D;background:#FDE7DA;padding:1px 4px">SIN SIEMBRA</span>`
          : f.origen === 'real'
            ? ` <span style="font-size:9px;font-weight:bold;color:#44621C;background:#EAF4DC;padding:1px 4px">FUERA DE PLAN</span>`
            : ''
      cuerpo += `<tr${i++ % 2 ? ' bgcolor="#FAFAFA"' : ''}>
        ${td(esc(fechaCorta(f.fecha)))}
        ${td(`<b>${esc(f.ut)}</b>`)}
        ${td(esc(f.zona ?? '—'))}
        ${td(esc(f.ciclo))}
        ${td(esc(f.variedad) + marca)}
        ${td(f.mz_real === null ? '—' : esc(n2(f.mz_real)), true)}
        ${td(f.mz_plan === null ? '—' : esc(n2(f.mz_plan)), true)}
        ${td(dif(Number(f.diferencia)), true)}
        ${td(f.plantas === null ? '—' : esc(n0(f.plantas)), true)}
      </tr>`
    }
    const r = sum(lista, 'mz_real')
    const p = sum(lista, 'mz_plan')
    const s = `background:${CORP.fondo};font-weight:bold`
    cuerpo += `<tr bgcolor="${CORP.fondo}">
      ${td(`Subtotal ${esc(fechaCorta(fecha))}`, false, s)}${td('', false, s)}${td('', false, s)}${td('', false, s)}${td('', false, s)}
      ${td(esc(n2(r)), true, s)}${td(esc(n2(p)), true, s)}${td(dif(r - p), true, s)}${td(esc(n0(sum(lista, 'plantas'))), true, s)}
    </tr>`
  }

  const tR = sum(filas, 'mz_real')
  const tP = sum(filas, 'mz_plan')
  const pieTotal = `background:${CORP.verde};color:#FFFFFF;font-weight:bold`
  const diario =
    filas.length === 0
      ? `<p style="${FUENTE};font-size:12px;color:#64748B">Ni siembra ni plan en el rango.</p>`
      : `
<table cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%">
  <tr>${th('Fecha')}${th('Lote')}${th('Zona')}${th('Ciclo')}${th('Variedad')}${th('Mz real', true)}${th('Mz plan', true)}${th('Dif real vs plan', true)}${th('Plantas', true)}</tr>
  ${cuerpo}
  <tr bgcolor="${CORP.verde}">
    ${td('TOTAL DEL RANGO', false, pieTotal)}${td('', false, pieTotal)}${td('', false, pieTotal)}${td('', false, pieTotal)}${td('', false, pieTotal)}
    ${td(esc(n2(tR)), true, pieTotal)}${td(esc(n2(tP)), true, pieTotal)}
    ${td(`${tR - tP < -0.004 ? '&#9660;' : tR - tP > 0.004 ? '&#9650;' : ''} ${esc(conSigno(tR - tP))}`, true, pieTotal)}
    ${td(esc(n0(sum(filas, 'plantas'))), true, pieTotal)}
  </tr>
</table>
${
  cortadas
    ? `<p style="${FUENTE};font-size:11px;color:${CORP.naranja};margin:4px 0 0 0">Se muestran ${MAX_FILAS_CORREO} de ${filas.length} filas; los totales son del rango completo. El detalle íntegro va en el PDF.</p>`
    : ''
}`

  // ---------------------------------------------------------------- pie
  const pie = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-top:16px">
  <tr>
    <td bgcolor="${CORP.lima}" style="background:${CORP.lima};height:4px;font-size:0;line-height:0">&nbsp;</td>
    <td bgcolor="${CORP.turquesa}" style="background:${CORP.turquesa};height:4px;font-size:0;line-height:0">&nbsp;</td>
    <td bgcolor="${CORP.naranja}" style="background:${CORP.naranja};height:4px;font-size:0;line-height:0">&nbsp;</td>
  </tr>
  <tr><td colspan="3" align="center" style="${FUENTE};font-size:10px;color:${CORP.marino};padding:6px">Torre Control Finca Santa Rosa · AgroNotificaciones</td></tr>
</table>`

  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;background:#FFFFFF">
<div style="${FUENTE};color:${CORP.marino};max-width:960px">
${membrete}
${titulo(1, `Estadísticas globales · al ${fechaLarga(d.hasta)}`)}
${kpis}
${ciclos}
${titulo(2, 'Avance diario · real contra plan')}
${diario}
${pie}
</div></body></html>`
}

/** Versión en texto plano para clientes que no aceptan HTML pegado. */
export function textoCorreoTrasplante(d: DatosCorreo): string {
  const t = totalGeneral(d.estadisticas)
  return [
    'Reporte de avance diario de trasplante',
    `Del ${fechaLarga(d.desde)} al ${fechaLarga(d.hasta)} · ${d.temporada}`,
    '',
    `Área planificada: ${n2(t.area_plan)} mz`,
    `Área sembrada: ${n2(t.area_real)} mz`,
    `Pendiente: ${n2(t.pendiente)} mz`,
    `% Avance: ${pct(t.pct)}`,
  ].join('\n')
}
