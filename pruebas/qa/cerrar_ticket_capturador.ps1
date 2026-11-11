# QA: un CAPTURADOR (rol Digitador de Campo, id 3) cierra y reabre su ticket en «0 · Registrado» (sql/89).
# Cambia temporalmente el rol del usuario QA a 3 (solo desarrollo) y lo devuelve a 2 al final. Crea y borra un ticket.
param([string]$Base = 'http://localhost:3100')
. "$PSScriptRoot\comun.ps1"
$script:Env = Leer-Entorno; $script:Url = $script:Env['NEXT_PUBLIC_SUPABASE_URL']; $script:Serv = $script:Env['SUPABASE_SERVICE_ROLE_KEY']
$qa = Get-Content "$PSScriptRoot\qa_usuario.local.json" -Raw | ConvertFrom-Json
Rest "perfiles?id=eq.$($qa.id)" 'Patch' @{ rol_id = 3 } -Servicio | Out-Null
$tk = $null
try {
    Iniciar-QA -Base $Base -Ancho 390 -Alto 844 -Movil
    foreach ($t in (Rest "tickets?select=id&usuario_id=eq.$($qa.id)" -Servicio)) { if ($t.id) { Rest "tickets?id=eq.$($t.id)" 'Delete' -Servicio | Out-Null } }
    $ayer = (Get-Date).AddDays(-1).ToString('yyyy-MM-dd')
    $tk = (Rest 'tickets' 'Post' @{ usuario_id = $qa.id; fecha = $ayer; codigo = "QA-CIERRE-$(Get-Random)"; estado = 'ABIERTO'; proceso = 'REGISTRADO' } -Servicio)[0].id
    $estado = { (Rest "tickets?select=estado&id=eq.$tk" -Servicio)[0].estado }

    Ir "/tickets/$tk"
    $BTN = { param($txt) "[...document.querySelectorAll('button')].find(b => b.offsetParent && b.textContent.trim() === '$txt')" }
    $t0 = Esperar "!!($(& $BTN 'Cerrar ticket'))" 20000
    OK ($t0 -ge 0) 'El capturador ve «Cerrar ticket» en su ticket'
    JS "window.confirm = () => true; true" | Out-Null
    for ($i = 0; $i -lt 10 -and (& $estado) -ne 'CERRADO'; $i++) { JS "($(& $BTN 'Cerrar ticket'))?.click(); true" | Out-Null; Start-Sleep -Seconds 2 }
    OK ((& $estado) -eq 'CERRADO') 'El capturador cierra su ticket (antes lo rechazaba la base)' (JS "document.querySelector('[role=alert]')?.innerText ?? ''")
    $t1 = Esperar "!!($(& $BTN 'Reabrir'))" 15000
    OK ($t1 -ge 0) 'Con el ticket cerrado ve «Reabrir»'
    Captura 'cerrar_ticket_capturador.png'
    JS "($(& $BTN 'Reabrir'))?.click(); true" | Out-Null
    for ($i = 0; $i -lt 8 -and (& $estado) -ne 'ABIERTO'; $i++) { Start-Sleep -Seconds 1 }
    OK ((& $estado) -eq 'ABIERTO') 'Lo reabre mientras siga en Registrado'
    OK ((Errores-Pagina) -eq '') 'Sin errores en la página' (Errores-Pagina)
} catch { $script:Resultados.Add("EXCEPCION $($_.Exception.Message)") }
finally {
    if ($tk) { Rest "tickets?id=eq.$tk" 'Delete' -Servicio | Out-Null }
    Rest "perfiles?id=eq.$($qa.id)" 'Patch' @{ rol_id = 2 } -Servicio | Out-Null
    $script:Resultados.Add("(ticket borrado; rol del usuario QA devuelto a $((Rest "perfiles?select=rol_id&id=eq.$($qa.id)" -Servicio)[0].rol_id))")
    Terminar-QA
}
