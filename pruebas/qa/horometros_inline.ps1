# QA: edición inline en /horometros (DataGrid): guardar, rechazo sin red (la celda revierte), edición en masa y
# eliminar, todo SIN «Consultando…». Crea su propio equipo, ticket y 2 lecturas, y los borra al final.
# Uso: powershell -ExecutionPolicy Bypass -File pruebas/qa/horometros_inline.ps1
param([string]$Base = 'http://localhost:3100')
. "$PSScriptRoot\comun.ps1"
Iniciar-QA -Base $Base -Puerto 9338
$ticket = $null; $eq = $null; $hms = @()
$BUSCA = "document.querySelector('input[placeholder^=""Buscar en toda la tabla""]')"
function Tecla([string]$k) { $m = @{ 'Enter' = @('Enter', 13); 'Escape' = @('Escape', 27) }[$k]; foreach ($t in 'rawKeyDown', 'keyUp') { CDP 'Input.dispatchKeyEvent' @{ type = $t; key = $k; code = $m[0]; windowsVirtualKeyCode = $m[1]; nativeVirtualKeyCode = $m[1] } | Out-Null } }
function ClicEn($expr) {
    $r = JS "(() => { const e = $expr; if (!e) return null; e.scrollIntoView({ block: 'center', inline: 'center' }); const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2] })()"
    if (-not $r) { return $false }
    CDP 'Input.dispatchMouseEvent' @{ type = 'mouseMoved'; x = $r[0]; y = $r[1] } | Out-Null
    foreach ($t in 'mousePressed', 'mouseReleased') { CDP 'Input.dispatchMouseEvent' @{ type = $t; x = $r[0]; y = $r[1]; button = 'left'; clickCount = 1 } | Out-Null }
    return $true
}
# Celda «Comentario» de la fila cuyo texto contiene window.__fila. OJO PowerShell: "${CEL}?." (con "$CEL?." el ? se pega al nombre)
$CEL = "(() => { const b = document.querySelector('button[title=""Ordenar por Comentario""]'); if (!b) return null; const th = b.closest('th'); const cols = [...th.parentElement.children].filter(x => !x.querySelector('[aria-label=""Seleccionar todas""],[aria-label=""Limpiar selección""]')); const i = cols.indexOf(th); const tr = [...document.querySelectorAll('tbody tr')].find(t => t.textContent.includes(window.__fila)); return tr?.querySelector('td[data-col=""' + i + '""]') })()"
$FILA = "[...document.querySelectorAll('tbody tr')].find(t => t.textContent.includes(window.__fila))"
function Editar($v) {
    JS "document.activeElement?.blur(); true" | Out-Null
    if (-not (ClicEn "${CEL}?.querySelector('[data-vista]')")) { return $false }
    Tecla 'Enter'
    if ((Esperar "!!${CEL}?.querySelector('input')" 3000) -lt 0) { return $false }
    CDP 'Input.insertText' @{ text = $v } | Out-Null
    Tecla 'Enter'
    return $true
}
function Texto { JS "${CEL}?.textContent.trim()" }
function Comentario($id) { (Rest "horometros?select=comentario&id=eq.$id" -Servicio)[0].comentario }
function Mon { JS "JSON.stringify({ veces: __mon.veces })" | ConvertFrom-Json }
try {
    $fecha = (Get-Date).AddDays(-1).ToString('yyyy-MM-dd'); $codigo = "QA-HMI-$(Get-Random -Maximum 99999)"
    $eq = (Rest 'equipos' 'Post' @{ codigo = $codigo; nombre = 'Equipo QA inline' } -Servicio)[0].id
    $ticket = (Rest 'tickets' 'Post' @{ usuario_id = $script:QA.id; fecha = $fecha; codigo = "$codigo-T"; estado = 'ABIERTO'; proceso = 'REGISTRADO' } -Servicio)[0].id
    $hms += (Rest 'horometros' 'Post' @{ ticket_id = $ticket; fecha = $fecha; turno = 'DIURNO'; equipo_id = $eq; horometro_inicial = 10; horometro_final = 18; horas_hombre = 8; usuario_id = $script:QA.id; comentario = 'QA-HMI-A original' } -Servicio)[0].id
    $hms += (Rest 'horometros' 'Post' @{ ticket_id = $ticket; fecha = $fecha; turno = 'DIURNO'; equipo_id = $eq; horometro_inicial = 18; horometro_final = 22; horas_hombre = 4; usuario_id = $script:QA.id; comentario = 'QA-HMI-B original' } -Servicio)[0].id
    Ir '/horometros'
    OK ((Esperar "!!($BUSCA) && document.querySelectorAll('tbody tr').length > 0" 30000) -ge 0) 'Horómetros abre'
    Teclear $BUSCA $codigo
    OK ((Esperar "[...document.querySelectorAll('tbody tr')].filter(t => t.textContent.includes('$codigo')).length === 2" 15000) -ge 0) 'Se ven las 2 lecturas de prueba'
    JS "window.__mon = { veces: 0, on: false }; setInterval(() => { const v = document.body.textContent.includes('Consultando…'); if (v && !__mon.on) { __mon.on = true; __mon.veces++ } else if (!v) __mon.on = false }, 40); true" | Out-Null
    Start-Sleep -Seconds 3

    # Editar con éxito
    JS "window.__fila = 'QA-HMI-A'; true" | Out-Null
    $ok = Editar 'QA-HMI-A bien'
    $t = Esperar "${CEL}?.textContent.trim() === 'QA-HMI-A bien'" 3000
    Start-Sleep -Seconds 3
    $b = Comentario $hms[0]
    OK ($ok -and $t -ge 0 -and $b -eq 'QA-HMI-A bien') 'Editar comentario: se ve al instante y queda en la base' "$t ms; base='$b'"
    OK ((Texto) -eq 'QA-HMI-A bien') 'Tras la relectura la celda sigue con lo guardado'

    # Sin red: se avisa y la celda vuelve a lo de la base
    CDP 'Network.enable' | Out-Null; CDP 'Network.setBlockedURLs' @{ urls = @('*rest/v1/horometros*') } | Out-Null
    JS "window.__fila = 'QA-HMI-A'; true" | Out-Null
    Editar 'QA-HMI-A sin red' | Out-Null
    Start-Sleep -Seconds 3
    $ahora = Texto; CDP 'Network.setBlockedURLs' @{ urls = @() } | Out-Null
    $b2 = Comentario $hms[0]
    $avisos = JS "[...document.querySelectorAll('[role=alert]')].map(x => x.textContent.trim()).join(' / ').slice(0, 200)"
    OK ($avisos -ne '') 'Sin red: se avisa el error' $avisos
    OK ($ahora -eq 'QA-HMI-A bien' -and $b2 -eq 'QA-HMI-A bien') 'Sin red: la celda vuelve a lo de la base (sin dato falso)' "pantalla='$ahora' base='$b2'"

    # Edición en masa (turno) de las 2 lecturas
    foreach ($f in 'QA-HMI-A', 'QA-HMI-B') { JS "window.__fila = '$f'; true" | Out-Null; ClicEn "${FILA}?.querySelector('[aria-label=""Seleccionar fila""]')" | Out-Null }
    $hay = Esperar "!!document.querySelector('select[aria-label=""Turno en masa""]')" 4000
    JS "(() => { const s = document.querySelector('select[aria-label=""Turno en masa""]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, 'NOCTURNO'); s.dispatchEvent(new Event('change', { bubbles: true })); return true })()" | Out-Null
    $vis = Esperar "[...document.querySelectorAll('tbody tr')].filter(t => t.textContent.includes('$codigo')).every(t => t.textContent.includes('Nocturno'))" 10000
    Start-Sleep -Seconds 2
    $turnos = @(); foreach ($id in $hms) { $turnos += (Rest "horometros?select=turno&id=eq.$id" -Servicio)[0].turno }
    OK ($hay -ge 0 -and $vis -ge 0 -and ($turnos -join ',') -eq 'NOCTURNO,NOCTURNO') 'Edición en masa (turno): se ve y queda en la base' "$vis ms; base=$($turnos -join ',')"

    # Eliminar una lectura
    JS "window.confirm = () => true; window.__fila = 'QA-HMI-B'; true" | Out-Null
    ClicEn "${FILA}?.querySelector('[aria-label=""Seleccionar fila""]')" | Out-Null
    Esperar "[...document.querySelectorAll('button')].some(b => b.offsetParent !== null && /^Eliminar \d/.test(b.textContent.trim()))" 4000 | Out-Null
    JS "[...document.querySelectorAll('button')].find(b => b.offsetParent !== null && /^Eliminar \d/.test(b.textContent.trim())).click(); true" | Out-Null
    $fuera = Esperar "![...document.querySelectorAll('tbody tr')].some(t => t.textContent.includes('QA-HMI-B'))" 10000
    Start-Sleep -Seconds 2
    $queda = @(); foreach ($x in (Rest "horometros?select=id&id=eq.$($hms[1])" -Servicio)) { $queda += $x }
    OK ($fuera -ge 0 -and $queda.Count -eq 0) 'Eliminar una lectura: desaparece y se borra de la base' "$fuera ms"

    $m = Mon
    OK ($m.veces -eq 0) 'Editar, rechazo, edición en masa y eliminar: nunca apareció «Consultando…»' "veces=$($m.veces)"
    OK ((Errores-Pagina) -eq '') 'Sin errores en la página' (Errores-Pagina)
} catch { $script:Resultados.Add("EXCEPCION $($_.Exception.Message) (línea $($_.InvocationInfo.ScriptLineNumber))") }
finally {
    foreach ($id in $hms) { try { Rest "registros?horometro_id=eq.$id" 'Delete' -Servicio | Out-Null; Rest "horometros?id=eq.$id" 'Delete' -Servicio | Out-Null } catch {} }
    if ($ticket) { Rest "tickets?id=eq.$ticket" 'Delete' -Servicio | Out-Null }
    if ($eq) { Rest "equipos?id=eq.$eq" 'Delete' -Servicio | Out-Null }
    $script:Resultados.Add('(datos de prueba borrados)')
    Terminar-QA
}
