# QA · Campo bloque 1 (sql/128): menú «Campo» y DEVOLVER A BODEGA. Copia en :3100 + base de DESARROLLO con la 128.
# Una estación de prueba propia con un producto de prueba; al final se borra todo y el usuario QA queda como estaba.
param([string]$Capturas = "$env:TEMP\qa_campo_capturas")
. "$PSScriptRoot\comun.ps1"
Iniciar-QA -Base http://localhost:3100 -Ancho 412 -Alto 915 -Movil
New-Item -ItemType Directory -Force $Capturas | Out-Null
function Cap($n) { $png = CDP 'Page.captureScreenshot' @{ format = 'png' }; [IO.File]::WriteAllBytes("$Capturas\$n", [Convert]::FromBase64String($png.result.data)) }

function Lista($ruta, $metodo = 'Get', $cuerpo = $null, [string]$Token = '') {
    $r = if ($Token) { Rest $ruta $metodo $cuerpo -Token $Token } else { Rest $ruta $metodo $cuerpo -Servicio }
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
function SinPendientes([int]$ms = 60000) { Start-Sleep -Milliseconds 1500; Esperar "!document.querySelector('[data-pendientes-cuenta]')" $ms }
function Pendientes { [int](JS "Number((document.querySelector('[data-pendientes-cuenta]')?.innerText.match(/\d+/) || [0])[0])") }
function Abrir($estacion, $sufijo) {
    Ir "/fertirriego?r=$s-$sufijo"
    $t = Esperar "!!document.querySelector('[data-barra-estado]') && (!!document.querySelector('[data-estacion]') || !!document.querySelector('[data-selector-estacion]'))" 40000
    if ((JS "document.querySelector('[data-estacion]')?.dataset.estacion") -ne $estacion -and (JS "!!document.querySelector('[data-selector-estacion]')")) {
        ElegirOpcion '[data-selector-estacion] button' $estacion | Out-Null
    }
    $t2 = Esperar "document.querySelector('[data-estacion]')?.dataset.estacion === '$estacion'" 15000
    Start-Sleep -Milliseconds 500
    Esperar "!!document.querySelector('[data-actualizar]') && !document.querySelector('[data-actualizar]').disabled" 40000 | Out-Null
    return [Math]::Max($t, $t2)
}
function SaldoBase($est, $mat) { $x = Lista "fert_saldos?select=disponible&estacion_id=eq.$est&material_id=eq.$mat"; if ($x.Count) { return [double]$x[0].disponible } else { return 0 } }
function TextoDialogo { JS "(${ULTIMO_DIALOGO}?.innerText || '')" }
function AbrirDevolver { ClicHasta "document.querySelector('[data-accion=devolver_bodega]')" "!!document.querySelector('[data-destinos-devolucion]')" }
function Medir($nombre) {
    $m = JS "(() => { const v = [...document.querySelectorAll('button, a[href]')].filter(b => b.offsetParent !== null && !b.closest('nav, header, aside') ); const chicos = v.filter(b => { const r = b.getBoundingClientRect(); return r.height > 0 && r.height < 44 }).map(b => (b.innerText||b.getAttribute('aria-label')||'?').trim().slice(0,25) + ':' + Math.round(b.getBoundingClientRect().height)); return JSON.stringify({ancho: document.documentElement.scrollWidth, chicos}) })()" | ConvertFrom-Json
    OK ($m.ancho -le 420) "412 px · $nombre sin desborde lateral" "scrollWidth $($m.ancho)"
    return $m
}

$s = Get-Random -Maximum 99999
$qaId = $script:QA.id
$orig = (Lista "perfiles?select=rol_id&id=eq.$qaId")[0]
$origRoles = @(foreach ($x in (Lista 'rpc/fn_roles_de_perfiles' 'Post' @{})) { if ($x.perfil_id -eq $qaId) { [int]$x.rol_id } })
$idAdmin = (Lista 'roles?select=id&acceso_total=eq.true&limit=1')[0].id
$z1 = (Lista 'zonas?select=id,nombre&activo=eq.true&order=nombre&limit=1')[0]
$NOMBRE_EST = "QA Devolucion $s"; $TURNO = "TQD-$s"; $SOL = "QA-SOLD-$s"; $DESC = "SOLUCION D $s"
$rolEst = $null; $est1 = $null; $solId = $null

try {
    # ============ Preparación ============
    $rolEst = (Rest 'roles' 'Post' @{ codigo = "QA_DEVB_$s"; nombre = "QA Devolucion $s" } -Servicio)[0].id
    foreach ($a in 'ver', 'recibir', 'aplicar', 'contar', 'anular') { Rest 'permisos' 'Post' @{ rol_id = $rolEst; recurso = 'fertirriego'; accion = $a; alcance = 'propietario' } -Servicio | Out-Null }
    Rest 'permisos' 'Post' @{ rol_id = $rolEst; recurso = 'campo'; accion = 'ver'; alcance = 'global' } -Servicio | Out-Null
    Rest 'permisos' 'Post' @{ rol_id = $rolEst; recurso = 'agrometricas'; accion = 'ver'; alcance = 'global' } -Servicio | Out-Null
    Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($orig.rol_id, $idAdmin); p_principal = $orig.rol_id } -Servicio | Out-Null
    $est1 = (Rest 'estaciones_riego' 'Post' @{ nombre = $NOMBRE_EST; zona_id = $z1.id } -Servicio)[0].id
    $pub = Rest 'rpc/fn_fert_publicar' 'Post' @{ p = @{
        temporada = "QA $s"
        estaciones = @(@{ nombre = $NOMBRE_EST; zona = $z1.nombre })
        materiales = @(@{ codigo = $SOL; descripcion = $DESC; unidad = 'L'; grupo = '1800' })
        turnos = @(@{ agl_id = "TR-QD-$s"; turno = $TURNO; temporada = "QA $s"; ciclo = 'Ciclo QA'; fecha_siembra = (Get-Date).AddDays(-5).ToString('yyyy-MM-dd'); estacion = $NOMBRE_EST; zona = $z1.nombre; area_mz = 10; estado = 'Creado' })
        plan = @()
    } }
    $solId = (Lista "materiales?select=id&codigo=eq.$SOL")[0].id
    Rest 'rpc/fn_fert_asignar_persona' 'Post' @{ p_estacion = $est1; p_perfil = $qaId; p_asignar = $true } | Out-Null
    Rest 'rpc/fn_fert_asignar_custodia' 'Post' @{ p_estacion = $est1; p_perfil = $qaId; p_motivo = 'Arranque QA' } | Out-Null
    Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($rolEst); p_principal = $rolEst } -Servicio | Out-Null
    $tok = Entrar-Como $script:QA.email $script:QA.clave
    OK ($pub.turnos -eq 1 -and $solId) 'Preparación: estación, turno y producto de prueba'
    CDP 'Browser.grantPermissions' @{ permissions = @('geolocation'); origin = 'http://localhost:3100' } | Out-Null
    CDP 'Emulation.setGeolocationOverride' @{ latitude = 13.312; longitude = -87.195; accuracy = 12 } | Out-Null

    # ============ (1) Menú Campo ============
    Ir "/campo?r=$s"
    $t = Esperar "!!document.querySelector('[data-ficha-campo=fertirriego]') && !!document.querySelector('[data-ficha-campo=agrometricas]')" 40000
    OK ($t -ge 0) '(1) /campo muestra las tarjetas Fertirriego y AgroMétricas' "$t ms"
    $alt = JS "Math.min(...[...document.querySelectorAll('[data-ficha-campo]')].map(a => a.getBoundingClientRect().height))"
    OK ($alt -ge 44) '(1) tarjetas de Campo ≥ 44 px' "$alt px"
    Medir 'Campo' | Out-Null
    Cap 'campo_claro.png'
    ClicEn "document.querySelector('[data-ficha-campo=agrometricas]')" | Out-Null
    $t = Esperar "location.pathname.startsWith('/agrometricas')" 20000
    OK ($t -ge 0) '(1) la tarjeta AgroMétricas navega a /agrometricas'
    Ir "/campo?r=$s-b"; Esperar "!!document.querySelector('[data-ficha-campo=fertirriego]')" 30000 | Out-Null
    ClicEn "document.querySelector('[data-ficha-campo=fertirriego]')" | Out-Null
    $t = Esperar "location.pathname.startsWith('/fertirriego')" 20000
    OK ($t -ge 0) '(1) la tarjeta Fertirriego navega a /fertirriego'

    # ============ Saldo inicial: conteo de 500 ============
    $t = Abrir $NOMBRE_EST 'a1'
    OK ($t -ge 0) 'Abre la estación de prueba' "$t ms"
    OK (-not (JS "!!document.querySelector('[data-accion=devolver_bodega]')")) 'Sin saldo no aparece «Devolver a bodega»'
    ClicHasta "document.querySelector('[data-accion=contar]')" "!!document.querySelector('[data-conteo]')" | Out-Null
    $FILA_SOL = "document.querySelector('[data-conteo-material=""$SOL""]')"
    if (-not (JS "!!$FILA_SOL")) {
        ClicHasta "[...$ULTIMO_DIALOGO.querySelectorAll('button')].find(b => /Agregar producto/.test(b.innerText))" "document.querySelectorAll('[role=dialog]').length > 1 && !!$ULTIMO_DIALOGO.querySelector('input[inputmode=search]')" | Out-Null
        ClicEn "[...$ULTIMO_DIALOGO.querySelectorAll('button')].find(b => b.innerText.includes('$SOL'))" | Out-Null
        Esperar "!!$FILA_SOL" 4000 | Out-Null
    }
    Teclear "document.querySelector('[data-conteo-material=""$SOL""] input')" '500'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    SinPendientes | Out-Null
    OK ((SaldoBase $est1 $solId) -eq 500) 'Conteo inicial: 500 L en la bodega'

    # ============ (2) Devolver a bodega ============
    $t = Esperar "!!document.querySelector('[data-accion=devolver_bodega]')" 15000
    $altB = JS "document.querySelector('[data-accion=devolver_bodega]')?.getBoundingClientRect().height"
    OK ($t -ge 0 -and $altB -ge 44) '(2) con saldo aparece «Devolver a bodega» (≥ 44 px)' "$altB px"
    $m = Medir 'Estación'
    Cap 'estacion_claro.png'
    AbrirDevolver | Out-Null
    OK ((JS "document.querySelectorAll('[data-destino]').length") -eq 3) '(2) formulario con 3 destinos (Suministros, Bodega, Taller)' (JS "[...document.querySelectorAll('[data-destino]')].map(b=>b.innerText).join(',')")
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    $t = Esperar "/Elige a dónde se devuelve/.test(${ULTIMO_DIALOGO}?.innerText || '')" 5000
    OK ($t -ge 0) '(2) sin destino: lo pide'
    ClicEn "document.querySelector('[data-destino=BODEGA]')" | Out-Null
    ClicEn "document.querySelector('[data-motivo-sugerido]')" | Out-Null
    ElegirOpcion '[data-linea="0"] button' $DESC | Out-Null
    Teclear "document.querySelector('[data-cantidad=""0""]')" '0'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    $t = Esperar "/Indica al menos un producto/.test(${ULTIMO_DIALOGO}?.innerText || '')" 5000
    OK ($t -ge 0) '(2) cantidad 0 = línea vacía: «Indica al menos un producto»'
    Teclear "document.querySelector('[data-cantidad=""0""]')" '600'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    $t = Esperar "/No puedes devolver más/.test(${ULTIMO_DIALOGO}?.innerText || '')" 5000
    OK ($t -ge 0 -and (Pendientes) -eq 0) '(2) más del saldo: avisa antes de enviar (no se encola)' ((TextoDialogo) -split "`n" | Where-Object { $_ -match 'devolver más' } | Select-Object -First 1)
    Medir 'Formulario devolver' | Out-Null
    Cap 'form_devolver_claro.png'
    Teclear "document.querySelector('[data-cantidad=""0""]')" '120'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    Esperar "!document.querySelector('[data-destinos-devolucion]')" 15000 | Out-Null
    SinPendientes | Out-Null
    $dv = Lista "fert_devoluciones_bodega?select=id,destino,motivo,fert_devoluciones_bodega_detalle(cantidad)&estacion_id=eq.$est1"
    $mv = Lista "fert_movimientos?select=cantidad,tipo&estacion_id=eq.$est1&tipo=eq.DEVOLUCION_BODEGA"
    OK ($dv.Count -eq 1 -and $dv[0].destino -eq 'BODEGA' -and $dv[0].motivo -eq 'Fin de temporada' -and [double]$dv[0].fert_devoluciones_bodega_detalle[0].cantidad -eq 120) '(2) devolver 120 guarda la devolución (BODEGA, motivo)'
    OK ((SaldoBase $est1 $solId) -eq 380 -and $mv.Count -eq 1 -and [double]$mv[0].cantidad -eq -120) '(2) saldo baja a 380 y el libro tiene DEVOLUCION_BODEGA −120' "saldo $(SaldoBase $est1 $solId)"

    # Forzado por la base: más del saldo
    $opId = [guid]::NewGuid().ToString()
    $op = @{ id = $opId; tipo = 'devolucion_bodega'; creado_en = (Get-Date).ToString('o'); dispositivo = 'QA'; datos = @{ estacion_id = $est1; fecha_hora = (Get-Date).ToString('o'); destino = 'TALLER'; motivo = 'forzado QA'; lineas = @(@{ material_id = $solId; cantidad = 9999 }) } }
    $r = $null; $err = ''; try { $r = Rest 'rpc/fn_fert_sincronizar' 'Post' @{ p_ops = @($op) } -Token $tok } catch { $err = "$($_.ErrorDetails.Message)" }
    $fo = Lista "fert_operaciones?select=resultado,mensaje&id=eq.$opId"
    $txt = "$(($r | ConvertTo-Json -Depth 6 -Compress))$err"
    OK ((SaldoBase $est1 $solId) -eq 380 -and (Lista "fert_devoluciones_bodega?select=id&estacion_id=eq.$est1").Count -eq 1 -and $txt -match 'solo hay') '(2) forzado por la base (9999): lo rechaza y el saldo no cambia' ($txt.Substring(0, [Math]::Min(220, $txt.Length)))

    # ============ (3) Sin señal ============
    Abrir $NOMBRE_EST 'a2' | Out-Null
    CDP 'Network.enable' | Out-Null
    CDP 'Network.setBlockedURLs' @{ urls = @('*supabase.co*') } | Out-Null
    AbrirDevolver | Out-Null
    ClicEn "document.querySelector('[data-destino=TALLER]')" | Out-Null
    Teclear "document.querySelector('[data-motivo-devolucion]')" 'Sobrante sin señal (QA)'
    ElegirOpcion '[data-linea="0"] button' $DESC | Out-Null
    Teclear "document.querySelector('[data-cantidad=""0""]')" '30'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    Esperar "!document.querySelector('[data-destinos-devolucion]')" 15000 | Out-Null
    Start-Sleep 2
    OK ((Pendientes) -ge 1 -and (Lista "fert_devoluciones_bodega?select=id&estacion_id=eq.$est1&destino=eq.TALLER").Count -eq 0) '(3) sin señal: queda en la cola del teléfono' "pendientes $(Pendientes)"
    ClicHasta "document.querySelector('[data-pestana=envios]')" "!!document.querySelector('[data-pendientes]')" | Out-Null
    $txtEnv = JS "document.querySelector('[data-pendientes]')?.innerText || ''"
    OK ($txtEnv -match 'Devoluci.n a taller') '(5) Envíos muestra el pendiente con su rótulo' ($txtEnv -replace "`n", ' / ')
    Cap 'envios_pendiente_claro.png'
    CDP 'Network.setBlockedURLs' @{ urls = @() } | Out-Null
    ClicEn "document.querySelector('[data-actualizar]')" | Out-Null
    $t = SinPendientes 40000
    ClicEn "document.querySelector('[data-actualizar]')" | Out-Null
    Start-Sleep 4
    $tal = Lista "fert_devoluciones_bodega?select=id&estacion_id=eq.$est1&destino=eq.TALLER"
    OK ($t -ge 0 -and $tal.Count -eq 1 -and (SaldoBase $est1 $solId) -eq 350) '(3) con señal: sincroniza UNA sola vez (saldo 350)' "filas $($tal.Count), saldo $(SaldoBase $est1 $solId)"

    # ============ (4)(5) Bitácora, detalle y Anular ============
    ClicHasta "document.querySelector('[data-pestana=bitacora]')" "!!document.querySelector('[data-movimiento=DEVOLUCION_BODEGA]')" | Out-Null
    $rot = JS "[...document.querySelectorAll('[data-movimiento=DEVOLUCION_BODEGA]')].map(b => b.textContent).join(' | ')"
    OK ($rot -match 'Devuelto a suministros') '(5) Bitácora con el rótulo del tipo' $rot
    Cap 'bitacora_claro.png'
    ClicHasta "[...document.querySelectorAll('[data-movimiento=DEVOLUCION_BODEGA]')].find(b => !b.disabled)" "!!document.querySelector('[data-detalle-documento]')" | Out-Null
    $det = TextoDialogo
    OK ((JS "!!document.querySelector('[data-detalle-movimientos]')") -and $det -match 'Devoluci.n a bodega') '(4) el detalle muestra la devolución y sus movimientos' (($det -split "`n" | Select-Object -First 6) -join ' / ')
    Medir 'Detalle' | Out-Null
    Cap 'detalle_claro.png'
    $antes = SaldoBase $est1 $solId
    ClicHasta "document.querySelector('[data-modo-anular]')" "!!document.querySelector('[data-motivo]')" | Out-Null
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    Start-Sleep 1
    Teclear "document.querySelector('[data-motivo]')" 'Anulación de prueba QA'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    SinPendientes | Out-Null
    Start-Sleep 2
    $an = Lista "fert_devoluciones_bodega?select=id,motivo_anulacion,fert_devoluciones_bodega_detalle(cantidad)&estacion_id=eq.$est1&anulado_at=not.is.null"
    $desp = SaldoBase $est1 $solId
    $cant = if ($an.Count) { [double]$an[0].fert_devoluciones_bodega_detalle[0].cantidad } else { 0 }
    OK ($an.Count -eq 1 -and $an[0].motivo_anulacion -match 'prueba QA' -and $desp -eq ($antes + $cant)) '(4) Anular con motivo devuelve el saldo' "antes $antes, anulado $cant, ahora $desp"

    # ============ (6) Tema oscuro ============
    JS "localStorage.setItem('agro-tema','oscuro'); document.cookie='agro-tema=oscuro;path=/;max-age=3600'; true" | Out-Null
    Ir "/campo?r=$s-o"; Esperar "!!document.querySelector('[data-ficha-campo]')" 30000 | Out-Null; Start-Sleep 1
    OK ((JS "document.documentElement.dataset.tema") -eq 'oscuro') '(6) tema oscuro activo'
    Cap 'campo_oscuro.png'
    Abrir $NOMBRE_EST 'o1' | Out-Null; Start-Sleep 1
    Cap 'estacion_oscuro.png'
    AbrirDevolver | Out-Null; Start-Sleep 1
    $bgBtn = JS "getComputedStyle(document.querySelector('[data-destino=SUMINISTROS]')).backgroundColor"
    OK ($true) '(6) formulario en oscuro (revisar captura)' "fondo botón destino: $bgBtn"
    Cap 'form_devolver_oscuro.png'
    ClicEn "document.querySelector('[data-cancelar-registro]')" | Out-Null
    ClicHasta "document.querySelector('[data-pestana=bitacora]')" "!!document.querySelector('[data-movimiento=DEVOLUCION_BODEGA]')" | Out-Null
    Cap 'bitacora_oscuro.png'
    JS "localStorage.setItem('agro-tema','claro'); document.cookie='agro-tema=claro;path=/;max-age=3600'; true" | Out-Null

    $e = Errores-Pagina; OK (-not $e) 'Sin errores en la página' $e
}
catch {
    $cuerpo = $_.ErrorDetails.Message
    $script:Resultados.Add("EXCEPCION (línea $($_.InvocationInfo.ScriptLineNumber)) $($_.Exception.Message) $cuerpo")
}
finally {
    try { CDP 'Network.setBlockedURLs' @{ urls = @() } | Out-Null } catch {}
    try {
        if ($est1) {
            $desde = "$((Get-Date).AddHours(-3).ToString('yyyy-MM-ddTHH:mm:ss'))-06:00"
            foreach ($x in (Lista "fert_devoluciones_bodega?select=id&estacion_id=eq.$est1")) { Rest "fert_devoluciones_bodega_detalle?devolucion_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null; Rest "fert_devoluciones_bodega?id=eq.$($x.id)" 'Delete' -Servicio | Out-Null }
            foreach ($t in 'fert_movimientos', 'fert_saldos', 'fert_bitacora_riego', 'fert_custodia', 'fert_relevos') { Rest "${t}?estacion_id=eq.$est1" 'Delete' -Servicio | Out-Null }
            foreach ($x in (Lista "fert_conteos?select=id&estacion_id=eq.$est1")) { Rest "fert_conteos_detalle?conteo_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null }
            Rest "fert_conteos?estacion_id=eq.$est1" 'Delete' -Servicio | Out-Null
            Rest "perfiles_estaciones?estacion_id=eq.$est1" 'Delete' -Servicio | Out-Null
            Rest "fert_operaciones?perfil_id=eq.$qaId&recibido_en=gte.$desde" 'Delete' -Servicio | Out-Null
        }
        foreach ($x in (Lista "turnos_ciclo?select=id,turno_id&agl_id=eq.TR-QD-$s")) { Rest "fert_plan?turno_ciclo_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null; Rest "turnos_ciclo?id=eq.$($x.id)" 'Delete' -Servicio | Out-Null; Rest "turnos?id=eq.$($x.turno_id)" 'Delete' -Servicio | Out-Null }
        if ($est1) { Rest "estaciones_riego?id=eq.$est1" 'Delete' -Servicio | Out-Null }
        Rest "materiales?codigo=eq.$SOL" 'Delete' -Servicio | Out-Null
        Rest "fert_publicaciones?temporada=eq.$([uri]::EscapeDataString("QA $s"))" 'Delete' -Servicio | Out-Null
    } catch { $script:Resultados.Add("LIMPIEZA datos: $($_.Exception.Message) $($_.ErrorDetails.Message)") }
    try { Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = $origRoles; p_principal = $orig.rol_id } -Servicio | Out-Null } catch { $script:Resultados.Add("LIMPIEZA roles QA: $($_.Exception.Message)") }
    try { if ($rolEst) { Rest "permisos?rol_id=eq.$rolEst" 'Delete' -Servicio | Out-Null; Rest "roles?id=eq.$rolEst" 'Delete' -Servicio | Out-Null } } catch { $script:Resultados.Add("LIMPIEZA rol: $($_.Exception.Message)") }
    try {
        $queda = (Lista "estaciones_riego?select=id&nombre=eq.$([uri]::EscapeDataString($NOMBRE_EST))").Count + (Lista "materiales?select=id&codigo=eq.$SOL").Count + (Lista "roles?select=id&codigo=eq.QA_DEVB_$s").Count
        OK ($queda -eq 0) 'Limpieza: nada de la prueba queda en desarrollo' "restos $queda"
    } catch { $script:Resultados.Add("LIMPIEZA verificación: $($_.Exception.Message)") }
    "SUFIJO $s · EST $est1 · CAPTURAS $Capturas"
    Terminar-QA
}
