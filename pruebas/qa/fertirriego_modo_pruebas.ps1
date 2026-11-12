# QA · Modo de pruebas de Fertirriego (sql/98) con clics. Copia en :3100 + base de DESARROLLO con la 98.
# Crea una estación real de prueba «QA Real <n>», un participante con un rol temporal y lo borra todo al final.
. "$PSScriptRoot\comun.ps1"
Iniciar-QA -Base http://localhost:3100 -Ancho 1280 -Alto 900
function ClicEn($js) { JS "(() => { const e = $js; if (!e) return false; e.scrollIntoView({block:'center'}); e.click(); return true })()" }
function ClicHasta($js, $condicion, [int]$veces = 15) { for ($i = 0; $i -lt $veces; $i++) { ClicEn $js | Out-Null; if ((Esperar $condicion 700) -ge 0) { return $true } }; return $false }
$s = Get-Random -Maximum 99999
$qaId = $script:QA.id
$origRoles = @(foreach ($x in (Rest 'rpc/fn_roles_de_perfiles' 'Post' @{} -Servicio)) { if ($x.perfil_id -eq $qaId) { [int]$x.rol_id } })
$origPrincipal = (Rest "perfiles?select=rol_id&id=eq.$qaId" -Servicio)[0].rol_id
$idAdmin = (Rest 'roles?select=id&acceso_total=eq.true&limit=1' -Servicio)[0].id
$z = (Rest 'zonas?select=id&activo=eq.true&order=nombre&limit=1' -Servicio)[0].id
$clave = "Qa-$(Get-Random)-x$(Get-Random)"; $EST = "QA Real $s"; $NOMBRE_P = "QA Participante $s"
$estId = $null; $partId = $null; $rolP = $null
try {
    $estId = (Rest 'estaciones_riego' 'Post' @{ nombre = $EST; zona_id = $z } -Servicio)[0].id
    $rolP = (Rest 'roles' 'Post' @{ codigo = "QA_PART_$s"; nombre = "QA Participante $s" } -Servicio)[0].id
    foreach ($a in 'ver', 'recibir', 'aplicar', 'contar') { Rest 'permisos' 'Post' @{ rol_id = $rolP; recurso = 'fertirriego'; accion = $a; alcance = 'propietario' } -Servicio | Out-Null }
    $u = Invoke-RestMethod -Method Post -Uri "$script:Url/auth/v1/admin/users" -Headers @{ apikey = $script:Serv; Authorization = "Bearer $script:Serv" } -ContentType 'application/json' -Body (@{ email = "qa.part$s@desarrollo.local"; password = $clave; email_confirm = $true } | ConvertTo-Json)
    $partId = $u.id
    Rest 'perfiles' 'Post' @{ id = $partId; nombre = $NOMBRE_P; rol_id = $rolP; todas_las_zonas = $false } -Servicio | Out-Null
    Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $partId; p_roles = @($rolP); p_principal = $rolP } -Servicio | Out-Null
    Rest 'perfiles_zonas' 'Post' @{ perfil_id = $partId; zona_id = $z } -Servicio | Out-Null
    Rest 'perfiles_estaciones' 'Post' @{ perfil_id = $partId; estacion_id = $estId } -Servicio | Out-Null

    # Administrador (QA con acceso total temporal)
    Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($origRoles + $idAdmin); p_principal = $origPrincipal } -Servicio | Out-Null
    Entrar-Como $script:QA.email $script:QA.clave | Out-Null
    Ir "/admin/fertirriego-pruebas?r=$s"
    $t = Esperar "!!document.querySelector('[data-estado-pruebas]')" 40000
    OK ($t -ge 0) 'Administración › Pruebas Fertirriego abre' "$t ms"
    ClicEn "document.querySelector('[data-lista=estaciones-prueba] [data-opcion=""$EST""]')" | Out-Null
    ClicEn "document.querySelector('[data-lista=participantes-prueba] [data-opcion=""$NOMBRE_P""]')" | Out-Null
    ClicEn "document.querySelector('[data-activar-pruebas]')" | Out-Null
    $t = Esperar "document.querySelector('[data-estado-pruebas]')?.dataset.estadoPruebas === 'activo'" 15000
    if ($t -lt 0) { $script:Resultados.Add("DIAG activar: marcadas=$(JS "[...document.querySelectorAll('[data-modo-pruebas] [aria-checked=true]')].map(b => b.dataset.opcion).join('|')") · pantalla=$((JS "document.querySelector('[data-modo-pruebas]')?.innerText.slice(-300)") -replace "`n", ' / ')") }
    $prueba = @(foreach ($x in (Rest "estaciones_riego?select=id,nombre&prueba_de=eq.$estId" -Servicio)) { if ($x.id) { $x } })
    OK ($t -ge 0 -and $prueba.Count -eq 1 -and $prueba[0].nombre -eq "PRUEBA · $EST") 'Activar: queda activo y se crea «PRUEBA · QA Real»' $prueba[0].nombre

    # El participante en el teléfono
    CDP 'Emulation.setDeviceMetricsOverride' @{ width = 412; height = 915; deviceScaleFactor = 2; mobile = $true } | Out-Null
    Entrar-Como "qa.part$s@desarrollo.local" $clave | Out-Null
    Ir "/fertirriego?r=$s-p"
    $t = Esperar "!!document.querySelector('[data-estacion]') || !!document.querySelector('[data-selector-estacion]')" 40000
    $nombre = JS "document.querySelector('[data-estacion]')?.dataset.estacion"
    OK ($t -ge 0 -and $nombre -eq "PRUEBA · $EST" -and -not (JS "!!document.querySelector('[data-selector-estacion]')")) 'El participante ve SOLO la estación de prueba (no la real)' $nombre
    OK ((JS "/MODO PRUEBA/.test(document.querySelector('[data-modo-prueba]')?.innerText || '')") -eq $true) 'Ve el aviso «MODO PRUEBA»'
    Captura 'fert_modo_prueba.png'

    # Apagar sin borrar y borrar
    CDP 'Emulation.setDeviceMetricsOverride' @{ width = 1280; height = 900; deviceScaleFactor = 1; mobile = $false } | Out-Null
    Entrar-Como $script:QA.email $script:QA.clave | Out-Null
    Ir "/admin/fertirriego-pruebas?r=$s-b"
    Esperar "document.querySelector('[data-estado-pruebas]')?.dataset.estadoPruebas === 'activo'" 30000 | Out-Null
    ClicEn "document.querySelector('[data-desactivar-pruebas]')" | Out-Null
    $t = Esperar "document.querySelector('[data-estado-pruebas]')?.dataset.estadoPruebas === 'inactivo' && !!document.querySelector('[data-se-borra]')" 15000
    OK ($t -ge 0) 'Apagar sin borrar: dice cuándo se borra solo' (JS "document.querySelector('[data-se-borra]')?.innerText")
    ClicEn "document.querySelector('[data-borrar-pruebas]')" | Out-Null
    ClicEn "document.querySelector('[data-confirmar-borrar-pruebas]')" | Out-Null
    $t = Esperar "/Borrado:/.test(document.body.innerText)" 15000
    $quedan = @(@(Rest "estaciones_riego?select=id&prueba_de=eq.$estId" -Servicio) | Where-Object { $_.id }).Count
    OK ($t -ge 0 -and $quedan -eq 0) 'Borrar: se va la estación de prueba' "quedan $quedan"
    OK ((Errores-Pagina) -eq '') 'Sin errores en la página' (Errores-Pagina)
} catch { $script:Resultados.Add("EXCEPCION (línea $($_.InvocationInfo.ScriptLineNumber)) $($_.Exception.Message) $($_.ErrorDetails.Message)") }
finally {
    try { $tok = Entrar-Como $script:QA.email $script:QA.clave; Rest 'rpc/fn_fert_pruebas_borrar' 'Post' @{} -Token $tok | Out-Null } catch {}
    try { Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = $origRoles; p_principal = $origPrincipal } -Servicio | Out-Null } catch { $script:Resultados.Add("LIMPIEZA roles QA: $($_.Exception.Message)") }
    try {
        if ($partId) { Rest "perfiles_estaciones?perfil_id=eq.$partId" 'Delete' -Servicio | Out-Null; Rest "perfiles_zonas?perfil_id=eq.$partId" 'Delete' -Servicio | Out-Null; Rest "perfiles?id=eq.$partId" 'Delete' -Servicio | Out-Null; Invoke-RestMethod -Method Delete -Uri "$script:Url/auth/v1/admin/users/$partId" -Headers @{ apikey = $script:Serv; Authorization = "Bearer $script:Serv" } | Out-Null }
        if ($rolP) { Rest "permisos?rol_id=eq.$rolP" 'Delete' -Servicio | Out-Null; Rest "roles?id=eq.$rolP" 'Delete' -Servicio | Out-Null }
        if ($estId) { Rest "perfiles_estaciones?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null; Rest "estaciones_riego?id=eq.$estId" 'Delete' -Servicio | Out-Null }
    } catch { $script:Resultados.Add("LIMPIEZA: $($_.Exception.Message) $($_.ErrorDetails.Message)") }
    $r = @(); foreach ($x in (Rest 'rpc/fn_roles_de_perfiles' 'Post' @{} -Servicio)) { if ($x.perfil_id -eq $qaId) { $r += [int]$x.rol_id } }
    $restos = @(@(Rest "estaciones_riego?select=id&or=(nombre.eq.$([uri]::EscapeDataString($EST)),prueba_de.not.is.null)" -Servicio) | Where-Object { $_.id }).Count
    OK ((($r | Sort-Object) -join ',') -eq (($origRoles | Sort-Object) -join ',') -and $restos -eq 0) 'Limpieza: nada de la prueba queda y el usuario QA está como estaba' "roles $($r -join ','), restos $restos"
    Terminar-QA
}
