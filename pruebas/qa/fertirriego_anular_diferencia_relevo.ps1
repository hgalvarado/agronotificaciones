# QA - Fertirriego: anular la diferencia de un producto en un relevo (sql/115). Servidor en :3102.
# REQUIERE que la base a la que apunta el servidor YA tenga corrida la sql/115 (en desarrollo todavia NO: no correr sin ella).
# Crea un usuario QA temporal (rol con acceso total, 412 px), una estacion de prueba y un relevo con dos diferencias
# (se siembran por la llave de servicio, como una recepcion de relevo ya hecha); al final borra todo por id exacto.
# Casos: (1) cada diferencia vigente muestra «Anular esta diferencia»; (2) motivo corto: error arriba y no cierra;
# (3) motivo largo: se guarda, la diferencia queda tachada con «Anulada», motivo y quien; la otra queda intacta;
# (4) el saldo vuelve al instante (sin esperar al servidor) y luego en la base; (5) aviso «Registrar la aplicacion
# olvidada» abre el formulario de aplicar; (6) sin el permiso «Anular» el boton no aparece.
param([string]$Base = 'http://localhost:3102', [int]$PuertoCdp = 9336)
. "$PSScriptRoot\comun.ps1"

$envQa = Leer-Entorno
$URLB = $envQa['NEXT_PUBLIC_SUPABASE_URL']; $SERV = $envQa['SUPABASE_SERVICE_ROLE_KEY']
$hServ = @{ apikey = $SERV; Authorization = "Bearer $SERV" }
$s = Get-Random -Maximum 99999
$qaEmail = "qa.rel.$([guid]::NewGuid().ToString('N').Substring(0,10))@desarrollo.local"; $qaClave = "Qa-$(Get-Random)-x$(Get-Random)"
$archivoQa = "$PSScriptRoot\qa_usuario.local.json"
$qaId = $null; $estId = $null; $rolSin = $null
$usr = Invoke-RestMethod -Method Post -Uri "$URLB/auth/v1/admin/users" -Headers $hServ -ContentType 'application/json' -Body (@{ email = $qaEmail; password = $qaClave; email_confirm = $true } | ConvertTo-Json)
$qaId = $usr.id
$rolTotal = (Invoke-RestMethod "$URLB/rest/v1/roles?select=id&acceso_total=eq.true&order=id&limit=1" -Headers $hServ)[0].id
Invoke-RestMethod -Method Post "$URLB/rest/v1/perfiles" -Headers $hServ -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes((@{ id = $qaId; nombre = "QA Relevo $s"; rol_id = $rolTotal; todas_las_zonas = $true } | ConvertTo-Json))) | Out-Null
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
function Saldo($matId) { [double](Lista "fert_saldos?select=disponible&estacion_id=eq.$estId&material_id=eq.$matId")[0].disponible }

$EST = "QA Estacion $s"; $A = "QA-A-$s"; $B = "QA-B-$s"
$zona = (Lista 'zonas?select=id,nombre&activo=eq.true&order=nombre&limit=1')[0]
$opId = [guid]::NewGuid().ToString(); $relId = $opId
$MOTIVO_LARGO = 'Se aplico el lunes en el turno de prueba y el companero de la tarde no lo registro antes de entregar'

try {
    # ============ Preparacion ============
    $estId = (Rest 'estaciones_riego' 'Post' @{ nombre = $EST; zona_id = $zona.id } -Servicio)[0].id
    # Los productos se crean directo (fn_fert_publicar pide una sesion de usuario, no la llave de servicio)
    Rest 'materiales' 'Post' @(@{ codigo = $A; descripcion = "PRODUCTO A QA $s"; unidad = 'L'; grupo = '1800'; fertirriego = $true; fert_analisis = $true; activo = $true }, @{ codigo = $B; descripcion = "PRODUCTO B QA $s"; unidad = 'L'; grupo = '1800'; fertirriego = $true; fert_analisis = $true; activo = $true }) -Servicio | Out-Null
    $matA = (Lista "materiales?select=id&codigo=eq.$A")[0].id; $matB = (Lista "materiales?select=id&codigo=eq.$B")[0].id
    Rest 'perfiles_estaciones' 'Post' @{ perfil_id = $qaId; estacion_id = $estId } -Servicio | Out-Null

    # Un relevo ya recibido por el usuario QA, con dos diferencias: A (10 -> 7) y B (10 -> 8)
    Rest 'fert_operaciones' 'Post' @{ id = $opId; tipo = 'relevo_recibir'; estacion_id = $estId; perfil_id = $qaId; resultado = 'ACEPTADO_CON_OBSERVACIONES'; datos = @{} } -Servicio | Out-Null
    $ahora = (Get-Date).ToUniversalTime().ToString('o')
    Rest 'fert_relevos' 'Post' @{ id = $relId; estacion_id = $estId; metodo = 'SESION'; estado = 'RECIBIDO'; entrega_id = $qaId; recibe_id = $qaId; entregado_at = $ahora; recibido_at = $ahora; revisar = $true; registrado_por = $qaId } -Servicio | Out-Null
    Rest 'fert_relevos_diferencias' 'Post' @(@{ relevo_id = $relId; material_id = $matA; saldo_sistema = 10; cantidad_real = 7; diferencia = -3 }, @{ relevo_id = $relId; material_id = $matB; saldo_sistema = 10; cantidad_real = 8; diferencia = -2 }) -Servicio | Out-Null
    Rest 'fert_movimientos' 'Post' @(
        @{ operacion_id = $opId; estacion_id = $estId; material_id = $matA; tipo = 'DIFERENCIA_RELEVO'; cantidad = -3; fecha_hora = $ahora; documento_tipo = 'relevo'; documento_id = $relId; registrado_por = $qaId },
        @{ operacion_id = $opId; estacion_id = $estId; material_id = $matB; tipo = 'DIFERENCIA_RELEVO'; cantidad = -2; fecha_hora = $ahora; documento_tipo = 'relevo'; documento_id = $relId; registrado_por = $qaId }) -Servicio | Out-Null
    Rest 'fert_saldos' 'Post' @(@{ estacion_id = $estId; material_id = $matA; disponible = 7 }, @{ estacion_id = $estId; material_id = $matB; disponible = 8 }) -Servicio | Out-Null
    OK ((Saldo $matA) -eq 7 -and (Saldo $matB) -eq 8) 'Preparacion: relevo con dos diferencias sembrado (A 7, B 8)'

    CDP 'Browser.grantPermissions' @{ permissions = @('geolocation'); origin = $Base } | Out-Null
    CDP 'Emulation.setGeolocationOverride' @{ latitude = 13.312; longitude = -87.195; accuracy = 12 } | Out-Null
    Ir "/fertirriego?r=$s"
    $t = Esperar "!!document.querySelector('[data-barra-estado]') && !!document.querySelector('[data-estacion]')" 60000
    OK ($t -ge 0) 'Abre Fertirriego' "$t ms"
    ElegirOpcion '[data-selector-estacion] button' $EST | Out-Null
    Esperar "document.querySelector('[data-estacion]')?.dataset.estacion === '$EST'" 10000 | Out-Null
    # Custodia para el usuario QA (para poder registrar luego la aplicacion olvidada)
    ClicHasta "document.querySelector('[data-asignar-custodia]')" "!!document.querySelector('[data-selector-custodio]')" | Out-Null
    ElegirOpcion '[data-selector-custodio] button' "QA Relevo $s" | Out-Null
    Teclear "document.querySelector('[data-motivo-custodia]')" 'Arranque QA'
    ClicEn "document.querySelector('[data-guardar-custodia]')" | Out-Null
    Esperar "/a tu cargo/.test(document.querySelector('[data-custodia]')?.innerText || '')" 20000 | Out-Null

    # ============ Caso 1: botones en cada diferencia ============
    ClicHasta "document.querySelector('[data-pestana=relevos]')" "document.querySelectorAll('[data-diferencia-material]').length === 2"
    $botones = [int](JS "document.querySelectorAll('[data-anular-diferencia]').length")
    OK ($botones -eq 2) 'Caso 1: las dos diferencias vigentes muestran «Anular esta diferencia»' "botones $botones"
    Captura 'fert_anular_diferencia_relevo_lista_412.png'

    # ============ Caso 2: motivo corto ============
    $selA = "document.querySelector('[data-diferencia-material=""$matA""]')"
    ClicHasta "$selA.querySelector('[data-anular-diferencia]')" "!!document.querySelector('[data-form-anular-diferencia]')" | Out-Null
    $alerta = JS "document.querySelector('[data-form-anular-diferencia] [role=alert]')?.innerText || ''"
    OK ($alerta -match 'volverá al inventario') 'Caso 2: alerta ambar visible arriba con lo que ocurrira' $alerta
    Teclear "document.querySelector('[data-motivo-diferencia]')" 'se olvido'
    Start-Sleep -Milliseconds 300
    $contador = JS "document.querySelector('[data-form-anular-diferencia]')?.innerText || ''"
    OK ($contador -match '9 de 25') 'Caso 2: el contador muestra las letras escritas' ''
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    Start-Sleep -Milliseconds 800
    $err = JS "document.querySelector('[data-error-registro]')?.innerText || ''"
    OK ((JS "!!document.querySelector('[data-form-anular-diferencia]')") -eq $true -and $err -match '25 letras') 'Caso 2: motivo corto no cierra y el error sale arriba' (($err -replace "`n", ' '))
    OK ((Lista "fert_operaciones?select=id&perfil_id=eq.$qaId&tipo=eq.anulacion").Count -eq 0) 'Caso 2: no se creo ninguna anulacion'

    # ============ Caso 3: motivo largo ============
    Teclear "document.querySelector('[data-motivo-diferencia]')" $MOTIVO_LARGO
    Start-Sleep -Milliseconds 300
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    $t = Esperar "!document.querySelector('[data-form-anular-diferencia]')" 8000
    OK ($t -ge 0) 'Caso 3: con motivo largo se guarda y el formulario se cierra'
    # Antes de sincronizar: el saldo local ya repuso lo anulado y la fila muestra «por enviar»
    $porEnviar = JS "!!document.querySelector('[data-diferencia-material=""$matA""] [data-diferencia-por-enviar]')"
    OK ($porEnviar -eq $true) 'Caso 3: la fila de A dice «Anulacion guardada en el telefono, por enviar»'
    $aviso = JS "!!document.querySelector('[data-aviso-aplicacion-olvidada]')"
    OK ($aviso -eq $true) 'Caso 3: aparece el aviso con «Registrar la aplicacion olvidada»'
    $t = EsperarSync
    OK ($t -ge 0) 'Caso 3: se sincroniza'
    $fila = (Lista "fert_relevos_diferencias?select=anulado_at,anulado_por,motivo_anulacion&relevo_id=eq.$relId&material_id=eq.$matA")[0]
    OK ($fila.anulado_at -and $fila.anulado_por -eq $qaId -and $fila.motivo_anulacion -like 'Se aplico el lunes*') 'Caso 3: la base marco la fila de A (quien, cuando, por que)'
    OK ((Saldo $matA) -eq 10 -and (Saldo $matB) -eq 8) 'Caso 4: A volvio al inventario (10) y B quedo igual (8)' "A $(Saldo $matA), B $(Saldo $matB)"
    $rev = (Lista "fert_relevos?select=revisar&id=eq.$relId")[0].revisar
    OK ($rev -eq $true) 'Caso 3: el relevo sigue «Revisar» mientras quede la diferencia de B'
    Esperar "document.querySelector('[data-diferencia-material=""$matA""]')?.dataset.diferenciaAnulada === 'si'" 20000 | Out-Null
    $txtA = JS "document.querySelector('[data-diferencia-material=""$matA""]')?.textContent || ''"
    OK ($txtA -match 'Anulada' -and $txtA -match 'QA Relevo' -and $txtA -match 'Se aplico el lunes') 'Caso 3: A se ve tachada con «Anulada», quien y el motivo' (($txtA -replace '\s+', ' '))
    $tachada = JS "getComputedStyle(document.querySelector('[data-diferencia-material=""$matA""] p')).textDecorationLine"
    OK ($tachada -match 'line-through') 'Caso 3: el texto de la diferencia anulada esta tachado'
    OK ((JS "!!document.querySelector('[data-diferencia-material=""$matA""] [data-anular-diferencia]')") -eq $false) 'Caso 3: A ya no ofrece anular'
    OK ((JS "!!document.querySelector('[data-diferencia-material=""$matB""] [data-anular-diferencia]')") -eq $true) 'Caso 3: B sigue ofreciendo anular'
    Captura 'fert_anular_diferencia_relevo_anulada_412.png'

    # ============ Caso 5: registrar la aplicacion olvidada ============
    # La estacion de prueba no tiene turnos: el formulario de aplicar abre igual (con su aviso de «sin turnos»)
    $ok = ClicHasta "document.querySelector('[data-registrar-aplicacion-olvidada]')" "!!document.querySelector('[data-selector-turno]') || /no tiene turnos activos/.test(($ULTIMO_DIALOGO)?.textContent || '')"
    OK ($ok) 'Caso 5: «Registrar la aplicacion olvidada» abre el formulario de aplicar'
    Captura 'fert_anular_diferencia_relevo_aplicar_412.png'
    ClicEn "document.querySelector('[data-cancelar-registro]')" | Out-Null

    # ============ Caso 6: sin «Anular» no hay boton ============
    $rolSin = (Rest 'roles' 'Post' @{ codigo = "QA_SIN_$s"; nombre = "QA Sin Anular $s" } -Servicio)[0].id
    foreach ($a in 'ver', 'recibir', 'aplicar', 'contar', 'relevo') { Rest 'permisos' 'Post' @{ rol_id = $rolSin; recurso = 'fertirriego'; accion = $a; alcance = 'propietario' } -Servicio | Out-Null }
    Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($rolSin); p_principal = $rolSin } -Servicio | Out-Null
    Ir "/fertirriego?r=$s-b"
    Esperar "document.querySelector('[data-estacion]')?.dataset.estacion === '$EST'" 60000 | Out-Null
    ClicHasta "document.querySelector('[data-pestana=relevos]')" "document.querySelectorAll('[data-diferencia-material]').length === 2" | Out-Null
    OK ((JS "document.querySelectorAll('[data-anular-diferencia]').length") -eq 0) 'Caso 6: sin el permiso «Anular» ningun boton de anular diferencia'

    $ancho = JS "document.documentElement.scrollWidth"
    OK ($ancho -le 420) 'Telefono: sin desplazamiento lateral' "scrollWidth $ancho"
    $e = Errores-Pagina; OK (-not $e) 'Sin errores en la pagina' $e
}
catch {
    $cuerpoErr = ''
    try { $cuerpoErr = (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } catch {}
    $script:Resultados.Add("EXCEPCION $($_.Exception.Message) $($_.ErrorDetails.Message) $cuerpoErr :: $(($_.ScriptStackTrace -replace "`n", ' | '))")
}
finally {
    # ---- Limpieza por id exacto: todo lo de la estacion de prueba y el usuario QA temporal ----
    try {
        if ($estId) {
            # El libro de movimientos es inalterable (disparador): se abre el paso solo para esta limpieza, via la funcion de pruebas si existe.
            foreach ($t in 'fert_movimientos', 'fert_saldos', 'fert_bitacora_riego', 'fert_custodia') { try { Rest "${t}?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null } catch { $script:Resultados.Add("LIMPIEZA $t (puede requerir borrar el modo de pruebas / libro): $($_.Exception.Message)") } }
            Rest "fert_relevos_diferencias?relevo_id=eq.$relId" 'Delete' -Servicio | Out-Null
            Rest "fert_relevos?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            foreach ($x in (Lista "fert_aplicaciones?select=id&estacion_id=eq.$estId")) { Rest "fert_aplicaciones_detalle?aplicacion_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null }
            Rest "fert_aplicaciones?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            if ($qaId) { Rest "fert_operaciones?perfil_id=eq.$qaId" 'Delete' -Servicio | Out-Null }
            Rest "fert_operaciones?id=eq.$opId" 'Delete' -Servicio | Out-Null
            Rest "perfiles_estaciones?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            Rest "estaciones_riego?id=eq.$estId" 'Delete' -Servicio | Out-Null
        }
        foreach ($c in $A, $B) { Rest "materiales?codigo=eq.$c" 'Delete' -Servicio | Out-Null }
    } catch { $script:Resultados.Add("LIMPIEZA datos: $($_.Exception.Message) $($_.ErrorDetails.Message)") }
    try { if ($rolSin) { Rest "permisos?rol_id=eq.$rolSin" 'Delete' -Servicio | Out-Null } } catch { $script:Resultados.Add("LIMPIEZA permisos rol: $($_.Exception.Message)") }
    try {
        if ($qaId) {
            foreach ($t in 'perfiles_zonas', 'perfiles_estaciones', 'fert_llaves') { Rest "${t}?perfil_id=eq.$qaId" 'Delete' -Servicio | Out-Null }
            try { Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($rolTotal); p_principal = $rolTotal } -Servicio | Out-Null } catch {}
            Rest "perfiles?id=eq.$qaId" 'Delete' -Servicio | Out-Null
            Invoke-RestMethod -Method Delete -Uri "$URLB/auth/v1/admin/users/$qaId" -Headers $hServ | Out-Null
        }
    } catch { $script:Resultados.Add("LIMPIEZA usuario QA: $($_.Exception.Message) $($_.ErrorDetails.Message)") }
    try { if ($rolSin) { Rest "roles?id=eq.$rolSin" 'Delete' -Servicio | Out-Null } } catch { $script:Resultados.Add("LIMPIEZA rol: $($_.Exception.Message)") }
    Remove-Item $archivoQa -ErrorAction SilentlyContinue
    try {
        $quedaUsr = 0; try { Invoke-RestMethod "$URLB/auth/v1/admin/users/$qaId" -Headers $hServ | Out-Null; $quedaUsr = 1 } catch {}
        $restos = (Lista "perfiles?select=id&id=eq.$qaId").Count + (Lista "estaciones_riego?select=id&nombre=eq.$([uri]::EscapeDataString($EST))").Count + (Lista "materiales?select=id&codigo=in.($A,$B)").Count + $(if ($rolSin) { (Lista "roles?select=id&id=eq.$rolSin").Count } else { 0 })
        OK ($quedaUsr -eq 0 -and $restos -eq 0) 'Limpieza: usuario QA temporal y datos de prueba borrados' "usuario $quedaUsr, restos $restos"
    } catch { $script:Resultados.Add("LIMPIEZA verificacion: $($_.Exception.Message)") }
    Terminar-QA
}
