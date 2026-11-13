# QA · Fertirriego · Terminar ciclo / Reactivar turno (sql/102) contra la base de DESARROLLO + copia en :3100.
# Lo que hace AGL (/TR02) se hace aquí con las mismas funciones y la sesión del usuario QA con rol de acceso total:
# exportar → archivar (borra de Supabase) → el teléfono ya no ve el turno → reactivar (vuelve igual).
# Todo en una estación de prueba; al final se borra y el usuario QA queda como estaba.
param([string]$Base = 'http://localhost:3100')
. "$PSScriptRoot\comun.ps1"
Iniciar-QA -Base $Base -Ancho 412 -Alto 915 -Movil

function Lista($ruta, $metodo = 'Get', $cuerpo = $null, [switch]$Usuario) {
    $r = if ($Usuario) { Rest $ruta $metodo $cuerpo } else { Rest $ruta $metodo $cuerpo -Servicio }
    $o = New-Object System.Collections.ArrayList; foreach ($x in $r) { if ($null -ne $x) { [void]$o.Add($x) } }; return ,$o
}
function ClicEn($js) { JS "(() => { const e = $js; if (!e) return false; e.scrollIntoView({block:'center'}); e.click(); return true })()" }
function ClicHasta($js, $condicion, [int]$veces = 15) { for ($i = 0; $i -lt $veces; $i++) { ClicEn $js | Out-Null; if ((Esperar $condicion 700) -ge 0) { return $true } }; return $false }
function Op($tipo, $datos) {
    @{ id = [guid]::NewGuid().ToString(); tipo = $tipo; creado_en = (Get-Date).ToString('o'); enviado_en = (Get-Date).ToString('o'); inmediato = $true
       dispositivo = 'QA'; ubicacion = @{ lat = 13.3; lon = -87.2; precision = 8 }; datos = $datos }
}
function Enviar($op) { (Lista 'rpc/fn_fert_sincronizar' 'Post' @{ p_ops = @($op) } -Usuario)[0] }
function AbrirCampo($sufijo) {
    Ir "/fertirriego?r=$s-$sufijo"
    Esperar "document.querySelector('[data-estacion]')?.dataset.estacion === '$EST'" 40000 | Out-Null
    Start-Sleep -Milliseconds 500
    Esperar "!!document.querySelector('[data-actualizar]') && !document.querySelector('[data-actualizar]').disabled" 40000 | Out-Null
    ClicHasta "document.querySelector('[data-pestana=turnos]')" "!!document.querySelector('[data-turno]')" | Out-Null
}

$s = Get-Random -Maximum 99999
$qaId = $script:QA.id
$orig = (Lista "perfiles?select=rol_id&id=eq.$qaId")[0]
$origRoles = @(foreach ($x in (Lista 'rpc/fn_roles_de_perfiles' 'Post' @{})) { if ($x.perfil_id -eq $qaId) { [int]$x.rol_id } })
$idAdmin = (Lista 'roles?select=id&acceso_total=eq.true&limit=1')[0].id
$z1 = (Lista 'zonas?select=id,nombre&activo=eq.true&order=nombre&limit=1')[0]
$EST = "QA Archivo $s"; $T1 = "TA1-$s"; $T2 = "TA2-$s"; $SOL = "QA-SOLA-$s"; $AGL1 = "TR-QAA1-$s"
$hoy = (Get-Date).ToString('yyyy-MM-dd')
$rolEst = $null; $estId = $null

try {
    # ============ Preparación (como AGL): estación, 2 turnos, plan, producto ============
    Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($orig.rol_id, $idAdmin); p_principal = $orig.rol_id } -Servicio | Out-Null
    $estId = (Rest 'estaciones_riego' 'Post' @{ nombre = $EST; zona_id = $z1.id } -Servicio)[0].id
    $siembra = (Get-Date).AddDays(-5).ToString('yyyy-MM-dd')
    Rest 'rpc/fn_fert_publicar' 'Post' @{ p = @{
        temporada = "QA $s"; estaciones = @(@{ nombre = $EST; zona = $z1.nombre })
        materiales = @(@{ codigo = $SOL; descripcion = "SOLUCION A $s"; unidad = 'L'; grupo = 'Fertilizantes'; analisis = $true })
        turnos = @(
            @{ agl_id = $AGL1; turno = $T1; temporada = "QA $s"; ciclo = 'Ciclo QA'; fecha_siembra = $siembra; estacion = $EST; zona = $z1.nombre; area_mz = 10; estado = 'Creado' },
            @{ agl_id = "TR-QAA2-$s"; turno = $T2; temporada = "QA $s"; ciclo = 'Ciclo QA'; fecha_siembra = $siembra; estacion = $EST; zona = $z1.nombre; area_mz = 10; estado = 'Creado' })
        plan = @(@{ agl_id = $AGL1; filas = @(@{ fecha = $hoy; ddt = 5; material = $SOL; cantidad = 120 }) })
    } } | Out-Null
    $solId = (Lista "materiales?select=id&codigo=eq.$SOL")[0].id
    $tc1 = (Lista "turnos_ciclo?select=id&agl_id=eq.$AGL1")[0].id
    Rest 'rpc/fn_fert_asignar_persona' 'Post' @{ p_estacion = $estId; p_perfil = $qaId; p_asignar = $true } | Out-Null
    Rest 'rpc/fn_fert_asignar_custodia' 'Post' @{ p_estacion = $estId; p_perfil = $qaId; p_motivo = 'Arranque QA' } | Out-Null

    # ============ El estacionero registra en el turno 1 ============
    $rolEst = (Rest 'roles' 'Post' @{ codigo = "QA_ESTA_$s"; nombre = "QA Estacionero A $s" } -Servicio)[0].id
    foreach ($a in 'ver', 'recibir', 'aplicar', 'contar') { Rest 'permisos' 'Post' @{ rol_id = $rolEst; recurso = 'fertirriego'; accion = $a; alcance = 'propietario' } -Servicio | Out-Null }
    Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($rolEst); p_principal = $rolEst } -Servicio | Out-Null
    $r1 = Enviar (Op 'conteo' @{ estacion_id = $estId; lineas = @(@{ material_id = $solId; cantidad_real = 500 }) })
    $apId = [guid]::NewGuid().ToString()
    $opAp = Op 'aplicacion' @{ estacion_id = $estId; turno_ciclo_id = $tc1; fecha = $hoy; ddt_plan = 5; fecha_plan = $hoy; lineas = @(@{ material_id = $solId; cantidad = 120 }) }
    $opAp.id = $apId
    $r2 = Enviar $opAp
    $r3 = Enviar (Op 'bitacora' @{ turno_ciclo_id = $tc1; fecha = $hoy; horas_riego = 6; ppm_cloro_cabezal = 1.2 })
    $saldo0 = [double](Lista "fert_saldos?select=disponible&estacion_id=eq.$estId&material_id=eq.$solId")[0].disponible
    OK ($r1.estado -like 'ACEPTADO*' -and $r2.estado -like 'ACEPTADO*' -and $r3.estado -like 'ACEPTADO*' -and $saldo0 -eq 380) 'El estacionero cuenta 500, aplica 120 en el turno 1 y anota horas: bodega 380' "$($r1.estado)/$($r2.estado)/$($r3.estado) · $saldo0"
    CDP 'Browser.grantPermissions' @{ permissions = @('geolocation'); origin = 'http://localhost:3100' } | Out-Null
    CDP 'Emulation.setGeolocationOverride' @{ latitude = 13.312; longitude = -87.195; accuracy = 12 } | Out-Null
    AbrirCampo 'a'
    OK ((JS "!!document.querySelector('[data-turno=""$T1""]')") -eq $true) 'El teléfono ve el turno 1 (en campo)'

    # ============ AGL: Terminar ciclo del turno 1 ============
    Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($rolEst, $idAdmin); p_principal = $rolEst } -Servicio | Out-Null
    $paquete = Rest 'rpc/fn_fert_exportar_turno' 'Post' @{ p_agl_id = $AGL1 }
    OK ($paquete.huella -and $paquete.filas) 'Paso 1: AGL baja el paquete completo del turno (con su huella)' "huella $("$($paquete.huella)".Substring(0, [Math]::Min(12, "$($paquete.huella)".Length)))…"
    $mal = $null; try { Rest 'rpc/fn_fert_archivar_turno' 'Post' @{ p_agl_id = $AGL1; p_huella = 'huella-equivocada' } | Out-Null } catch { $mal = $_.ErrorDetails.Message }
    OK ($null -ne $mal -and (Lista "fert_aplicaciones?select=id&turno_ciclo_id=eq.$tc1").Count -eq 1) 'Con una huella que no cuadra NO borra nada' "$mal"
    $arch = Rest 'rpc/fn_fert_archivar_turno' 'Post' @{ p_agl_id = $AGL1; p_huella = $paquete.huella }
    $apsDesp = (Lista "fert_aplicaciones?select=id&turno_ciclo_id=eq.$tc1").Count
    $bitDesp = (Lista "fert_bitacora_riego?select=fecha&turno_ciclo_id=eq.$tc1").Count
    $planDesp = (Lista "fert_plan?select=id&turno_ciclo_id=eq.$tc1").Count
    OK ($apsDesp -eq 0 -and $bitDesp -eq 0 -and $planDesp -eq 0) 'Paso 2: Supabase ya no guarda aplicaciones, horas ni plan del turno 1' "aplicaciones $apsDesp · horas $bitDesp · plan $planDesp"
    $saldo1 = [double](Lista "fert_saldos?select=disponible&estacion_id=eq.$estId&material_id=eq.$solId")[0].disponible
    $resumen = Lista "fert_movimientos?select=tipo,cantidad&estacion_id=eq.$estId&tipo=eq.ARCHIVO_TURNO"
    OK ($saldo1 -eq $saldo0 -and $resumen.Count -eq 1) 'La bodega de la estación NO cambia (380) y queda un movimiento resumen' "$saldo1 · resumen $($resumen.Count)"
    $tcEstado = (Lista "turnos_ciclo?select=activo,archivado_at&id=eq.$tc1")[0]
    OK ($tcEstado.activo -eq $false -and $tcEstado.archivado_at) 'El turno queda «Ciclo terminado» (inactivo y archivado)'
    $otraVez = Rest 'rpc/fn_fert_archivar_turno' 'Post' @{ p_agl_id = $AGL1; p_huella = $paquete.huella }
    OK ($null -ne $otraVez) 'Terminar otra vez: responde que ya estaba, sin errores'

    # ============ El teléfono ya no lo ve; lo enviado tarde se rechaza claro ============
    Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($rolEst); p_principal = $rolEst } -Servicio | Out-Null
    AbrirCampo 'b'
    OK ((JS "!document.querySelector('[data-turno=""$T1""]') && !!document.querySelector('[data-turno=""$T2""]')") -eq $true) 'El teléfono ya no ve el turno 1 (el 2 sigue)'
    ClicHasta "document.querySelector('[data-pestana=bitacora]')" "!!document.querySelector('[data-movimiento]')" | Out-Null
    $bit = JS "document.body.textContent"
    OK ($bit -match 'Turno terminado') 'La bitácora explica el movimiento: «Turno terminado (archivado en AGL)»'
    $tarde = Enviar (Op 'aplicacion' @{ estacion_id = $estId; turno_ciclo_id = $tc1; fecha = $hoy; lineas = @(@{ material_id = $solId; cantidad = 10 }) })
    OK ($tarde.estado -eq 'RECHAZADO' -and $tarde.mensaje) 'Una aplicación tardía (sin señal) al turno terminado se rechaza con un mensaje claro' "$($tarde.mensaje)"

    # ============ AGL: Reactivar ============
    Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($rolEst, $idAdmin); p_principal = $rolEst } -Servicio | Out-Null
    $rest = Rest 'rpc/fn_fert_restaurar_turno' 'Post' @{ p = $paquete }
    $aps = Lista "fert_aplicaciones?select=id&turno_ciclo_id=eq.$tc1"
    $saldo2 = [double](Lista "fert_saldos?select=disponible&estacion_id=eq.$estId&material_id=eq.$solId")[0].disponible
    $resumen2 = (Lista "fert_movimientos?select=id&estacion_id=eq.$estId&tipo=eq.ARCHIVO_TURNO").Count
    OK ($aps.Count -eq 1 -and $aps[0].id -eq $apId -and (Lista "fert_bitacora_riego?select=fecha&turno_ciclo_id=eq.$tc1").Count -eq 1 -and (Lista "fert_plan?select=id&turno_ciclo_id=eq.$tc1").Count -eq 1) 'Reactivar: vuelven la aplicación (mismo id), las horas y el plan'
    OK ($saldo2 -eq $saldo0 -and $resumen2 -eq 0 -and (Lista "turnos_ciclo?select=activo&id=eq.$tc1")[0].activo -eq $true) 'Reactivar: la bodega sigue en 380, sin movimiento resumen y el turno activo'
    $dos = $null; try { Rest 'rpc/fn_fert_restaurar_turno' 'Post' @{ p = $paquete } | Out-Null; $dos = 'ok' } catch { $dos = $_.ErrorDetails.Message }
    OK ((Lista "fert_aplicaciones?select=id&turno_ciclo_id=eq.$tc1").Count -eq 1) 'Reactivar dos veces no duplica nada' "$dos"
    Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($rolEst); p_principal = $rolEst } -Servicio | Out-Null
    AbrirCampo 'c'
    OK ((JS "!!document.querySelector('[data-turno=""$T1""]')") -eq $true) 'El teléfono vuelve a ver el turno 1'
    $e = Errores-Pagina; OK (-not $e) 'Sin errores en la página' $e
}
catch { $script:Resultados.Add("EXCEPCION $($_.Exception.Message) $($_.ErrorDetails.Message)") }
finally {
    try {
        if ($estId) {
            foreach ($t in 'fert_movimientos', 'fert_saldos', 'fert_bitacora_riego', 'fert_custodia', 'fert_relevos', 'fert_envases_movimientos') { Rest "${t}?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null }
            foreach ($x in (Lista "fert_aplicaciones?select=id&estacion_id=eq.$estId")) { Rest "fert_aplicaciones_detalle?aplicacion_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null }
            Rest "fert_aplicaciones?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            foreach ($x in (Lista "fert_conteos?select=id&estacion_id=eq.$estId")) { Rest "fert_conteos_detalle?conteo_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null }
            Rest "fert_conteos?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            Rest "fert_operaciones?perfil_id=eq.$qaId&recibido_en=gte.$((Get-Date).AddHours(-3).ToString('yyyy-MM-ddTHH:mm:ss'))-06:00" 'Delete' -Servicio | Out-Null
            foreach ($x in (Lista "turnos_ciclo?select=id,turno_id&agl_id=in.($AGL1,TR-QAA2-$s)")) { Rest "fert_plan?turno_ciclo_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null; Rest "turnos_ciclo?id=eq.$($x.id)" 'Delete' -Servicio | Out-Null; Rest "turnos?id=eq.$($x.turno_id)" 'Delete' -Servicio | Out-Null }
            Rest "perfiles_estaciones?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            Rest "estaciones_riego?id=eq.$estId" 'Delete' -Servicio | Out-Null
        }
        Rest "materiales?codigo=eq.$SOL" 'Delete' -Servicio | Out-Null
        Rest "fert_publicaciones?temporada=eq.$([uri]::EscapeDataString("QA $s"))" 'Delete' -Servicio | Out-Null
    } catch { $script:Resultados.Add("LIMPIEZA datos: $($_.Exception.Message) $($_.ErrorDetails.Message)") }
    try { Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = $origRoles; p_principal = $orig.rol_id } -Servicio | Out-Null } catch { $script:Resultados.Add("LIMPIEZA roles QA: $($_.Exception.Message)") }
    try { if ($rolEst) { Rest "permisos?rol_id=eq.$rolEst" 'Delete' -Servicio | Out-Null; Rest "roles?id=eq.$rolEst" 'Delete' -Servicio | Out-Null } } catch { $script:Resultados.Add("LIMPIEZA rol: $($_.Exception.Message) $($_.ErrorDetails.Message)") }
    try {
        $ahora = @(foreach ($x in (Lista 'rpc/fn_roles_de_perfiles' 'Post' @{})) { if ($x.perfil_id -eq $qaId) { [int]$x.rol_id } }) | Sort-Object
        $queda = (Lista "estaciones_riego?select=id&nombre=eq.$([uri]::EscapeDataString($EST))").Count + (Lista "materiales?select=id&codigo=eq.$SOL").Count
        OK ((($ahora -join ',') -eq (($origRoles | Sort-Object) -join ',')) -and $queda -eq 0) 'Limpieza: nada de la prueba queda en desarrollo y el usuario QA está como estaba' "roles $($ahora -join ','), restos $queda"
    } catch { $script:Resultados.Add("LIMPIEZA verificación: $($_.Exception.Message)") }
    Terminar-QA
}
