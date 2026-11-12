# QA · sql/97 con clics: un jefe de zona que administra SOLO Estacioneros. Crea un rol jefe, un jefe, un estacionero y un
# digitador de prueba en la misma zona; al final borra todo. Copia en :3100 + base de DESARROLLO con la 97.
. "$PSScriptRoot\comun.ps1"
Iniciar-QA -Base http://localhost:3100 -Ancho 1280 -Alto 900
function ClicEn($js) { JS "(() => { const e = $js; if (!e) return false; e.scrollIntoView({block:'center'}); e.click(); return true })()" }
function ClicHasta($js, $condicion, [int]$veces = 15) { for ($i = 0; $i -lt $veces; $i++) { ClicEn $js | Out-Null; if ((Esperar $condicion 700) -ge 0) { return $true } }; return $false }
function Nuevo($email, $clave, $nombre, $rol, $zona) {
    $u = Invoke-RestMethod -Method Post -Uri "$script:Url/auth/v1/admin/users" -Headers @{ apikey = $script:Serv; Authorization = "Bearer $script:Serv" } -ContentType 'application/json' -Body (@{ email = $email; password = $clave; email_confirm = $true } | ConvertTo-Json)
    Rest 'perfiles' 'Post' @{ id = $u.id; nombre = $nombre; rol_id = $rol; todas_las_zonas = $false } -Servicio | Out-Null
    Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $u.id; p_roles = @($rol); p_principal = $rol } -Servicio | Out-Null
    Rest 'perfiles_zonas' 'Post' @{ perfil_id = $u.id; zona_id = $zona } -Servicio | Out-Null
    return $u.id
}
$s = Get-Random -Maximum 99999
$ids = @(); $rolJefe = $null
$rolEst = (Rest "roles?select=id&nombre=eq.Estacionero" -Servicio)[0].id
$rolDig = (Rest "roles?select=id&nombre=eq.Digitador%20de%20Campo" -Servicio)[0].id
$z = (Rest 'zonas?select=id,nombre&activo=eq.true&order=nombre&limit=1' -Servicio)[0]
$clave = "Qa-$(Get-Random)-x$(Get-Random)"
$qaId = $script:QA.id
$origRoles = @(foreach ($x in (Rest 'rpc/fn_roles_de_perfiles' 'Post' @{} -Servicio)) { if ($x.perfil_id -eq $qaId) { [int]$x.rol_id } })
$origPrincipal = (Rest "perfiles?select=rol_id&id=eq.$qaId" -Servicio)[0].rol_id
$idAdmin = (Rest 'roles?select=id&acceso_total=eq.true&limit=1' -Servicio)[0].id
try {
    $rolJefe = (Rest 'roles' 'Post' @{ codigo = "QA_JEFE_$s"; nombre = "QA Jefe $s" } -Servicio)[0].id
    foreach ($a in 'ver', 'editar', 'crear') { Rest 'permisos' 'Post' @{ rol_id = $rolJefe; recurso = 'usuarios'; accion = $a; alcance = 'zonal' } -Servicio | Out-Null }
    # Como lo haría el administrador en Permisos (la función exige administrador: se escribe con la llave de servicio)
    Rest 'rpc/fn_roles_administra' 'Post' @{} -Servicio | Out-Null
    $jefe = Nuevo "qa.jefe$s@desarrollo.local" $clave "QA Jefe Persona $s" $rolJefe $z.id; $ids += $jefe
    $est = Nuevo "qa.est$s@desarrollo.local" $clave "QA Estacionero $s" $rolEst $z.id; $ids += $est
    $dig = Nuevo "qa.dig$s@desarrollo.local" $clave "QA Digitador $s" $rolDig $z.id; $ids += $dig

    # Admin (usuario QA con acceso total TEMPORAL, se devuelve al final) configura la lista en Permisos con clics
    Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($origRoles + $idAdmin); p_principal = $origPrincipal } -Servicio | Out-Null
    Entrar-Como $script:QA.email $script:QA.clave | Out-Null
    Ir "/admin/permisos?r=$s"
    Esperar "!!document.querySelector('[data-administra-rol]')" 40000 | Out-Null
    ClicHasta "document.querySelector('[data-rol=QA_JEFE_$s]')" "!!document.querySelector('[data-administra-rol=""$rolJefe""]')" | Out-Null
    $t = Esperar "!!document.querySelector('[data-administra-rol=""$rolJefe""]')" 10000
    ClicEn "document.querySelector('[data-administra-rol=""$rolJefe""] [data-abrir-administra]')" | Out-Null
    Start-Sleep -Milliseconds 400
    ClicEn "document.querySelector('[data-administra-rol=""$rolJefe""] [data-opcion=Estacionero]')" | Out-Null
    ClicEn "document.querySelector('[data-administra-rol=""$rolJefe""] [data-guardar-administra]')" | Out-Null
    $t2 = Esperar "/Guardado/.test(document.querySelector('[data-administra-rol=""$rolJefe""] [data-estado-administra]')?.innerText || '')" 10000
    $lista = @(foreach ($x in (Rest 'rpc/fn_roles_administra' 'Post' @{} -Token (Entrar-Como $script:QA.email $script:QA.clave))) { if ($x.rol_id -eq $rolJefe) { $x } })
    OK ($t2 -ge 0 -and $lista.Count -eq 1 -and $lista[0].administra_rol_id -eq $rolEst) 'Permisos: el administrador marca «Jefe administra Estacionero» y guarda' "$($lista.Count) fila(s) · panel=$(JS "!!document.querySelector('[data-administra-rol=`"$rolJefe`"]')") · marcada=$(JS "document.querySelector('[data-administra-rol=`"$rolJefe`"] [data-opcion=Estacionero]')?.getAttribute('aria-checked')") · mensaje=$(JS "document.querySelector('[data-administra-rol=`"$rolJefe`"] [data-estado-administra]')?.innerText")"

    # El jefe entra a Usuarios
    Entrar-Como "qa.jefe$s@desarrollo.local" $clave | Out-Null
    Ir "/admin/usuarios?r=$s-j"
    $t = Esperar "!!document.querySelector('[data-resumen-usuarios]') && !!document.querySelector('[data-delegado-aviso]')" 40000
    if (JS "!!document.querySelector('[data-segmentos=vista] [data-opcion=lista][aria-pressed=false]')") { ClicEn "document.querySelector('[data-segmentos=vista] [data-opcion=lista]')" | Out-Null; Start-Sleep 1 }
    Esperar "document.querySelectorAll('[data-usuario]').length > 0" 20000 | Out-Null
    $correos = JS "[...new Set([...document.querySelectorAll('[data-usuario]')].map(b => b.dataset.usuario))].join(' ')"
    $tokDiag = Entrar-Como "qa.jefe$s@desarrollo.local" $clave
    $vis = @(foreach ($x in (Rest 'rpc/fn_personas_visibles' 'Post' @{} -Token $tokDiag)) { "$x" })
    $adm = @(foreach ($x in (Rest 'rpc/fn_roles_que_administro' 'Post' @{} -Token $tokDiag)) { "$x" })
    OK ($t -ge 0 -and $correos -match "qa.est$s@" -and $correos -notmatch "qa.dig$s@") 'El jefe ve al Estacionero de su zona y NO al Digitador' "pantalla: [$correos] · base visibles: est=$($vis -contains $est) dig=$($vis -contains $dig) · administra: $($adm -join ',') (Estacionero=$rolEst)"
    OK ((JS "document.querySelector('[data-delegado-aviso]').innerText") -match 'Estacionero') 'Le dice qué roles administra' (JS "document.querySelector('[data-delegado-aviso]').innerText")
    ClicHasta "[...document.querySelectorAll('[data-usuario]')].find(b => b.dataset.usuario.startsWith('qa.est$s@'))" "!!document.querySelector('[data-lista=roles]')" | Out-Null
    $rolesOfrecidos = JS "[...document.querySelectorAll('[data-lista=roles] [data-rol-opcion]')].map(b => b.innerText.trim()).join('|')"
    OK ($rolesOfrecidos -eq 'Estacionero') 'En la ficha solo puede dar el rol Estacionero' $rolesOfrecidos
    ClicEn "[...document.querySelectorAll('[role=dialog] button')].find(b => b.innerText.trim() === 'Cancelar')" | Out-Null

    # Por fuera de la pantalla: la base no lo deja tocar al digitador
    $tokJ = Entrar-Como "qa.jefe$s@desarrollo.local" $clave
    $bloqueo = $false; try { Rest 'rpc/fn_guardar_accesos_persona' 'Post' @{ p_perfil = $dig; p_zonas = @($z.id) } -Token $tokJ | Out-Null } catch { $bloqueo = $true }
    OK $bloqueo 'Aunque lo intente por fuera de la pantalla, la base no lo deja cambiar al Digitador'
    OK ((Errores-Pagina) -eq '') 'Sin errores en la página' (Errores-Pagina)
} catch { $script:Resultados.Add("EXCEPCION (línea $($_.InvocationInfo.ScriptLineNumber)) $($_.Exception.Message) $($_.ErrorDetails.Message)") }
finally {
    try { Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = $origRoles; p_principal = $origPrincipal } -Servicio | Out-Null } catch { $script:Resultados.Add("LIMPIEZA roles QA: $($_.Exception.Message)") }
    try { Entrar-Como $script:QA.email $script:QA.clave | Out-Null } catch {}
    foreach ($id in $ids) {
        try {
            Rest "perfiles_zonas?perfil_id=eq.$id" 'Delete' -Servicio | Out-Null
            Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $id; p_roles = @(); p_principal = $null } -Servicio -ErrorAction SilentlyContinue | Out-Null
        } catch {}
        try { Rest "perfiles?id=eq.$id" 'Delete' -Servicio | Out-Null; Invoke-RestMethod -Method Delete -Uri "$script:Url/auth/v1/admin/users/$id" -Headers @{ apikey = $script:Serv; Authorization = "Bearer $script:Serv" } | Out-Null } catch { $script:Resultados.Add("LIMPIEZA persona: $($_.Exception.Message)") }
    }
    if ($rolJefe) { try { Rest "permisos?rol_id=eq.$rolJefe" 'Delete' -Servicio | Out-Null; Rest "roles?id=eq.$rolJefe" 'Delete' -Servicio | Out-Null } catch { $script:Resultados.Add("LIMPIEZA rol: $($_.Exception.Message) $($_.ErrorDetails.Message)") } }
    $quedan = @(@(Rest "perfiles?select=id&nombre=like.QA*$s" -Servicio) | Where-Object { $_.id }).Count + @(@(Rest "roles?select=id&codigo=eq.QA_JEFE_$s" -Servicio) | Where-Object { $_.id }).Count
    OK ($quedan -eq 0) 'Limpieza: nada de la prueba queda en desarrollo' "restos $quedan"
    Terminar-QA
}
