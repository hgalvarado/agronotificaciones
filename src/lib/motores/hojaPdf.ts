/**
 * Documento de impresión del historial de un motor (A4 horizontal), con el encabezado y las columnas de la hoja FTR_F-MA-103,
 * los totales y quién lo generó. Devuelve HTML completo y autocontenido: se imprime desde un iframe con «Guardar como PDF»
 * (en el teléfono, «Compartir»). Puro: sin React ni red.
 */

import { ddmmaa, numHoja, totalesHoja, type FilaHoja } from './hoja'

export type SeccionPdf = {
  motor: string
  estacion: string | null
  zona: string | null
  tanque: string | null
  filas: FilaHoja[]
}

const ENTIDADES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
const esc = (s: string | null | undefined) => String(s ?? '').replace(/[&<>"']/g, (c) => ENTIDADES[c])

export function htmlHoja(args: { secciones: SeccionPdf[]; desde?: string; hasta?: string; generadoPor: string; generadoEn: string }): string {
  const periodo = args.desde || args.hasta ? `${args.desde ? ddmmaa(args.desde) : 'inicio'} al ${args.hasta ? ddmmaa(args.hasta) : 'hoy'}` : 'todo el historial disponible'
  const bloques = args.secciones
    .map((s) => {
      const t = totalesHoja(s.filas)
      const filas = s.filas
        .map(
          (f) =>
            f.soloSuministro
              ? `<tr><td>${ddmmaa(f.fecha)}</td><td colspan="9"></td><td class="n">${numHoja(f.suministro)}</td><td>${esc(f.operador)}</td><td colspan="2"></td></tr>`
              : `<tr><td>${ddmmaa(f.fecha)}</td><td class="n">${numHoja(f.horoIni)}</td><td class="n">${numHoja(f.horoFin)}</td><td class="n">${numHoja(f.horas)}</td><td class="n">${f.horasEst ? numHoja(f.horasEst) : ''}</td>` +
            `<td class="n">${numHoja(f.visorIni)}</td><td class="n">${numHoja(f.visorFin)}</td><td class="n">${numHoja(f.gastado)}</td><td class="n">${numHoja(f.rendimiento, 2)}</td>` +
            `<td class="n">${numHoja(f.rpm, 0)}</td><td class="n">${f.suministro > 0 ? numHoja(f.suministro) : ''}</td><td>${esc(f.operador)}</td>` +
            `<td class="n">${f.caudalIni === null ? '' : numHoja(f.caudalIni)}</td><td class="n">${f.caudalFin === null ? '' : numHoja(f.caudalFin)}</td></tr>`
        )
        .join('')
      return `<section>
<p class="cab"><b>Bomba:</b> ${esc(s.motor)} &nbsp; <b>Estación:</b> ${esc(s.estacion) || '—'} &nbsp; <b>Zona:</b> ${esc(s.zona) || '—'} &nbsp; <b>Tanque:</b> ${esc(s.tanque) || '—'} &nbsp; <b>Periodo:</b> ${esc(periodo)}</p>
<table><thead>
<tr><th rowspan="2">Fecha</th><th colspan="4">Control de horas motor</th><th colspan="3">Lectura de visor tanque comb.</th><th rowspan="2">Rend. gal/h</th><th rowspan="2">Rev. motor</th><th rowspan="2">Suministro comb.</th><th rowspan="2">Firma operador</th><th colspan="2">Lectura de caudal</th></tr>
<tr><th>Horóm. inicial</th><th>Horóm. final</th><th>Horas</th><th>Horas est.</th><th>Gal. iniciales</th><th>Gal. finales</th><th>Gal. gastados</th><th>Inicial</th><th>Final</th></tr>
</thead><tbody>${filas || '<tr><td colspan="14">Sin registros en el periodo.</td></tr>'}</tbody>
<tfoot><tr><td>Totales</td><td colspan="2">${t.dias} día(s)</td><td class="n">${numHoja(t.horas)}</td><td class="n">${t.horasEst ? numHoja(t.horasEst) : ''}</td><td colspan="2"></td><td class="n">${numHoja(t.gastado)}</td><td class="n">${numHoja(t.rendimiento, 2)}</td><td></td><td class="n">${numHoja(t.suministro)}</td><td colspan="3">Horas proyectadas = horómetro + estimadas: ${numHoja(t.horasProy)} h · Rend. medio = gal ÷ horas</td></tr></tfoot></table>
</section>`
    })
    .join('')
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Control de consumo de horas y combustible</title><style>
@page{size:A4 landscape;margin:6mm}
*{box-sizing:border-box}
body{font:9px/1.15 Arial,Helvetica,sans-serif;color:#000;margin:0}
h1{font-size:11px;margin:0}h2{font-size:9px;font-weight:normal;margin:1px 0 3px}
.cab{margin:3px 0 3px}
section{page-break-after:always}section:last-of-type{page-break-after:auto}
table{width:100%;border-collapse:collapse;table-layout:fixed}
th,td{border:1px solid #000;padding:1px 3px;text-align:left;white-space:nowrap;overflow:hidden}
th{background:#eee;text-align:center;font-size:8.5px}
td.n{text-align:right}td.c{text-align:center;font-weight:bold}
tfoot td{font-weight:bold;background:#f4f4f4}
thead{display:table-header-group}tr{page-break-inside:avoid}
.pie{margin-top:4px;font-size:8px}
</style></head><body>
<h1>Agropecuaria Montelibano S.A. de C.V.</h1>
<h2>FTR_F-MA-103 · Control de consumo de horas y combustible de bombas de riego</h2>
${bloques}
<p class="pie">Generado por ${esc(args.generadoPor)} · ${esc(args.generadoEn)} (hora de Honduras, UTC-6)</p>
</body></html>`
}
