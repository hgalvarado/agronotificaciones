# QA · Fertirriego › pestaña Bitácora POR DÍA con BLOQUES (los productos de un mismo registro y tipo van juntos, con sangría).
# Base de DESARROLLO. Autocontenido sobre comun.ps1: crea un usuario QA temporal (y su qa_usuario.local.json), una estación
# de prueba con turno/plan/3 productos, genera movimientos con la UI y al final BORRA todo (usuario, estación, datos, rol).
# Uso: powershell -ExecutionPolicy Bypass -File pruebas/qa/fertirriego_bitacora_grupos.ps1 [-Puerto 3103]
param([string]$CarpetaServidor, [int]$Puerto = 3103, [int]$PuertoCdp = 9336)
. "$PSScriptRoot\comun.ps1"
# Progreso en vivo
function OK($cond, $nombre, $extra = '') {
    $l = ("{0} {1}{2}" -f ($(if ($cond) { 'OK' } else { 'FALLO' })), $nombre, $(if ("$extra" -ne '') { " :: $extra" } else { '' }))
    $script:Resultados.Add($l); Write-Host $l
}
function Nota($t) { $script:Resultados.Add($t); Write-Host $t }
$BASE = "http://localhost:$Puerto"
$envd = Leer-Entorno
$URLB = $envd['NEXT_PUBLIC_SUPABASE_URL']; $SERV = $envd['SUPABASE_SERVICE_ROLE_KEY']
$hServ = @{ apikey = $SERV; Authorization = "Bearer $SERV" }
$s = Get-Random -Maximum 99999
$archivoQa = "$PSScriptRoot\qa_usuario.local.json"
$qaId = $null; $rolEst = $null; $estId = $null
$EST = "PRUEBA · QA Bit $s"; $TURNO = "TQB-$s"; $SOL = "QB-SOL-$s"; $ACI = "QB-ACI-$s"; $MAG = "QB-MAG-$s"
$hoy = (Get-Date).ToString('yyyy-MM-dd'); $ayer = (Get-Date).AddDays(-1).ToString('yyyy-MM-dd'); $manana = (Get-Date).AddDays(1).ToString('yyyy-MM-dd')
Write-Host "Sufijo $s · estación $EST"

# ---- usuario QA temporal ----
$qaEmail = "qa.bit.$([guid]::NewGuid().ToString('N').Substring(0,10))@desarrollo.local"; $qaClave = "Qa-$(Get-Random)-x$(Get-Random)"
$usr = Invoke-RestMethod -Method Post -Uri "$URLB/auth/v1/admin/users" -Headers $hServ -ContentType 'application/json' -Body (@{ email = $qaEmail; password = $qaClave; email_confirm = $true } | ConvertTo-Json)
$qaId = $usr.id
Write-Host "Usuario QA $qaId"
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
    CDP 'Input.dispatchKeyEvent' @{ type = 'keyDown'; key = 'Escape'; code = 'Escape'; windowsVirtualKeyCode = 27 } | Out-Null
    CDP 'Input.dispatchKeyEvent' @{ type = 'keyUp'; key = 'Escape'; code = 'Escape'; windowsVirtualKeyCode = 27 } | Out-Null
    Start-Sleep -Milliseconds 300
    return $ok
}
function EsperarConteo($ruta, [int]$n) { for ($q = 0; $q -lt 15; $q++) { if ((Lista $ruta).Count -ge $n) { return $true }; Start-Sleep 2 }; return $false }
function EsperarSync { Start-Sleep -Milliseconds 1800; Esperar "!document.querySelector('[data-pendientes-cuenta]')" 60000 | Out-Null }
function IrBitacora { ClicHasta "document.querySelector('[data-pestana=bitacora]')" "!!document.querySelector('[data-filtros-bitacora]')" | Out-Null; Start-Sleep -Milliseconds 400 }
function PonerValor($sel, $valor) { JS "(() => { const i = document.querySelector('$sel'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '$valor'); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()" | Out-Null; Start-Sleep -Milliseconds 400 }
# Estructura de la bitácora: por día, sus elementos de primer nivel (bloque o fila suelta), en orden
$E_JS = @"
JSON.stringify([...document.querySelectorAll('[data-dia]')].map(d => ({
  dia: d.dataset.dia,
  items: [...d.querySelectorAll(':scope > div > *')].map(el => el.hasAttribute('data-bloque')
    ? { b: 1, t: el.dataset.bloque, c: Number(el.dataset.bloqueCuenta), n: el.querySelectorAll('[data-movimiento]').length,
        exp: el.querySelector('[data-bloque-cabecera]').getAttribute('aria-expanded'),
        txt: el.querySelector('[data-bloque-cabecera]').textContent.replace(/\s+/g,' ').trim(),
        hora: (el.querySelector('[data-bloque-cabecera] span')?.textContent || '').trim(),
        sangria: (() => { const f = el.querySelector('[data-movimiento]'); if (!f) return null; const c = f.parentElement; return { ml: parseFloat(getComputedStyle(c).marginLeft), bl: parseFloat(getComputedStyle(c).borderLeftWidth), quien: !!f.querySelector('[data-quien-movimiento]') } })() }
    : { b: 0, t: el.dataset.movimiento, hora: (el.querySelector('span')?.textContent || '').trim(), dis: el.disabled, pend: /por enviar/i.test(el.textContent) })
})))
"@
function Estructura { $j = JS $E_JS; if (-not $j) { return @() }; return @($j | ConvertFrom-Json) }
function Bloques { $o = @(); foreach ($d in (Estructura)) { foreach ($i in $d.items) { if ($i.b -eq 1) { $i | Add-Member -NotePropertyName dia -NotePropertyValue $d.dia -Force; $o += $i } } }; return $o }
function Resumen { ((Estructura) | ForEach-Object { "$($_.dia): " + (($_.items | ForEach-Object { if ($_.b -eq 1) { "[$($_.t)x$($_.c)/$($_.n) $($_.exp)]" } else { $_.t } }) -join ' ') }) -join ' || ' }
function Cuenta { [int](JS "Number(document.querySelector('[data-cuenta-bitacora]')?.dataset.cuentaBitacora ?? -1)") }
function Filas { [int](JS "document.querySelectorAll('[data-movimiento]').length") }

try {
    # ============ Preparación ============
    $z1 = (Lista 'zonas?select=id,nombre&activo=eq.true&order=nombre&limit=1')[0]
    $estId = (Rest 'estaciones_riego' 'Post' @{ nombre = $EST; zona_id = $z1.id } -Servicio)[0].id
    Write-Host "Estación $estId"
    $pub = Rest 'rpc/fn_fert_publicar' 'Post' @{ p = @{
        temporada = "QA $s"
        estaciones = @(@{ nombre = $EST; zona = $z1.nombre })
        materiales = @(@{ codigo = $SOL; descripcion = "SOLUCION QA $s"; unidad = 'L'; grupo = '1800' }, @{ codigo = $ACI; descripcion = "ACIDO QA $s"; unidad = 'L'; grupo = '1800' }, @{ codigo = $MAG; descripcion = "MAGNESIO QA $s"; unidad = 'KG'; grupo = '1800' })
        turnos = @(@{ agl_id = "TR-QB-$s"; turno = $TURNO; temporada = "QA $s"; ciclo = 'Ciclo QA'; fecha_siembra = (Get-Date).AddDays(-5).ToString('yyyy-MM-dd'); estacion = $EST; zona = $z1.nombre; area_mz = 10; estado = 'Creado' })
        plan = @(@{ agl_id = "TR-QB-$s"; filas = @(@{ fecha = $hoy; ddt = 5; material = $SOL; cantidad = 120 }, @{ fecha = $hoy; ddt = 5; material = $ACI; cantidad = 4 }, @{ fecha = $manana; ddt = 6; material = $MAG; cantidad = 50 }) })
    } }
    OK ($pub.turnos -eq 1 -and $pub.filas_plan -eq 3) 'Preparación: estación de prueba, turno, plan y 3 productos' "turnos $($pub.turnos), plan $($pub.filas_plan)"
    Rest 'perfiles_estaciones' 'Post' @{ perfil_id = $qaId; estacion_id = $estId } -Servicio | Out-Null
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
    $rolEst = (Rest 'roles' 'Post' @{ codigo = "QA_BIT_$s"; nombre = "QA Estacionero Bit $s" } -Servicio)[0].id
    foreach ($a in 'ver', 'recibir', 'aplicar', 'contar', 'relevo', 'anular') { Rest 'permisos' 'Post' @{ rol_id = $rolEst; recurso = 'fertirriego'; accion = $a; alcance = 'propietario' } -Servicio | Out-Null }
    Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($rolEst); p_principal = $rolEst } -Servicio | Out-Null
    CDP 'Browser.grantPermissions' @{ permissions = @('geolocation'); origin = $BASE } | Out-Null
    CDP 'Emulation.setGeolocationOverride' @{ latitude = 13.312; longitude = -87.195; accuracy = 12 } | Out-Null
    Ir "/fertirriego?r=$s-b"
    $t = Esperar "document.querySelector('[data-estacion]')?.dataset.estacion === '$EST'" 60000
    OK ($t -ge 0) 'El estacionero ve su estación' "$t ms"
    Esperar "!document.querySelector('[data-actualizar]')?.disabled" 30000 | Out-Null

    # ---- (f) sin movimientos ----
    IrBitacora
    Esperar "/Sin movimientos todav/.test(document.body.innerText)" 8000 | Out-Null
    $txt = JS "document.body.innerText"
    OK ($txt -match 'Sin movimientos todavía\.' -and -not (JS "!!document.querySelector('[data-expandir-todo]') || !!document.querySelector('[data-contraer-todo]')") -and (JS "document.querySelectorAll('[data-dia]').length") -eq 0) '(f) sin movimientos: mensaje y sin botones Expandir/Contraer'
    ClicHasta "document.querySelector('[data-pestana=estacion]')" "!!document.querySelector('[data-accion=recibir]')" | Out-Null

    # ============ Generar movimientos ============
    # RECEPCION de AYER con 3 productos
    ClicHasta "document.querySelector('[data-accion=recibir]')" "!!document.querySelector('[data-selector-chofer]')" | Out-Null
    CrearEnSelector '[data-selector-chofer] button' 'Agregar chofer' @("Chofer QA $s", '9999-0000')
    CrearEnSelector '[data-selector-vehiculo] button' 'Agregar vehículo' @("qb $s", 'Camión', 'Isuzu', 'Blanco')
    $lineas = JS "[...document.querySelectorAll('[data-linea-codigo]')].map(l => l.dataset.lineaCodigo).join(',')"
    Nota "INFO líneas de la recepción: $lineas"
    if ($lineas -notmatch [regex]::Escape($MAG)) {
        ClicEn "document.querySelector('[data-agregar-linea]')" | Out-Null; Start-Sleep -Milliseconds 400
        ElegirOpcion '[data-lineas] > [data-linea]:last-of-type button' "MAGNESIO QA $s" | Out-Null
        Nota "INFO tras agregar: $(JS "[...document.querySelectorAll('[data-linea-codigo]')].map(l => l.dataset.lineaCodigo).join(',')")"
    }
    foreach ($p in @(@($SOL, '1000'), @($ACI, '200'), @($MAG, '300'))) {
        $q = "document.querySelector('[data-linea-codigo=""$($p[0])""] [data-cantidad]')"
        if (JS "!!$q") { Teclear $q $p[1] } else { Nota "DIAG falta línea $($p[0])" }
    }
    PonerValor '[data-fecha-hora]' "$($ayer)T08:00"
    Nota "INFO fecha-hora recepción: $(JS "document.querySelector('[data-fecha-hora]')?.value")"
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    $tq = Esperar "!document.querySelector('[data-selector-chofer]')" 15000; EsperarSync
    if (-not (EsperarConteo "fert_recepciones?select=id&estacion_id=eq.$estId" 1)) { Nota "DIAG recepción: cierre=$tq dialogo=$((JS "[...document.querySelectorAll('[role=dialog]')].map(d => d.innerText.substring(0,500)).join(' ||| ')") -replace "`n",' / ')"; foreach ($x in (Lista "fert_operaciones?select=tipo,resultado,mensaje&perfil_id=eq.$qaId&order=recibido_en.desc&limit=4")) { Nota "DIAG op $($x.tipo) $($x.resultado) $($x.mensaje)" } }
    $rec = Lista "fert_recepciones?select=id&estacion_id=eq.$estId"
    $recDet = if ($rec.Count) { (Lista "fert_recepciones_detalle?select=material_id&recepcion_id=eq.$($rec[0].id)").Count } else { 0 }
    OK ($rec.Count -eq 1 -and $recDet -eq 3) 'Generado: recepción de ayer con 3 productos' "recepciones $($rec.Count), detalle $recDet"

    # APLICACION 1 (en línea, 1 solo producto): desde el plan, quitando el ácido
    ClicHasta "document.querySelector('[data-pestana=estacion]')" "!!document.querySelector('[data-plan-turno=""$TURNO""]')" | Out-Null
    $okp = ClicHasta "document.querySelector('[data-plan-turno=""$TURNO""]')" "!!document.querySelector('[data-selector-turno]')"
    if (-not $okp) { Nota "DIAG plan: $((JS "document.body.innerText.substring(0,500)") -replace "`n",' / ')" }
    Esperar "[...document.querySelectorAll('[data-cantidad]')].some(i => i.value)" 8000 | Out-Null
    ClicEn "document.querySelector('[data-linea-codigo=""$ACI""] button[aria-label=""Quitar producto""]')" | Out-Null; Start-Sleep -Milliseconds 300
    Nota "INFO líneas aplicación 1: $(JS "[...document.querySelectorAll('[data-linea-codigo]')].map(l => l.dataset.lineaCodigo + '=' + l.querySelector('[data-cantidad]').value).join(',')")"
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    $tq = Esperar "!document.querySelector('[data-selector-turno]')" 15000; EsperarSync
    if (-not (EsperarConteo "fert_aplicaciones?select=id&estacion_id=eq.$estId" 1)) {
        Nota "DIAG aplicación 1: cierre=$tq dialogo=$((JS "[...document.querySelectorAll('[role=dialog]')].map(d => d.innerText.substring(0,500)).join(' ||| ')") -replace "`n",' / ')"
        foreach ($x in (Lista "fert_operaciones?select=tipo,resultado,mensaje&perfil_id=eq.$qaId&order=recibido_en.desc&limit=4")) { Nota "DIAG op $($x.tipo) $($x.resultado) $($x.mensaje)" }
    }
    OK ((Lista "fert_aplicaciones?select=id&estacion_id=eq.$estId").Count -ge 1) 'Generado: aplicación 1 (1 producto)'
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
    # CONTEO (solo SOL)
    ClicHasta "document.querySelector('[data-pestana=estacion]')" "!!document.querySelector('[data-accion=contar]')" | Out-Null
    ClicHasta "document.querySelector('[data-accion=contar]')" "!!document.querySelector('[data-conteo]')" | Out-Null
    Teclear "document.querySelector('[data-conteo-material=""$SOL""] input')" '1300'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    Esperar "!document.querySelector('[data-conteo]')" 15000 | Out-Null
    Start-Sleep -Milliseconds 800
    if (JS "!!document.querySelector('[data-conteo]')") { Nota "DIAG conteo sigue abierto: $((JS "document.querySelector('[role=dialog]')?.innerText") -replace "`n",' / ')" }
    EsperarSync
    $aj = 0; for ($q = 0; $q -lt 10 -and $aj -lt 1; $q++) { $aj = (Lista "fert_movimientos?select=tipo&estacion_id=eq.$estId&tipo=in.(AJUSTE_CONTEO,SALDO_INICIAL)").Count; if ($aj -lt 1) { Start-Sleep 2 } }
    OK ($aj -ge 1) 'Generado: movimiento por conteo' "$aj"

    # ---- SIN SEÑAL: aplicación 2 (2 productos) queda «por enviar» ----
    CDP 'Network.enable' | Out-Null
    CDP 'Network.setBlockedURLs' @{ urls = @('*supabase.co*') } | Out-Null
    ClicHasta "document.querySelector('[data-pestana=estacion]')" "!!document.querySelector('[data-plan-turno=""$TURNO""]')" | Out-Null
    ClicHasta "document.querySelector('[data-plan-turno=""$TURNO""]')" "!!document.querySelector('[data-selector-turno]')" | Out-Null
    Esperar "[...document.querySelectorAll('[data-cantidad]')].some(i => i.value)" 8000 | Out-Null
    Nota "INFO líneas aplicación 2: $(JS "[...document.querySelectorAll('[data-linea-codigo]')].map(l => l.dataset.lineaCodigo + '=' + l.querySelector('[data-cantidad]').value).join(',')")"
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    Esperar "!document.querySelector('[data-selector-turno]')" 15000 | Out-Null; Esperar "!!document.querySelector('[data-pendientes-cuenta]')" 10000 | Out-Null; Start-Sleep 1
    OK ((Pendientes) -eq 1) 'Sin señal: aplicación 2 guardada en el teléfono (1 por enviar)' "pend=$(Pendientes)"
    IrBitacora
    Nota "INFO sin señal: $(Resumen)"
    $est = Estructura
    $hoyD = @($est | Where-Object dia -eq $hoy)[0]
    $pr = $hoyD.items[0]
    $pendOk = JS "(() => { const b = document.querySelector('[data-dia=""$hoy""] [data-bloque=APLICACION]'); if (!b) return 'sin bloque'; const f = [...b.querySelectorAll('[data-movimiento]')]; return f.length + '|' + f.every(x => x.disabled && /por enviar/i.test(x.textContent)) })()"
    OK ($pr.b -eq 1 -and $pr.t -eq 'APLICACION' -and $pendOk -eq '2|True') '(g) «por enviar»: la aplicación de 2 productos sale arriba en su día como bloque, cada fila con insignia y deshabilitada' "$pendOk primero=$($pr.t)/$($pr.b)"
    $e = Errores-Pagina; if ($e) { Nota "INFO errores de página sin señal (esperables por red bloqueada): $e"; JS "(() => { window.__err = []; return true })()" | Out-Null }
    CDP 'Network.setBlockedURLs' @{ urls = @() } | Out-Null
    ClicEn "document.querySelector('[data-actualizar]')" | Out-Null
    Esperar "!document.querySelector('[data-pendientes-cuenta]') && document.querySelector('[data-barra-estado]').dataset.barraEstado === 'en_linea'" 60000 | Out-Null
    EsperarConteo "fert_aplicaciones?select=id&estacion_id=eq.$estId" 2 | Out-Null
    OK ((Lista "fert_aplicaciones?select=id&estacion_id=eq.$estId").Count -eq 2) 'Con señal: la aplicación 2 llega (2 en la base)'
    IrBitacora

    # ANULACION de la aplicación 2 (2 productos): tocar una fila del bloque
    ClicHasta "document.querySelector('[data-dia=""$hoy""] [data-bloque=APLICACION] [data-movimiento]:not([disabled])')" "!!document.querySelector('[data-detalle-documento]')" | Out-Null
    ClicHasta "document.querySelector('[data-modo-anular]')" "!!document.querySelector('[data-motivo]')" | Out-Null
    Teclear "document.querySelector('[data-motivo]')" 'Anulada por QA de bitácora'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    Esperar "!document.querySelector('[data-detalle-documento]')" 15000 | Out-Null; EsperarSync
    $an = 0; for ($q = 0; $q -lt 10 -and $an -lt 2; $q++) { $an = (Lista "fert_movimientos?select=tipo&estacion_id=eq.$estId&tipo=eq.ANULACION").Count; if ($an -lt 2) { Start-Sleep 2 } }
    OK ($an -eq 2) 'Generado: anulación de la aplicación de 2 productos (2 movimientos)' "$an"
    IrBitacora
    Start-Sleep 1
    JS "(() => { window.__err = []; return true })()" | Out-Null

    # ============ (a) estructura ============
    Nota "INFO estructura: $(Resumen)"
    $est = Estructura
    OK ((JS "document.querySelectorAll('[data-grupo], [data-grupo-cabecera], [data-grupo-cuenta]').length") -eq 0) '(a) ya no existen secciones [data-grupo]'
    $dias = @($est | ForEach-Object { $_.dia })
    OK (($dias -join ',') -eq "$hoy,$ayer" -and ($dias | Select-Object -Unique).Count -eq $dias.Count) '(a)(d) un [data-dia] por día, el más reciente arriba' ($dias -join ',')
    $bl = @(Bloques)
    $recB = @($bl | Where-Object t -eq 'RECEPCION')
    OK ($recB.Count -eq 1 -and $recB[0].c -eq 3 -and $recB[0].n -eq 3 -and $recB[0].dia -eq $ayer -and $recB[0].txt -match '3 productos · hecho junto') '(a) la recepción forma UN bloque de 3 (cuenta=3, 3 filas, «3 productos · hecho junto»)' "$($recB[0].txt)"
    $ayerD = @($est | Where-Object dia -eq $ayer)[0]
    OK ($ayerD.items.Count -eq 1) '(a) el día de ayer solo tiene el bloque de la recepción' (Resumen)
    OK ($recB[0].sangria.ml -gt 0 -and $recB[0].sangria.bl -ge 1 -and -not $recB[0].sangria.quien) '(a) filas del bloque con sangría (margen + borde izquierdo) y solo producto (sin quién)' "ml=$($recB[0].sangria.ml) bl=$($recB[0].sangria.bl)"
    $txtFilaRec = JS "[...document.querySelectorAll('[data-bloque=RECEPCION] [data-movimiento]')].map(f => f.textContent.replace(/\s+/g,' ').trim()).join(' | ')"
    OK ($txtFilaRec -match "SOLUCION QA $s" -and $txtFilaRec -match "ACIDO QA $s" -and $txtFilaRec -match "MAGNESIO QA $s" -and $txtFilaRec -notmatch 'Entrega' -and $txtFilaRec -match 'saldo') '(a) filas del bloque muestran producto, cantidad y saldo' $txtFilaRec
    $hoyD = @($est | Where-Object dia -eq $hoy)[0]
    $suelt = @($hoyD.items | Where-Object { $_.b -eq 0 -and $_.t -eq 'APLICACION' })
    OK ($suelt.Count -eq 1) '(a) la aplicación de 1 producto es fila normal (no bloque)' (Resumen)
    $anB = @($bl | Where-Object t -eq 'ANULACION'); $apB = @($bl | Where-Object t -eq 'APLICACION')
    OK ($anB.Count -eq 1 -and $anB[0].c -eq 2 -and $anB[0].n -eq 2 -and $apB.Count -eq 1 -and $apB[0].c -eq 2) '(a) la anulación forma su propio bloque (2) separado del bloque de la aplicación original (2)' (Resumen)
    OK (@($hoyD.items | Where-Object { $_.b -eq 0 -and $_.t -eq 'DEVOLUCION' }).Count -eq 1) '(a) la devolución (1 producto) es fila normal'
    # Orden dentro del día: horas no crecientes
    $seq = @($hoyD.items | ForEach-Object { "$($_.t)$(if ($_.b -eq 1) { '*' })" })
    $iApB = [array]::IndexOf($seq, 'APLICACION*'); $iDev = [array]::IndexOf($seq, 'DEVOLUCION'); $iAp1 = [array]::IndexOf($seq, 'APLICACION')
    OK ($seq[0] -eq 'ANULACION*' -and $iApB -eq 1 -and $iDev -gt $iApB -and $iAp1 -gt $iDev) '(d) dentro del día lo más reciente arriba (anulación, aplicación 2, …, devolución, aplicación 1)' (($hoyD.items | ForEach-Object { "$($_.t)$(if ($_.b -eq 1) { '*' })@$($_.hora)" }) -join ' ')
    $TOTAL = Cuenta; $NSUELTAS = @(@($est | ForEach-Object { $_.items }) | Where-Object { $_.b -eq 0 }).Count
    OK ((Filas) -eq $TOTAL -and $TOTAL -ge 10) '(d) contador de la barra = total de filas [data-movimiento]' "$TOTAL/$(Filas)"
    $an2 = JS "JSON.stringify([...document.querySelectorAll('[data-bloque=APLICACION] [data-movimiento]')].map(b => ({ op: getComputedStyle(b).opacity, tach: !!b.querySelector('.line-through') })))" | ConvertFrom-Json
    OK (@($an2).Count -eq 2 -and @($an2 | Where-Object { -not ($_.tach -and [double]$_.op -lt 1) }).Count -eq 0) '(g) las filas de la aplicación anulada siguen tachadas y opacas dentro de su bloque' (($an2 | ForEach-Object { "$($_.op)/$($_.tach)" }) -join ' ')

    # ============ (b) expandir/contraer ============
    OK (@($bl | Where-Object { $_.exp -ne 'true' -or $_.n -ne $_.c -or $_.txt -notmatch '^\S+\s.*▾' }).Count -eq 0) '(b) todos los bloques arrancan expandidos (aria-expanded=true, ▾, filas visibles)' (($bl | ForEach-Object { "$($_.t):$($_.exp)" }) -join ' ')
    OK ((JS "!!document.querySelector('[data-expandir-todo]') && !!document.querySelector('[data-contraer-todo]')") -eq $true) '(b) con bloques aparecen «Expandir bloques» y «Contraer bloques»'
    ClicEn "document.querySelector('[data-bloque=RECEPCION] [data-bloque-cabecera]')" | Out-Null; Start-Sleep -Milliseconds 400
    $r = @(Bloques) | Where-Object t -eq 'RECEPCION'
    OK ($r.exp -eq 'false' -and $r.n -eq 0 -and $r.c -eq 3 -and $r.txt -match '▸' -and $r.txt -notmatch '▾') '(b) tocar la cabecera contrae (filas fuera, ▸, aria-expanded=false, cuenta se mantiene)' "exp=$($r.exp) n=$($r.n) $($r.txt)"
    OK (@(@(Bloques) | Where-Object { $_.t -ne 'RECEPCION' -and $_.exp -ne 'true' }).Count -eq 0 -and (Cuenta) -eq $TOTAL) '(b) los otros bloques siguen expandidos; el contador de la barra no cambia' "cuenta=$(Cuenta)"
    ClicEn "document.querySelector('[data-bloque=RECEPCION] [data-bloque-cabecera]')" | Out-Null; Start-Sleep -Milliseconds 400
    $r = @(Bloques) | Where-Object t -eq 'RECEPCION'
    OK ($r.exp -eq 'true' -and $r.n -eq 3 -and $r.txt -match '▾') '(b) tocarla otra vez expande'
    ClicEn "document.querySelector('[data-contraer-todo]')" | Out-Null; Start-Sleep -Milliseconds 400
    $bl2 = @(Bloques)
    $sueltas = [int](JS "[...document.querySelectorAll('[data-dia] > div > [data-movimiento]')].length")
    OK (@($bl2 | Where-Object { $_.exp -ne 'false' -or $_.n -ne 0 }).Count -eq 0 -and (Filas) -eq $sueltas -and $sueltas -eq $NSUELTAS) '(b) «Contraer bloques»: todos contraídos, quedan solo las filas sueltas' "filas=$(Filas) sueltas=$sueltas"
    ClicEn "document.querySelector('[data-expandir-todo]')" | Out-Null; Start-Sleep -Milliseconds 400
    OK (@(@(Bloques) | Where-Object { $_.exp -ne 'true' -or $_.n -ne $_.c }).Count -eq 0 -and (Filas) -eq (Cuenta)) '(b) «Expandir bloques»: todos expandidos'

    # ============ (c) detalle desde una fila dentro de un bloque ============
    ClicEn "document.querySelector('[data-bloque=ANULACION] [data-bloque-cabecera]')" | Out-Null; Start-Sleep -Milliseconds 300   # contraer Anulación
    ClicHasta "[...document.querySelectorAll('[data-bloque=RECEPCION] [data-movimiento]')][1]" "!!document.querySelector('[data-detalle-documento]')" | Out-Null
    $det = JS "document.querySelector('[data-detalle-documento]')?.innerText || ''"
    OK ($det -match "Chofer QA $s" -and $det -match "SOLUCION QA $s" -and $det -match "MAGNESIO QA $s") '(c) tocar un producto dentro del bloque abre el detalle de ESA recepción' (($det -split "`n" | Select-Object -First 8) -join ' / ')
    ClicHasta "[...document.querySelectorAll('button')].find(b => b.offsetParent !== null && b.textContent.trim() === 'Listo')" "!document.querySelector('[data-detalle-documento]')" | Out-Null
    $a = @(Bloques) | Where-Object t -eq 'ANULACION'; $r = @(Bloques) | Where-Object t -eq 'RECEPCION'
    OK ((JS "!document.querySelector('[data-detalle-documento]')") -eq $true -and $a.exp -eq 'false' -and $r.exp -eq 'true') '(c) «Listo» cierra el detalle y se conserva el estado (Anulación contraída, Recepción expandida)' "ANULACION=$($a.exp) RECEPCION=$($r.exp)"
    ClicHasta "document.querySelector('[data-bloque=APLICACION] [data-movimiento]')" "!!document.querySelector('[data-detalle-documento]')" | Out-Null
    $det = JS "document.querySelector('[data-detalle-documento]')?.innerText || ''"
    OK ($det -match "ACIDO QA $s" -and $det -match 'Anulad|anulad') '(c) tocar un producto del bloque de la aplicación abre esa aplicación (anulada, con los 2 productos)' (($det -split "`n" | Select-Object -First 8) -join ' / ')
    ClicHasta "[...document.querySelectorAll('button')].find(b => b.offsetParent !== null && b.textContent.trim() === 'Listo')" "!document.querySelector('[data-detalle-documento]')" | Out-Null
    ClicEn "document.querySelector('[data-expandir-todo]')" | Out-Null; Start-Sleep -Milliseconds 300
    $e = Errores-Pagina; OK (-not $e) '(i) sin errores de consola/página tras estructura, bloques y detalle' $e

    # ============ (e) filtros ============
    ClicHasta "document.querySelector('[data-filtros-bitacora]')" "!!document.querySelector('[data-panel-filtros]')" | Out-Null
    ElegirFiltro '[data-filtro-producto] button' "MAGNESIO QA $s" | Out-Null; Start-Sleep -Milliseconds 400
    Nota "INFO filtro MAGNESIO: $(Resumen)"
    $b3 = @(Bloques); $est = Estructura
    OK ($b3.Count -eq 0 -and (Cuenta) -eq 1 -and (Filas) -eq 1 -and @($est).Count -eq 1 -and $est[0].items[0].b -eq 0 -and $est[0].items[0].t -eq 'RECEPCION' -and -not (JS "!!document.querySelector('[data-expandir-todo]')")) '(e) Producto=MAGNESIO: la recepción ya no es bloque (fila normal), sin Expandir/Contraer' (Resumen)
    ClicEn "document.querySelector('[data-limpiar-filtros]')" | Out-Null; Start-Sleep -Milliseconds 500
    OK ((Cuenta) -eq $TOTAL -and @(Bloques).Count -eq 3) '(e) Limpiar restaura (todos los movimientos, 3 bloques)' "cuenta=$(Cuenta) bloques=$(@(Bloques).Count)"
    # Tipo = Entrega recibida: el bloque de 3 sigue completo
    if (-not (JS "!!document.querySelector('[data-panel-filtros]')")) { ClicEn "document.querySelector('[data-filtros-bitacora]')" | Out-Null; Start-Sleep -Milliseconds 300 }
    ElegirFiltro '[data-filtro-tipo] button' 'Entrega' | Out-Null; Start-Sleep -Milliseconds 400
    $b3 = @(Bloques)
    OK ($b3.Count -eq 1 -and $b3[0].t -eq 'RECEPCION' -and $b3[0].c -eq 3 -and (Cuenta) -eq 3) '(e) Tipo=Entrega: solo el bloque de la recepción con sus 3' (Resumen)
    ClicEn "document.querySelector('[data-limpiar-filtros]')" | Out-Null; Start-Sleep -Milliseconds 500
    # Cantidad entre 250 y 1000: de la recepción quedan 2 (1000 y 300)
    if (-not (JS "!!document.querySelector('[data-panel-filtros]')")) { ClicEn "document.querySelector('[data-filtros-bitacora]')" | Out-Null; Start-Sleep -Milliseconds 300 }
    Teclear "document.querySelector('[data-filtro-cantidad-min]')" '250'
    Teclear "document.querySelector('[data-filtro-cantidad-max]')" '1000'
    Start-Sleep -Milliseconds 500
    Nota "INFO filtro cantidad 250–1000: $(Resumen)"
    $r = @(@(Bloques) | Where-Object t -eq 'RECEPCION')
    OK ($r.Count -eq 1 -and $r[0].c -eq 2 -and $r[0].n -eq 2 -and $r[0].txt -match '2 productos · hecho junto' -and (Filas) -eq (Cuenta)) '(e) Cantidad 250–1000: la recepción muestra «2 productos» (N coincidencias)' "$($r[0].txt)"
    ClicEn "document.querySelector('[data-limpiar-filtros]')" | Out-Null; Start-Sleep -Milliseconds 500
    # Fecha = ayer: solo el día de ayer con su bloque
    if (-not (JS "!!document.querySelector('[data-panel-filtros]')")) { ClicEn "document.querySelector('[data-filtros-bitacora]')" | Out-Null; Start-Sleep -Milliseconds 300 }
    PonerValor '[data-filtro-dia]' $ayer
    $est = Estructura
    OK (@($est).Count -eq 1 -and $est[0].dia -eq $ayer -and (Cuenta) -eq 3 -and @(Bloques).Count -eq 1) '(e) Fecha=ayer: solo ese día con el bloque de la recepción' (Resumen)
    ClicEn "document.querySelector('[data-limpiar-filtros]')" | Out-Null; Start-Sleep -Milliseconds 500
    OK ((Cuenta) -eq $TOTAL -and (Filas) -eq $TOTAL) '(e) Limpiar restaura todo' "cuenta=$(Cuenta)"
    if (JS "!!document.querySelector('[data-panel-filtros]')") { ClicEn "document.querySelector('[data-filtros-bitacora]')" | Out-Null; Start-Sleep -Milliseconds 300 }

    # ============ (h) anchos y letra grande ============
    foreach ($ancho in 412, 360) {
        Pantalla -Ancho $ancho -Alto 915 -Movil; Start-Sleep -Milliseconds 600
        IrBitacora
        $sw = [int](JS "document.documentElement.scrollWidth"); $iw = [int](JS "window.innerWidth")
        OK ($sw -le $iw) "(h) $ancho px: sin desborde horizontal" "scrollWidth $sw / $iw"
        $alt = JS "Math.min(...[...document.querySelectorAll('[data-bloque-cabecera]')].map(b => b.getBoundingClientRect().height))"
        OK ([double]$alt -ge 44) "(h) $ancho px: cabeceras de bloque ≥ 44 px" "$alt"
        $alt2 = JS "Math.min(...['[data-expandir-todo]','[data-contraer-todo]'].map(q => document.querySelector(q)?.getBoundingClientRect().height ?? 99))"
        OK ([double]$alt2 -ge 44) "(h) $ancho px: Expandir/Contraer bloques ≥ 44 px" "$alt2"
    }
    JS "(() => { document.documentElement.style.setProperty('font-size','24px','important'); return true })()" | Out-Null
    Start-Sleep -Milliseconds 800
    $fs = JS "getComputedStyle(document.documentElement).fontSize"
    OK ($fs -eq '24px') 'Letra grande aplicada (fuente raíz 24 px)' $fs
    JS "(() => { const t = document.querySelector('[data-bloque-cabecera] span.min-w-0 span'); t.textContent = 'Entrega recibida · TURNO MUY LARGO DE PRUEBA 12345, OTRO TURNO 67890'; return true })()" | Out-Null
    Start-Sleep -Milliseconds 300
    $chk = JS "JSON.stringify([...document.querySelectorAll('[data-bloque-cabecera], [data-movimiento]')].map(b => { const r = b.getBoundingClientRect(); const ts = [...b.querySelectorAll('span')]; return { corta: ts.some(t => t.scrollWidth > t.clientWidth + 1 && getComputedStyle(t).display === 'block'), dentro: r.left >= 0 && r.right <= innerWidth + 0.5 && ts.every(t => t.getBoundingClientRect().right <= innerWidth + 0.5), h: Math.round(r.height), cab: b.hasAttribute('data-bloque-cabecera') } }))" | ConvertFrom-Json
    OK (@($chk | Where-Object { $_.corta -or -not $_.dentro }).Count -eq 0) 'Letra grande 360 px: títulos de cabeceras y filas envuelven sin cortarse (incl. uno largo)' (($chk | Where-Object cab | ForEach-Object { "h$($_.h)" }) -join ' ')
    $diag = JS "JSON.stringify([...document.querySelectorAll('[data-bloque-cabecera], [data-movimiento]')].map(b => ({ cab: b.hasAttribute('data-bloque-cabecera'), h: Math.round(b.getBoundingClientRect().height), cols: [...b.children].map(c => Math.round(c.getBoundingClientRect().width)).join('/'), cortados: [...b.querySelectorAll('span')].filter(t => t.scrollWidth > t.clientWidth + 1 && getComputedStyle(t).display === 'block').map(t => t.textContent.trim().substring(0,30) + ' sw=' + t.scrollWidth + ' cw=' + t.clientWidth).join(' ; ') })))"
    Nota "DIAG letra grande (alto, anchos de columnas, cortados): $diag"
    OK (@($chk | Where-Object { $_.cab -and $_.h -lt 44 }).Count -eq 0) 'Letra grande 360 px: cabeceras ≥ 44 px'
    $sw = [int](JS "document.documentElement.scrollWidth"); $iw = [int](JS "window.innerWidth")
    OK ($sw -le $iw) 'Letra grande 360 px: sin desborde horizontal' "scrollWidth $sw / $iw"
    Captura 'fert_bitacora_bloques_grande.png'
    Pantalla -Ancho 412 -Alto 915 -Movil
    JS "(() => { document.documentElement.style.removeProperty('font-size'); return true })()" | Out-Null

    # ============ (i) regresión pestañas ============
    Ir "/fertirriego?r=$s-c"
    Esperar "document.querySelector('[data-estacion]')?.dataset.estacion === '$EST'" 60000 | Out-Null
    Start-Sleep 1
    $pest = JS "[...document.querySelectorAll('[data-pestana]')].map(b => b.dataset.pestana).join(',')"
    Nota "INFO pestañas: $pest"
    foreach ($p in ($pest -split ',')) {
        if (-not $p) { continue }
        ClicHasta "document.querySelector('[data-pestana=$p]')" "document.querySelector('[data-pestana=$p]')?.getAttribute('aria-selected') === 'true' || document.querySelector('[data-pestana=$p]')?.getAttribute('aria-current') !== null" | Out-Null
        Start-Sleep -Milliseconds 700
        $e = Errores-Pagina; $sw = [int](JS "document.documentElement.scrollWidth")
        OK ((-not $e) -and $sw -le 412 -and (JS "document.body.innerText.length") -gt 50) "(i) pestaña «$p» abre sin error ni desborde" "$e sw=$sw"
    }
    IrBitacora
    $e = Errores-Pagina; OK (-not $e) '(i) sin errores de página al final' $e
}
catch { $cuerpoErr = ""; try { $cuerpoErr = (New-Object IO.StreamReader $_.Exception.Response.GetResponseStream()).ReadToEnd() } catch {}; Nota "EXCEPCION $($_.Exception.Message) $cuerpoErr @ $($_.InvocationInfo.ScriptLineNumber): $($_.InvocationInfo.Line.Trim())" }
finally {
    try { CDP 'Network.setBlockedURLs' @{ urls = @() } | Out-Null } catch {}
    Write-Host 'Limpieza...'
    try {
        if ($estId) {
            foreach ($t in 'fert_movimientos', 'fert_saldos', 'fert_bitacora_riego', 'fert_custodia', 'fert_relevos', 'fert_envases_movimientos') { try { Rest "${t}?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null } catch {} }
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
        foreach ($c in $SOL, $ACI, $MAG) { Rest "materiales?codigo=eq.$c" 'Delete' -Servicio | Out-Null }
        Rest "fert_publicaciones?temporada=eq.$([uri]::EscapeDataString("QA $s"))" 'Delete' -Servicio | Out-Null
    } catch { Nota "LIMPIEZA datos: $($_.Exception.Message) $($_.ErrorDetails.Message)" }
    try {
        if ($qaId) {
            try { Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($rolTotal); p_principal = $rolTotal } -Servicio | Out-Null } catch {}
            if ($rolEst) { Rest "permisos?rol_id=eq.$rolEst" 'Delete' -Servicio | Out-Null; Rest "roles?id=eq.$rolEst" 'Delete' -Servicio | Out-Null }
            foreach ($t in 'perfiles_zonas', 'perfiles_estaciones', 'fert_llaves') { Rest "${t}?perfil_id=eq.$qaId" 'Delete' -Servicio | Out-Null }
            Rest "perfiles?id=eq.$qaId" 'Delete' -Servicio | Out-Null
            Invoke-RestMethod -Method Delete -Uri "$URLB/auth/v1/admin/users/$qaId" -Headers $hServ | Out-Null
        }
    } catch { Nota "LIMPIEZA usuario QA: $($_.Exception.Message) $($_.ErrorDetails.Message)" }
    Remove-Item $archivoQa -ErrorAction SilentlyContinue
    try {
        $quedaUsr = 0; try { Invoke-RestMethod "$URLB/auth/v1/admin/users/$qaId" -Headers $hServ | Out-Null; $quedaUsr = 1 } catch {}
        $restos = (Lista "perfiles?select=id&id=eq.$qaId").Count + (Lista "estaciones_riego?select=id&nombre=eq.$([uri]::EscapeDataString($EST))").Count + (Lista "materiales?select=id&codigo=in.($SOL,$ACI,$MAG)").Count + (Lista "roles?select=id&codigo=eq.QA_BIT_$s").Count
        OK ($quedaUsr -eq 0 -and $restos -eq 0) 'Limpieza: usuario QA, estación, productos y rol temporal borrados de desarrollo' "usuario $quedaUsr, restos $restos"
    } catch { Nota "LIMPIEZA verificación: $($_.Exception.Message)" }
    Write-Host "Usuario $qaId · estación $estId · sufijo $s"
    Terminar-QA
}
