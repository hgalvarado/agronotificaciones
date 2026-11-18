# QA - Fertirriego: aplicar sin inventario (commit abe85ba). Servidor en :3101 + base de DESARROLLO.
# Crea un usuario QA temporal, una estacion de prueba con turno, plan y dos productos; al final borra todo.
# Casos: (4) dentro del saldo no hay alerta y guarda sin casilla; (1) mayor al saldo: alerta roja arriba, guardar sin casilla
# no cierra y muestra el error arriba; (3) la casilla se desmarca sola si cambia una cantidad; (2) con la casilla se registra.
param([string]$Base = 'http://localhost:3101', [int]$PuertoCdp = 9335)
. "$PSScriptRoot\comun.ps1"

# ---------------------------------------------------------------- usuario QA temporal
$envQa = Leer-Entorno
$URLB = $envQa['NEXT_PUBLIC_SUPABASE_URL']; $SERV = $envQa['SUPABASE_SERVICE_ROLE_KEY']
$hServ = @{ apikey = $SERV; Authorization = "Bearer $SERV" }
$s = Get-Random -Maximum 99999
$qaEmail = "qa.apl.$([guid]::NewGuid().ToString('N').Substring(0,10))@desarrollo.local"; $qaClave = "Qa-$(Get-Random)-x$(Get-Random)"
$archivoQa = "$PSScriptRoot\qa_usuario.local.json"
$qaId = $null; $estId = $null; $rolEst = $null
$usr = Invoke-RestMethod -Method Post -Uri "$URLB/auth/v1/admin/users" -Headers $hServ -ContentType 'application/json' -Body (@{ email = $qaEmail; password = $qaClave; email_confirm = $true } | ConvertTo-Json)
$qaId = $usr.id
$rolTotal = (Invoke-RestMethod "$URLB/rest/v1/roles?select=id&acceso_total=eq.true&order=id&limit=1" -Headers $hServ)[0].id
Invoke-RestMethod -Method Post "$URLB/rest/v1/perfiles" -Headers $hServ -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes((@{ id = $qaId; nombre = "QA Aplicar $s"; rol_id = $rolTotal; todas_las_zonas = $true } | ConvertTo-Json))) | Out-Null
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
    ElegirOpcion '[data-selector-custodio] button' "QA Aplicar $s" | Out-Null
    Teclear "document.querySelector('[data-motivo-custodia]')" 'Arranque QA'
    ClicEn "document.querySelector('[data-guardar-custodia]')" | Out-Null
    $t = Esperar "/a tu cargo/.test(document.querySelector('[data-custodia]')?.innerText || '')" 20000
    OK ($t -ge 0) 'Custodia asignada al usuario QA'

    # Pasa a estacionero
    $rolEst = (Rest 'roles' 'Post' @{ codigo = "QA_EST_$s"; nombre = "QA Estacionero $s" } -Servicio)[0].id
    foreach ($a in 'ver', 'recibir', 'aplicar', 'contar', 'relevo') { Rest 'permisos' 'Post' @{ rol_id = $rolEst; recurso = 'fertirriego'; accion = $a; alcance = 'propietario' } -Servicio | Out-Null }
    Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($rolEst); p_principal = $rolEst } -Servicio | Out-Null
    CDP 'Browser.grantPermissions' @{ permissions = @('geolocation'); origin = $Base } | Out-Null
    CDP 'Emulation.setGeolocationOverride' @{ latitude = 13.312; longitude = -87.195; accuracy = 12 } | Out-Null
    Ir "/fertirriego?r=$s-b"
    $t = Esperar "document.querySelector('[data-estacion]')?.dataset.estacion === '$EST'" 60000
    OK ($t -ge 0) 'El estacionero ve su estacion' "$t ms"

    # Conteo inicial: SOL 10, ACI 10
    ClicHasta "document.querySelector('[data-accion=contar]')" "!!document.querySelector('[data-conteo]')" | Out-Null
    Teclear "document.querySelector('[data-conteo-material=""$SOL""] input')" '10'
    Teclear "document.querySelector('[data-conteo-material=""$ACI""] input')" '10'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    Esperar "!document.querySelector('[data-conteo]')" 15000 | Out-Null
    $t = EsperarSync
    $m = Lista "fert_movimientos?select=tipo,cantidad&estacion_id=eq.$estId"
    OK ($t -ge 0 -and $m.Count -eq 2) 'Saldo inicial 10 y 10 registrado' "movs $($m.Count)"

    # ============ Caso 4: dentro del saldo (DDT 4, SOL 5 <= 10) ============
    AbrirAplicar
    OK ((FormAbierto) -eq $true) 'Abre Preparar / aplicar turno'
    ClicHasta "document.querySelector('[data-ddt-chip=""4""]')" "document.querySelector('[data-ddt-chip=""4""]')?.getAttribute('aria-pressed') === 'true'" | Out-Null
    Start-Sleep -Milliseconds 400
    Teclear (Cant $SOL) '5'
    Start-Sleep -Milliseconds 400
    OK ((Alerta) -eq $false) 'Caso 4: cantidad dentro del saldo, NO aparece la alerta roja'
    Guardar
    $t = Esperar "!document.querySelector('[data-selector-turno]')" 8000
    OK ($t -ge 0) 'Caso 4: se guarda sin casilla y el formulario se cierra'
    $t = EsperarSync
    $apl = Lista "fert_aplicaciones?select=id&estacion_id=eq.$estId"
    OK ($t -ge 0 -and $apl.Count -eq 1) 'Caso 4: la aplicacion llego a la base' "aplicaciones $($apl.Count)"

    # ============ Caso 1: mayor al saldo (DDT 5: SOL 120 > 5) ============
    AbrirAplicar
    $ok5 = ClicHasta "document.querySelector('[data-ddt-chip=""5""]')" "document.querySelector('[data-ddt-chip=""5""]')?.getAttribute('aria-pressed') === 'true'"
    Start-Sleep -Milliseconds 500
    OK ($ok5 -and (JS "document.querySelector('[data-linea-codigo=""$SOL""] [data-cantidad]')?.value") -eq '120') 'Caso 1: DDT 5 propone SOL 120 (saldo 5)' (JS "document.querySelector('[data-linea-codigo=""$SOL""] [data-cantidad]')?.value")
    OK ((Alerta) -eq $true) 'Caso 1: aparece la alerta roja de sin inventario'
    $info = (JS "(() => { const a=document.querySelector('[data-alerta-sin-inventario]'); if(!a) return ''; const p=a.parentElement; const ch=[...p.children]; const r=a.getBoundingClientRect(); return JSON.stringify({top:r.top,bottom:r.bottom,vh:innerHeight,idx:ch.indexOf(a),antes:ch.slice(0,ch.indexOf(a)).map(x=>x.getAttributeNames().join(',')).join('|')}) })()") | ConvertFrom-Json
    $alto = JS "Math.round(document.querySelector('[data-alerta-sin-inventario]').getBoundingClientRect().height)"
    $enPie = JS "(() => { const a=document.querySelector('[data-alerta-sin-inventario]'); const g=document.querySelector('[data-guardar-registro]'); return !!g && a.getBoundingClientRect().bottom <= g.getBoundingClientRect().top + 2 && g.getBoundingClientRect().top - a.getBoundingClientRect().bottom < 40 })()"
    OK ($info.top -ge 0 -and $info.bottom -le $info.vh -and $enPie -eq $true -and [int]$alto -le 130) 'Caso 1: la alerta es compacta (<= 130 px), fija sobre el botón Guardar y visible sin scroll' "alto $alto px, en el pie $enPie"
    Captura 'fert_aplicar_sin_inventario_412.png'
    # Sticky: bajar el contenido y la alerta sigue a la vista
    JS "(() => { const a=document.querySelector('[data-alerta-sin-inventario]'); let p=a.parentElement; while(p && p.scrollHeight <= p.clientHeight+2) p=p.parentElement; if(p) p.scrollTop = p.scrollHeight; return true })()" | Out-Null
    Start-Sleep -Milliseconds 400
    $vis = JS "(() => { const r=document.querySelector('[data-alerta-sin-inventario]').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight })()"
    OK ($vis -eq $true) 'Caso 1: tras bajar al final del formulario la alerta sigue visible (fija abajo)'
    OK ((Casilla) -eq $false) 'Caso 1: la casilla empieza sin marcar'
    # --- Texto grande (fuente raiz 24 px): nombre largo completo y area de scroll suficiente ---
    $jsScroll = "(() => { let p=document.querySelector('[data-selector-turno]'); while(p && !(/(auto|scroll)/.test(getComputedStyle(p).overflowY) && p.scrollHeight > p.clientHeight + 2)) p=p.parentElement; return p ? Math.round(p.getBoundingClientRect().height) : -1 })()"
    $hScroll1 = [int](JS $jsScroll)
    OK ($hScroll1 -ge [int](915 * 0.5)) 'Aviso: con letra normal el area de scroll visible del formulario es >= 50 % de la pantalla' "$hScroll1 de 915 px"
    JS "document.documentElement.style.fontSize='24px'; true" | Out-Null
    Start-Sleep -Milliseconds 600
    $nom = (JS "(() => { const b=document.querySelector('[data-linea-codigo=""$SOL""] button'); const t=b.querySelector('span.break-words'); let ell=false; for (let e=t; e && e!==b.parentElement; e=e.parentElement) if (getComputedStyle(e).textOverflow==='ellipsis') ell=true; const lh=parseFloat(getComputedStyle(t).lineHeight)||parseFloat(getComputedStyle(t).fontSize)*1.4; return JSON.stringify({ell, sw:t.scrollWidth, cw:t.clientWidth, h:t.getBoundingClientRect().height, lh, lineas:Math.round(t.getBoundingClientRect().height/lh), txt:t.textContent, fs:getComputedStyle(document.documentElement).fontSize}) })()") | ConvertFrom-Json
    OK ($nom.fs -eq '24px' -and -not $nom.ell -and $nom.sw -le $nom.cw -and $nom.lineas -ge 2 -and $nom.txt -match 'QUELATADOS SACO 25 KG') 'Texto grande 24 px a 412 px: el nombre largo del producto se ve completo (sin ellipsis) y baja a 2+ lineas' "lineas $($nom.lineas), scrollW $($nom.sw) / clientW $($nom.cw)"
    $hScroll2 = [int](JS $jsScroll)
    $alto2 = [int](JS "Math.round(document.querySelector('[data-alerta-sin-inventario]').getBoundingClientRect().height)")
    OK ($hScroll2 -ge [int](915 * 0.5)) 'Aviso: con texto grande el area de scroll visible del formulario sigue >= 50 % de la pantalla' "$hScroll2 de 915 px, barra $alto2 px"
    $enPie2 = JS "(() => { const a=document.querySelector('[data-alerta-sin-inventario]'); const g=document.querySelector('[data-guardar-registro]'); const ra=a.getBoundingClientRect(); return ra.top>=0 && !!g && ra.bottom <= g.getBoundingClientRect().top + 2 && g.getBoundingClientRect().bottom <= innerHeight })()"
    OK ($enPie2 -eq $true) 'Texto grande: la barra del aviso sigue sobre Guardar y a la vista'
    Captura 'fert_aplicar_sin_inventario_textogrande_412.png'
    JS "(() => { const a=document.querySelector('[data-alerta-sin-inventario]'); let p=a.parentElement; while(p && !/(auto|scroll)/.test(getComputedStyle(p).overflowY)) p=p.parentElement; if(p) p.scrollTop = 0; return true })()" | Out-Null
    Start-Sleep -Milliseconds 300
    Captura 'fert_aplicar_sin_inventario_textogrande_arriba_412.png'
    JS "document.documentElement.style.fontSize=''; true" | Out-Null
    Start-Sleep -Milliseconds 500
    Guardar
    $abierto = FormAbierto
    $err = JS "document.querySelector('[data-error-registro]')?.innerText || ''"
    OK ($abierto -eq $true -and $err -match 'inventario') 'Caso 1: Guardar sin casilla NO cierra y muestra el error' (($err -replace "`n", ' '))
    $info2 = (JS "(() => { const e=document.querySelector('[data-error-registro]'); if(!e) return ''; const r=e.getBoundingClientRect(); return JSON.stringify({top:r.top,bottom:r.bottom,vh:innerHeight}) })()") | ConvertFrom-Json
    OK ($info2 -and $info2.top -ge 0 -and $info2.bottom -le $info2.vh) 'Caso 1: el error esta visible arriba sin hacer scroll' "top $([int]$info2.top)"
    Captura 'fert_aplicar_sin_inventario_error_412.png'

    # ============ Caso 3: la casilla no es pegajosa ============
    ClicEn "document.querySelector('[data-acepta-negativo]')" | Out-Null; Start-Sleep -Milliseconds 300
    OK ((Casilla) -eq $true) 'Caso 3: se marca la casilla (solo SOL en falta)'
    Teclear (Cant $SOL) '121'
    Start-Sleep -Milliseconds 400
    OK ((Alerta) -eq $true -and (Casilla) -eq $false) 'Caso 3: cambia la cantidad de A (SOL) -> la casilla se desmarca sola'
    Guardar
    OK ((FormAbierto) -eq $true -and ((JS "document.querySelector('[data-error-registro]')?.innerText || ''") -match 'inventario')) 'Caso 3: Guardar vuelve a exigir la casilla'
    # Dos productos en falta: ACI 50 > 10
    Teclear (Cant $ACI) '50'
    Start-Sleep -Milliseconds 400
    $txt = JS "(() => { const a=document.querySelector('[data-alerta-sin-inventario]'); return a ? a.innerText + ' || ' + (a.querySelector('[title]')?.title || '') : '' })()"
    OK ($txt -match 'en 2 productos' -and $txt -match 'ACIDO' -and $txt -match 'SOLUCION') 'Caso 3: con A y B en falta la barra dice 2 productos y el title detalla los dos' $txt
    ClicEn "document.querySelector('[data-acepta-negativo]')" | Out-Null; Start-Sleep -Milliseconds 300
    OK ((Casilla) -eq $true) 'Caso 3: casilla marcada con A y B en falta'
    Teclear (Cant $ACI) '51'
    Start-Sleep -Milliseconds 400
    OK ((Casilla) -eq $false) 'Caso 3: cambia la cantidad de B (ACI) -> se desmarca sola'
    ClicEn "document.querySelector('[data-acepta-negativo]')" | Out-Null; Start-Sleep -Milliseconds 300
    # B vuelve al plan (4, dentro del saldo): cambia el faltante -> otra vez a marcar
    Teclear (Cant $ACI) '4'
    Start-Sleep -Milliseconds 400
    OK ((Alerta) -eq $true -and (Casilla) -eq $false) 'Caso 3: B vuelve a una cantidad dentro del saldo -> el faltante cambio, casilla desmarcada'

    # ============ Caso 2: marcar la casilla y guardar ============
    Teclear (Cant $SOL) '120'
    Start-Sleep -Milliseconds 400
    ClicEn "document.querySelector('[data-acepta-negativo]')" | Out-Null; Start-Sleep -Milliseconds 300
    OK ((Casilla) -eq $true) 'Caso 2: casilla marcada para el faltante actual'
    Guardar
    $t = Esperar "!document.querySelector('[data-selector-turno]')" 8000
    OK ($t -ge 0) 'Caso 2: con la casilla marcada se guarda y el formulario se cierra'
    $t = EsperarSync
    $apl = Lista "fert_aplicaciones?select=*&estacion_id=eq.$estId"
    OK ($t -ge 0 -and $apl.Count -eq 2) 'Caso 2: la aplicacion sin inventario quedo registrada' "aplicaciones $($apl.Count)"
    $obs = ($apl | ForEach-Object { $_.observaciones }) -join ' || '
    $script:Resultados.Add("INFO observaciones de las aplicaciones: $obs")
    $ops = Lista "fert_operaciones?select=tipo,resultado,mensaje&perfil_id=eq.$qaId&order=recibido_en.desc&limit=5"
    foreach ($x in $ops) { $script:Resultados.Add("INFO op $($x.tipo) $($x.resultado) $($x.mensaje)") }
    $sal = JS "document.querySelector('[data-saldo=""$SOL""]')?.innerText"
    $script:Resultados.Add("INFO saldo SOL en pantalla: $($sal -replace "`n", ' ')")
    $solId = (Lista "materiales?select=id&codigo=eq.$SOL")[0].id
    $saldoBase = [double](Lista "fert_saldos?select=disponible&estacion_id=eq.$estId&material_id=eq.$solId")[0].disponible
    OK ($saldoBase -eq -115) 'Caso 2: el saldo de SOL en la base queda negativo (5 - 120 = -115)' "$saldoBase"
    $opAp = @(Lista "fert_operaciones?select=resultado,observaciones&perfil_id=eq.$qaId&tipo=eq.aplicacion&order=recibido_en.desc&limit=1")[0]
    OK ($opAp.resultado -like 'ACEPTADO*' -and ("$($opAp.observaciones)" -match 'SALDO_NEGATIVO')) 'Caso 2: operacion ACEPTADA con la observacion SALDO_NEGATIVO' "$($opAp.resultado) / $($opAp.observaciones)"
    $rech = (Lista "fert_operaciones?select=id&perfil_id=eq.$qaId&resultado=eq.RECHAZADO").Count
    OK ($rech -eq 0) 'Ninguna operacion rechazada' "rechazadas $rech"

    $ancho = JS "document.documentElement.scrollWidth"
    OK ($ancho -le 420) 'Telefono: sin desplazamiento lateral' "scrollWidth $ancho"
    $e = Errores-Pagina; OK (-not $e) 'Caso 5: sin errores en la pagina' $e
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
