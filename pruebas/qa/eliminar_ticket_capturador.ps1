# QA: un CAPTURADOR (rol 3) sólo puede eliminar su ticket cuando está vacío (sql/90).
# Cambia temporalmente el rol del usuario QA a 3 (solo desarrollo) y lo devuelve a 2 al final.
param([string]$Base = 'http://localhost:3100')
. "$PSScriptRoot\comun.ps1"
$script:Env = Leer-Entorno; $script:Url = $script:Env['NEXT_PUBLIC_SUPABASE_URL']; $script:Serv = $script:Env['SUPABASE_SERVICE_ROLE_KEY']
$qa = Get-Content "$PSScriptRoot\qa_usuario.local.json" -Raw | ConvertFrom-Json
Rest "perfiles?id=eq.$($qa.id)" 'Patch' @{ rol_id = 3 } -Servicio | Out-Null
$tk = $null; $eq = $null
try {
    Iniciar-QA -Base $Base -Ancho 390 -Alto 844 -Movil
    foreach ($t in (Rest "tickets?select=id&usuario_id=eq.$($qa.id)" -Servicio)) { if ($t.id) { Rest "tickets?id=eq.$($t.id)" 'Delete' -Servicio | Out-Null } }
    $ayer = (Get-Date).AddDays(-1).ToString('yyyy-MM-dd')
    $eq = (Rest 'equipos' 'Post' @{ codigo = "QA-DEL-$(Get-Random -Maximum 99999)"; nombre = 'Equipo de prueba QA' } -Servicio)[0].id
    $tk = (Rest 'tickets' 'Post' @{ usuario_id = $qa.id; fecha = $ayer; codigo = "QA-DEL-$(Get-Random)"; estado = 'ABIERTO'; proceso = 'REGISTRADO' } -Servicio)[0].id
    $h = (Rest 'horometros' 'Post' @{ ticket_id = $tk; fecha = $ayer; turno = 'DIURNO'; equipo_id = $eq; horometro_inicial = 10; horometro_final = 18; horas_hombre = 8; usuario_id = $qa.id } -Servicio)[0].id
    $existe = { [bool]((Rest "tickets?select=id&id=eq.$tk" -Servicio) | Where-Object { $_.id }) }
    $ELIMINAR = "[...document.querySelectorAll('button')].find(b => b.offsetParent && b.textContent.trim() === 'Eliminar')"

    # Con un equipo: sin botón, con la explicación; y la base lo frena aunque se intente por fuera
    Ir "/tickets/$tk"
    $t0 = Esperar "!!document.querySelector('[data-eliminar-bloqueado]')" 20000
    OK ($t0 -ge 0) 'Ticket con equipos: explica que primero se eliminan los equipos' (JS "document.querySelector('[data-eliminar-bloqueado]')?.innerText")
    OK (-not (JS "!!($ELIMINAR)")) 'Ticket con equipos: no aparece «Eliminar»'
    Captura 'eliminar_ticket_bloqueado.png'
    $msg = ''
    try { Rest "tickets?id=eq.$tk" 'Delete' | Out-Null } catch { $msg = "$($_.ErrorDetails.Message)"; if (-not $msg -and $_.Exception.Response) { $msg = (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } }
    OK ((& $existe) -and $msg -match 'primero elimina sus equipos') 'La base frena el borrado completo' $msg

    # Vacío: se puede
    Rest "horometros?id=eq.$h" 'Delete' -Servicio | Out-Null
    Ir "/tickets/$tk"
    $t1 = Esperar "!!($ELIMINAR)" 20000
    OK ($t1 -ge 0) 'Ticket vacío: aparece «Eliminar»'
    JS "window.confirm = () => true; ($ELIMINAR).click(); true" | Out-Null
    for ($i = 0; $i -lt 10 -and (& $existe); $i++) { Start-Sleep -Seconds 1 }
    OK (-not (& $existe)) 'El capturador elimina su ticket vacío'
    if (-not (& $existe)) { $tk = $null }
    OK ((Errores-Pagina) -eq '') 'Sin errores en la página' (Errores-Pagina)
} catch { $script:Resultados.Add("EXCEPCION $($_.Exception.Message)") }
finally {
    if ($tk) { Rest "tickets?id=eq.$tk" 'Delete' -Servicio | Out-Null }
    if ($eq) { try { Rest "equipos?id=eq.$eq" 'Delete' -Servicio | Out-Null } catch {} }
    Rest "perfiles?id=eq.$($qa.id)" 'Patch' @{ rol_id = 2 } -Servicio | Out-Null
    $script:Resultados.Add("(datos borrados; rol del usuario QA devuelto a $((Rest "perfiles?select=rol_id&id=eq.$($qa.id)" -Servicio)[0].rol_id))")
    Terminar-QA
}
