# QA - Fertirriego: horas de riego dentro de Aplicar, aviso historico discreto, botones de «Por turno» segun la estacion
# a cargo, y cantidad 0 = producto no registrado. Servidor en :3100 + base de DESARROLLO.
# Crea un usuario QA temporal, un rol temporal de estacionero (sin «Registrar por otro»), una estacion de prueba con turno,
# plan y dos productos; al final borra todo por id exacto.
# Casos: (A) sin estaciones: mensaje y ningun boton; (B) estacion asignada pero sin custodia: Aplicar/Horas de «Por turno»
# deshabilitados con el motivo; (C) con «Registrar por otro» (rol total): habilitados; aviso del historico en linea (no fijo);
# (D) custodio: habilitados; (E) cantidad 0 = no se registra (Aplicar y Recibir), todo en 0 o texto invalido = error;
# (F) horas en Aplicar: cerrada = solo aplicacion; 30 h = error y nada se guarda; con horas = aplicacion + bitacora; ya
# registrada se muestra y no se reenvia; escrita pero cerrada no se manda; (G) formulario Horas igual que antes.
param([string]$Base = 'http://localhost:3100', [int]$PuertoCdp = 9351)
. "$PSScriptRoot\comun.ps1"

$envQa = Leer-Entorno
$URLB = $envQa['NEXT_PUBLIC_SUPABASE_URL']; $SERV = $envQa['SUPABASE_SERVICE_ROLE_KEY']
$hServ = @{ apikey = $SERV; Authorization = "Bearer $SERV" }
$s = Get-Random -Maximum 99999
$qaEmail = "qa.ah.$([guid]::NewGuid().ToString('N').Substring(0,10))@desarrollo.local"; $qaClave = "Qa-$(Get-Random)-x$(Get-Random)"
$archivoQa = "$PSScriptRoot\qa_usuario.local.json"
$qaId = $null; $estId = $null; $rolEst = $null
$NOMBRE = "QA Horas $s"
$nuevoUsr = Invoke-RestMethod -Method Post -Uri "$URLB/auth/v1/admin/users" -Headers $hServ -ContentType 'application/json' -Body (@{ email = $qaEmail; password = $qaClave; email_confirm = $true } | ConvertTo-Json)
$qaId = $nuevoUsr.id
$rolTotal = (Invoke-RestMethod "$URLB/rest/v1/roles?select=id&acceso_total=eq.true&order=id&limit=1" -Headers $hServ)[0].id
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
function CrearEnSelector($selectorBoton, $etiqueta, [string[]]$valores) {
    ClicHasta "document.querySelector('$selectorBoton')" "!!$ULTIMO_DIALOGO.querySelector('input[inputmode=search]')" | Out-Null
    ClicEn "[...$ULTIMO_DIALOGO.querySelectorAll('button')].find(b => b.innerText.includes('$etiqueta'))" | Out-Null
    Start-Sleep -Milliseconds 300
    for ($i = 0; $i -lt $valores.Count; $i++) { if ($valores[$i]) { Teclear "$ULTIMO_DIALOGO.querySelectorAll('input')[$i]" $valores[$i] } }
    Clic 'Crear y usar' | Out-Null
    Start-Sleep -Milliseconds 500
}
function Pendientes { [int](JS "Number((document.querySelector('[data-pendientes-cuenta]')?.innerText.match(/\d+/) || [0])[0])") }
function EsperarSync { Start-Sleep -Milliseconds 1500; Esperar "!document.querySelector('[data-pendientes-cuenta]')" 80000 }
function Cant($cod) { "document.querySelector('[data-linea-codigo=""$cod""] [data-cantidad]')" }
function Guardar { ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null; Start-Sleep -Milliseconds 1200 }
function ErrorForm { JS "document.querySelector('[data-error-registro]')?.textContent || ''" }
function Cancelar { ClicEn "[...${ULTIMO_DIALOGO}.querySelectorAll('button')].find(b => b.innerText.trim() === 'Cancelar')" | Out-Null; Start-Sleep -Milliseconds 600 }
function Roles($ids) { Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($ids); p_principal = $ids } -Servicio | Out-Null }
function Abrir($sufijo) {
    Ir "/fertirriego?r=$s-$sufijo"
    $t = Esperar "!!document.querySelector('[data-barra-estado]') && (!!document.querySelector('[data-estacion]') || /No tienes estaciones asignadas/.test(document.body.textContent))" 60000
    if (JS "!!document.querySelector('[data-selector-estacion]')") { ElegirOpcion '[data-selector-estacion] button' $EST | Out-Null }
    Esperar "document.querySelector('[data-estacion]')?.dataset.estacion === '$EST' || /No tienes estaciones asignadas/.test(document.body.textContent)" 15000 | Out-Null
    Esperar "!document.querySelector('[data-actualizar]')?.disabled" 30000 | Out-Null
    return $t
}
function PorTurno { ClicHasta "document.querySelector('[data-pestana=turnos]')" "!!document.querySelector('[data-turno=""$TURNO""] [data-tarjeta-ddt]')" | Out-Null; Start-Sleep -Milliseconds 300 }
function EstadoBotones { JS "JSON.stringify({ apl: [...document.querySelectorAll('[data-aplicar-dia]')].map(b => b.disabled), hrs: [...document.querySelectorAll('[data-horas-dia]')].map(b => b.disabled), txt: document.querySelector('[data-sin-estacion-asignada]')?.textContent || '' })" | ConvertFrom-Json }
function AplicarDesde($ddt) {
    PorTurno
    ClicHasta "document.querySelector('[data-tarjeta-ddt=""$ddt""] [data-aplicar-dia]')" "!!document.querySelector('[data-selector-turno]')" | Out-Null
    Start-Sleep -Milliseconds 800
}
function Apls { Lista "fert_aplicaciones?select=id,fecha,turno_ciclo_id&estacion_id=eq.$estId&order=fecha_hora" }
function OpsTipo($tipo) { Lista "fert_operaciones?select=id,tipo,resultado&perfil_id=eq.$qaId&tipo=eq.$tipo" }
function Detalle($aplId) { Lista "fert_aplicaciones_detalle?select=material_id,cantidad&aplicacion_id=eq.$aplId" }
function Bita($fecha) { Lista "fert_bitacora_riego?select=*&estacion_id=eq.$estId&fecha=eq.$fecha" }

$EST = "PRUEBA QA AH $s"; $TURNO = "TQA-AH-$s"; $SOL = "QA-SOL-$s"; $ACI = "QA-ACI-$s"
$hoy = (Get-Date).ToString('yyyy-MM-dd'); $ayer = (Get-Date).AddDays(-1).ToString('yyyy-MM-dd')
$z1 = (Lista 'zonas?select=id,nombre&activo=eq.true&order=nombre&limit=1')[0]

try {
    # ============ Preparacion ============
    $estId = (Rest 'estaciones_riego' 'Post' @{ nombre = $EST; zona_id = $z1.id } -Servicio)[0].id
    $pub = Rest 'rpc/fn_fert_publicar' 'Post' @{ p = @{
        temporada = "QA $s"
        estaciones = @(@{ nombre = $EST; zona = $z1.nombre })
        materiales = @(@{ codigo = $SOL; descripcion = "SOLUCION QA $s"; unidad = 'L'; grupo = '1800' }, @{ codigo = $ACI; descripcion = "ACIDO QA $s"; unidad = 'L'; grupo = '1800' })
        turnos = @(@{ agl_id = "TR-QA-$s"; turno = $TURNO; temporada = "QA $s"; ciclo = 'Ciclo QA'; fecha_siembra = (Get-Date).AddDays(-5).ToString('yyyy-MM-dd'); estacion = $EST; zona = $z1.nombre; area_mz = 10; estado = 'Creado' })
        plan = @(@{ agl_id = "TR-QA-$s"; filas = @(
            @{ fecha = $hoy; ddt = 5; material = $SOL; cantidad = 3 }, @{ fecha = $hoy; ddt = 5; material = $ACI; cantidad = 2 },
            @{ fecha = $ayer; ddt = 4; material = $SOL; cantidad = 1 }) })
    } }
    OK ($pub.turnos -eq 1 -and $pub.filas_plan -eq 3) 'Preparacion: turno, plan y productos publicados' "turnos $($pub.turnos), plan $($pub.filas_plan)"
    $solId = (Lista "materiales?select=id&codigo=eq.$SOL")[0].id; $aciId = (Lista "materiales?select=id&codigo=eq.$ACI")[0].id
    $tcId = (Lista "turnos_ciclo?select=id&agl_id=eq.TR-QA-$s")[0].id
    $rolEst = (Rest 'roles' 'Post' @{ codigo = "QA_EST_$s"; nombre = "QA Estacionero $s" } -Servicio)[0].id
    foreach ($a in 'ver', 'recibir', 'aplicar', 'contar', 'relevo') { Rest 'permisos' 'Post' @{ rol_id = $rolEst; recurso = 'fertirriego'; accion = $a; alcance = 'propietario' } -Servicio | Out-Null }
    CDP 'Browser.grantPermissions' @{ permissions = @('geolocation'); origin = $Base } | Out-Null
    CDP 'Emulation.setGeolocationOverride' @{ latitude = 13.312; longitude = -87.195; accuracy = 12 } | Out-Null

    # ============ A: estacionero SIN estaciones ============
    Roles $rolEst
    $t = Abrir 'a'
    OK ($t -ge 0 -and (JS "/No tienes estaciones asignadas/.test(document.body.textContent)") -eq $true) 'A: sin estaciones dice «No tienes estaciones asignadas»' "$t ms"
    OK ((JS "!document.querySelector('[data-aplicar-dia]') && !document.querySelector('[data-horas-dia]') && !document.querySelector('[data-accion=aplicar]')") -eq $true) 'A: sin estaciones no hay botones Aplicar/Horas'

    # ============ B: estacion asignada, sin custodia, sin «Registrar por otro» ============
    Rest 'perfiles_estaciones' 'Post' @{ perfil_id = $qaId; estacion_id = $estId } -Servicio | Out-Null
    $t = Abrir 'b'
    OK ((JS "document.querySelector('[data-estacion]')?.dataset.estacion") -eq $EST) 'B: ve su estacion' "$t ms"
    OK ((JS "document.querySelector('[data-accion=aplicar]')?.disabled") -eq $true) 'B: PanelEstacion igual que antes (Aplicar deshabilitado sin custodia)'
    PorTurno
    $b = EstadoBotones
    OK ($b.apl.Count -ge 2 -and -not ($b.apl -contains $false) -and -not ($b.hrs -contains $false)) 'B: «Por turno»: Aplicar y Horas deshabilitados en todas las tarjetas' "apl $($b.apl -join ','), hrs $($b.hrs -join ',')"
    OK ($b.txt -match 'a cargo') 'B: aparece el motivo [data-sin-estacion-asignada]' $b.txt
    $abre = ClicEn "document.querySelector('[data-tarjeta-ddt=""5""] [data-aplicar-dia]')"; Start-Sleep -Milliseconds 700
    OK ((JS "!document.querySelector('[data-selector-turno]')") -eq $true) 'B: el clic en Aplicar deshabilitado no abre nada'
    Captura 'fert_aplicar_horas_sin_custodia_412.png'

    # ============ C: con «Registrar por otro» (rol de acceso total) ============
    Roles $rolTotal
    $null = Abrir 'c'
    Esperar "document.querySelector('[data-estacion]')?.dataset.estacion === '$EST'" 30000 | Out-Null
    PorTurno
    # Tras cambiar el rol el estado del teléfono puede traer permisos viejos: se espera a que lleguen los botones
    # y, si no, se pide actualizar (con señal) y se vuelve a mirar
    if (-not (Esperar "!!document.querySelector('[data-aplicar-dia]')" 15000)) {
        ClicEn "document.querySelector('[data-actualizar]')" | Out-Null
        Start-Sleep -Seconds 3
        Esperar "!document.querySelector('[data-actualizar]')?.disabled" 30000 | Out-Null
        PorTurno
        Esperar "!!document.querySelector('[data-aplicar-dia]')" 15000 | Out-Null
    }
    $b = EstadoBotones
    OK ($b.apl.Count -ge 2 -and -not ($b.apl -contains $true) -and -not ($b.hrs -contains $true) -and -not $b.txt) 'C: con «Registrar por otro» Aplicar y Horas habilitados, sin aviso' "apl $($b.apl -join ','), txt '$($b.txt)'"
    # Aviso del historico: una linea en el flujo, no fija
    Rest 'rpc/fn_fert_historico_otorgar' 'Post' @{ p_persona = $qaId; p_estaciones = @($estId); p_hasta = (Get-Date).AddDays(3).ToString('yyyy-MM-dd'); p_nota = 'QA aviso' } | Out-Null
    $null = Abrir 'c2'
    ClicHasta "document.querySelector('[data-accion=historico]')" "!!document.querySelector('[data-alerta-historico]')" | Out-Null
    Start-Sleep -Milliseconds 600
    $av = JS "(() => { const a = document.querySelector('[data-alerta-historico]'); if (!a) return ''; const pos = []; for (let e = a; e && !e.matches('[role=dialog]'); e = e.parentElement) pos.push(getComputedStyle(e).position); let sc = a.parentElement; while (sc && sc.scrollHeight <= sc.clientHeight + 2) sc = sc.parentElement; const t0 = a.getBoundingClientRect().top; if (sc) sc.scrollTop = sc.scrollHeight; const t1 = a.getBoundingClientRect().top; if (sc) sc.scrollTop = 0; return JSON.stringify({ hayScroll: !!sc, tag: a.tagName, pos: getComputedStyle(a).position, fijo: pos.some(p => p === 'sticky' || p === 'fixed'), t0, t1, alto: a.getBoundingClientRect().height, z: getComputedStyle(a).zIndex, txt: a.textContent }) })()"
    $av = $av | ConvertFrom-Json
    OK ($av.tag -eq 'P' -and $av.pos -eq 'static' -and -not $av.fijo -and $av.z -eq 'auto') 'C: aviso historico es una linea P sin sticky/fixed (ni sus contenedores dentro del modal)' "tag $($av.tag), pos $($av.pos), z $($av.z)"
    OK ((-not $av.hayScroll -or $av.t1 -lt $av.t0) -and $av.alto -le 60) 'C: al bajar, el aviso se va con el contenido (no queda fijo) y es discreto' "top $([int]$av.t0) -> $([int]$av.t1), alto $([int]$av.alto)"
    OK ($av.txt -match 'Registro inicial del proceso' -and $av.txt -match 'no mueve el inventario') 'C: el aviso dice lo mismo' $av.txt
    OK ((JS "!!document.querySelector('[data-seccion-horas]')") -eq $true) 'C: el historico SI trae la seccion de horas (con Aplicar en la estacion)'
    Cancelar
    Rest "fert_historico_permisos?persona_id=eq.$qaId" 'Delete' -Servicio | Out-Null
    # Custodia para el usuario QA
    $null = Abrir 'c3'
    ClicHasta "document.querySelector('[data-asignar-custodia]')" "!!document.querySelector('[data-selector-custodio]')" | Out-Null
    ElegirOpcion '[data-selector-custodio] button' $NOMBRE | Out-Null
    Teclear "document.querySelector('[data-motivo-custodia]')" 'Arranque QA'
    ClicEn "document.querySelector('[data-guardar-custodia]')" | Out-Null
    $t = Esperar "/a tu cargo/.test(document.querySelector('[data-custodia]')?.innerText || '')" 20000
    OK ($t -ge 0) 'C: custodia asignada al usuario QA'

    # ============ D: custodio con rol de estacionero ============
    Roles $rolEst
    $null = Abrir 'd'
    PorTurno
    $b = EstadoBotones
    OK ($b.apl.Count -ge 2 -and -not ($b.apl -contains $true) -and -not ($b.hrs -contains $true) -and -not $b.txt) 'D: custodio: Aplicar y Horas habilitados, sin aviso' "apl $($b.apl -join ',')"
    # Saldo inicial
    ClicHasta "document.querySelector('[data-pestana=estacion]')" "!!document.querySelector('[data-accion=contar]')" | Out-Null
    ClicHasta "document.querySelector('[data-accion=contar]')" "!!document.querySelector('[data-conteo]')" | Out-Null
    Teclear "document.querySelector('[data-conteo-material=""$SOL""] input')" '50'
    Teclear "document.querySelector('[data-conteo-material=""$ACI""] input')" '50'
    Guardar
    Esperar "!document.querySelector('[data-conteo]')" 15000 | Out-Null
    $t = EsperarSync
    OK ($t -ge 0 -and (Lista "fert_movimientos?select=id&estacion_id=eq.$estId").Count -eq 2) 'D: saldo inicial 50 y 50'

    # ============ E + F1: Aplicar desde «Por turno», un producto en 0, horas cerradas ============
    AplicarDesde 5
    OK ((JS "!!document.querySelector('[data-selector-turno]')") -eq $true) 'E: Aplicar desde la tarjeta abre el formulario'
    OK ((JS "!!document.querySelector('[data-seccion-horas] [data-abrir-horas]') && !document.querySelector('[data-seccion-horas] [data-horas-fert]') && document.querySelector('[data-abrir-horas]').getAttribute('aria-expanded') === 'false'") -eq $true) 'F: la seccion «Registrar horas de riego» existe y empieza cerrada'
    OK ((JS "$(Cant $SOL)?.value") -eq '3' -and (JS "$(Cant $ACI)?.value") -eq '2') 'E: el plan propone SOL 3 y ACI 2'
    Teclear (Cant $SOL) '0'
    Guardar
    $t = Esperar "!document.querySelector('[data-selector-turno]')" 8000
    OK ($t -ge 0) 'E: con SOL en 0 se guarda sin error' (ErrorForm)
    $null = EsperarSync
    $a = Apls; for ($i = 0; $i -lt 10 -and $a.Count -lt 1; $i++) { Start-Sleep 1; $a = Apls }
    $d = if ($a.Count) { Detalle $a[0].id } else { @() }
    OK ($a.Count -eq 1 -and $d.Count -eq 1 -and $d[0].material_id -eq $aciId -and [double]$d[0].cantidad -eq 2) 'E: la aplicacion trae SOLO el producto > 0 (ACI 2)' "apls $($a.Count), det $(($d | ConvertTo-Json -Compress))"
    OK ((OpsTipo 'bitacora').Count -eq 0 -and (Bita $hoy).Count -eq 0) 'F: seccion cerrada = solo la aplicacion (sin bitacora)'

    # ============ E: todo en 0 / texto invalido ============
    AplicarDesde 5
    Teclear (Cant $SOL) '0'; Teclear (Cant $ACI) '0,0'
    Guardar
    $e1 = ErrorForm
    OK ((JS "!!document.querySelector('[data-selector-turno]')") -eq $true -and $e1 -match 'Agrega al menos un producto con su cantidad') 'E: todo en 0 = «Agrega al menos un producto con su cantidad.» y no cierra' $e1
    Teclear (Cant $SOL) '1,2,3'
    Guardar
    $e2 = ErrorForm
    OK ($e2 -match 'cantidad v.lida') 'E: texto invalido sigue dando error' $e2
    OK ((JS "$(Cant $SOL)?.value") -eq '123' -or (JS "$(Cant $SOL)?.value") -match '^[\d.,]+$') 'E: el campo no acepta el signo menos (solo cifras, punto y coma)'

    # ============ F2: horas fuera de rango = error y no se guarda nada ============
    Teclear (Cant $SOL) '1'
    ClicHasta "document.querySelector('[data-abrir-horas]')" "!!document.querySelector('[data-seccion-horas] [data-horas-fert]')" | Out-Null
    OK ((JS "['data-horas-fert','data-horas-riego','data-pct-fert','data-ppm-cabezal','data-ppm-campo'].every(a => document.querySelector('[data-seccion-horas] [' + a + ']')) && document.querySelectorAll('[data-seccion-horas] input[type=datetime-local]').length === 2") -eq $true) 'F: la seccion trae los mismos campos que Horas (5 + inicio/fin)'
    Teclear "document.querySelector('[data-seccion-horas] [data-horas-fert]')" '30'
    Guardar
    $e3 = ErrorForm
    Start-Sleep 3
    OK ((JS "!!document.querySelector('[data-selector-turno]')") -eq $true -and $e3 -match 'entre 0 y 24') 'F: 30 horas = error «entre 0 y 24» y no cierra' $e3
    OK ((Apls).Count -eq 1 -and (Pendientes) -eq 0 -and (OpsTipo 'bitacora').Count -eq 0) 'F: con el error NO se guardo nada (ni aplicacion ni bitacora)'

    # ============ F3: con horas validas = aplicacion + bitacora ============
    Teclear "document.querySelector('[data-seccion-horas] [data-horas-fert]')" '2'
    Teclear "document.querySelector('[data-seccion-horas] [data-horas-riego]')" '3'
    Teclear "document.querySelector('[data-seccion-horas] [data-pct-fert]')" '100'
    OK ((JS "/con datos/.test(document.querySelector('[data-abrir-horas]').textContent)") -eq $true) 'F: la seccion marca «con datos»'
    Guardar
    $t = Esperar "!document.querySelector('[data-selector-turno]')" 8000
    OK ($t -ge 0) 'F: aplicacion + horas se guarda y cierra' (ErrorForm)
    $null = EsperarSync
    $bt = Bita $hoy; for ($i = 0; $i -lt 10 -and $bt.Count -lt 1; $i++) { Start-Sleep 1; $bt = Bita $hoy }
    $a = Apls
    $d = if ($a.Count -ge 2) { Detalle $a[1].id } else { @() }
    OK ($a.Count -eq 2 -and $d.Count -eq 1 -and $d[0].material_id -eq $solId) 'F: llega la segunda aplicacion (solo SOL 1; ACI en 0 no va)' "apls $($a.Count), det $(($d | ConvertTo-Json -Compress))"
    OK ($bt.Count -eq 1 -and [double]$bt[0].horas_fertilizacion -eq 2 -and [double]$bt[0].horas_riego -eq 3 -and [double]$bt[0].pct_fertilizacion -eq 100 -and $bt[0].turno_ciclo_id -eq $tcId -and $bt[0].fecha -eq $a[1].fecha) 'F: la bitacora llega con el mismo turno y dia (2 h / 3 h / 100 %)' "$(($bt | Select-Object horas_fertilizacion,horas_riego,pct_fertilizacion,fecha | ConvertTo-Json -Compress))"
    $ob = OpsTipo 'bitacora'; $oa = OpsTipo 'aplicacion'
    OK ($ob.Count -eq 1 -and $ob[0].resultado -like 'ACEPTADO*' -and $oa.Count -eq 2 -and -not ($oa | Where-Object { $_.resultado -notlike 'ACEPTADO*' })) 'F: dos operaciones (aplicacion + bitacora) ACEPTADAS' "bit $($ob.Count) $($ob[0].resultado), apl $($oa.Count)"

    # ============ F4: ya registrada: se muestra y no se reenvia ============
    $null = Abrir 'f4'
    AplicarDesde 5
    ClicHasta "document.querySelector('[data-abrir-horas]')" "!!document.querySelector('[data-seccion-horas] [data-horas-fert]')" | Out-Null
    $vals = JS "['data-horas-fert','data-horas-riego','data-pct-fert'].map(a => document.querySelector('[data-seccion-horas] [' + a + ']').value).join('|')"
    OK ($vals -eq '2|3|100') 'F: con bitacora del dia, la seccion muestra lo registrado' $vals
    OK ((JS "!/con datos/.test(document.querySelector('[data-abrir-horas]').textContent)") -eq $true) 'F: sin tocar, no marca «con datos»'
    Teclear (Cant $SOL) '1'; Teclear (Cant $ACI) '0'
    Guardar
    Esperar "!document.querySelector('[data-selector-turno]')" 8000 | Out-Null
    $null = EsperarSync
    $a = Apls; for ($i = 0; $i -lt 8 -and $a.Count -lt 3; $i++) { Start-Sleep 1; $a = Apls }
    OK ($a.Count -eq 3 -and (OpsTipo 'bitacora').Count -eq 1) 'F: sin cambios en horas: solo va la aplicacion (la bitacora no se reenvia)' "apls $($a.Count), bit $((OpsTipo 'bitacora').Count)"

    # ============ F5: escrita pero la seccion cerrada = no se manda ============
    AplicarDesde 5
    ClicHasta "document.querySelector('[data-abrir-horas]')" "!!document.querySelector('[data-seccion-horas] [data-horas-fert]')" | Out-Null
    Teclear "document.querySelector('[data-seccion-horas] [data-horas-fert]')" '7'
    ClicHasta "document.querySelector('[data-abrir-horas]')" "!document.querySelector('[data-seccion-horas] [data-horas-fert]')" | Out-Null
    Teclear (Cant $SOL) '1'; Teclear (Cant $ACI) '0'
    Guardar
    Esperar "!document.querySelector('[data-selector-turno]')" 8000 | Out-Null
    $null = EsperarSync
    $a = Apls; for ($i = 0; $i -lt 8 -and $a.Count -lt 4; $i++) { Start-Sleep 1; $a = Apls }
    $bt = Bita $hoy
    OK ($a.Count -eq 4 -and (OpsTipo 'bitacora').Count -eq 1 -and [double]$bt[0].horas_fertilizacion -eq 2) 'F: seccion cerrada con algo escrito: no manda la bitacora' "apls $($a.Count), hf $($bt[0].horas_fertilizacion)"

    # ============ G: formulario Horas (FormBitacora) igual que antes ============
    PorTurno
    ClicHasta "document.querySelector('[data-tarjeta-ddt=""4""] [data-horas-dia]')" "!!document.querySelector('[data-horas-fert]')" | Out-Null
    Start-Sleep -Milliseconds 600
    OK ((JS "['data-horas-fert','data-horas-riego','data-pct-fert','data-ppm-cabezal','data-ppm-campo'].every(a => document.querySelector('[' + a + ']')) && !document.querySelector('[data-seccion-horas]')") -eq $true) 'G: Horas trae los mismos data-* (sin seccion plegable)'
    Guardar
    $e4 = ErrorForm
    OK ($e4 -match 'Escribe al menos las horas de fertilizaci.n o de riego') 'G: vacio = «Escribe al menos…»' $e4
    Teclear "document.querySelector('[data-horas-fert]')" '25'
    Guardar
    $e5 = ErrorForm
    OK ($e5 -match 'entre 0 y 24') 'G: 25 h = «entre 0 y 24»' $e5
    Teclear "document.querySelector('[data-ppm-cabezal]')" '2000'; Teclear "document.querySelector('[data-horas-fert]')" '4'
    Guardar
    $e6 = ErrorForm
    OK ($e6 -match 'ppm de cloro del cabezal deben estar entre 0 y 1000') 'G: ppm 2000 = error de cloro' $e6
    Teclear "document.querySelector('[data-ppm-cabezal]')" '3'
    Guardar
    $t = Esperar "!document.querySelector('[data-horas-fert]')" 8000
    $null = EsperarSync
    $bt = Bita $ayer; for ($i = 0; $i -lt 8 -and $bt.Count -lt 1; $i++) { Start-Sleep 1; $bt = Bita $ayer }
    OK ($t -ge 0 -and $bt.Count -eq 1 -and [double]$bt[0].horas_fertilizacion -eq 4 -and [double]$bt[0].ppm_cloro_cabezal -eq 3) 'G: Horas guarda (ayer: 4 h, cloro 3)' "$(($bt | Select-Object horas_fertilizacion,ppm_cloro_cabezal | ConvertTo-Json -Compress))"

    # ============ E: Recibir con un producto en 0 ============
    ClicHasta "document.querySelector('[data-pestana=estacion]')" "!!document.querySelector('[data-accion=recibir]')" | Out-Null
    ClicHasta "document.querySelector('[data-accion=recibir]')" "!!document.querySelector('[data-selector-chofer]')" | Out-Null
    Start-Sleep -Milliseconds 600
    CrearEnSelector '[data-selector-chofer] button' 'Agregar chofer' @("Chofer QA $s", '9999-0000')
    CrearEnSelector '[data-selector-vehiculo] button' 'Agregar veh' @("qa $s", 'Camion', 'Isuzu', 'Blanco')
    Teclear (Cant $SOL) '0'; Teclear (Cant $ACI) '0'
    Guardar
    $e7 = ErrorForm
    OK ($e7 -match 'cantidad de al menos un producto recibido') 'E: Recibir todo en 0 = pide al menos un producto' $e7
    Teclear (Cant $ACI) '5'
    Guardar
    $t = Esperar "!document.querySelector('[data-selector-chofer]')" 10000
    $null = EsperarSync
    $rec = Lista "fert_recepciones?select=id&estacion_id=eq.$estId"; for ($i = 0; $i -lt 8 -and $rec.Count -lt 1; $i++) { Start-Sleep 1; $rec = Lista "fert_recepciones?select=id&estacion_id=eq.$estId" }
    $rd = if ($rec.Count) { Lista "fert_recepciones_detalle?select=material_id,cantidad&recepcion_id=eq.$($rec[0].id)" } else { @() }
    OK ($t -ge 0 -and $rec.Count -eq 1 -and $rd.Count -eq 1 -and $rd[0].material_id -eq $aciId) 'E: Recibir con SOL 0 y ACI 5: solo registra ACI' "rec $($rec.Count), det $(($rd | ConvertTo-Json -Compress)) $(ErrorForm)"

    $ancho = JS "document.documentElement.scrollWidth"
    OK ($ancho -le 420) 'Telefono: sin desplazamiento lateral' "scrollWidth $ancho"
    $e = Errores-Pagina; OK (-not $e) 'Sin errores en la pagina' $e
}
catch { $script:Resultados.Add("EXCEPCION (linea $($_.InvocationInfo.ScriptLineNumber)) $($_.Exception.Message) $($_.ErrorDetails.Message)") }
finally {
    try {
        if ($qaId) { Rest "fert_historico_permisos?persona_id=eq.$qaId" 'Delete' -Servicio | Out-Null }
        if ($estId) {
            foreach ($t in 'fert_movimientos', 'fert_saldos', 'fert_bitacora_riego', 'fert_custodia', 'fert_relevos') { Rest "${t}?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null }
            foreach ($x in (Lista "fert_aplicaciones?select=id&estacion_id=eq.$estId")) { Rest "fert_aplicaciones_detalle?aplicacion_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null }
            Rest "fert_aplicaciones?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            $choferes = @(); $vehiculos = @()
            foreach ($x in (Lista "fert_recepciones?select=id,chofer_id,vehiculo_id&estacion_id=eq.$estId")) { Rest "fert_recepciones_detalle?recepcion_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null; $choferes += $x.chofer_id; if ($x.vehiculo_id) { $vehiculos += $x.vehiculo_id } }
            Rest "fert_recepciones?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            foreach ($x in (Lista "fert_conteos?select=id&estacion_id=eq.$estId")) { Rest "fert_conteos_detalle?conteo_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null }
            Rest "fert_conteos?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            if ($qaId) { Rest "fert_operaciones?perfil_id=eq.$qaId" 'Delete' -Servicio | Out-Null }
            foreach ($c in ($choferes | Select-Object -Unique)) { if ($c) { Rest "fert_choferes_vehiculos?chofer_id=eq.$c" 'Delete' -Servicio | Out-Null; Rest "fert_choferes?id=eq.$c" 'Delete' -Servicio | Out-Null } }
            foreach ($v in ($vehiculos | Select-Object -Unique)) { Rest "fert_vehiculos?id=eq.$v" 'Delete' -Servicio | Out-Null }
            foreach ($c in (Lista "fert_choferes?select=id&nombre=eq.$([uri]::EscapeDataString("Chofer QA $s"))")) { Rest "fert_choferes_vehiculos?chofer_id=eq.$($c.id)" 'Delete' -Servicio | Out-Null; Rest "fert_choferes?id=eq.$($c.id)" 'Delete' -Servicio | Out-Null }
            Rest "fert_vehiculos?placa=eq.QA$s" 'Delete' -Servicio | Out-Null
            $tc = Lista "turnos_ciclo?select=id,turno_id&agl_id=eq.TR-QA-$s"
            foreach ($x in $tc) { Rest "fert_plan?turno_ciclo_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null; Rest "turnos_ciclo?id=eq.$($x.id)" 'Delete' -Servicio | Out-Null; Rest "turnos?id=eq.$($x.turno_id)" 'Delete' -Servicio | Out-Null }
            Rest "perfiles_estaciones?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            Rest "estaciones_riego?id=eq.$estId" 'Delete' -Servicio | Out-Null
        }
        foreach ($c in $SOL, $ACI) { Rest "materiales?codigo=eq.$c" 'Delete' -Servicio | Out-Null }
        Rest "fert_publicaciones?temporada=eq.$([uri]::EscapeDataString("QA $s"))" 'Delete' -Servicio | Out-Null
    } catch { $script:Resultados.Add("LIMPIEZA datos: $($_.Exception.Message) $($_.ErrorDetails.Message)") }
    try {
        if ($qaId) {
            Roles $rolTotal
            foreach ($t in 'perfiles_zonas', 'perfiles_estaciones', 'fert_llaves') { Rest "${t}?perfil_id=eq.$qaId" 'Delete' -Servicio | Out-Null }
            Rest "perfiles?id=eq.$qaId" 'Delete' -Servicio | Out-Null
            Invoke-RestMethod -Method Delete -Uri "$URLB/auth/v1/admin/users/$qaId" -Headers $hServ | Out-Null
        }
        if ($rolEst) { Rest "permisos?rol_id=eq.$rolEst" 'Delete' -Servicio | Out-Null; Rest "roles?id=eq.$rolEst" 'Delete' -Servicio | Out-Null }
    } catch { $script:Resultados.Add("LIMPIEZA usuario/rol QA: $($_.Exception.Message) $($_.ErrorDetails.Message)") }
    Remove-Item $archivoQa -ErrorAction SilentlyContinue
    try {
        $quedaUsr = 0; try { Invoke-RestMethod "$URLB/auth/v1/admin/users/$qaId" -Headers $hServ | Out-Null; $quedaUsr = 1 } catch {}
        $restos = (Lista "perfiles?select=id&id=eq.$qaId").Count + (Lista "estaciones_riego?select=id&nombre=eq.$([uri]::EscapeDataString($EST))").Count + (Lista "materiales?select=id&codigo=in.($SOL,$ACI)").Count + (Lista "turnos_ciclo?select=id&agl_id=eq.TR-QA-$s").Count + $(if ($rolEst) { (Lista "roles?select=id&id=eq.$rolEst").Count } else { 0 }) + (Lista "fert_choferes?select=id&nombre=eq.$([uri]::EscapeDataString("Chofer QA $s"))").Count
        OK ($quedaUsr -eq 0 -and $restos -eq 0) 'Limpieza: usuario, rol, estacion y datos de prueba borrados de desarrollo' "usuario $quedaUsr, restos $restos"
    } catch { $script:Resultados.Add("LIMPIEZA verificacion: $($_.Exception.Message)") }
    Terminar-QA
}
