# QA - Fertirriego: ubicacion GPS opcional (commit 7b316a3). Servidor en :3108 + base de DESARROLLO.
# Crea usuario QA temporal, estacion, turno, plan y productos; al final borra todo.
param([string]$Base = 'http://localhost:3108', [int]$PuertoCdp = 9348)
. "$PSScriptRoot\comun.ps1"

# ---------------------------------------------------------------- usuario QA temporal
$envQa = Leer-Entorno
$URLB = $envQa['NEXT_PUBLIC_SUPABASE_URL']; $SERV = $envQa['SUPABASE_SERVICE_ROLE_KEY']
$hServ = @{ apikey = $SERV; Authorization = "Bearer $SERV" }
$s = Get-Random -Maximum 99999
$qaEmail = "qa.gps.$([guid]::NewGuid().ToString('N').Substring(0,10))@desarrollo.local"; $qaClave = "Qa-$(Get-Random)-x$(Get-Random)"
$archivoQa = "$PSScriptRoot\qa_usuario.local.json"
$qaId = $null; $estId = $null; $rolEst = $null
$usr = Invoke-RestMethod -Method Post -Uri "$URLB/auth/v1/admin/users" -Headers $hServ -ContentType 'application/json' -Body (@{ email = $qaEmail; password = $qaClave; email_confirm = $true } | ConvertTo-Json)
$qaId = $usr.id
$rolTotal = (Invoke-RestMethod "$URLB/rest/v1/roles?select=id&acceso_total=eq.true&order=id&limit=1" -Headers $hServ)[0].id
Invoke-RestMethod -Method Post "$URLB/rest/v1/perfiles" -Headers $hServ -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes((@{ id = $qaId; nombre = "QA Gps $s"; rol_id = $rolTotal; todas_las_zonas = $true } | ConvertTo-Json))) | Out-Null
@{ id = $qaId; email = $qaEmail; clave = $qaClave } | ConvertTo-Json | Set-Content -Encoding utf8 $archivoQa

Iniciar-QA -Base $Base -Ancho 412 -Alto 915 -Movil -Puerto $PuertoCdp

function Lista($ruta, $metodo = 'Get', $cuerpo = $null) {
    $r = Rest $ruta $metodo $cuerpo -Servicio
    $o = New-Object System.Collections.ArrayList; foreach ($x in $r) { if ($null -ne $x) { [void]$o.Add($x) } }; return ,$o
}
function ClicEn($js) { JS "(() => { const e = $js; if (!e) return false; e.scrollIntoView({block:'center'}); e.click(); return true })()" }
function ClicHasta($js, $condicion, [int]$veces = 15) { for ($i = 0; $i -lt $veces; $i++) { ClicEn $js | Out-Null; if ((Esperar $condicion 700) -ge 0) { return $true } }; return $false }
$ULTIMO_DIALOGO = "[...document.querySelectorAll('[role=dialog]')].pop()"
function ElegirOpcion($selectorBoton, $texto) {
    ClicHasta "document.querySelector('$selectorBoton')" "document.querySelectorAll('[role=dialog]').length > 0 && !!$ULTIMO_DIALOGO.querySelector('input[inputmode=search]')" | Out-Null
    $ok = ClicEn "[...$ULTIMO_DIALOGO.querySelectorAll('button')].find(b => b.innerText.trim().startsWith('$texto'))"
    Start-Sleep -Milliseconds 400
    return $ok
}
function Pendientes { [int](JS "Number((document.querySelector('[data-pendientes-cuenta]')?.innerText.match(/\d+/) || [0])[0])") }
function Cant($cod) { "document.querySelector('[data-linea-codigo=""$cod""] [data-cantidad]')" }
function AbrirAplicar { ClicHasta "document.querySelector('[data-accion=aplicar]')" "!!document.querySelector('[data-selector-turno]')" | Out-Null; Start-Sleep -Milliseconds 800 }
function Alerta { JS "!!document.querySelector('[data-alerta-sin-inventario]')" }
function Casilla { JS "document.querySelector('[data-acepta-negativo]')?.checked === true" }
function FormAbierto { JS "!!document.querySelector('[data-selector-turno]')" }
function Guardar { ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null; Start-Sleep -Milliseconds 1200 }
function EsperarSync { Start-Sleep -Milliseconds 1500; Esperar "!document.querySelector('[data-pendientes-cuenta]')" 80000 }

$EST = "QA Estacion $s"; $TURNO = "TQA-$s"; $SOL = "QA-SOL-$s"; $ACI = "QA-ACI-$s"
$hoy = (Get-Date).ToString('yyyy-MM-dd'); $ayer = (Get-Date).AddDays(-1).ToString('yyyy-MM-dd')
$z1 = (Lista 'zonas?select=id,nombre&activo=eq.true&order=nombre&limit=1')[0]

try {
    # ============ Preparacion ============
    $estId = (Rest 'estaciones_riego' 'Post' @{ nombre = $EST; zona_id = $z1.id } -Servicio)[0].id
    $pub = Rest 'rpc/fn_fert_publicar' 'Post' @{ p = @{
        temporada = "QA $s"
        estaciones = @(@{ nombre = $EST; zona = $z1.nombre })
        materiales = @(@{ codigo = $SOL; descripcion = "SOLUCION QA $s NITRATO DE CALCIO GRANULAR ESTANDAR CON MICRONUTRIENTES QUELATADOS SACO 25 KG"; unidad = 'L'; grupo = '1800' }, @{ codigo = $ACI; descripcion = "ACIDO QA $s"; unidad = 'L'; grupo = '1800' })
        turnos = @(@{ agl_id = "TR-QA-$s"; turno = $TURNO; temporada = "QA $s"; ciclo = 'Ciclo QA'; fecha_siembra = (Get-Date).AddDays(-5).ToString('yyyy-MM-dd'); estacion = $EST; zona = $z1.nombre; area_mz = 10; estado = 'Creado' })
        plan = @(@{ agl_id = "TR-QA-$s"; filas = @(
            @{ fecha = $hoy; ddt = 5; material = $SOL; cantidad = 120 }, @{ fecha = $hoy; ddt = 5; material = $ACI; cantidad = 4 },
            @{ fecha = $ayer; ddt = 4; material = $SOL; cantidad = 100 }) })
    } }
    OK ($pub.turnos -eq 1 -and $pub.filas_plan -eq 3) 'Preparacion: turno, plan y productos de prueba publicados' "turnos $($pub.turnos), plan $($pub.filas_plan)"
    Rest 'perfiles_estaciones' 'Post' @{ perfil_id = $qaId; estacion_id = $estId } -Servicio | Out-Null

    # Jefe: asigna la estacion al usuario QA
    Ir "/fertirriego?r=$s"
    $t = Esperar "!!document.querySelector('[data-barra-estado]') && !!document.querySelector('[data-estacion]')" 60000
    OK ($t -ge 0) 'Abre Fertirriego' "$t ms"
    ElegirOpcion '[data-selector-estacion] button' $EST | Out-Null
    Esperar "document.querySelector('[data-estacion]')?.dataset.estacion === '$EST'" 10000 | Out-Null
    ClicHasta "document.querySelector('[data-asignar-custodia]')" "!!document.querySelector('[data-selector-custodio]')" | Out-Null
    ElegirOpcion '[data-selector-custodio] button' "QA Gps $s" | Out-Null
    Teclear "document.querySelector('[data-motivo-custodia]')" 'Arranque QA'
    ClicEn "document.querySelector('[data-guardar-custodia]')" | Out-Null
    $t = Esperar "/a tu cargo/.test(document.querySelector('[data-custodia]')?.innerText || '')" 20000
    OK ($t -ge 0) 'Custodia asignada al usuario QA'

    # Pasa a estacionero
    $rolEst = (Rest 'roles' 'Post' @{ codigo = "QA_EST_$s"; nombre = "QA Estacionero $s" } -Servicio)[0].id
    foreach ($a in 'ver', 'recibir', 'aplicar', 'contar', 'relevo') { Rest 'permisos' 'Post' @{ rol_id = $rolEst; recurso = 'fertirriego'; accion = $a; alcance = 'propietario' } -Servicio | Out-Null }
    Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($rolEst); p_principal = $rolEst } -Servicio | Out-Null
    Ir "/fertirriego?r=$s-b"
    $t = Esperar "document.querySelector('[data-estacion]')?.dataset.estacion === '$EST'" 60000
    OK ($t -ge 0) 'El estacionero ve su estacion' "$t ms"

    # Ubicacion denegada: el estado debe ser 'denied'
    CDP 'Browser.setPermission' @{ permission = @{ name = 'geolocation' }; setting = 'denied'; origin = $Base } | Out-Null
    Write-Host 'denegado'
    $st = JS "navigator.permissions.query({name:'geolocation'}).then(p => p.state)"
    OK ($st -eq 'denied') 'Permiso de ubicacion DENEGADO (permissions.query)' "$st"
    Captura 'fert_ubicacion_inicio_412.png'

    function ConteoNuevo($v1, $v2) {
        ClicHasta "document.querySelector('[data-accion=contar]')" "!!document.querySelector('[data-conteo]')" | Out-Null
        Teclear "document.querySelector('[data-conteo-material=""$SOL""] input')" $v1
        Teclear "document.querySelector('[data-conteo-material=""$ACI""] input')" $v2
        Start-Sleep -Milliseconds 800
    }
    # ============ (1) Denegado ============
    ConteoNuevo '10' '10'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    $aviso = ''
    for ($i = 0; $i -lt 30; $i++) { $aviso = JS "document.querySelector('[data-aviso]')?.textContent || ''"; if ($aviso -match 'ubicaci') { break }; Start-Sleep -Milliseconds 200 }
    $t = Esperar "!document.querySelector('[data-conteo]')" 10000
    OK ($t -ge 0) '1: con ubicacion denegada el formulario CIERRA' "$t ms"
    $texto = JS "document.body.innerText"
    OK ($texto -notmatch 'hay que permitir la ubicaci') '1: NO aparece el mensaje "Para registrar hay que permitir la ubicacion"'
    OK ($aviso -match 'sin ubicaci') '1: el aviso de guardado menciona "sin ubicacion"' $aviso
    Captura 'fert_ubicacion_denegado_412.png'
    $t = EsperarSync
    $o1 = Lista "fert_operaciones?select=tipo,resultado,observaciones,lat,lon&perfil_id=eq.$qaId&tipo=eq.conteo&order=recibido_en.asc"
    $r1 = $o1[0]
    OK ($t -ge 0 -and $o1.Count -eq 1 -and $null -eq $r1.lat -and $null -eq $r1.lon -and "$($r1.observaciones)" -match 'SIN_UBICACION' -and $r1.resultado -like 'ACEPTADO*') '1: la operacion llego con lat/lon nulos y observacion SIN_UBICACION' "n $($o1.Count) / $($r1.resultado) / $($r1.observaciones) / $($r1.lat),$($r1.lon)"

    # ============ (2) Concedido con ubicacion simulada ============
    CDP 'Browser.setPermission' @{ permission = @{ name = 'geolocation' }; setting = 'granted'; origin = $Base } | Out-Null
    CDP 'Browser.grantPermissions' @{ permissions = @('geolocation'); origin = $Base } | Out-Null
    CDP 'Emulation.setGeolocationOverride' @{ latitude = 13.312; longitude = -87.195; accuracy = 12 } | Out-Null
    Write-Host 'concedido'
    ConteoNuevo '11' '11'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    $aviso2 = ''
    for ($i = 0; $i -lt 30; $i++) { $aviso2 = JS "document.querySelector('[data-aviso]')?.textContent || ''"; if ($aviso2 -match 'Guardado en el') { break }; Start-Sleep -Milliseconds 200 }
    $t = Esperar "!document.querySelector('[data-conteo]')" 10000
    OK ($t -ge 0) '2: con ubicacion concedida el formulario cierra'
    OK ($aviso2 -notmatch 'sin ubicaci') '2: el aviso NO dice "sin ubicacion"' $aviso2
    $t = EsperarSync
    $o2 = Lista "fert_operaciones?select=tipo,resultado,observaciones,lat,lon&perfil_id=eq.$qaId&tipo=eq.conteo&order=recibido_en.asc"
    $r2 = $o2[$o2.Count - 1]
    OK ($t -ge 0 -and $o2.Count -eq 2 -and [math]::Abs([double]$r2.lat - 13.312) -lt 0.001 -and [math]::Abs([double]$r2.lon + 87.195) -lt 0.001 -and "$($r2.observaciones)" -notmatch 'SIN_UBICACION') '2: la operacion lleva lat/lon y NO tiene SIN_UBICACION' "n $($o2.Count) / $($r2.observaciones) / $($r2.lat),$($r2.lon)"

    # ============ (3) Sin senal ============
    CDP 'Network.enable' @{} | Out-Null
    CDP 'Network.emulateNetworkConditions' @{ offline = $true; latency = 0; downloadThroughput = -1; uploadThroughput = -1 } | Out-Null
    Write-Host 'offline'
    ConteoNuevo '12' '12'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    $t = Esperar "!document.querySelector('[data-conteo]')" 10000
    OK ($t -ge 0) '3: sin senal el formulario cierra (se guarda en el telefono)'
    Start-Sleep -Milliseconds 2000
    $pend = Pendientes
    $enBase = (Lista "fert_operaciones?select=id&perfil_id=eq.$qaId&tipo=eq.conteo").Count
    OK ($pend -ge 1 -and $enBase -eq 2) '3: queda pendiente en el telefono y aun no llega a la base' "pendientes $pend, en base $enBase"
    Captura 'fert_ubicacion_sinsenal_412.png'
    CDP 'Network.emulateNetworkConditions' @{ offline = $false; latency = 0; downloadThroughput = -1; uploadThroughput = -1 } | Out-Null
    Write-Host 'online'
    $t = EsperarSync
    $o3 = Lista "fert_operaciones?select=tipo,resultado,observaciones,lat,lon&perfil_id=eq.$qaId&tipo=eq.conteo&order=recibido_en.asc"
    OK ($t -ge 0 -and $o3.Count -eq 3 -and $o3[2].resultado -like 'ACEPTADO*') '3: al volver la senal el registro llega a la base' "n $($o3.Count) / $($o3[2].resultado) / $($o3[2].lat)"
    $rech = (Lista "fert_operaciones?select=id&perfil_id=eq.$qaId&resultado=eq.RECHAZADO").Count
    OK ($rech -eq 0) 'Ninguna operacion rechazada' "rechazadas $rech"
    $ancho = JS "document.documentElement.scrollWidth"
    OK ($ancho -le 420) 'Telefono: sin desplazamiento lateral' "scrollWidth $ancho"
    $e = Errores-Pagina; OK (-not $e) '4: sin errores en la pagina' $e
}
catch { $script:Resultados.Add("EXCEPCION (linea $($_.InvocationInfo.ScriptLineNumber)) $($_.Exception.Message) $($_.ErrorDetails.Message)") }
finally {
    # ---- Limpieza: todo lo de la estacion de prueba y el usuario QA temporal ----
    try {
        if ($estId) {
            foreach ($t in 'fert_movimientos', 'fert_saldos', 'fert_bitacora_riego', 'fert_custodia', 'fert_relevos') { Rest "${t}?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null }
            foreach ($x in (Lista "fert_devoluciones?select=id&estacion_id=eq.$estId")) { Rest "fert_devoluciones_detalle?devolucion_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null }
            Rest "fert_devoluciones?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            foreach ($x in (Lista "fert_aplicaciones?select=id&estacion_id=eq.$estId")) { Rest "fert_aplicaciones_detalle?aplicacion_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null }
            Rest "fert_aplicaciones?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            foreach ($x in (Lista "fert_recepciones?select=id&estacion_id=eq.$estId")) { Rest "fert_recepciones_detalle?recepcion_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null }
            Rest "fert_recepciones?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            foreach ($x in (Lista "fert_conteos?select=id&estacion_id=eq.$estId")) { Rest "fert_conteos_detalle?conteo_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null }
            Rest "fert_conteos?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            if ($qaId) { Rest "fert_operaciones?perfil_id=eq.$qaId" 'Delete' -Servicio | Out-Null }
            $tc = Lista "turnos_ciclo?select=id,turno_id&agl_id=eq.TR-QA-$s"
            foreach ($x in $tc) { Rest "fert_plan?turno_ciclo_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null; Rest "turnos_ciclo?id=eq.$($x.id)" 'Delete' -Servicio | Out-Null; Rest "turnos?id=eq.$($x.turno_id)" 'Delete' -Servicio | Out-Null }
            Rest "perfiles_estaciones?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            Rest "estaciones_riego?id=eq.$estId" 'Delete' -Servicio | Out-Null
        }
        foreach ($c in $SOL, $ACI) { Rest "materiales?codigo=eq.$c" 'Delete' -Servicio | Out-Null }
        Rest "fert_publicaciones?temporada=eq.$([uri]::EscapeDataString("QA $s"))" 'Delete' -Servicio | Out-Null
    } catch { $script:Resultados.Add("LIMPIEZA datos: $($_.Exception.Message) $($_.ErrorDetails.Message)") }
    try { if ($rolEst) { Rest "permisos?rol_id=eq.$rolEst" 'Delete' -Servicio | Out-Null } } catch { $script:Resultados.Add("LIMPIEZA permisos rol: $($_.Exception.Message)") }
    try {
        if ($qaId) {
            foreach ($t in 'perfiles_zonas', 'perfiles_estaciones', 'fert_llaves') { Rest "${t}?perfil_id=eq.$qaId" 'Delete' -Servicio | Out-Null }
            try { Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($rolTotal); p_principal = $rolTotal } -Servicio | Out-Null } catch {}
            Rest "perfiles?id=eq.$qaId" 'Delete' -Servicio | Out-Null
            Invoke-RestMethod -Method Delete -Uri "$URLB/auth/v1/admin/users/$qaId" -Headers $hServ | Out-Null
        }
    } catch { $script:Resultados.Add("LIMPIEZA usuario QA: $($_.Exception.Message) $($_.ErrorDetails.Message)") }
    try { if ($rolEst) { Rest "roles?id=eq.$rolEst" 'Delete' -Servicio | Out-Null } } catch { $script:Resultados.Add("LIMPIEZA rol: $($_.Exception.Message)") }
    Remove-Item $archivoQa -ErrorAction SilentlyContinue
    try {
        $quedaUsr = 0; try { Invoke-RestMethod "$URLB/auth/v1/admin/users/$qaId" -Headers $hServ | Out-Null; $quedaUsr = 1 } catch {}
        $restos = (Lista "perfiles?select=id&id=eq.$qaId").Count + (Lista "estaciones_riego?select=id&nombre=eq.$([uri]::EscapeDataString($EST))").Count + (Lista "materiales?select=id&codigo=in.($SOL,$ACI)").Count + (Lista "turnos_ciclo?select=id&agl_id=eq.TR-QA-$s").Count + $(if ($rolEst) { (Lista "roles?select=id&id=eq.$rolEst").Count } else { 0 })
        OK ($quedaUsr -eq 0 -and $restos -eq 0) 'Limpieza: usuario QA temporal y datos de prueba borrados de desarrollo' "usuario $quedaUsr, restos $restos"
    } catch { $script:Resultados.Add("LIMPIEZA verificacion: $($_.Exception.Message)") }
    Terminar-QA
}
