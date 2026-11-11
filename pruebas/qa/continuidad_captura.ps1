# QA: continuidad al capturar un horómetro (celular). Prepara un equipo con una lectura anterior (ticket QA del
# día previo, final 500), abre «Nuevo horómetro» en el ticket QA de la jornada y comprueba:
#   - al elegir el equipo, el inicial se propone en 500 y avisa «sigue la secuencia»
#   - si se teclea otro inicial, aparece el aviso de desfase (sin bloquear) y se puede guardar
# Borra todo lo creado al final.
param([string]$Base = 'http://localhost:3100')
. "$PSScriptRoot\comun.ps1"
Iniciar-QA -Base $Base -Ancho 390 -Alto 844 -Movil
$tickets = @()
try {
    $ayer = (Get-Date).AddDays(-1).ToString('yyyy-MM-dd')
    $antes = (Get-Date).AddDays(-2).ToString('yyyy-MM-dd')
    # Equipo de prueba propio: así ninguna lectura real se mete en medio
    $codigo = "QA-EQ-$(Get-Random -Maximum 99999)"
    $eq = (Rest 'equipos' 'Post' @{ codigo = $codigo; nombre = 'Equipo de prueba QA' } -Servicio)[0].id
    $t0 = (Rest 'tickets' 'Post' @{ usuario_id = $script:QA.id; fecha = $antes; codigo = "QA-CONT-A-$(Get-Random)"; estado = 'ABIERTO'; proceso = 'REGISTRADO' } -Servicio)[0].id
    $tickets += $t0
    Rest 'horometros' 'Post' @{ ticket_id = $t0; fecha = $antes; turno = 'DIURNO'; equipo_id = $eq; horometro_inicial = 492; horometro_final = 500; horas_hombre = 8; usuario_id = $script:QA.id } -Servicio | Out-Null
    $t1 = (Rest 'tickets' 'Post' @{ usuario_id = $script:QA.id; fecha = $ayer; codigo = "QA-CONT-B-$(Get-Random)"; estado = 'ABIERTO'; proceso = 'REGISTRADO' } -Servicio)[0].id
    $tickets += $t1

    Ir "/tickets/$t1/horometros/nuevo"
    $ok = Esperar "[...document.querySelectorAll('button')].some(b => b.offsetParent && /Buscar equipo/.test(b.textContent))" 20000
    OK ($ok -ge 0) 'Abre «Nuevo horómetro»'
    # Elegir el equipo con el selector buscable (como una persona)
    # Reintenta el clic hasta que React esté hidratado y abra el buscador
    $BUSCADOR = "document.querySelector('input[placeholder^=""Escribe el código""]')"
    for ($i = 0; $i -lt 20 -and -not (JS "!!($BUSCADOR)"); $i++) { JS "[...document.querySelectorAll('button')].find(b => b.offsetParent && /Buscar equipo/.test(b.textContent)).click(); true" | Out-Null; Start-Sleep -Milliseconds 500 }
    Start-Sleep -Milliseconds 400
    Teclear "document.querySelector('input[placeholder^=""Escribe el código""]')" $codigo
    $OPCION = "[...document.querySelectorAll('button')].find(b => b.offsetParent && b.textContent.startsWith('$codigo'))"
    $op = Esperar "!!($OPCION)" 5000
    Captura 'continuidad_busqueda.png'; OK ($op -ge 0) 'El equipo aparece al buscarlo' (JS "[...document.querySelectorAll('button')].filter(b => b.offsetParent).map(b => b.textContent.trim().slice(0,30)).join(' | ')")
    JS "($OPCION).click(); true" | Out-Null
    $INI = "document.querySelectorAll('input[inputmode=decimal]')[0]"
    $tp = Esperar "$INI.value === '500'" 8000
    OK ($tp -ge 0) 'Propone el inicial desde la última lectura (500)' "$tp ms; valor=$(JS "$INI.value")"
    OK ((JS "document.querySelector('[data-continuidad]')?.dataset.continuidad") -eq 'ok') 'Muestra «sigue la secuencia»' (JS "document.querySelector('[data-continuidad]')?.innerText")
    Captura 'continuidad_ok.png'

    Teclear $INI '497'
    $td = Esperar "document.querySelector('[data-continuidad]')?.dataset.continuidad === 'desfase'" 3000
    OK ($td -ge 0) 'Inicial distinto: aviso de desfase' (JS "document.querySelector('[data-continuidad]')?.innerText")
    Captura 'continuidad_desfase.png'

    Teclear "document.querySelectorAll('input[inputmode=decimal]')[1]" '505'
    Clic 'Guardar y registrar labores' | Out-Null
    $tg = Esperar "/registros\/nuevo/.test(location.pathname)" 15000
    OK ($tg -ge 0) 'El aviso no bloquea: guarda y pasa a labores'
    $h = Rest "horometros?select=horometro_inicial,horometro_final&ticket_id=eq.$t1" -Servicio
    OK ($h.Count -eq 1 -and [double]$h[0].horometro_inicial -eq 497 -and [double]$h[0].horometro_final -eq 505) 'Se guardó lo tecleado (497 → 505)' ($h | ConvertTo-Json -Compress)
    OK ((Errores-Pagina) -eq '') 'Sin errores en la página' (Errores-Pagina)
} catch { $script:Resultados.Add("EXCEPCION $($_.Exception.Message)") }
finally {
    foreach ($t in $tickets) { Rest "tickets?id=eq.$t" 'Delete' -Servicio | Out-Null }
    if ($eq) { try { Rest "equipos?id=eq.$eq" 'Delete' -Servicio | Out-Null } catch { $script:Resultados.Add("(no se pudo borrar el equipo QA $codigo)") } }
    $script:Resultados.Add('(datos de prueba borrados)')
    Terminar-QA
}
