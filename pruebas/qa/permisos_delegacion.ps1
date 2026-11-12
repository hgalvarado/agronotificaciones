# QA · Permisos 93: historial (P3), menú desde la base (P4) y delegación a jefes de zona (P5).
# Corre contra la copia en :3100 y la base de DESARROLLO. Guarda el estado del usuario QA (roles, zonas, «Todas»)
# y lo restaura al final; borra todo lo que crea (roles, personas) y deja el menú como estaba.
. "$PSScriptRoot\comun.ps1"
Iniciar-QA -Base http://localhost:3100

function Lista($ruta, $metodo = 'Get', $cuerpo = $null) { $r = Rest $ruta $metodo $cuerpo -Servicio; $o = New-Object System.Collections.ArrayList; foreach ($x in $r) { if ($null -ne $x) { [void]$o.Add($x) } }; return ,$o }
function ClicEn($js) { JS "(() => { const e = $js; if (!e) return false; e.click(); return true })()" }
function NuevaPersona($nombre, $rolId, $zonaId) {
    $u = Invoke-RestMethod -Method Post -Uri "$script:Url/auth/v1/admin/users" -Headers @{ apikey = $script:Serv; Authorization = "Bearer $script:Serv" } -ContentType 'application/json' -Body (@{ email = "qa.$([guid]::NewGuid().ToString('N').Substring(0,10))@desarrollo.local"; password = "Qa-$(Get-Random)-x"; email_confirm = $true } | ConvertTo-Json)
    Rest 'perfiles' 'Post' @{ id = $u.id; nombre = $nombre; rol_id = $rolId; todas_las_zonas = $false } -Servicio | Out-Null
    if ($zonaId) { Rest 'perfiles_zonas' 'Post' @{ perfil_id = $u.id; zona_id = $zonaId } -Servicio | Out-Null }
    return $u.id
}

$s = Get-Random -Maximum 99999
$qaId = $script:QA.id
$qaNombre = (Lista "perfiles?select=nombre&id=eq.$qaId")[0].nombre
$orig = (Lista "perfiles?select=rol_id,todas_las_zonas&id=eq.$qaId")[0]
$origRoles = @(foreach ($x in (Lista 'rpc/fn_roles_de_perfiles' 'Post' @{})) { if ($x.perfil_id -eq $qaId) { [int]$x.rol_id } })
$origZonas = @(foreach ($x in (Lista "perfiles_zonas?select=zona_id&perfil_id=eq.$qaId")) { $x.zona_id })
$idAdmin = (Lista 'roles?select=id&acceso_total=eq.true&limit=1')[0].id
$zonas = Lista 'zonas?select=id,nombre&activo=eq.true&order=nombre'
$z1 = $zonas[0]; $z2 = $zonas[1]
$creadas = New-Object System.Collections.ArrayList
$rolesCreados = New-Object System.Collections.ArrayList

try {
    # Roles de prueba: un jefe (Usuarios zonal) y uno que se marcará delegable desde la pantalla
    $rJefe = (Rest 'roles' 'Post' @{ codigo = "QA_JEFE_$s"; nombre = "QA Jefe $s" } -Servicio)[0].id; [void]$rolesCreados.Add($rJefe)
    $rDele = (Rest 'roles' 'Post' @{ codigo = "QA_DELE_$s"; nombre = "QA Delegable $s" } -Servicio)[0].id; [void]$rolesCreados.Add($rDele)
    foreach ($a in 'ver', 'crear', 'editar') { Rest 'permisos' 'Post' @{ rol_id = $rJefe; recurso = 'usuarios'; accion = $a; alcance = 'zonal' } -Servicio | Out-Null }
    Rest 'permisos' 'Post' @{ rol_id = $rJefe; recurso = 'fertirriego'; accion = 'ver'; alcance = 'zonal' } -Servicio | Out-Null

    # ===================== Como ADMINISTRADOR: delegable + historial =====================
    Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($orig.rol_id, $idAdmin); p_principal = $orig.rol_id } -Servicio | Out-Null
    Ir "/admin/permisos?r=$s"
    Esperar "!!document.querySelector('[data-rol=QA_DELE_$s]')" 30000 | Out-Null
    # Hasta que React tome la página, un clic se pierde: se repite hasta que la pestaña quede seleccionada
    $sel = -1
    for ($i = 0; $i -lt 20 -and $sel -lt 0; $i++) { ClicEn "document.querySelector('[data-rol=QA_DELE_$s]')" | Out-Null; $sel = Esperar "document.querySelector('[data-rol=QA_DELE_$s]')?.getAttribute('aria-selected') === 'true' && document.body.innerText.includes('QA_DELE_$s')" 700 }
    if ($sel -lt 0) { throw 'No se pudo seleccionar el rol de prueba: se detiene para no tocar otro rol' }
    ClicEn "document.querySelector('[data-delegable]')" | Out-Null
    $t = Esperar "document.querySelector('[data-delegable]')?.getAttribute('aria-checked') === 'true'" 10000
    OK ($t -ge 0 -and (Lista "roles?select=delegable&id=eq.$rDele")[0].delegable) 'Permisos: marcar un rol como delegable'
    ClicEn "document.querySelector('[data-ver-historial-rol]')" | Out-Null
    $t = Esperar "/delegable/.test(document.querySelector('[data-historial]')?.innerText || '')" 10000
    OK ($t -ge 0) 'Historial del rol: dice quién lo marcó delegable' ((JS "document.querySelector('[data-historial] li')?.innerText") -replace "`n", ' · ')

    # Personas de prueba: una en Z1 (delegable), una en Z2, una en Z1 con rol NO delegable
    $pZ1 = NuevaPersona "QA Z1 $s" $rDele $z1.id; [void]$creadas.Add($pZ1)
    $pZ2 = NuevaPersona "QA Z2 $s" $rDele $z2.id; [void]$creadas.Add($pZ2)
    $pNo = NuevaPersona "QA NoDele $s" $rJefe $z1.id; [void]$creadas.Add($pNo)

    # ===================== Como JEFE DE ZONA (solo Z1) =====================
    Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($rJefe); p_principal = $rJefe } -Servicio | Out-Null
    Rest "perfiles?id=eq.$qaId" 'Patch' @{ todas_las_zonas = $false } -Servicio | Out-Null
    Rest "perfiles_zonas?perfil_id=eq.$qaId" 'Delete' -Servicio | Out-Null
    Rest 'perfiles_zonas' 'Post' @{ perfil_id = $qaId; zona_id = $z1.id } -Servicio | Out-Null

    Ir "/admin/usuarios?r=$s"
    $t = Esperar "location.pathname === '/admin/usuarios' && !!document.querySelector('[data-roles-usuario]')" 60000
    $texto = JS "document.body.innerText"
    OK ($t -ge 0 -and $texto -match "QA Z1 $s" -and $texto -notmatch "QA Z2 $s") 'Jefe: la lista trae su zona y no otra' "$t ms"
    $admins = @(foreach ($x in (Lista 'rpc/fn_roles_de_perfiles' 'Post' @{})) { if ([int]$x.rol_id -eq $idAdmin) { $x.perfil_id } })
    $nombresAdmin = @(foreach ($id in $admins) { (Lista "perfiles?select=nombre,todas_las_zonas&id=eq.$id")[0] }) | Where-Object { $_.todas_las_zonas } | ForEach-Object { $_.nombre }
    OK (-not ($nombresAdmin | Where-Object { $texto -match [regex]::Escape($_) -and $_ -ne $qaNombre })) 'Jefe: no ve administradores'

    $tm = -1; for ($i = 0; $i -lt 5 -and $tm -lt 0; $i++) { Clic 'Nuevo' | Out-Null; $tm = Esperar "!!document.querySelector('[data-lista=roles]')" 3000 }
    $rolesOfrecidos = JS "[...document.querySelectorAll('[data-rol-opcion]')].map(b => b.dataset.rolOpcion).join(',')"
    OK ($rolesOfrecidos -eq "QA_DELE_$s") 'Jefe: solo le ofrece roles delegables' $rolesOfrecidos
    OK ((JS "!!document.querySelector('[data-todas-las-zonas]')") -eq $false -and (JS "!!document.querySelector('[data-delegado]')") -eq $true) 'Jefe: sin «Todas las zonas», con aviso de delegación'
    $zonasOfrecidas = JS "[...document.querySelectorAll('[data-lista=zonas] [data-opcion]')].map(b => b.dataset.opcion).join(',')"
    OK ($zonasOfrecidas -eq $z1.nombre) 'Jefe: solo le ofrece su zona' $zonasOfrecidas

    $dlg = "document.querySelector('[role=dialog]') || document"
    Teclear "($dlg).querySelector('input[placeholder=""Fernando Lazo""]')" "QA Alta Jefe $s"
    Teclear "($dlg).querySelector('input[type=email]')" "qa.altajefe.$s@desarrollo.local"
    Teclear "[...($dlg).querySelectorAll('input[type=text]')].find(i => i.placeholder === '')" "QaClave-$s"
    ClicEn "document.querySelector('[data-rol-opcion=QA_DELE_$s]')" | Out-Null
    ClicEn "document.querySelector('[data-lista=zonas] [data-opcion]')" | Out-Null
    ClicEn "document.querySelector('[data-guardar-usuario]')" | Out-Null
    $t = Esperar "!document.querySelector('[data-lista=roles]')" 20000
    $nueva = (Lista "perfiles?select=id,rol_id,todas_las_zonas&nombre=eq.$([uri]::EscapeDataString("QA Alta Jefe $s"))")[0]
    if ($nueva) { [void]$creadas.Add($nueva.id) }
    $zn = @(foreach ($x in (Lista "perfiles_zonas?select=zona_id&perfil_id=eq.$($nueva.id)")) { $x.zona_id })
    OK ($t -ge 0 -and $nueva -and $nueva.rol_id -eq $rDele -and -not $nueva.todas_las_zonas -and ($zn -join ',') -eq $z1.id) 'Jefe: da de alta a alguien en su zona con rol delegable'
    # Con la sesión del jefe (el historial exige el permiso de una persona; la llave de servicio no lo tiene)
    $h = @(foreach ($x in (Rest 'rpc/fn_historial_accesos' 'Post' @{ p_perfil = $nueva.id; p_limite = 20 })) { $x })
    OK (@($h | Where-Object { $_.por -eq $qaNombre -or $_.por -match 'QA' }).Count -gt 0) 'Historial: el alta queda a nombre del jefe' (($h | Select-Object -First 3 | ForEach-Object { "$($_.tabla)/$($_.accion) por $($_.por)" }) -join ' · ')

    # Intentos por fuera de la pantalla (la base y la API deben negarlo)
    $r1 = JS "fetch('/api/usuarios/$pZ2', {method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({zonas: ['$($z1.id)']})}).then(r => r.status)"
    OK ($r1 -eq 403) 'Jefe: no puede editar a alguien de otra zona (403)' $r1
    $r2 = JS "fetch('/api/usuarios/$pZ1', {method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({roles: [$idAdmin], rol_id: $idAdmin})}).then(async r => r.status + ' ' + (await r.json()).error)"
    OK ($r2 -match '^(400|403)' -and (Lista "perfiles?select=rol_id&id=eq.$pZ1")[0].rol_id -eq $rDele) 'Jefe: no puede dar acceso total' $r2
    $r3 = JS "fetch('/api/usuarios/$pZ1', {method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({todas_las_zonas: true})}).then(r => r.status)"
    OK ($r3 -ne 200 -and -not (Lista "perfiles?select=todas_las_zonas&id=eq.$pZ1")[0].todas_las_zonas) 'Jefe: no puede dar «Todas las zonas»' $r3
    $r4 = JS "fetch('/api/usuarios/$pNo', {method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({nombre: 'hackeado'})}).then(r => r.status)"
    OK ($r4 -eq 403) 'Jefe: no puede editar a alguien con rol no delegable' $r4

    # Ficha: historial visible para el jefe en alguien de su zona
    ClicEn "document.querySelector('[aria-label=""Editar QA Alta Jefe $s""]')" | Out-Null
    Esperar "!!document.querySelector('[data-ver-historial]')" 10000 | Out-Null
    ClicEn "document.querySelector('[data-ver-historial]')" | Out-Null
    $t = Esperar "!!document.querySelector('[data-historial] li')" 10000
    OK ($t -ge 0) 'Ficha: «Historial de sus accesos»' ((JS "document.querySelector('[data-historial] li')?.innerText") -replace "`n", ' · ')
    Captura 'permisos_delegacion_jefe.png'

    # ===================== P4 · Menú desde la base =====================
    $script:menuOriginal = (Lista 'pantallas?select=en_menu&codigo=eq.fertirriego')[0].en_menu
    Rest 'pantallas?codigo=eq.fertirriego' 'Patch' @{ en_menu = $true } -Servicio | Out-Null
    Ir "/admin/usuarios?r=$s-2"
    Esperar "!!document.querySelector('nav')" 30000 | Out-Null
    Start-Sleep 1
    OK ((JS "!![...document.querySelectorAll('a[href=""/fertirriego""]')].find(a => a.offsetParent)") -eq $true) 'Menú: una pantalla marcada en la base aparece sola a quien la ve'
    Rest 'pantallas?codigo=eq.fertirriego' 'Patch' @{ en_menu = $false } -Servicio | Out-Null
    Ir "/admin/usuarios?r=$s-3"
    Esperar "!!document.querySelector('nav')" 30000 | Out-Null
    Start-Sleep 1
    OK ((JS "!![...document.querySelectorAll('a[href=""/fertirriego""]')].find(a => a.offsetParent)") -eq $false) 'Menú: apagada en la base, desaparece'

    $e = Errores-Pagina; OK (-not $e) 'Sin errores en la página' $e
}
catch { $script:Resultados.Add("EXCEPCION $($_.Exception.Message)") }
finally {
    # El menú vuelve a como estaba (desde la 94 Fertirriego está encendido)
    try { if ($null -ne $script:menuOriginal) { Rest 'pantallas?codigo=eq.fertirriego' 'Patch' @{ en_menu = [bool]$script:menuOriginal } -Servicio | Out-Null } } catch {}
    # Restaurar al usuario QA tal como estaba
    # Cada paso por separado: si uno falla, los demás igual se hacen. Al final se verifica contra lo guardado.
    try { Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = $origRoles; p_principal = $orig.rol_id } -Servicio | Out-Null } catch { $script:Resultados.Add("LIMPIEZA roles QA: $($_.Exception.Message)") }
    try { Rest "perfiles?id=eq.$qaId" 'Patch' @{ todas_las_zonas = $orig.todas_las_zonas } -Servicio | Out-Null } catch { $script:Resultados.Add("LIMPIEZA todas QA: $($_.Exception.Message)") }
    try { Rest "perfiles_zonas?perfil_id=eq.$qaId" 'Delete' -Servicio | Out-Null } catch { $script:Resultados.Add("LIMPIEZA zonas QA: $($_.Exception.Message)") }
    foreach ($z in $origZonas) { try { Rest 'perfiles_zonas' 'Post' @{ perfil_id = $qaId; zona_id = $z } -Servicio | Out-Null } catch { $script:Resultados.Add("LIMPIEZA zona ${z}: $($_.Exception.Message)") } }
    try {
        $ahoraRoles = @(foreach ($x in (Lista 'rpc/fn_roles_de_perfiles' 'Post' @{})) { if ($x.perfil_id -eq $qaId) { [int]$x.rol_id } }) | Sort-Object
        $ahoraZonas = @(foreach ($x in (Lista "perfiles_zonas?select=zona_id&perfil_id=eq.$qaId")) { $x.zona_id }) | Sort-Object
        $ahora = (Lista "perfiles?select=rol_id,todas_las_zonas&id=eq.$qaId")[0]
        OK (($ahoraRoles -join ',') -eq (($origRoles | Sort-Object) -join ',') -and ($ahoraZonas -join ',') -eq (($origZonas | Sort-Object) -join ',') -and $ahora.rol_id -eq $orig.rol_id -and $ahora.todas_las_zonas -eq $orig.todas_las_zonas) 'Usuario QA restaurado como estaba' "roles $($ahoraRoles -join ',') · $($ahoraZonas.Count) zonas"
    } catch { $script:Resultados.Add("LIMPIEZA verificación: $($_.Exception.Message)") }
    foreach ($id in $creadas) {
        try { Invoke-RestMethod -Method Delete -Uri "$script:Url/auth/v1/admin/users/$id" -Headers @{ apikey = $script:Serv; Authorization = "Bearer $script:Serv" } | Out-Null } catch { $script:Resultados.Add("LIMPIEZA persona ${id}: $($_.Exception.Message)") }
    }
    foreach ($r in $rolesCreados) {
        try { Rest "permisos?rol_id=eq.$r" 'Delete' -Servicio | Out-Null; Rest "roles?id=eq.$r" 'Delete' -Servicio | Out-Null } catch { $script:Resultados.Add("LIMPIEZA rol ${r}: $($_.Exception.Message)") }
    }
    Terminar-QA
}
