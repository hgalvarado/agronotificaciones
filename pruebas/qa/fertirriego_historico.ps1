# QA - Fertirriego: registro historico (sql/116). Servidor en :3103 + base de DESARROLLO.
# REQUIERE que la base de desarrollo YA tenga corrida la sql/116 (al escribir este archivo todavia NO estaba corrida: no se ha podido ejecutar).
# Crea un usuario QA temporal (rol con acceso total, 412 px), una estacion de prueba con turno (siembra hace 12 dias), plan y un
# producto; al final borra todo por id exacto.
# Casos: (1) sin permiso no hay boton «Registrar historico»; (2) el administrador otorga el permiso (persona + estacion + fecha limite)
# y aparece VIGENTE; (3) la persona ve el boton y los dias que le quedan; (4) el formulario: alerta azul fija arriba «NO mueve el
# inventario», fecha maxima = ayer, sin «Hoy», sin alerta de inventario aunque el saldo sea 0; (5) guardar: llega a la base con
# historica = true y SIN movimientos ni saldos; (6) bitacora: fila con insignia «Historico» y el detalle dice «No movio el inventario»,
# sin «Devolver sobrante»; (7) anular con motivo: queda anulada y sigue sin movimientos; (8) sin senal: queda en la cola, el saldo local
# no cambia y al volver la senal llega; (9) revocar: el boton desaparece y la base rechaza; (10) vencido: igual.
param([string]$Base = 'http://localhost:3103', [int]$PuertoCdp = 9337)
. "$PSScriptRoot\comun.ps1"

$envQa = Leer-Entorno
$URLB = $envQa['NEXT_PUBLIC_SUPABASE_URL']; $SERV = $envQa['SUPABASE_SERVICE_ROLE_KEY']
$hServ = @{ apikey = $SERV; Authorization = "Bearer $SERV" }
$s = Get-Random -Maximum 99999
$qaEmail = "qa.his.$([guid]::NewGuid().ToString('N').Substring(0,10))@desarrollo.local"; $qaClave = "Qa-$(Get-Random)-x$(Get-Random)"
$archivoQa = "$PSScriptRoot\qa_usuario.local.json"
$qaId = $null; $estId = $null
$usr = Invoke-RestMethod -Method Post -Uri "$URLB/auth/v1/admin/users" -Headers $hServ -ContentType 'application/json' -Body (@{ email = $qaEmail; password = $qaClave; email_confirm = $true } | ConvertTo-Json)
$qaId = $usr.id
$rolTotal = (Invoke-RestMethod "$URLB/rest/v1/roles?select=id&acceso_total=eq.true&order=id&limit=1" -Headers $hServ)[0].id
$NOMBRE = "QA Historico $s"
Invoke-RestMethod -Method Post "$URLB/rest/v1/perfiles" -Headers $hServ -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes((@{ id = $qaId; nombre = $NOMBRE; rol_id = $rolTotal; todas_las_zonas = $true } | ConvertTo-Json))) | Out-Null
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
function EsperarSync { Start-Sleep -Milliseconds 1500; Esperar "!document.querySelector('[data-pendientes-cuenta]')" 80000 }
function Pendientes { [int](JS "Number((document.querySelector('[data-pendientes-cuenta]')?.innerText.match(/\d+/) || [0])[0])") }
function Cant($cod) { "document.querySelector('[data-linea-codigo=""$cod""] [data-cantidad]')" }
function Guardar { ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null; Start-Sleep -Milliseconds 1200 }
function AbrirEstacion {
    Ir "/fertirriego?r=$s-$(Get-Random)"
    $t = Esperar "!!document.querySelector('[data-barra-estado]') && !!document.querySelector('[data-estacion]')" 60000
    ElegirOpcion '[data-selector-estacion] button' $EST | Out-Null
    Esperar "document.querySelector('[data-estacion]')?.dataset.estacion === '$EST'" 10000 | Out-Null
    return $t
}
function CampoFecha($valor) {
    JS "(() => { const el = document.querySelector('[data-fecha]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, '$valor'); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); return el.value })()"
}
function SincronizarRpc($id, $fecha, $matId, $tcId) {
    $op = @(@{ id = $id; tipo = 'aplicacion_historica'; creado_en = (Get-Date).ToUniversalTime().ToString('o'); enviado_en = (Get-Date).ToUniversalTime().ToString('o'); inmediato = $true
               ubicacion = @{ lat = 13.3; lon = -87.2 }
               datos = @{ estacion_id = $estId; turno_ciclo_id = $tcId; fecha = $fecha; extra = $true; lineas = @(@{ material_id = $matId; cantidad = 1 }) } })
    $r = Rest 'rpc/fn_fert_sincronizar' 'Post' @{ p_ops = $op }
    return $r
}

$EST = "QA Estacion $s"; $TURNO = "TQA-$s"; $SOL = "QA-SOL-$s"
$hoy = (Get-Date).ToString('yyyy-MM-dd'); $ayer = (Get-Date).AddDays(-1).ToString('yyyy-MM-dd'); $antier = (Get-Date).AddDays(-2).ToString('yyyy-MM-dd')
$hasta7 = (Get-Date).AddDays(7).ToString('yyyy-MM-dd')
$z1 = (Lista 'zonas?select=id,nombre&activo=eq.true&order=nombre&limit=1')[0]

try {
    # ============ Preparacion ============
    $estId = (Rest 'estaciones_riego' 'Post' @{ nombre = $EST; zona_id = $z1.id } -Servicio)[0].id
    $pub = Rest 'rpc/fn_fert_publicar' 'Post' @{ p = @{
        temporada = "QA $s"
        estaciones = @(@{ nombre = $EST; zona = $z1.nombre })
        materiales = @(@{ codigo = $SOL; descripcion = "SOLUCION QA $s"; unidad = 'L'; grupo = '1800' })
        turnos = @(@{ agl_id = "TR-QA-$s"; turno = $TURNO; temporada = "QA $s"; ciclo = 'Ciclo QA'; fecha_siembra = (Get-Date).AddDays(-12).ToString('yyyy-MM-dd'); estacion = $EST; zona = $z1.nombre; area_mz = 10; estado = 'Creado' })
        plan = @(@{ agl_id = "TR-QA-$s"; filas = @(@{ fecha = $ayer; ddt = 11; material = $SOL; cantidad = 100 }, @{ fecha = $hoy; ddt = 12; material = $SOL; cantidad = 100 }) })
    } }
    OK ($pub.turnos -eq 1 -and $pub.filas_plan -eq 2) 'Preparacion: turno, plan y producto de prueba publicados' "turnos $($pub.turnos), plan $($pub.filas_plan)"
    Rest 'perfiles_estaciones' 'Post' @{ perfil_id = $qaId; estacion_id = $estId } -Servicio | Out-Null
    $solId = (Lista "materiales?select=id&codigo=eq.$SOL")[0].id
    $tcId = (Lista "turnos_ciclo?select=id&agl_id=eq.TR-QA-$s")[0].id
    CDP 'Browser.grantPermissions' @{ permissions = @('geolocation'); origin = $Base } | Out-Null
    CDP 'Emulation.setGeolocationOverride' @{ latitude = 13.312; longitude = -87.195; accuracy = 12 } | Out-Null
    CDP 'Network.enable' | Out-Null

    # ============ Caso 1: sin permiso no hay boton ============
    $t = AbrirEstacion
    OK ($t -ge 0) 'Abre Fertirriego' "$t ms"
    OK ((JS "!document.querySelector('[data-accion=historico]')") -eq $true) 'Caso 1: sin permiso NO aparece «Registrar historico»'

    # ============ Caso 2: el administrador otorga ============
    Ir "/admin/fertirriego-historico?r=$s"
    $t = Esperar "!!document.querySelector('[data-registro-historico-admin]') && !!document.querySelector('[data-sel-persona] button')" 60000
    OK ($t -ge 0) 'Caso 2: abre Administracion > Registro historico' "$t ms"
    ElegirOpcion '[data-sel-persona] button' $NOMBRE | Out-Null
    ClicEn "document.querySelector('[data-opcion=""$EST""]')" | Out-Null
    Start-Sleep -Milliseconds 300
    OK ((JS "document.querySelector('[data-opcion=""$EST""]')?.getAttribute('aria-checked')") -eq 'true') 'Caso 2: estacion marcada'
    Teclear "document.querySelector('[data-nota-historico]')" 'QA aplicaciones de antes'
    # Sin persona/estacion el error sale arriba: se prueba despues. Primero otorgar.
    ClicEn "document.querySelector('[data-otorgar-historico]')" | Out-Null
    $t = Esperar "!!document.querySelector('[data-permiso-historico=VIGENTE][data-persona=""$NOMBRE""]')" 20000
    OK ($t -ge 0) 'Caso 2: el permiso aparece VIGENTE en la lista' "$t ms"
    $perm = Lista "fert_historico_permisos?select=*&persona_id=eq.$qaId&estacion_id=eq.$estId"
    OK ($perm.Count -eq 1 -and $perm[0].hasta -eq $hasta7 -and $null -eq $perm[0].revocado_at) 'Caso 2: la base guardo persona, estacion y fecha limite (hoy + 7)' "hasta $($perm[0].hasta)"
    Captura 'fert_historico_admin_412.png'
    # Error visible arriba: guardar sin elegir persona
    ClicEn "document.querySelector('[data-sel-persona] button')" | Out-Null
    Start-Sleep -Milliseconds 200

    # ============ Caso 3: la persona ve el boton ============
    $t = AbrirEstacion
    $t = Esperar "!!document.querySelector('[data-accion=historico]')" 20000
    OK ($t -ge 0) 'Caso 3: con permiso vigente aparece «Registrar historico»' "$t ms"
    $txt = JS "document.querySelector('[data-registro-historico-panel]')?.innerText || ''"
    OK ($txt -match '7 d') 'Caso 3: dice cuantos dias le quedan' (($txt -replace "`n", ' '))

    # ============ Caso 4: el formulario ============
    ClicHasta "document.querySelector('[data-accion=historico]')" "!!document.querySelector('[data-selector-turno]')" | Out-Null
    Start-Sleep -Milliseconds 800
    $al = JS "document.querySelector('[data-alerta-historico]')?.innerText || ''"
    OK ($al -match 'NO mueve el inventario' -and $al -match 'Registro inicial del proceso') 'Caso 4: alerta azul «NO mueve el inventario» arriba' (($al -replace "`n", ' '))
    $info = (JS "(() => { const a=document.querySelector('[data-alerta-historico]'); if(!a) return ''; const p=a.parentElement; const r=a.getBoundingClientRect(); return JSON.stringify({top:r.top,bottom:r.bottom,vh:innerHeight,idx:[...p.children].indexOf(a)}) })()") | ConvertFrom-Json
    OK ($info.idx -le 1 -and $info.top -ge 0 -and $info.bottom -le $info.vh) 'Caso 4: la alerta es de lo primero y se ve sin scroll' "idx $($info.idx), top $([int]$info.top)"
    OK ([int](JS "document.querySelector('[data-dias-historico]')?.dataset.diasHistorico") -eq 7) 'Caso 4: muestra los 7 dias que quedan'
    OK ((JS "document.querySelector('[data-fecha]')?.max") -eq $ayer) 'Caso 4: el dia maximo es AYER (solo pasado)' (JS "document.querySelector('[data-fecha]')?.max")
    OK ((JS "[...document.querySelectorAll('button')].some(b => b.innerText.trim() === 'Hoy')") -eq $false) 'Caso 4: no hay atajo «Hoy»'
    ClicHasta "document.querySelector('[data-ddt-chip=""11""]')" "document.querySelector('[data-ddt-chip=""11""]')?.getAttribute('aria-pressed') === 'true'" | Out-Null
    Start-Sleep -Milliseconds 500
    OK ((JS "document.querySelector('[data-linea-codigo=""$SOL""] [data-cantidad]')?.value") -eq '100') 'Caso 4: DDT 11 propone 100 (la bodega esta en 0)'
    OK ((JS "!document.querySelector('[data-alerta-sin-inventario]') && !document.querySelector('[data-acepta-negativo]')") -eq $true) 'Caso 4: SIN alerta ni casilla de inventario aunque el saldo es 0'
    Captura 'fert_historico_form_412.png'
    # Hoy se rechaza en el formulario
    CampoFecha $hoy | Out-Null
    Guardar
    $err = JS "document.querySelector('[data-error-registro]')?.innerText || ''"
    OK ((JS "!!document.querySelector('[data-selector-turno]')") -eq $true -and $err -match 'pasados') 'Caso 4: hoy no se puede: el error sale arriba y no cierra' (($err -replace "`n", ' '))
    CampoFecha $ayer | Out-Null
    Start-Sleep -Milliseconds 300

    # ============ Caso 5: guardar ============
    Guardar
    $t = Esperar "!document.querySelector('[data-selector-turno]')" 8000
    OK ($t -ge 0) 'Caso 5: se guarda y el formulario se cierra'
    $t = EsperarSync
    OK ($t -ge 0) 'Caso 5: se sincroniza'
    $apl = Lista "fert_aplicaciones?select=id,historica,comentario,fecha,anulado_at&estacion_id=eq.$estId"
    OK ($apl.Count -eq 1 -and $apl[0].historica -eq $true -and $apl[0].comentario -like 'Registro inicial del proceso*' -and $apl[0].fecha -eq $ayer) 'Caso 5: llego como historica, con el texto fijo y el dia de ayer' "n $($apl.Count)"
    $movs = (Lista "fert_movimientos?select=id&estacion_id=eq.$estId").Count
    $sal = (Lista "fert_saldos?select=disponible&estacion_id=eq.$estId").Count
    OK ($movs -eq 0 -and $sal -eq 0) 'Caso 5: NO movio el inventario (0 movimientos, 0 saldos)' "movs $movs, saldos $sal"
    $op = @(Lista "fert_operaciones?select=tipo,resultado&id=eq.$($apl[0].id)")[0]
    OK ($op.tipo -eq 'aplicacion_historica' -and $op.resultado -like 'ACEPTADO*') 'Caso 5: operacion aplicacion_historica ACEPTADA' "$($op.tipo) $($op.resultado)"
    $aplId = $apl[0].id

    # ============ Caso 6: bitacora ============
    Esperar "!!document.querySelector('[data-pestana=bitacora]')" 15000 | Out-Null
    ClicHasta "document.querySelector('[data-pestana=bitacora]')" "!!document.querySelector('[data-movimiento=HISTORICO]')" | Out-Null
    OK ((JS "!!document.querySelector('[data-movimiento=HISTORICO] [data-insignia-historico]')") -eq $true) 'Caso 6: la fila lleva la insignia «Historico»'
    OK ((JS "document.querySelector('[data-movimiento=HISTORICO]')?.innerText") -match 'sin mover inventario') 'Caso 6: la fila dice «sin mover inventario»'
    OK ((JS "document.querySelectorAll('[data-movimiento=HISTORICO]').length") -eq 1) 'Caso 6: una fila por producto'
    ClicHasta "document.querySelector('[data-movimiento=HISTORICO]')" "!!document.querySelector('[data-detalle-historico]')" | Out-Null
    $det = JS "document.querySelector('[data-detalle-historico]')?.innerText || ''"
    OK ($det -match 'No movi' -and $det -match 'Registro inicial') 'Caso 6: el detalle dice «No movio el inventario»' (($det -replace "`n", ' '))
    OK ((JS "!document.querySelector('[data-modo-devolver]')") -eq $true) 'Caso 6: sin «Devolver sobrante»'

    # ============ Caso 7: anular ============
    ClicHasta "document.querySelector('[data-modo-anular]')" "!!document.querySelector('[data-motivo]')" | Out-Null
    Teclear "document.querySelector('[data-motivo]')" 'Prueba QA: se registro de mas'
    Guardar
    $t = Esperar "!document.querySelector('[data-detalle-documento]')" 8000
    $t = EsperarSync
    $a = @(Lista "fert_aplicaciones?select=anulado_at,motivo_anulacion&id=eq.$aplId")[0]
    OK ($a.anulado_at -and $a.motivo_anulacion -like 'Prueba QA*') 'Caso 7: la historica queda anulada con su motivo' "$($a.motivo_anulacion)"
    $movs = (Lista "fert_movimientos?select=id&estacion_id=eq.$estId").Count
    OK ($movs -eq 0) 'Caso 7: anular tampoco genera movimientos' "movs $movs"

    # ============ Caso 8: sin senal ============
    CDP 'Network.emulateNetworkConditions' @{ offline = $true; latency = 0; downloadThroughput = -1; uploadThroughput = -1 } | Out-Null
    ClicHasta "document.querySelector('[data-pestana=estacion]')" "!!document.querySelector('[data-accion=historico]')" | Out-Null
    ClicHasta "document.querySelector('[data-accion=historico]')" "!!document.querySelector('[data-selector-turno]')" | Out-Null
    Start-Sleep -Milliseconds 600
    # DDT 12 del plan (propone SOL 100) con el dia de antier
    ClicHasta "document.querySelector('[data-ddt-chip=""12""]')" "document.querySelector('[data-ddt-chip=""12""]')?.getAttribute('aria-pressed') === 'true'" | Out-Null
    Start-Sleep -Milliseconds 400
    CampoFecha $antier | Out-Null
    Start-Sleep -Milliseconds 300
    Guardar
    $t = Esperar "!document.querySelector('[data-selector-turno]')" 8000
    $pend = Pendientes
    OK ($t -ge 0 -and $pend -ge 1) 'Caso 8: sin senal queda en la cola del telefono' "pendientes $pend"
    OK ((JS "!document.querySelector('[data-saldo=""$SOL""]')") -eq $true) 'Caso 8: el saldo local NO cambia (sigue sin saldo del producto)'
    CDP 'Network.emulateNetworkConditions' @{ offline = $false; latency = 0; downloadThroughput = -1; uploadThroughput = -1 } | Out-Null
    $t = EsperarSync
    $cuenta = (Lista "fert_aplicaciones?select=id&estacion_id=eq.$estId&historica=eq.true").Count
    OK ($t -ge 0 -and $cuenta -ge 1) 'Caso 8: al volver la senal llega a la base' "historicas $cuenta"

    # ============ Caso 9: revocar ============
    Ir "/admin/fertirriego-historico?r=$s-rev"
    Esperar "!!document.querySelector('[data-revocar-historico]')" 30000 | Out-Null
    ClicEn "document.querySelector('[data-revocar-historico]')" | Out-Null
    $t = Esperar "!document.querySelector('[data-permiso-historico=VIGENTE]')" 15000
    OK ($t -ge 0) 'Caso 9: revocar quita el permiso de los vigentes'
    $p = @(Lista "fert_historico_permisos?select=revocado_at&persona_id=eq.$qaId&estacion_id=eq.$estId&order=otorgado_at.desc")[0]
    OK ($null -ne $p.revocado_at) 'Caso 9: la base lo marca revocado'
    $null = AbrirEstacion
    Start-Sleep -Milliseconds 1500
    OK ((JS "!document.querySelector('[data-accion=historico]')") -eq $true) 'Caso 9: revocado, el boton desaparece'
    $r = SincronizarRpc ([guid]::NewGuid().ToString()) $antier $solId $tcId
    OK ("$($r | ConvertTo-Json -Depth 6)" -match 'RECHAZADO' -and "$($r | ConvertTo-Json -Depth 6)" -match 'Registro hist') 'Caso 9: la base rechaza (permiso revocado)'

    # ============ Caso 10: vencido ============
    Rest 'rpc/fn_fert_historico_otorgar' 'Post' @{ p_persona = $qaId; p_estaciones = @($estId); p_hasta = $hasta7; p_nota = 'QA vencido' } | Out-Null
    $vig = @(Lista "fert_historico_permisos?select=id&persona_id=eq.$qaId&estacion_id=eq.$estId&revocado_at=is.null")
    OK ($vig.Count -eq 1) 'Caso 10: se otorga otra vez'
    Rest "fert_historico_permisos?id=eq.$($vig[0].id)" 'Patch' @{ hasta = $ayer } -Servicio | Out-Null
    $null = AbrirEstacion
    Start-Sleep -Milliseconds 1500
    OK ((JS "!document.querySelector('[data-accion=historico]')") -eq $true) 'Caso 10: vencido, el boton desaparece'
    $r = SincronizarRpc ([guid]::NewGuid().ToString()) $antier $solId $tcId
    OK ("$($r | ConvertTo-Json -Depth 6)" -match 'RECHAZADO') 'Caso 10: la base rechaza (permiso vencido)'

    $ancho = JS "document.documentElement.scrollWidth"
    OK ($ancho -le 420) 'Telefono: sin desplazamiento lateral' "scrollWidth $ancho"
    $e = Errores-Pagina; OK (-not $e) 'Sin errores en la pagina' $e
}
catch { $script:Resultados.Add("EXCEPCION (linea $($_.InvocationInfo.ScriptLineNumber)) $($_.Exception.Message) $($_.ErrorDetails.Message)") }
finally {
    # ---- Limpieza: todo lo de la estacion de prueba y el usuario QA temporal ----
    try { CDP 'Network.emulateNetworkConditions' @{ offline = $false; latency = 0; downloadThroughput = -1; uploadThroughput = -1 } | Out-Null } catch {}
    try {
        if ($qaId) { Rest "fert_historico_permisos?persona_id=eq.$qaId" 'Delete' -Servicio | Out-Null }
        if ($estId) {
            foreach ($t in 'fert_movimientos', 'fert_saldos', 'fert_bitacora_riego', 'fert_custodia', 'fert_relevos') { Rest "${t}?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null }
            foreach ($x in (Lista "fert_aplicaciones?select=id&estacion_id=eq.$estId")) { Rest "fert_aplicaciones_detalle?aplicacion_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null }
            Rest "fert_aplicaciones?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            if ($qaId) { Rest "fert_operaciones?perfil_id=eq.$qaId" 'Delete' -Servicio | Out-Null }
            $tc = Lista "turnos_ciclo?select=id,turno_id&agl_id=eq.TR-QA-$s"
            foreach ($x in $tc) { Rest "fert_plan?turno_ciclo_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null; Rest "turnos_ciclo?id=eq.$($x.id)" 'Delete' -Servicio | Out-Null; Rest "turnos?id=eq.$($x.turno_id)" 'Delete' -Servicio | Out-Null }
            Rest "perfiles_estaciones?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            Rest "estaciones_riego?id=eq.$estId" 'Delete' -Servicio | Out-Null
        }
        Rest "materiales?codigo=eq.$SOL" 'Delete' -Servicio | Out-Null
        Rest "fert_publicaciones?temporada=eq.$([uri]::EscapeDataString("QA $s"))" 'Delete' -Servicio | Out-Null
    } catch { $script:Resultados.Add("LIMPIEZA datos: $($_.Exception.Message) $($_.ErrorDetails.Message)") }
    try {
        if ($qaId) {
            foreach ($t in 'perfiles_zonas', 'perfiles_estaciones', 'fert_llaves') { Rest "${t}?perfil_id=eq.$qaId" 'Delete' -Servicio | Out-Null }
            Rest "perfiles?id=eq.$qaId" 'Delete' -Servicio | Out-Null
            Invoke-RestMethod -Method Delete -Uri "$URLB/auth/v1/admin/users/$qaId" -Headers $hServ | Out-Null
        }
    } catch { $script:Resultados.Add("LIMPIEZA usuario QA: $($_.Exception.Message) $($_.ErrorDetails.Message)") }
    Remove-Item $archivoQa -ErrorAction SilentlyContinue
    try {
        $quedaUsr = 0; try { Invoke-RestMethod "$URLB/auth/v1/admin/users/$qaId" -Headers $hServ | Out-Null; $quedaUsr = 1 } catch {}
        $restos = (Lista "perfiles?select=id&id=eq.$qaId").Count + (Lista "estaciones_riego?select=id&nombre=eq.$([uri]::EscapeDataString($EST))").Count + (Lista "materiales?select=id&codigo=eq.$SOL").Count + (Lista "turnos_ciclo?select=id&agl_id=eq.TR-QA-$s").Count
        OK ($quedaUsr -eq 0 -and $restos -eq 0) 'Limpieza: usuario QA temporal y datos de prueba borrados de desarrollo' "usuario $quedaUsr, restos $restos"
    } catch { $script:Resultados.Add("LIMPIEZA verificacion: $($_.Exception.Message)") }
    Terminar-QA
}
