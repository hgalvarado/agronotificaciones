# QA · Fertirriego › pestaña Bitácora agrupada por TIPO de movimiento (secciones plegables). Base de DESARROLLO.
# Autocontenido sobre comun.ps1: crea un usuario QA temporal (y su qa_usuario.local.json), una estación de prueba con
# turno/plan/productos, genera movimientos con la UI y al final BORRA todo (usuario, estación, datos, rol temporal).
# Uso: powershell -ExecutionPolicy Bypass -File pruebas/qa/fertirriego_bitacora_grupos.ps1 -CarpetaServidor <worktree con next build> [-Puerto 3101]
param([string]$CarpetaServidor, [int]$Puerto = 3101, [int]$PuertoCdp = 9335)
. "$PSScriptRoot\comun.ps1"
$BASE = "http://localhost:$Puerto"
$envd = Leer-Entorno
$URLB = $envd['NEXT_PUBLIC_SUPABASE_URL']; $SERV = $envd['SUPABASE_SERVICE_ROLE_KEY']
$hServ = @{ apikey = $SERV; Authorization = "Bearer $SERV" }
$s = Get-Random -Maximum 99999
$archivoQa = "$PSScriptRoot\qa_usuario.local.json"
$qaId = $null; $rolEst = $null; $estId = $null
$EST = "PRUEBA · QA Bit $s"; $TURNO = "TQB-$s"; $SOL = "QB-SOL-$s"; $ACI = "QB-ACI-$s"
$hoy = (Get-Date).ToString('yyyy-MM-dd'); $ayer = (Get-Date).AddDays(-1).ToString('yyyy-MM-dd')

# ---- usuario QA temporal ----
$qaEmail = "qa.bit.$([guid]::NewGuid().ToString('N').Substring(0,10))@desarrollo.local"; $qaClave = "Qa-$(Get-Random)-x$(Get-Random)"
$usr = Invoke-RestMethod -Method Post -Uri "$URLB/auth/v1/admin/users" -Headers $hServ -ContentType 'application/json' -Body (@{ email = $qaEmail; password = $qaClave; email_confirm = $true } | ConvertTo-Json)
$qaId = $usr.id
$rolTotal = (Invoke-RestMethod "$URLB/rest/v1/roles?select=id&acceso_total=eq.true&order=id&limit=1" -Headers $hServ)[0].id
Invoke-RestMethod -Method Post "$URLB/rest/v1/perfiles" -Headers $hServ -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes((@{ id = $qaId; nombre = "QA Bitacora $s"; rol_id = $rolTotal; todas_las_zonas = $true } | ConvertTo-Json))) | Out-Null
@{ id = $qaId; email = $qaEmail; clave = $qaClave } | ConvertTo-Json | Set-Content -Encoding utf8 $archivoQa

Iniciar-QA -Base $BASE -Ancho 412 -Alto 915 -Movil -Puerto $PuertoCdp

function Lista($ruta, $metodo = 'Get', $cuerpo = $null) { $r = Rest $ruta $metodo $cuerpo -Servicio; $o = New-Object System.Collections.ArrayList; foreach ($x in $r) { if ($null -ne $x) { [void]$o.Add($x) } }; return ,$o }
function ClicEn($js) { JS "(() => { const e = $js; if (!e) return false; e.scrollIntoView({block:'center'}); e.click(); return true })()" }
function ClicHasta($js, $condicion, [int]$veces = 15) { for ($i = 0; $i -lt $veces; $i++) { ClicEn $js | Out-Null; if ((Esperar $condicion 700) -ge 0) { return $true } }; return $false }
$ULTIMO_DIALOGO = "[...document.querySelectorAll('[role=dialog]')].pop()"
function ElegirOpcion($selectorBoton, $texto) {
    ClicHasta "document.querySelector('$selectorBoton')" "document.querySelectorAll('[role=dialog]').length > 0 && !!$ULTIMO_DIALOGO.querySelector('input[inputmode=search]')" | Out-Null
    $ok = ClicEn "[...$ULTIMO_DIALOGO.querySelectorAll('button')].find(b => b.innerText.trim().toLowerCase().startsWith('$($texto.ToLower())'))"
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
function ElegirFiltro($selectorBoton, $texto) {
    $PANEL = "[...document.querySelectorAll('div.fixed.z-50')].pop()"
    ClicHasta "document.querySelector('$selectorBoton')" "!!$PANEL && !!$PANEL.querySelector('input')" | Out-Null
    $ok = ClicEn "[...$PANEL.querySelectorAll('button')].find(b => b.textContent.trim().toLowerCase().startsWith('$($texto.ToLower())'))"
    Start-Sleep -Milliseconds 500
    return $ok
}
function EsperarConteo($ruta, [int]$n) { for ($q = 0; $q -lt 15; $q++) { if ((Lista $ruta).Count -ge $n) { return $true }; Start-Sleep 2 }; return $false }
function EsperarSync { Start-Sleep -Milliseconds 1800; Esperar "!document.querySelector('[data-pendientes-cuenta]')" 60000 | Out-Null }
# Estado de los grupos en pantalla (JSON)
$G_JS = "JSON.stringify([...document.querySelectorAll('[data-grupo]')].map(s => ({ t: s.dataset.grupo, c: Number(s.querySelector('[data-grupo-cuenta]').dataset.grupoCuenta), txt: s.querySelector('[data-grupo-cuenta]').textContent.trim(), n: s.querySelectorAll('[data-movimiento]').length, exp: s.querySelector('[data-grupo-cabecera]').getAttribute('aria-expanded'), flecha: s.querySelector('[data-grupo-cabecera]').textContent.trim()[0] })))"
function Grupos { return (JS $G_JS | ConvertFrom-Json) }
function IrBitacora { ClicHasta "document.querySelector('[data-pestana=bitacora]')" "!!document.querySelector('[data-filtros-bitacora]')" | Out-Null; Start-Sleep -Milliseconds 400 }
function PonerFecha($sel, $valor) { JS "(() => { const i = document.querySelector('$sel'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '$valor'); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()" | Out-Null; Start-Sleep -Milliseconds 400 }

try {
    # ============ Preparación ============
    $z1 = (Lista 'zonas?select=id,nombre&activo=eq.true&order=nombre&limit=1')[0]
    $estId = (Rest 'estaciones_riego' 'Post' @{ nombre = $EST; zona_id = $z1.id } -Servicio)[0].id
    $pub = Rest 'rpc/fn_fert_publicar' 'Post' @{ p = @{
        temporada = "QA $s"
        estaciones = @(@{ nombre = $EST; zona = $z1.nombre })
        materiales = @(@{ codigo = $SOL; descripcion = "SOLUCION QA $s"; unidad = 'L'; grupo = '1800' }, @{ codigo = $ACI; descripcion = "ACIDO QA $s"; unidad = 'L'; grupo = '1800' })
        turnos = @(@{ agl_id = "TR-QB-$s"; turno = $TURNO; temporada = "QA $s"; ciclo = 'Ciclo QA'; fecha_siembra = (Get-Date).AddDays(-5).ToString('yyyy-MM-dd'); estacion = $EST; zona = $z1.nombre; area_mz = 10; estado = 'Creado' })
        plan = @(@{ agl_id = "TR-QB-$s"; filas = @(@{ fecha = $hoy; ddt = 5; material = $SOL; cantidad = 120 }, @{ fecha = $hoy; ddt = 5; material = $ACI; cantidad = 4 }) })
    } }
    OK ($pub.turnos -eq 1 -and $pub.filas_plan -eq 2) 'Preparación: estación de prueba, turno, plan y productos' "turnos $($pub.turnos), plan $($pub.filas_plan)"
    Rest 'perfiles_estaciones' 'Post' @{ perfil_id = $qaId; estacion_id = $estId } -Servicio | Out-Null
    # Jefe (admin): asigna custodia
    Ir "/fertirriego?r=$s"
    $t = Esperar "!!document.querySelector('[data-barra-estado]') && !!document.querySelector('[data-estacion]')" 60000
    OK ($t -ge 0) 'Abre Fertirriego' "$t ms"
    ElegirOpcion '[data-selector-estacion] button' $EST | Out-Null
    Esperar "document.querySelector('[data-estacion]')?.dataset.estacion === '$EST'" 10000 | Out-Null
    ClicHasta "document.querySelector('[data-asignar-custodia]')" "!!document.querySelector('[data-selector-custodio]')" | Out-Null
    ElegirOpcion '[data-selector-custodio] button' "QA Bitacora $s" | Out-Null
    Teclear "document.querySelector('[data-motivo-custodia]')" 'Arranque QA'
    ClicEn "document.querySelector('[data-guardar-custodia]')" | Out-Null
    $t = Esperar "/a tu cargo/.test(document.querySelector('[data-custodia]')?.innerText || '')" 25000
    OK ($t -ge 0) 'Custodia asignada'
    # Estacionero
    $rolEst = (Rest 'roles' 'Post' @{ codigo = "QA_BIT_$s"; nombre = "QA Estacionero Bit $s" } -Servicio)[0].id
    foreach ($a in 'ver', 'recibir', 'aplicar', 'contar', 'relevo', 'anular') { Rest 'permisos' 'Post' @{ rol_id = $rolEst; recurso = 'fertirriego'; accion = $a; alcance = 'propietario' } -Servicio | Out-Null }
    Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($rolEst); p_principal = $rolEst } -Servicio | Out-Null
    CDP 'Browser.grantPermissions' @{ permissions = @('geolocation'); origin = $BASE } | Out-Null
    CDP 'Emulation.setGeolocationOverride' @{ latitude = 13.312; longitude = -87.195; accuracy = 12 } | Out-Null
    Ir "/fertirriego?r=$s-b"
    $t = Esperar "document.querySelector('[data-estacion]')?.dataset.estacion === '$EST'" 60000
    OK ($t -ge 0) 'El estacionero ve su estación' "$t ms"

    # ---- B7a: sin movimientos ----
    IrBitacora
    Esperar "/Sin movimientos todav/.test(document.body.innerText)" 8000 | Out-Null
    $txt = JS "document.body.innerText"
    $script:Resultados.Add("DIAG B7: grupos=$(@(Grupos).Count) expandir=$(JS "!!document.querySelector('[data-expandir-todo]')") texto=$(($txt -replace "`n",' / ').Substring(0, [Math]::Min(400, $txt.Length)))")
    $script:Resultados.Add("DIAG B7 html: $((JS "document.querySelector('[data-filtros-bitacora]')?.parentElement?.parentElement?.parentElement?.innerText") -replace "`n",' / ')")
    OK ($txt -match 'Sin movimientos todavía\.' -and -not (JS "!!document.querySelector('[data-expandir-todo]') || !!document.querySelector('[data-contraer-todo]')") -and @(Grupos).Count -eq 0) 'B7 sin movimientos: mensaje y sin botones Expandir/Contraer'
    ClicHasta "document.querySelector('[data-pestana=estacion]')" "!!document.querySelector('[data-accion=contar]')" | Out-Null

    # ============ Generar movimientos ============
    # SALDO_INICIAL
    ClicHasta "document.querySelector('[data-accion=contar]')" "!!document.querySelector('[data-conteo]')" | Out-Null
    Teclear "document.querySelector('[data-conteo-material=""$SOL""] input')" '500'
    Teclear "document.querySelector('[data-conteo-material=""$ACI""] input')" '50'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    Esperar "!document.querySelector('[data-conteo]')" 15000 | Out-Null; EsperarSync
    OK ((Lista "fert_movimientos?select=tipo&estacion_id=eq.$estId&tipo=eq.SALDO_INICIAL").Count -ge 1) 'Generado: saldo inicial'
    # RECEPCION
    ClicHasta "document.querySelector('[data-accion=recibir]')" "!!document.querySelector('[data-selector-chofer]')" | Out-Null
    CrearEnSelector '[data-selector-chofer] button' 'Agregar chofer' @("Chofer QA $s", '9999-0000')
    CrearEnSelector '[data-selector-vehiculo] button' 'Agregar vehículo' @("qb $s", 'Camión', 'Isuzu', 'Blanco')
    Teclear "document.querySelector('[data-linea-codigo=""$SOL""] [data-cantidad]')" '1000'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    Esperar "!document.querySelector('[data-selector-chofer]')" 15000 | Out-Null; EsperarSync
    if (-not (EsperarConteo "fert_recepciones?select=id&estacion_id=eq.$estId" 1)) { $script:Resultados.Add("DIAG recepción: dialogo=$((JS "[...document.querySelectorAll('[role=dialog]')].map(d => d.innerText.substring(0,400)).join(' ||| ')") -replace "`n",' / ')"); foreach ($x in (Lista "fert_operaciones?select=tipo,resultado,mensaje&perfil_id=eq.$qaId&order=recibido_en.desc&limit=4")) { $script:Resultados.Add("DIAG op $($x.tipo) $($x.resultado) $($x.mensaje)") } }
    OK ((Lista "fert_recepciones?select=id&estacion_id=eq.$estId").Count -eq 1) 'Generado: entrega recibida'
    # APLICACION 1 (en línea) desde «Plan de hoy»
    $okp = ClicHasta "document.querySelector('[data-plan-turno=""$TURNO""]')" "!!document.querySelector('[data-selector-turno]')"
    if (-not $okp) { $script:Resultados.Add("DIAG plan: botones=$(JS "document.querySelectorAll('[data-plan-turno]').length") accion=$(JS "[...document.querySelectorAll('[data-accion]')].map(b=>b.dataset.accion).join(',')") dialogo=$((JS "[...document.querySelectorAll('[role=dialog]')].map(d => d.innerText).join(' ||| ')") -replace "`n",' / ') pagina=$((JS "document.body.innerText.substring(0,500)") -replace "`n",' / ')"); Captura 'fert_bit_diag_plan.png' }
    Esperar "[...document.querySelectorAll('[data-cantidad]')].some(i => i.value)" 8000 | Out-Null
    $pre = JS "[...document.querySelectorAll('[data-cantidad]')].map(i => i.value).join('|')"
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    $tq = Esperar "!document.querySelector('[data-selector-turno]')" 15000; EsperarSync
    if (-not (EsperarConteo "fert_aplicaciones?select=id&estacion_id=eq.$estId" 1)) {
        $script:Resultados.Add("DIAG aplicación 1: cantidades=$pre cierre=$tq dialogo=$((JS "[...document.querySelectorAll('[role=dialog]')].map(d => d.innerText).join(' ||| ')") -replace "`n",' / ')")
        foreach ($x in (Lista "fert_operaciones?select=tipo,resultado,mensaje&perfil_id=eq.$qaId&order=recibido_en.desc&limit=4")) { $script:Resultados.Add("DIAG op $($x.tipo) $($x.resultado) $($x.mensaje)") }
        Captura 'fert_bit_diag_apl.png'
    }
    OK ((Lista "fert_aplicaciones?select=id&estacion_id=eq.$estId").Count -ge 1) 'Generado: aplicación 1'
    # DEVOLUCION de la aplicación 1 (desde la bitácora)
    IrBitacora
    ClicHasta "document.querySelector('[data-movimiento=APLICACION]')" "!!document.querySelector('[data-detalle-documento]')" | Out-Null
    ClicHasta "document.querySelector('[data-modo-devolver]')" "!!document.querySelector('[data-motivo]')" | Out-Null
    Start-Sleep -Milliseconds 400
    Teclear "document.querySelector('[data-cantidad=""0""]')" '10'
    Teclear "document.querySelector('[data-motivo]')" 'Sobró en el tanque (QA)'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    Esperar "!document.querySelector('[data-detalle-documento]')" 15000 | Out-Null; EsperarSync
    EsperarConteo "fert_devoluciones?select=id&estacion_id=eq.$estId" 1 | Out-Null
    OK ((Lista "fert_devoluciones?select=id&estacion_id=eq.$estId").Count -eq 1) 'Generado: devolución a bodega'
    # AJUSTE_CONTEO: contar SOL con otro valor
    ClicHasta "document.querySelector('[data-pestana=estacion]')" "!!document.querySelector('[data-accion=contar]')" | Out-Null
    ClicHasta "document.querySelector('[data-accion=contar]')" "!!document.querySelector('[data-conteo]')" | Out-Null
    Teclear "document.querySelector('[data-conteo-material=""$SOL""] input')" '1300'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    Esperar "!document.querySelector('[data-conteo]')" 15000 | Out-Null
    # Si pide confirmar/motivo
    Start-Sleep -Milliseconds 800
    if (JS "!!document.querySelector('[data-conteo]')") { $script:Resultados.Add("DIAG conteo2 sigue abierto: $((JS "document.querySelector('[role=dialog]')?.innerText") -replace "`n",' / ')") }
    EsperarSync
    $ajustes = 0; for ($q = 0; $q -lt 10 -and $ajustes -lt 1; $q++) { $ajustes = (Lista "fert_movimientos?select=tipo&estacion_id=eq.$estId&tipo=eq.AJUSTE_CONTEO").Count; if ($ajustes -lt 1) { Start-Sleep 2 } }
    OK ($ajustes -ge 1) 'Generado: ajuste por conteo' "$ajustes"

    # ---- SIN SEÑAL: aplicación 2 queda «por enviar» ----
    CDP 'Network.enable' | Out-Null
    CDP 'Network.setBlockedURLs' @{ urls = @('*supabase.co*') } | Out-Null
    ClicHasta "document.querySelector('[data-pestana=estacion]')" "!!document.querySelector('[data-plan-turno=""$TURNO""]')" | Out-Null
    ClicHasta "document.querySelector('[data-plan-turno=""$TURNO""]')" "!!document.querySelector('[data-selector-turno]')" | Out-Null
    Esperar "[...document.querySelectorAll('[data-cantidad]')].some(i => i.value)" 8000 | Out-Null
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    Esperar "!document.querySelector('[data-selector-turno]')" 15000 | Out-Null; Esperar "!!document.querySelector('[data-pendientes-cuenta]')" 10000 | Out-Null; Start-Sleep 1
    $script:Resultados.Add("DIAG offline: pend=$(Pendientes) barra=$(JS "document.querySelector('[data-barra-estado]')?.dataset.barraEstado") dialogo=$((JS "[...document.querySelectorAll('[role=dialog]')].map(d => d.innerText.substring(0,300)).join(' ||| ')") -replace "`n",' / ')")
    OK ((Pendientes) -eq 1) 'Sin señal: aplicación 2 guardada en el teléfono (1 por enviar)'
    IrBitacora
    $r = JS "(() => { const s = document.querySelector('[data-grupo=APLICACION]'); if (!s) return 'sin grupo'; const b = [...s.querySelectorAll('[data-movimiento]')].find(x => /por enviar/i.test(x.textContent)); return b ? ('ok|' + b.disabled) : 'sin fila pendiente' })()"
    OK ($r -eq 'ok|True') 'B8 registro «por enviar»: sale en su grupo Aplicaciones con insignia y botón deshabilitado' $r
    CDP 'Network.setBlockedURLs' @{ urls = @() } | Out-Null
    ClicEn "document.querySelector('[data-actualizar]')" | Out-Null
    Esperar "!document.querySelector('[data-pendientes-cuenta]') && document.querySelector('[data-barra-estado]').dataset.barraEstado === 'en_linea'" 60000 | Out-Null
    IrBitacora
    foreach ($x in (Lista "fert_operaciones?select=tipo,resultado,mensaje,recibido_en&perfil_id=eq.$qaId&tipo=eq.aplicacion&order=recibido_en.asc")) { $script:Resultados.Add("DIAG opapl $($x.resultado) $($x.mensaje) $($x.recibido_en)") }
    foreach ($x in (Lista "fert_aplicaciones?select=id,fecha&estacion_id=eq.$estId")) { $script:Resultados.Add("DIAG apl $($x.id) $($x.fecha)") }
    $script:Resultados.Add("DIAG online: pend=$(Pendientes) apl=$((Lista "fert_aplicaciones?select=id&estacion_id=eq.$estId").Count) barra=$(JS "document.querySelector('[data-barra-estado]')?.innerText")")
    EsperarConteo "fert_aplicaciones?select=id&estacion_id=eq.$estId" 2 | Out-Null
    OK ((Lista "fert_aplicaciones?select=id&estacion_id=eq.$estId").Count -eq 2) 'Con señal: la aplicación 2 llega (2 en la base)'

    # ANULACION: anular la aplicación 2 (la más reciente = primera fila)
    ClicHasta "document.querySelector('[data-grupo=APLICACION] [data-movimiento]')" "!!document.querySelector('[data-detalle-documento]')" | Out-Null
    ClicHasta "document.querySelector('[data-modo-anular]')" "!!document.querySelector('[data-motivo]')" | Out-Null
    Teclear "document.querySelector('[data-motivo]')" 'Anulada por QA de bitácora'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    Esperar "!document.querySelector('[data-detalle-documento]')" 15000 | Out-Null; EsperarSync
    IrBitacora
    Start-Sleep 1

    # ============ B1 ============
    $g = @(Grupos)
    $tipos = @($g | ForEach-Object { $_.t })
    $ordenEsperado = @('APLICACION', 'RECEPCION', 'DEVOLUCION', 'AJUSTE_CONTEO', 'ANULACION', 'SALDO_INICIAL')
    $esperadoPresentes = @($ordenEsperado | Where-Object { $tipos -contains $_ })
    OK ($g.Count -ge 5) 'B1 hay una sección por tipo (≥5 tipos)' ($tipos -join ',')
    OK (($tipos -join ',') -eq ($esperadoPresentes -join ',')) 'B1 orden: Aplicaciones, Entregas, Devoluciones, Ajustes, Anulaciones, Saldo inicial' ($tipos -join ',')
    $cuentaOk = $true; foreach ($x in $g) { if ($x.c -ne $x.n -or $x.txt -ne "$($x.n)") { $cuentaOk = $false } }
    OK $cuentaOk 'B1 el contador de cada cabecera = filas [data-movimiento] del grupo' (($g | ForEach-Object { "$($_.t)=$($_.txt)/$($_.n)" }) -join ' ')
    $totalFilas = [int](JS "document.querySelectorAll('[data-movimiento]').length"); $cuentaBarra = [int](JS "document.querySelector('[data-cuenta-bitacora]').dataset.cuentaBitacora")
    OK ($totalFilas -eq $cuentaBarra -and ($g | Measure-Object c -Sum).Sum -eq $cuentaBarra) 'B1 contador de la barra = suma de grupos = filas' "$cuentaBarra"
    $nombres = JS "[...document.querySelectorAll('[data-grupo-cabecera]')].map(b => b.textContent.replace(/[▾▸]/g,'').trim().replace(/\s+\d+$/,'')).join('|')"
    OK ($nombres -match 'Aplicaciones' -and $nombres -match 'Entregas recibidas' -and $nombres -match 'Devoluciones a bodega' -and $nombres -match 'Ajustes por conteo' -and $nombres -match 'Anulaciones' -and $nombres -match 'Saldo inicial') 'B1 títulos de los grupos' $nombres
    OK ((JS "!!document.querySelector('[data-grupo] [data-dia]')") -eq $true) 'B1 dentro del grupo hay días [data-dia]'
    $e = Errores-Pagina; OK (-not $e) 'B1 sin errores de consola/página' $e

    # ============ B2 ============
    OK (@($g | Where-Object { $_.exp -ne 'true' -or $_.flecha -ne '▾' -or $_.n -lt 1 }).Count -eq 0) 'B2 todos arrancan expandidos (aria-expanded=true, ▾, filas visibles)'
    OK ((JS "!!document.querySelector('[data-expandir-todo]') && !!document.querySelector('[data-contraer-todo]')") -eq $true) 'B2 con 2+ grupos: aparecen Expandir todo / Contraer todo'

    # ============ B3 ============
    ClicEn "document.querySelector('[data-grupo-cabecera=APLICACION]')" | Out-Null; Start-Sleep -Milliseconds 400
    $a = @(Grupos) | Where-Object t -eq 'APLICACION'
    OK ($a.exp -eq 'false' -and $a.flecha -eq '▸' -and $a.n -eq 0 -and $a.c -ge 1) 'B3 tocar la cabecera contrae (filas fuera, ▸, aria-expanded=false, contador se mantiene)' "exp=$($a.exp) n=$($a.n) c=$($a.c)"
    $otros = @(Grupos) | Where-Object { $_.t -ne 'APLICACION' }
    OK (@($otros | Where-Object { $_.exp -ne 'true' }).Count -eq 0) 'B3 los otros grupos siguen expandidos'
    ClicEn "document.querySelector('[data-grupo-cabecera=APLICACION]')" | Out-Null; Start-Sleep -Milliseconds 400
    $a = @(Grupos) | Where-Object t -eq 'APLICACION'
    OK ($a.exp -eq 'true' -and $a.flecha -eq '▾' -and $a.n -eq $a.c) 'B3 tocarla otra vez expande'

    # ============ B4 ============
    ClicEn "document.querySelector('[data-contraer-todo]')" | Out-Null; Start-Sleep -Milliseconds 400
    $g = @(Grupos)
    OK (@($g | Where-Object { $_.exp -ne 'false' -or $_.n -ne 0 }).Count -eq 0 -and (JS "document.querySelectorAll('[data-movimiento]').length") -eq 0) 'B4 Contraer todo: todos contraídos y sin filas'
    OK ((JS "!!document.querySelector('[data-expandir-todo]')") -eq $true) 'B4 Expandir todo sigue visible con todo contraído'
    ClicEn "document.querySelector('[data-expandir-todo]')" | Out-Null; Start-Sleep -Milliseconds 400
    $g = @(Grupos)
    OK (@($g | Where-Object { $_.exp -ne 'true' -or $_.n -ne $_.c }).Count -eq 0) 'B4 Expandir todo: todos expandidos'

    # ============ B5 ============
    ClicEn "document.querySelector('[data-grupo-cabecera=RECEPCION]')" | Out-Null; Start-Sleep -Milliseconds 300   # contraer Entregas
    ClicHasta "document.querySelector('[data-grupo=APLICACION] [data-movimiento]:not([disabled])')" "!!document.querySelector('[data-detalle-documento]')" | Out-Null
    $det = JS "document.querySelector('[data-detalle-documento]')?.innerText || ''"
    OK ($det.Length -gt 20 -and $det -match 'SOLUCION QA|ACIDO QA|Plan|Aplicaci') 'B5 tocar una fila abre el detalle (DetalleDocumento)' (($det -split "`n" | Select-Object -First 6) -join ' / ')
    OK ($det -match 'QA Bitacora') 'B5 el detalle muestra quién'
    ClicHasta "[...document.querySelectorAll('button')].find(b => b.offsetParent !== null && b.textContent.trim() === 'Listo')" "!document.querySelector('[data-detalle-documento]')" | Out-Null
    $r = @(Grupos) | Where-Object t -eq 'RECEPCION'
    OK ((JS "!document.querySelector('[data-detalle-documento]')") -eq $true -and $r.exp -eq 'false') 'B5 «Listo» cierra el detalle y la bitácora conserva el grupo contraído' "RECEPCION exp=$($r.exp)"
    ClicEn "document.querySelector('[data-grupo-cabecera=RECEPCION]')" | Out-Null; Start-Sleep -Milliseconds 300

    # ============ B8 anulado ============
    $an = JS "(() => { const f = [...document.querySelectorAll('[data-grupo=APLICACION] [data-movimiento]')]; return JSON.stringify(f.map(b => ({ op: getComputedStyle(b).opacity, tach: !!b.querySelector('.line-through') }))) })()" | ConvertFrom-Json
    OK (@($an | Where-Object { $_.tach -and [double]$_.op -lt 1 }).Count -ge 1) 'B8 la aplicación anulada sigue en su grupo, tachada y opaca' (($an | ForEach-Object { "$($_.op)/$($_.tach)" }) -join ' ')

    # ============ B6 filtros ============
    ClicHasta "document.querySelector('[data-filtros-bitacora]')" "!!document.querySelector('[data-panel-filtros]')" | Out-Null
    ElegirFiltro '[data-filtro-tipo] button' 'Aplicaci' | Out-Null
    Start-Sleep -Milliseconds 500
    $g = @(Grupos)
    $cb = [int](JS "document.querySelector('[data-cuenta-bitacora]').dataset.cuentaBitacora")
    OK ($g.Count -eq 1 -and $g[0].t -eq 'APLICACION' -and $g[0].c -eq $cb -and $g[0].n -eq $cb -and -not (JS "!!document.querySelector('[data-expandir-todo]')")) 'B6 Tipo=Aplicación: solo ese grupo, contadores coinciden, sin Expandir/Contraer (1 grupo)' "grupos=$($g.Count) cuenta=$cb"
    ClicEn "document.querySelector('[data-limpiar-filtros]')" | Out-Null; Start-Sleep -Milliseconds 500
    $g = @(Grupos)
    OK ($g.Count -ge 5) 'B6 Limpiar restaura todos los grupos' "grupos=$($g.Count)"
    # Producto (ACI aparece solo en la aplicación del plan y su devolución)
    ClicHasta "document.querySelector('[data-filtros-bitacora]')" "!!document.querySelector('[data-panel-filtros]')" | Out-Null
    if (-not (JS "!!document.querySelector('[data-panel-filtros]')")) { ClicEn "document.querySelector('[data-filtros-bitacora]')" | Out-Null }
    ElegirFiltro '[data-filtro-producto] button' "ACIDO QA $s" | Out-Null
    Start-Sleep -Milliseconds 600
    $g = @(Grupos); $cb = [int](JS "document.querySelector('[data-cuenta-bitacora]').dataset.cuentaBitacora"); $nf = [int](JS "document.querySelectorAll('[data-movimiento]').length")
    OK ($g.Count -ge 1 -and $g.Count -lt 6 -and $nf -eq $cb -and ($g | Measure-Object c -Sum).Sum -eq $cb) 'B6 Producto=ACIDO: grupos y contadores reflejan lo filtrado' "grupos=$(($g | ForEach-Object { $_.t }) -join ',') filas=$nf barra=$cb"
    ClicEn "document.querySelector('[data-limpiar-filtros]')" | Out-Null; Start-Sleep -Milliseconds 500
    # Fecha: un día sin movimientos, y hoy
    if (-not (JS "!!document.querySelector('[data-panel-filtros]')")) { ClicEn "document.querySelector('[data-filtros-bitacora]')" | Out-Null; Start-Sleep -Milliseconds 300 }
    PonerFecha '[data-filtro-dia]' $ayer
    $g = @(Grupos)
    OK ($g.Count -eq 0 -and (JS "document.body.innerText") -match 'Ningún movimiento con estos filtros' -and -not (JS "!!document.querySelector('[data-expandir-todo]')")) 'B6 Fecha=ayer: sin grupos, mensaje de filtros y sin Expandir/Contraer'
    PonerFecha '[data-filtro-dia]' $hoy
    $g = @(Grupos); $cb = [int](JS "document.querySelector('[data-cuenta-bitacora]').dataset.cuentaBitacora")
    OK ($g.Count -ge 5 -and ($g | Measure-Object c -Sum).Sum -eq $cb) 'B6 Fecha=hoy: vuelven los grupos; suma = contador de la barra' "grupos=$($g.Count) barra=$cb"
    ClicEn "document.querySelector('[data-limpiar-filtros]')" | Out-Null; Start-Sleep -Milliseconds 400

    # ============ B9 pestañas, desbordes, alto de botones ============
    foreach ($ancho in 412, 360) {
        Pantalla -Ancho $ancho -Alto 915 -Movil; Start-Sleep -Milliseconds 600
        IrBitacora
        $sw = [int](JS "document.documentElement.scrollWidth"); $iw = [int](JS "window.innerWidth")
        OK ($sw -le $iw) "B9 $ancho px: sin desborde horizontal en Bitácora" "scrollWidth $sw / $iw"
        $alt = JS "Math.min(...[...document.querySelectorAll('[data-grupo-cabecera]')].map(b => b.getBoundingClientRect().height))"
        OK ([double]$alt -ge 44) "B9 $ancho px: cabeceras de grupo ≥ 44 px" "$alt"
        $alt2 = JS "Math.min(...['[data-expandir-todo]','[data-contraer-todo]'].map(q => document.querySelector(q)?.getBoundingClientRect().height ?? 99))"
        $script:Resultados.Add("INFO $ancho px: alto de Expandir/Contraer todo = $alt2 px")
    }
    # Letra grande (24 px raíz): ningún título de grupo se corta y no hay desborde
    JS "(() => { const d = document.documentElement; d.style.setProperty('font-size','24px','important'); return true })()" | Out-Null
    Start-Sleep -Milliseconds 800
    $fs = JS "getComputedStyle(document.documentElement).fontSize"
    OK ($fs -eq '24px') 'Letra grande aplicada (fuente raíz 24 px)' $fs
    # Título largo (el de «Turnos terminados») inyectado en el primer grupo para comprobar que envuelve y no se corta
    JS "(() => { const t = document.querySelector('[data-grupo-cabecera] span.flex-1'); t.dataset.orig = t.textContent; t.textContent = 'Turnos terminados (archivados en AGL)'; return true })()" | Out-Null
    $chk = JS "JSON.stringify([...document.querySelectorAll('[data-grupo-cabecera]')].map(b => { const t = b.querySelector('span.flex-1'); const r = b.getBoundingClientRect(); const rt = t.getBoundingClientRect(); const c = b.querySelector('[data-grupo-cuenta]').getBoundingClientRect(); return { sobra: t.scrollWidth > t.clientWidth + 1, dentro: r.left >= 0 && r.right <= innerWidth + 0.5 && c.right <= innerWidth + 0.5 && rt.height >= t.scrollHeight - 1, h: Math.round(r.height) } }))" | ConvertFrom-Json
    OK (@($chk | Where-Object { $_.sobra -or -not $_.dentro }).Count -eq 0) 'Letra grande 360 px: títulos de grupo (incl. el más largo) envuelven sin cortarse' (($chk | ForEach-Object { "h$($_.h)" }) -join ' ')
    $sw = [int](JS "document.documentElement.scrollWidth"); $iw = [int](JS "window.innerWidth")
    OK ($sw -le $iw) 'Letra grande 360 px: sin desborde horizontal' "scrollWidth $sw / $iw"
    Captura 'fert_bitacora_grupos_grande.png'
    Pantalla -Ancho 412 -Alto 915 -Movil
    JS "(() => { document.documentElement.style.removeProperty('font-size'); return true })()" | Out-Null
    Ir "/fertirriego?r=$s-c"
    Esperar "document.querySelector('[data-estacion]')?.dataset.estacion === '$EST'" 60000 | Out-Null
    $pest = JS "[...document.querySelectorAll('[data-pestana]')].map(b => b.dataset.pestana).join(',')"
    foreach ($p in ($pest -split ',')) {
        if (-not $p) { continue }
        $ok = ClicHasta "document.querySelector('[data-pestana=$p]')" "document.querySelector('[data-pestana=$p]')?.getAttribute('aria-selected') === 'true' || document.querySelector('[data-pestana=$p]')?.getAttribute('aria-current') !== null"
        Start-Sleep -Milliseconds 600
        $e = Errores-Pagina; $sw = [int](JS "document.documentElement.scrollWidth")
        OK ((-not $e) -and $sw -le 412 -and (JS "document.body.innerText.length") -gt 50) "B9 pestaña «$p» abre sin error ni desborde" "$e sw=$sw"
    }
    # Con filtro por tipo y recarga: sin errores (regresión final)
    IrBitacora
    $e = Errores-Pagina; OK (-not $e) 'B9 sin errores de página al final' $e
}
catch { $cuerpoErr = ""; try { $cuerpoErr = (New-Object IO.StreamReader $_.Exception.Response.GetResponseStream()).ReadToEnd() } catch {}; $script:Resultados.Add("EXCEPCION $($_.Exception.Message) $cuerpoErr @ $($_.InvocationInfo.ScriptLineNumber): $($_.InvocationInfo.Line.Trim())") }
finally {
    try { CDP 'Network.setBlockedURLs' @{ urls = @() } | Out-Null } catch {}
    # ---- Limpieza ----
    try {
        if ($estId) {
            foreach ($t in 'fert_movimientos', 'fert_saldos', 'fert_bitacora_riego', 'fert_custodia', 'fert_relevos') { Rest "${t}?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null }
            foreach ($x in (Lista "fert_devoluciones?select=id&estacion_id=eq.$estId")) { Rest "fert_devoluciones_detalle?devolucion_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null }
            Rest "fert_devoluciones?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            foreach ($x in (Lista "fert_aplicaciones?select=id&estacion_id=eq.$estId")) { Rest "fert_aplicaciones_detalle?aplicacion_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null }
            Rest "fert_aplicaciones?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            $choferes = @(); $vehiculos = @()
            foreach ($x in (Lista "fert_recepciones?select=id,chofer_id,vehiculo_id&estacion_id=eq.$estId")) { Rest "fert_recepciones_detalle?recepcion_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null; $choferes += $x.chofer_id; if ($x.vehiculo_id) { $vehiculos += $x.vehiculo_id } }
            Rest "fert_recepciones?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            foreach ($x in (Lista "fert_conteos?select=id&estacion_id=eq.$estId")) { Rest "fert_conteos_detalle?conteo_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null }
            Rest "fert_conteos?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            Rest "fert_operaciones?perfil_id=eq.$qaId" 'Delete' -Servicio | Out-Null
            foreach ($c in ($choferes | Select-Object -Unique)) { Rest "fert_choferes_vehiculos?chofer_id=eq.$c" 'Delete' -Servicio | Out-Null; Rest "fert_choferes?id=eq.$c" 'Delete' -Servicio | Out-Null }
            foreach ($v in ($vehiculos | Select-Object -Unique)) { Rest "fert_vehiculos?id=eq.$v" 'Delete' -Servicio | Out-Null }
            Rest "fert_choferes?nombre=eq.$([uri]::EscapeDataString("Chofer QA $s"))" 'Delete' -Servicio | Out-Null
            Rest "fert_vehiculos?placa=eq.QB$s" 'Delete' -Servicio | Out-Null
            foreach ($x in (Lista "turnos_ciclo?select=id,turno_id&agl_id=eq.TR-QB-$s")) { Rest "fert_plan?turno_ciclo_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null; Rest "turnos_ciclo?id=eq.$($x.id)" 'Delete' -Servicio | Out-Null; Rest "turnos?id=eq.$($x.turno_id)" 'Delete' -Servicio | Out-Null }
            Rest "perfiles_estaciones?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            Rest "estaciones_riego?id=eq.$estId" 'Delete' -Servicio | Out-Null
        }
        foreach ($c in $SOL, $ACI) { Rest "materiales?codigo=eq.$c" 'Delete' -Servicio | Out-Null }
        Rest "fert_publicaciones?temporada=eq.$([uri]::EscapeDataString("QA $s"))" 'Delete' -Servicio | Out-Null
    } catch { $script:Resultados.Add("LIMPIEZA datos: $($_.Exception.Message) $($_.ErrorDetails.Message)") }
    try {
        if ($qaId) {
            try { Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($rolTotal); p_principal = $rolTotal } -Servicio | Out-Null } catch {}
            if ($rolEst) { Rest "permisos?rol_id=eq.$rolEst" 'Delete' -Servicio | Out-Null; Rest "roles?id=eq.$rolEst" 'Delete' -Servicio | Out-Null }
            foreach ($t in 'perfiles_zonas', 'perfiles_estaciones', 'fert_llaves') { Rest "${t}?perfil_id=eq.$qaId" 'Delete' -Servicio | Out-Null }
            Rest "perfiles?id=eq.$qaId" 'Delete' -Servicio | Out-Null
            Invoke-RestMethod -Method Delete -Uri "$URLB/auth/v1/admin/users/$qaId" -Headers $hServ | Out-Null
        }
    } catch { $script:Resultados.Add("LIMPIEZA usuario QA: $($_.Exception.Message) $($_.ErrorDetails.Message)") }
    Remove-Item $archivoQa -ErrorAction SilentlyContinue
    try {
        $quedaUsr = 0; try { Invoke-RestMethod "$URLB/auth/v1/admin/users/$qaId" -Headers $hServ | Out-Null; $quedaUsr = 1 } catch {}
        $restos = (Lista "perfiles?select=id&id=eq.$qaId").Count + (Lista "estaciones_riego?select=id&nombre=eq.$([uri]::EscapeDataString($EST))").Count + (Lista "materiales?select=id&codigo=in.($SOL,$ACI)").Count + (Lista "roles?select=id&codigo=eq.QA_BIT_$s").Count
        OK ($quedaUsr -eq 0 -and $restos -eq 0) 'Limpieza: usuario QA, estación, productos y rol temporal borrados de desarrollo' "usuario $quedaUsr, restos $restos"
    } catch { $script:Resultados.Add("LIMPIEZA verificación: $($_.Exception.Message)") }
    Terminar-QA
}
