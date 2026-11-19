# QA con clics - Fertirriego: ELIMINAR POR COMPLETO (sql/119-121). Base de DESARROLLO (.env.local).
# Autocontenido: crea 2 usuarios QA (administrador y estacionero sin el permiso), estaciones "PRUEBA · QA Elim", turno, plan, productos y
# chofer; genera registros por RPC (fn_fert_sincronizar) y elimina con la UI. Al final BORRA todo por id exacto (incluida su auditoria).
# Uso: powershell -ExecutionPolicy Bypass -File pruebas/qa/fertirriego_eliminar.ps1 [-Puerto 3102] [-PuertoCdp 9352]
param([int]$Puerto = 3102, [int]$PuertoCdp = 9352)
. "$PSScriptRoot\comun.ps1"
# Progreso en vivo: cada comprobacion se imprime al instante (el arnés solo imprime al final y no se veia donde se atascaba)
function OK($cond, $nombre, $extra = '') {
    $t = ("{0} {1}{2}" -f ($(if ($cond) { 'OK' } else { 'FALLO' })), $nombre, $(if ("$extra" -ne '') { " :: $extra" } else { '' }))
    $script:Resultados.Add($t); Write-Host "[$((Get-Date).ToString('HH:mm:ss'))] $t"
}
$BASE = "http://localhost:$Puerto"
$envd = Leer-Entorno
$URLB = $envd['NEXT_PUBLIC_SUPABASE_URL']; $SERV = $envd['SUPABASE_SERVICE_ROLE_KEY']; $ANON = $envd['NEXT_PUBLIC_SUPABASE_ANON_KEY']
$hServ = @{ apikey = $SERV; Authorization = "Bearer $SERV" }
$s = Get-Random -Maximum 99999
$archivoQa = "$PSScriptRoot\qa_usuario.local.json"
$EST = "PRUEBA · QA Elim $s"; $EST2 = "PRUEBA · QA Elim2 $s"; $TURNO = "TQE-$s"; $SOL = "QE-SOL-$s"; $ACI = "QE-ACI-$s"
$hoy = (Get-Date).ToString('yyyy-MM-dd'); $ayer = (Get-Date).AddDays(-1).ToString('yyyy-MM-dd')
$qaId = $null; $negId = $null; $estId = $null; $est2Id = $null; $choferId = [guid]::NewGuid().ToString(); $tcId = $null
$audIds = New-Object System.Collections.ArrayList

function Lista($ruta) { $r = Rest $ruta 'Get' $null -Servicio; $o = New-Object System.Collections.ArrayList; foreach ($x in $r) { if ($null -ne $x) { [void]$o.Add($x) } }; return ,$o }
function ClicEn($js) { JS "(() => { const e = $js; if (!e) return false; e.scrollIntoView({block:'center'}); e.click(); return true })()" }
function ClicHasta($js, $condicion, [int]$veces = 15) { for ($i = 0; $i -lt $veces; $i++) { ClicEn $js | Out-Null; if ((Esperar $condicion 700) -ge 0) { return $true } }; return $false }
$ULTIMO_DIALOGO = "[...document.querySelectorAll('[role=dialog]')].pop()"
function ElegirOpcion($selectorBoton, $texto) {
    ClicHasta "document.querySelector('$selectorBoton')" "document.querySelectorAll('[role=dialog]').length > 0 && !!$ULTIMO_DIALOGO.querySelector('input[inputmode=search]')" | Out-Null
    $ok = ClicEn "[...$ULTIMO_DIALOGO.querySelectorAll('button')].find(b => b.innerText.trim().toLowerCase().startsWith('$($texto.ToLower())'))"
    Start-Sleep -Milliseconds 500
    return $ok
}
# Selector buscable de la pantalla de Administracion: se localiza por el texto de su boton (placeholder o valor)
function ElegirEnAdmin($textoBoton, $opcion) {
    $b = "[...document.querySelectorAll('[data-eliminar-registros-admin] button')].find(x => x.innerText.trim().startsWith('$textoBoton'))"
    ClicHasta $b "document.querySelectorAll('[role=dialog]').length > 0 && !!$ULTIMO_DIALOGO.querySelector('input[inputmode=search]')" | Out-Null
    $ok = ClicEn "[...$ULTIMO_DIALOGO.querySelectorAll('button')].find(b => b.innerText.trim().toLowerCase().startsWith('$($opcion.ToLower())'))"
    Start-Sleep -Milliseconds 600
    return $ok
}
function SaldoBase($matId) { $r = Lista "fert_saldos?select=disponible&estacion_id=eq.$estId&material_id=eq.$matId"; if ($r.Count -eq 0) { return 0 }; return [double]$r[0].disponible }
function SumaMovs($matId) { $t = 0.0; foreach ($x in (Lista "fert_movimientos?select=cantidad&estacion_id=eq.$estId&material_id=eq.$matId")) { $t += [double]$x.cantidad }; return $t }
function Op($tipo, $datos, $id = $null, $Tok = $null) {
    if (-not $Tok) { $Tok = $script:TokAdmin }
    if (-not $id) { $id = [guid]::NewGuid().ToString() }
    $ahora = (Get-Date).ToUniversalTime().AddSeconds(15).ToString('o')
    $op = @(@{ id = $id; tipo = $tipo; creado_en = $ahora; enviado_en = $ahora; inmediato = $true; ubicacion = @{ lat = 13.3; lon = -87.2 }; datos = $datos })
    $r = Rest 'rpc/fn_fert_sincronizar' 'Post' @{ p_ops = $op } -Token $Tok
    $e = @($r)[0]
    return [pscustomobject]@{ id = $id; estado = "$($e.estado)"; mensaje = "$($e.mensaje)" }
}
function Aceptado($r) { return ($r.estado -like 'ACEPTADO*') }
function PonerFecha($sel, $valor) { JS "(() => { const i = document.querySelector('$sel'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, '$valor'); i.dispatchEvent(new Event('input', { bubbles: true })); return true })()" | Out-Null; Start-Sleep -Milliseconds 400 }
function AbrirEstacion([string]$tag) {
    Ir "/fertirriego?r=$s-$tag"
    Esperar "!!document.querySelector('[data-barra-estado]') && !!document.querySelector('[data-estacion]')" 60000 | Out-Null
    ElegirOpcion '[data-selector-estacion] button' $EST | Out-Null
    $ok = (Esperar "document.querySelector('[data-estacion]')?.dataset.estacion === '$EST'" 15000)
    # La base de desarrollo tarda >10 s en responder: sin esperar a que [data-actualizar] se habilite la bitacora llega vacia
    Esperar "!!document.querySelector('[data-actualizar]') && !document.querySelector('[data-actualizar]').disabled" 60000 | Out-Null
    return $ok
}
function IrBitacora { ClicHasta "document.querySelector('[data-pestana=bitacora]')" "!!document.querySelector('[data-filtros-bitacora]')" | Out-Null; Start-Sleep -Milliseconds 500 }
function AbrirDoc($tipoMov) { Esperar "!!document.querySelector('[data-movimiento=$tipoMov]')" 60000 | Out-Null; return (ClicHasta "[...document.querySelectorAll('[data-movimiento=$tipoMov]')].find(b => !b.disabled)" "!!document.querySelector('[data-detalle-documento]')") }
# Elimina desde el detalle abierto con el motivo dado; devuelve $true si el detalle se cerro y aparecio «Registro eliminado»
function EliminarDesdeDetalle($motivo) {
    ClicHasta "document.querySelector('[data-modo-eliminar]')" "!!document.querySelector('[data-motivo-eliminar]')" | Out-Null
    Teclear "document.querySelector('[data-motivo-eliminar]')" $motivo
    ClicEn "document.querySelector('[data-confirmar-eliminar]')" | Out-Null
    $t = Esperar "!document.querySelector('[data-eliminar-por-completo]') && !document.querySelector('[data-detalle-documento]')" 30000
    return $t
}

# ---- usuarios QA ----
function NuevoUsuario($pref, $nombre, $rol) {
    $em = "qa.$pref.$([guid]::NewGuid().ToString('N').Substring(0,10))@desarrollo.local"; $cl = "Qa-$(Get-Random)-x$(Get-Random)"
    $u = Invoke-RestMethod -Method Post -Uri "$URLB/auth/v1/admin/users" -Headers $hServ -ContentType 'application/json' -Body (@{ email = $em; password = $cl; email_confirm = $true } | ConvertTo-Json)
    Invoke-RestMethod -Method Post "$URLB/rest/v1/perfiles" -Headers $hServ -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes((@{ id = $u.id; nombre = $nombre; rol_id = $rol; todas_las_zonas = $true } | ConvertTo-Json))) | Out-Null
    return [pscustomobject]@{ id = $u.id; email = $em; clave = $cl }
}
$rolAdmin = (Invoke-RestMethod "$URLB/rest/v1/roles?select=id&acceso_total=eq.true&order=id&limit=1" -Headers $hServ)[0].id
$ua = NuevoUsuario 'eli' "QA Eliminar $s" $rolAdmin; $qaId = $ua.id
$un = NuevoUsuario 'neg' "QA SinPermiso $s" 84; $negId = $un.id
@{ id = $ua.id; email = $ua.email; clave = $ua.clave } | ConvertTo-Json | Set-Content -Encoding utf8 $archivoQa
$script:TokAdmin = (Invoke-RestMethod -Method Post "$URLB/auth/v1/token?grant_type=password" -Headers @{ apikey = $ANON } -ContentType 'application/json' -Body (@{ email = $ua.email; password = $ua.clave } | ConvertTo-Json)).access_token

try {
    Iniciar-QA -Base $BASE -Ancho 412 -Alto 915 -Movil -Puerto $PuertoCdp
    $script:Token = $script:TokAdmin
    # ============ Preparacion ============
    $z1 = (Lista 'zonas?select=id,nombre&activo=eq.true&order=nombre&limit=1')[0]
    $estId = (Rest 'estaciones_riego' 'Post' @{ nombre = $EST; zona_id = $z1.id } -Servicio)[0].id
    $est2Id = (Rest 'estaciones_riego' 'Post' @{ nombre = $EST2; zona_id = $z1.id } -Servicio)[0].id
    $pub = Rest 'rpc/fn_fert_publicar' 'Post' @{ p = @{
        temporada = "QA $s"
        estaciones = @(@{ nombre = $EST; zona = $z1.nombre }, @{ nombre = $EST2; zona = $z1.nombre })
        materiales = @(@{ codigo = $SOL; descripcion = "SOLUCION QA $s"; unidad = 'L'; grupo = '1800' }, @{ codigo = $ACI; descripcion = "ACIDO QA $s"; unidad = 'L'; grupo = '1800' })
        turnos = @(@{ agl_id = "TR-QE-$s"; turno = $TURNO; temporada = "QA $s"; ciclo = 'Ciclo QA'; fecha_siembra = (Get-Date).AddDays(-5).ToString('yyyy-MM-dd'); estacion = $EST; zona = $z1.nombre; area_mz = 10; estado = 'Creado' })
        plan = @(@{ agl_id = "TR-QE-$s"; filas = @(@{ fecha = $hoy; ddt = 5; material = $SOL; cantidad = 120 }) })
    } } -Token $script:TokAdmin
    OK ($pub.turnos -eq 1) 'Preparacion: estaciones de prueba, turno, plan y productos' "turnos $($pub.turnos)"
    $mSol = (Lista "materiales?select=id&codigo=eq.$SOL")[0].id; $mAci = (Lista "materiales?select=id&codigo=eq.$ACI")[0].id
    $tcId = (Lista "turnos_ciclo?select=id&agl_id=eq.TR-QE-$s")[0].id
    Rest 'fert_choferes' 'Post' @{ id = $choferId; nombre = "Chofer QE $s"; validado = $true } -Servicio | Out-Null
    foreach ($p in $qaId, $negId) { Rest 'perfiles_estaciones' 'Post' @{ perfil_id = $p; estacion_id = $estId } -Servicio | Out-Null }
    Rest 'perfiles_estaciones' 'Post' @{ perfil_id = $qaId; estacion_id = $est2Id } -Servicio | Out-Null
    $cu = Rest 'rpc/fn_fert_asignar_custodia' 'Post' @{ p_estacion = $estId; p_perfil = $qaId; p_motivo = 'Arranque QA eliminar' }
    Start-Sleep -Seconds 2
    $rc = Op 'recepcion' @{ estacion_id = $estId; fecha_hora = (Get-Date).ToUniversalTime().AddHours(-3).ToString('o'); chofer_id = $choferId; lineas = @(@{ material_id = $mSol; cantidad = 100 }, @{ material_id = $mAci; cantidad = 50 }) }
    OK (Aceptado $rc) 'Preparacion: recepcion inicial 100 SOL / 50 ACI' "$($rc.estado) $($rc.mensaje)"

    # ============ E1 permisos en la base ============
    $roles = Lista 'roles?select=id,codigo,nombre,acceso_total&order=id'
    $pm = Lista 'permisos?select=rol_id,accion,permitido&recurso=eq.fertirriego&accion=in.(eliminar_definitivo,configurar)'
    $difE1 = @(); $filas = @()
    foreach ($r in $roles) {
        $e = [bool](@($pm | Where-Object { $_.rol_id -eq $r.id -and $_.accion -eq 'eliminar_definitivo' -and $_.permitido }).Count)
        $c = [bool](@($pm | Where-Object { $_.rol_id -eq $r.id -and $_.accion -eq 'configurar' -and $_.permitido }).Count)
        $filas += "$($r.id) $($r.codigo) ($($r.nombre)) eliminar=$e configurar=$c total=$($r.acceso_total)"
        if (-not $r.acceso_total -and $e -ne $c) { $difE1 += $r.codigo }
    }
    foreach ($f in $filas) { $script:Resultados.Add("INFO E1 $f") }
    OK ($difE1.Count -eq 0) 'E1 quien tiene «Eliminar por completo» coincide con quien tenia «Configurar»' ($difE1 -join ',')

    # ============ E2 visibilidad: admin ============
    # --- paso A: aplicacion A1 (SOL 30) + devolucion D1 (5) ---
    $a1 = Op 'aplicacion' @{ estacion_id = $estId; turno_ciclo_id = $tcId; fecha = $ayer; lineas = @(@{ material_id = $mSol; cantidad = 30 }) }
    $d1 = Op 'devolucion' @{ estacion_id = $estId; aplicacion_id = $a1.id; motivo = 'sobro'; lineas = @(@{ material_id = $mSol; cantidad = 5 }) }
    OK ((Aceptado $a1) -and (Aceptado $d1)) 'Datos A1 + devolucion D1' "$($a1.estado) $($a1.mensaje) | $($d1.estado) $($d1.mensaje)"
    $saldoAntes = SaldoBase $mSol
    OK ($saldoAntes -eq 75) 'Saldo SOL antes = 100 - 30 + 5 = 75' $saldoAntes
    CDP 'Browser.grantPermissions' @{ permissions = @('geolocation'); origin = $BASE } | Out-Null
    $t = AbrirEstacion 'a'
    OK ($t -ge 0) 'Admin abre Fertirriego y elige su estacion' "$t ms"
    IrBitacora
    OK (AbrirDoc 'APLICACION') 'Abre el detalle de la aplicacion en la bitacora'
    OK ([bool](JS "!!document.querySelector('[data-modo-eliminar]')")) 'E2 admin: el detalle muestra «Eliminar por completo»'
    $txtBtn = JS "document.querySelector('[data-modo-eliminar]')?.innerText"
    $h44 = JS "Math.round(document.querySelector('[data-modo-eliminar]')?.getBoundingClientRect().height || 0)"
    OK ([int]$h44 -ge 44) 'E11 boton «Eliminar por completo» mide >= 44 px' "$h44 px"

    # ============ E3 modal ============
    ClicHasta "document.querySelector('[data-modo-eliminar]')" "!!document.querySelector('[data-motivo-eliminar]')" | Out-Null
    $aviso = JS "document.querySelector('[data-eliminar-por-completo]')?.innerText"
    OK ($aviso -match 'ning[uú]n informe' -and $aviso -match 'No se puede deshacer') 'E3 el modal advierte que no aparece en informes y no se puede deshacer' (($aviso -replace "`n",' ').Substring(0, [Math]::Min(160, $aviso.Length)))
    ClicEn "document.querySelector('[data-confirmar-eliminar]')" | Out-Null
    $t = Esperar "!!document.querySelector('[data-error-eliminar]')" 4000
    OK ($t -ge 0) 'E3 motivo vacio: muestra error y no elimina'
    Teclear "document.querySelector('[data-motivo-eliminar]')" 'corto'
    ClicEn "document.querySelector('[data-confirmar-eliminar]')" | Out-Null
    $t = Esperar "/m[ií]nimo 15/.test(document.querySelector('[data-error-eliminar]')?.innerText || '')" 4000
    OK ($t -ge 0 -and (Lista "fert_aplicaciones?select=id&id=eq.$($a1.id)").Count -eq 1) 'E3 motivo corto (<15): error y nada se borra'
    ClicEn "document.querySelector('[data-cancelar-eliminar]')" | Out-Null
    Start-Sleep -Milliseconds 700
    OK ((Lista "fert_aplicaciones?select=id&id=eq.$($a1.id)").Count -eq 1 -and [bool](JS "!document.querySelector('[data-eliminar-por-completo]')")) 'E3 Cancelar no borra y cierra el modal'

    # ============ E6 sin senal ============
    $nOps = (Lista "fert_operaciones?select=id&perfil_id=eq.$qaId").Count
    CDP 'Network.enable' | Out-Null
    CDP 'Network.setBlockedURLs' @{ urls = @('*supabase.co*') } | Out-Null
    ClicHasta "document.querySelector('[data-modo-eliminar]')" "!!document.querySelector('[data-motivo-eliminar]')" | Out-Null
    Teclear "document.querySelector('[data-motivo-eliminar]')" 'Prueba sin senal de la QA'
    ClicEn "document.querySelector('[data-confirmar-eliminar]')" | Out-Null
    $t = Esperar "/Necesitas se[nñ]al para eliminar/.test(document.querySelector('[data-error-eliminar]')?.innerText || '')" 15000
    $pend = JS "!!document.querySelector('[data-pendientes-cuenta]')"
    CDP 'Network.setBlockedURLs' @{ urls = @() } | Out-Null
    OK ($t -ge 0 -and -not $pend -and (Lista "fert_aplicaciones?select=id&id=eq.$($a1.id)").Count -eq 1 -and (Lista "fert_operaciones?select=id&perfil_id=eq.$qaId").Count -eq $nOps) 'E6 sin senal: avisa «Necesitas senal para eliminar», no encola ni borra' "t=$t pend=$pend"
    ClicEn "document.querySelector('[data-cancelar-eliminar]')" | Out-Null
    Start-Sleep -Milliseconds 500

    # ============ E4 eliminar la aplicacion con devolucion ============
    $ok = EliminarDesdeDetalle 'La QA elimina esta aplicacion con devolucion'
    OK ($ok -ge 0) 'E4 tras confirmar se cierra el detalle' "$ok ms"
    $av = Esperar "/Registro eliminado/.test(document.body.innerText)" 8000
    OK ($av -ge 0) 'E4 aparece «Registro eliminado»'
    # El estado de campo se refresca tras el RPC; con la base de desarrollo lenta puede tardar: se espera hasta 30 s y se informa cuanto tardo
    $msRef = Esperar "document.querySelectorAll('[data-movimiento=APLICACION]').length === 0 && document.querySelectorAll('[data-movimiento=DEVOLUCION]').length === 0" 30000
    $nAp = JS "document.querySelectorAll('[data-movimiento=APLICACION]').length"; $nDe = JS "document.querySelectorAll('[data-movimiento=DEVOLUCION]').length"
    OK ([int]$nAp -eq 0 -and [int]$nDe -eq 0) 'E4 la bitacora ya no trae la aplicacion ni su devolucion' "apl=$nAp dev=$nDe, la lista se refresco en $msRef ms"
    OK ((Lista "fert_aplicaciones?select=id&id=eq.$($a1.id)").Count -eq 0 -and (Lista "fert_devoluciones?select=id&id=eq.$($d1.id)").Count -eq 0 -and (Lista "fert_movimientos?select=id&documento_id=in.($($a1.id),$($d1.id))").Count -eq 0) 'E4 base: sin fila ni movimientos de A1 ni D1'
    OK ((SaldoBase $mSol) -eq 100 -and (SumaMovs $mSol) -eq 100) 'E4 saldo SOL vuelve a 100 y fert_saldos = suma de movimientos' "saldo $(SaldoBase $mSol) suma $(SumaMovs $mSol)"
    $aud = Lista "fert_eliminaciones?select=id,tipo,motivo,snapshot_huella,movimientos_ids,documento_id&documento_id=eq.$($a1.id)"
    foreach ($x in $aud) { [void]$audIds.Add($x.id) }
    # ============ E8 auditoria en base ============
    OK ($aud.Count -eq 1 -and $aud[0].snapshot_huella -and @($aud[0].movimientos_ids).Count -ge 2) 'E8 auditoria en base: snapshot_huella y movimientos_ids existen' "huella=$($aud[0].snapshot_huella) movs=$(@($aud[0].movimientos_ids).Count)"

    # ============ E9 estado del telefono y exportacion ============
    $estCampo = Rest 'rpc/fn_fert_estado_campo' 'Post' @{} -Token $script:TokAdmin
    $estTxt = $estCampo | ConvertTo-Json -Depth 20 -Compress
    OK ($estTxt -notmatch $a1.id -and $estTxt -notmatch $d1.id -and $estTxt -notmatch 'fert_eliminaciones' -and $estTxt -notmatch 'snapshot_huella') 'E9 fn_fert_estado_campo no trae lo eliminado ni la auditoria'
    $exp = $null; try { $exp = Rest 'rpc/fn_fert_exportar' 'Post' @{ p_cursor = 0; p_limite = 5000 } -Token $script:TokAdmin } catch { $script:Resultados.Add("INFO E9 exportar: $($_.Exception.Message) $($_.ErrorDetails.Message)") }
    if ($exp) { $expTxt = $exp | ConvertTo-Json -Depth 30 -Compress; OK ($expTxt -notmatch $a1.id -and $expTxt -notmatch $d1.id -and $expTxt -notmatch 'snapshot_huella') 'E9 fn_fert_exportar (admin) no trae lo eliminado ni la tabla de auditoria' ; $script:Resultados.Add("INFO E9 claves exportar: $((($exp | Get-Member -MemberType NoteProperty).Name) -join ',')") }
    else { OK $false 'E9 fn_fert_exportar respondio' 'sin respuesta (ver INFO)' }

    # ============ E4b aplicacion anulada (con su anulacion) ============
    $a2 = Op 'aplicacion' @{ estacion_id = $estId; turno_ciclo_id = $tcId; fecha = $ayer; lineas = @(@{ material_id = $mAci; cantidad = 7 }) }
    $an = Op 'anulacion' @{ documento_tipo = 'aplicacion'; documento_id = $a2.id; motivo = 'error de captura QA' }
    OK ((Aceptado $a2) -and (Aceptado $an)) 'Datos A2 + anulacion' "$($a2.estado) | $($an.estado) $($an.mensaje)"
    $saldoAci = SaldoBase $mAci
    $t = AbrirEstacion 'b'; IrBitacora
    OK (AbrirDoc 'APLICACION') 'Abre la aplicacion anulada'
    $ok = EliminarDesdeDetalle 'La QA elimina la aplicacion anulada y su anulacion'
    Start-Sleep -Milliseconds 1500
    $nAn = JS "document.querySelectorAll('[data-movimiento=APLICACION],[data-movimiento=ANULACION]').length"
    OK ($ok -ge 0 -and [int]$nAn -eq 0 -and (Lista "fert_aplicaciones?select=id&id=eq.$($a2.id)").Count -eq 0 -and (Lista "fert_movimientos?select=id&documento_id=eq.$($a2.id)").Count -eq 0 -and (SaldoBase $mAci) -eq 50 -and (SumaMovs $mAci) -eq 50) 'E4b aplicacion anulada eliminada: sin filas/movimientos, saldo ACI = 50 y cuadra' "bit=$nAn saldo $(SaldoBase $mAci) (antes $saldoAci)"
    foreach ($x in (Lista "fert_eliminaciones?select=id&documento_id=eq.$($a2.id)")) { [void]$audIds.Add($x.id) }

    # ============ E5 recepcion, conteo, devolucion suelta ============
    $r2 = Op 'recepcion' @{ estacion_id = $estId; chofer_id = $choferId; lineas = @(@{ material_id = $mAci; cantidad = 20 }) }
    OK (Aceptado $r2) 'Datos recepcion R2 (ACI +20)' $r2.mensaje
    $t = AbrirEstacion 'c'; IrBitacora
    $filaRec = JS "document.querySelectorAll('[data-movimiento=RECEPCION]').length"
    # hay 2 recepciones (R inicial y R2); se abre cada una hasta dar con la de R2 por su documento: se elimina la primera visible y se mide el efecto neto
    OK (AbrirDoc 'RECEPCION') "Abre una recepcion (hay $filaRec)"
    $antesAci = SaldoBase $mAci; $antesSol = SaldoBase $mSol
    $ok = EliminarDesdeDetalle 'La QA elimina una recepcion de prueba'
    Start-Sleep -Milliseconds 1500
    $recs = Lista "fert_recepciones?select=id&estacion_id=eq.$estId"
    OK ($ok -ge 0 -and $recs.Count -eq 1 -and (SaldoBase $mAci) -eq (SumaMovs $mAci) -and (SaldoBase $mSol) -eq (SumaMovs $mSol) -and ((SaldoBase $mAci) -ne $antesAci -or (SaldoBase $mSol) -ne $antesSol)) 'E5 recepcion eliminada: desaparece, saldos cambian y cuadran con movimientos' "ACI $antesAci->$(SaldoBase $mAci) SOL $antesSol->$(SaldoBase $mSol) restan $($recs.Count)"
    foreach ($x in (Lista "fert_eliminaciones?select=id&estacion_id=eq.$estId")) { if (-not $audIds.Contains($x.id)) { [void]$audIds.Add($x.id) } }
    # reponer stock para lo siguiente
    $r3 = Op 'recepcion' @{ estacion_id = $estId; chofer_id = $choferId; lineas = @(@{ material_id = $mSol; cantidad = 100 }, @{ material_id = $mAci; cantidad = 50 }) }
    $sSol = SaldoBase $mSol
    # conteo con ajuste
    $ct = Op 'conteo' @{ estacion_id = $estId; lineas = @(@{ material_id = $mSol; cantidad_real = ($sSol - 3) }) }
    OK ((Aceptado $ct) -and (Lista "fert_movimientos?select=id&documento_id=eq.$($ct.id)&tipo=eq.AJUSTE_CONTEO").Count -ge 1 -and (SaldoBase $mSol) -eq ($sSol - 3)) 'Datos: conteo con ajuste -3' "$($ct.estado) $($ct.mensaje)"
    $t = AbrirEstacion 'd'; IrBitacora
    $abre = AbrirDoc 'CONTEO'; if (-not $abre) { $abre = AbrirDoc 'AJUSTE_CONTEO' }
    OK $abre 'Abre el detalle del conteo'
    $ok = EliminarDesdeDetalle 'La QA elimina un conteo con ajuste'
    Start-Sleep -Milliseconds 1500
    OK ($ok -ge 0 -and (Lista "fert_conteos?select=id&id=eq.$($ct.id)").Count -eq 0 -and (Lista "fert_movimientos?select=id&documento_id=eq.$($ct.id)").Count -eq 0 -and (SaldoBase $mSol) -eq $sSol -and (SaldoBase $mSol) -eq (SumaMovs $mSol)) 'E5 conteo con ajuste eliminado: el saldo vuelve y cuadra' "saldo $(SaldoBase $mSol) esperado $sSol"
    foreach ($x in (Lista "fert_eliminaciones?select=id&documento_id=eq.$($ct.id)")) { [void]$audIds.Add($x.id) }
    # devolucion suelta
    $a3 = Op 'aplicacion' @{ estacion_id = $estId; turno_ciclo_id = $tcId; fecha = $ayer; lineas = @(@{ material_id = $mSol; cantidad = 10 }) }
    $d2 = Op 'devolucion' @{ estacion_id = $estId; aplicacion_id = $a3.id; motivo = 'sobro'; lineas = @(@{ material_id = $mSol; cantidad = 4 }) }
    $sConDev = SaldoBase $mSol
    $t = AbrirEstacion 'e'; IrBitacora
    OK (AbrirDoc 'DEVOLUCION') 'Abre el detalle de la devolucion suelta'
    $ok = EliminarDesdeDetalle 'La QA elimina solo la devolucion'
    Start-Sleep -Milliseconds 1500
    OK ($ok -ge 0 -and (Lista "fert_devoluciones?select=id&id=eq.$($d2.id)").Count -eq 0 -and (Lista "fert_aplicaciones?select=id&id=eq.$($a3.id)").Count -eq 1 -and (SaldoBase $mSol) -eq ($sConDev - 4) -and (SaldoBase $mSol) -eq (SumaMovs $mSol)) 'E5 devolucion suelta eliminada: la aplicacion sigue, el saldo baja 4 y cuadra' "saldo $(SaldoBase $mSol) (antes $sConDev)"
    foreach ($x in (Lista "fert_eliminaciones?select=id&documento_id=eq.$($d2.id)")) { [void]$audIds.Add($x.id) }

    # ============ E10 reenvio: operacion en cola apuntando a un documento eliminado ============
    $t = AbrirEstacion 'f'; IrBitacora
    CDP 'Network.enable' | Out-Null
    CDP 'Network.setBlockedURLs' @{ urls = @('*supabase.co*') } | Out-Null
    OK (AbrirDoc 'APLICACION') 'E10 abre la aplicacion A3 sin senal'
    ClicHasta "document.querySelector('[data-modo-devolver]')" "!!document.querySelector('[data-motivo]')" | Out-Null
    Start-Sleep -Milliseconds 400
    Teclear "document.querySelector('[data-cantidad=""0""]')" '2'
    Teclear "document.querySelector('[data-motivo]')" 'Sobro (QA E10)'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    Esperar "!!document.querySelector('[data-pendientes-cuenta]')" 10000 | Out-Null; Start-Sleep 1
    $pend = JS "Number((document.querySelector('[data-pendientes-cuenta]')?.innerText.match(/\d+/) || [0])[0])"
    OK ([int]$pend -ge 1) 'E10 la devolucion queda en cola sin senal' "pend=$pend"
    # otro contexto elimina la aplicacion (RPC con el token del admin)
    try { $rr = Rest 'rpc/fn_fert_eliminar_documento' 'Post' @{ p_tipo = 'aplicacion'; p_documento = $a3.id; p_motivo = 'La QA elimina A3 desde otro contexto' } -Token $script:TokAdmin; OK ($rr.ok -eq $true) 'E10 A3 eliminada por RPC desde otro contexto' } catch { OK $false 'E10 eliminar A3 por RPC' "$($_.ErrorDetails.Message)" }
    foreach ($x in (Lista "fert_eliminaciones?select=id&documento_id=eq.$($a3.id)")) { [void]$audIds.Add($x.id) }
    CDP 'Network.setBlockedURLs' @{ urls = @() } | Out-Null
    ClicEn "document.querySelector('[data-actualizar]')" | Out-Null
    Esperar "!document.querySelector('[data-pendientes-cuenta]')" 40000 | Out-Null; Start-Sleep -Milliseconds 800
    ClicHasta "document.querySelector('[data-pestana=envios]')" "!!document.querySelector('[data-rechazados]')" | Out-Null
    $rech = JS "document.querySelector('[data-rechazados]')?.innerText"
    $script:Resultados.Add("INFO E10 texto de rechazados: $(($rech -replace "`n",' / '))")
    OK (-not [string]::IsNullOrWhiteSpace($rech) -and (Lista "fert_devoluciones?select=id&aplicacion_id=eq.$($a3.id)").Count -eq 0 -and (Lista "fert_aplicaciones?select=id&id=eq.$($a3.id)").Count -eq 0) 'E10 la devolucion en cola se rechaza (aparece en Rechazados) y no recrea nada' (($rech -replace "`n",' / ').Substring(0, [Math]::Min(220, "$rech".Length)))
    OK ((SaldoBase $mSol) -eq (SumaMovs $mSol)) 'E10 saldos cuadran tras el rechazo' "saldo $(SaldoBase $mSol)"

    # ============ E7 / E2 pantalla de Administracion ============
    # datos: bitacora (horas), relevo (entrega), traslado (crear), historica, y 2 conteos para borrado multiple
    Rest 'rpc/fn_fert_historico_otorgar' 'Post' @{ p_persona = $qaId; p_estaciones = @($estId); p_hasta = (Get-Date).AddDays(2).ToString('yyyy-MM-dd'); p_nota = 'QA eliminar' } -Token $script:TokAdmin | Out-Null
    $bt = Op 'bitacora' @{ estacion_id = $estId; turno_ciclo_id = $tcId; fecha = $ayer; horas_riego = 3 }
    $tr = Op 'traslado_crear' @{ origen_id = $estId; destino_id = $est2Id; motivo = 'QA traslado'; autorizador_id = $qaId; lineas = @(@{ material_id = $mSol; cantidad = 3 }) }
    $hi = Op 'aplicacion_historica' @{ estacion_id = $estId; turno_ciclo_id = $tcId; fecha = (Get-Date).AddDays(-30).ToString('yyyy-MM-dd'); lineas = @(@{ material_id = $mSol; cantidad = 2 }) }
    $c1 = Op 'conteo' @{ estacion_id = $estId; lineas = @(@{ material_id = $mAci; cantidad_real = (SaldoBase $mAci) }) }
    $c2 = Op 'conteo' @{ estacion_id = $estId; lineas = @(@{ material_id = $mAci; cantidad_real = (SaldoBase $mAci) }) }
    $rl = Op 'relevo_entregar' @{ estacion_id = $estId; nota = 'QA relevo' }
    foreach ($p in @(@('bitacora', $bt), @('relevo', $rl), @('traslado', $tr), @('historica', $hi), @('conteo 1', $c1), @('conteo 2', $c2))) { $script:Resultados.Add("INFO datos E7 $($p[0]): $($p[1].estado) $($p[1].mensaje)") }
    $saldoPreE7 = SaldoBase $mSol

    # volver al admin
    Entrar-Como $ua.email $ua.clave | Out-Null
    $entrada = $null
    Ir "/admin"; Esperar "document.readyState === 'complete'" 20000 | Out-Null; Start-Sleep -Seconds 3
    $linkAdm = JS "!![...document.querySelectorAll('a')].find(a => a.getAttribute('href') === '/admin/fertirriego-eliminar')"
    $script:Resultados.Add("INFO E2 enlace en /admin para el admin: $linkAdm (puede estar en el arbol de Administracion en otra ruta)")

    Ir "/admin/fertirriego-eliminar"
    $t = Esperar "!!document.querySelector('[data-eliminar-registros-admin]') && document.querySelectorAll('[data-registro-eliminar]').length > 0" 40000
    OK ($t -ge 0) 'E7 la pantalla abre y lista registros' "$t ms"
    $tipos = JS "JSON.stringify([...document.querySelectorAll('[data-registro-eliminar]')].map(x => x.dataset.registroEliminar))" | ConvertFrom-Json
    $script:Resultados.Add("INFO E7 tipos listados: $(($tipos | Group-Object | ForEach-Object { "$($_.Name)=$($_.Count)" }) -join ' ')")
    # filtro por estacion
    ElegirEnAdmin 'Todas las estaciones' $EST | Out-Null
    $n1 = JS "document.querySelectorAll('[data-registro-eliminar]').length"
    $soloMia = JS "[...document.querySelectorAll('[data-registro-eliminar]')].every(x => x.textContent.includes('$EST') && !x.textContent.includes('$EST2 ') )"
    OK ([int]$n1 -ge 5) 'E7 filtro por estacion: lista los registros de la estacion' "n=$n1"
    # filtro por tipo
    ElegirEnAdmin 'Todos los tipos' 'Conteo' | Out-Null
    $solo = JS "(() => { const l = [...document.querySelectorAll('[data-registro-eliminar]')]; return l.length + '|' + l.every(x => x.dataset.registroEliminar === 'conteo') })()"
    OK ($solo -match '^[2-9]\|true$') 'E7 filtro por tipo (Conteo): solo conteos' $solo
    # filtro por fecha: desde manana => ninguno
    PonerFecha '[data-desde-eliminar]' $hoy
    $conFecha = JS "document.querySelectorAll('[data-registro-eliminar]').length"
    PonerFecha '[data-desde-eliminar]' ''
    $sinFecha = JS "document.querySelectorAll('[data-registro-eliminar]').length"
    OK ([int]$sinFecha -ge [int]$conFecha) 'E7 filtro por fecha (Desde hoy) reduce o iguala la lista' "con=$conFecha sin=$sinFecha"
    # filtro quien
    ElegirEnAdmin 'Cualquiera' "QA Eliminar $s" | Out-Null
    $nq = JS "document.querySelectorAll('[data-registro-eliminar]').length"
    OK ([int]$nq -ge 2) 'E7 filtro «Quien lo registro»: trae los registros de ese usuario' "n=$nq"
    # seleccion multiple + un solo motivo (2 conteos)
    ClicEn "document.querySelectorAll('[data-marcar-registro]')[0]" | Out-Null
    ClicEn "document.querySelectorAll('[data-marcar-registro]')[1]" | Out-Null
    $t = Esperar "!!document.querySelector('[data-panel-eliminar]')" 5000
    OK ($t -ge 0) 'E7 al marcar 2+ registros aparece un solo panel de motivo'
    Teclear "document.querySelector('[data-motivo-eliminar-admin]')" 'corto'
    ClicEn "document.querySelector('[data-eliminar-marcados]')" | Out-Null
    OK ((Esperar "!!document.querySelector('[data-error-eliminar-admin]')" 4000) -ge 0) 'E7 motivo corto: avisa'
    Teclear "document.querySelector('[data-motivo-eliminar-admin]')" 'La QA elimina varios conteos a la vez'
    ClicEn "document.querySelector('[data-eliminar-marcados]')" | Out-Null
    OK ((Esperar "!!document.querySelector('[data-confirmar-eliminar-admin]')" 4000) -ge 0) 'E7 pide confirmar'
    $antesN = JS "document.querySelectorAll('[data-registro-eliminar]').length"
    ClicEn "document.querySelector('[data-confirmar-eliminar-admin]')" | Out-Null
    $t = Esperar "document.querySelectorAll('[data-registro-eliminar]').length === ($antesN - 2)" 30000
    OK ($t -ge 0 -and (Lista "fert_conteos?select=id&id=in.($($c1.id),$($c2.id))").Count -eq 0) 'E7 eliminacion multiple: 2 conteos fuera y la tabla se refresca' "antes=$antesN"
    # horas de riego, relevo, traslado, historica: uno por uno quitando filtros
    Ir "/admin/fertirriego-eliminar"; Esperar "document.querySelectorAll('[data-registro-eliminar]').length > 0" 40000 | Out-Null
    ElegirEnAdmin 'Todas las estaciones' $EST | Out-Null
    foreach ($par in @(@('Horas de riego', 'bitacora', $bt), @('Relevo', 'relevo', $rl), @('Traslado', 'traslado', $tr), @('Aplicaci', 'aplicacion', $hi))) {
        $tipoDom = $par[1]; $caso = $par[2]
        if (-not (Aceptado $caso)) { $script:Resultados.Add("NO VERIFICABLE E7 $tipoDom : el dato no se pudo crear por RPC ($($caso.estado) $($caso.mensaje))"); continue }
        $hay = Esperar "!![...document.querySelectorAll('[data-registro-eliminar=$tipoDom]')].find(x => $(if ($tipoDom -eq 'aplicacion') { "/Hist/i.test(x.textContent)" } else { 'true' }))" 8000
        if ($hay -lt 0) { OK $false "E7 $tipoDom aparece en la lista"; continue }
        JS "(() => { const li = [...document.querySelectorAll('[data-registro-eliminar=$tipoDom]')].find(x => $(if ($tipoDom -eq 'aplicacion') { "/Hist/i.test(x.textContent)" } else { 'true' })); li.querySelector('[data-marcar-registro]').click(); return true })()" | Out-Null
        Esperar "!!document.querySelector('[data-panel-eliminar]')" 5000 | Out-Null
        Teclear "document.querySelector('[data-motivo-eliminar-admin]')" "La QA elimina $tipoDom desde Administracion"
        ClicEn "document.querySelector('[data-eliminar-marcados]')" | Out-Null
        Esperar "!!document.querySelector('[data-confirmar-eliminar-admin]')" 4000 | Out-Null
        ClicEn "document.querySelector('[data-confirmar-eliminar-admin]')" | Out-Null
        $gone = Esperar "!document.querySelector('[data-panel-eliminar]')" 30000
        Start-Sleep -Milliseconds 1200
        $existe = switch ($tipoDom) {
            'bitacora' { (Lista "fert_bitacora_riego?select=turno_ciclo_id&operacion_id=eq.$($caso.id)").Count }
            'relevo' { (Lista "fert_relevos?select=id&id=eq.$($caso.id)").Count }
            'traslado' { (Lista "fert_traslados?select=id&id=eq.$($caso.id)").Count }
            default { (Lista "fert_aplicaciones?select=id&id=eq.$($caso.id)").Count }
        }
        $err = JS "document.querySelector('[data-error-eliminar-admin]')?.innerText"
        OK ($gone -ge 0 -and $existe -eq 0) "E7/E5 $tipoDom eliminado desde Administracion" "existe=$existe err=$err"
    }
    OK ((SaldoBase $mSol) -eq (SumaMovs $mSol) -and (SaldoBase $mAci) -eq (SumaMovs $mAci)) 'E7 saldos cuadran con movimientos tras todo' "SOL $(SaldoBase $mSol)/$(SumaMovs $mSol) ACI $(SaldoBase $mAci)/$(SumaMovs $mAci)"
    foreach ($x in (Lista "fert_eliminaciones?select=id&estacion_id=eq.$estId")) { if (-not $audIds.Contains($x.id)) { [void]$audIds.Add($x.id) } }
    foreach ($x in (Lista "fert_eliminaciones?select=id&estacion2_id=eq.$est2Id")) { if (-not $audIds.Contains($x.id)) { [void]$audIds.Add($x.id) } }

    # ============ E8 auditoria en pantalla ============
    Ir "/admin/fertirriego-eliminar"; Esperar "!!document.querySelector('[data-lista-auditoria] [data-auditoria]')" 40000 | Out-Null
    $audTxt = JS "document.querySelector('[data-lista-auditoria]')?.innerText"
    $propia = JS "[...document.querySelectorAll('[data-auditoria]')].map(x => x.innerText).find(t => /La QA elimina/.test(t)) || ''"
    OK ($propia -match 'QA Eliminar' -and $propia -match 'Motivo:' -and $propia -match '\d{1,2}\s+\w+\s+\d{4}') 'E8 la auditoria muestra fecha, quien, tipo, estacion, resumen y motivo' (($propia -replace "`n",' / ').Substring(0, [Math]::Min(240, $propia.Length)))
    $verOk = ClicEn "[...document.querySelectorAll('[data-auditoria] button')].find(b => /Ver copia/.test(b.innerText))"
    $t = Esperar "!!document.querySelector('[data-lista-auditoria] pre')" 15000
    $copia = JS "document.querySelector('[data-lista-auditoria] pre')?.innerText"
    OK ($t -ge 0 -and $copia.Length -gt 20) 'E8 «Ver copia» muestra el contenido mientras el snapshot siga en Supabase' "len=$($copia.Length)"
    Captura 'fert_eliminar_admin.png'

    # ============ E2 negativo: usuario sin permiso ============
    Entrar-Como $ua.email $ua.clave | Out-Null
    Rest 'rpc/fn_fert_asignar_custodia' 'Post' @{ p_estacion = $estId; p_perfil = $negId; p_motivo = 'QA E2 estacionero' } -Token $script:TokAdmin | Out-Null
    Start-Sleep -Seconds 2
    $tokNegR = (Invoke-RestMethod -Method Post "$URLB/auth/v1/token?grant_type=password" -Headers @{ apikey = $ANON } -ContentType 'application/json' -Body (@{ email = $un.email; password = $un.clave } | ConvertTo-Json)).access_token
    $a4 = Op 'aplicacion' @{ estacion_id = $estId; turno_ciclo_id = $tcId; fecha = $ayer; lineas = @(@{ material_id = $mSol; cantidad = 1 }) } $null $tokNegR
    $script:Resultados.Add("INFO E2 aplicacion del estacionero: $($a4.estado) $($a4.mensaje)")
    $tokNeg = Entrar-Como $un.email $un.clave
    Ir "/admin/fertirriego-eliminar"; Start-Sleep -Seconds 4; Esperar "document.readyState === 'complete'" 20000 | Out-Null; Start-Sleep -Milliseconds 800
    $ruta = JS "location.pathname"
    OK ($ruta -ne '/admin/fertirriego-eliminar' -and -not (JS "!!document.querySelector('[data-eliminar-registros-admin]')")) 'E2 usuario sin permiso: /admin/fertirriego-eliminar no deja entrar' "ruta=$ruta"
    Ir "/admin"; Start-Sleep -Seconds 4; Esperar "document.readyState === 'complete'" 20000 | Out-Null
    $linkNeg = JS "!![...document.querySelectorAll('a')].find(a => a.getAttribute('href') === '/admin/fertirriego-eliminar')"
    OK (-not $linkNeg) 'E2 usuario sin permiso: no hay entrada «Eliminar registros» en Administracion' "enlace=$linkNeg"
    Ir "/fertirriego?r=$s-neg"; Esperar "!!document.querySelector('[data-barra-estado]') && !!document.querySelector('[data-estacion]')" 60000 | Out-Null
    ElegirOpcion '[data-selector-estacion] button' $EST | Out-Null
    Esperar "document.querySelector('[data-estacion]')?.dataset.estacion === '$EST'" 15000 | Out-Null
    IrBitacora
    $abre = AbrirDoc 'APLICACION'
    if ($abre) { OK (-not (JS "!!document.querySelector('[data-modo-eliminar]')")) 'E2 usuario sin permiso: el detalle NO muestra «Eliminar por completo»' } else { $script:Resultados.Add("NO VERIFICABLE E2 detalle del estacionero: no se pudo abrir ninguna aplicacion ($($a4.estado) $($a4.mensaje))") }
    Entrar-Como $ua.email $ua.clave | Out-Null
    Rest 'rpc/fn_fert_asignar_custodia' 'Post' @{ p_estacion = $estId; p_perfil = $qaId; p_motivo = 'QA vuelve custodia' } -Token $script:TokAdmin | Out-Null
    Start-Sleep -Seconds 2

    # ============ E11 letra grande 24 px a 360 px ============
    Pantalla -Ancho 360 -Alto 780 -Movil
    JS "(() => { document.documentElement.style.fontSize = '24px'; return true })()" | Out-Null
    Start-Sleep -Milliseconds 800
    $sw = [int](JS "document.documentElement.scrollWidth"); $iw = [int](JS "window.innerWidth")
    OK ($sw -le $iw) 'E11 Administracion a 24 px / 360 px: sin desborde horizontal' "scrollWidth $sw / $iw"
    $botones = JS "JSON.stringify([...document.querySelectorAll('[data-eliminar-registros-admin] button')].filter(b => b.offsetParent !== null).map(b => Math.round(b.getBoundingClientRect().height)))" | ConvertFrom-Json
    $chicos = @($botones | Where-Object { $_ -lt 44 })
    OK ($chicos.Count -eq 0) 'E11 Administracion 24 px: botones >= 44 px' "min=$((@($botones) | Measure-Object -Minimum).Minimum)"
    $cortado = JS "[...document.querySelectorAll('[data-eliminar-registros-admin] p, [data-eliminar-registros-admin] li')].filter(e => e.scrollWidth > e.clientWidth + 1).length"
    OK ([int]$cortado -eq 0) 'E11 Administracion 24 px: textos no se cortan' "cortados=$cortado"
    Captura 'fert_eliminar_admin_grande.png'
    # modal en la app de campo
    $a5 = Op 'aplicacion' @{ estacion_id = $estId; turno_ciclo_id = $tcId; fecha = $ayer; lineas = @(@{ material_id = $mSol; cantidad = 1 }) }
    Ir "/fertirriego?r=$s-g"; Esperar "!!document.querySelector('[data-estacion]')" 60000 | Out-Null
    JS "(() => { document.documentElement.style.fontSize = '24px'; return true })()" | Out-Null
    ElegirOpcion '[data-selector-estacion] button' $EST | Out-Null
    Esperar "document.querySelector('[data-estacion]')?.dataset.estacion === '$EST'" 15000 | Out-Null
    IrBitacora
    $abre = AbrirDoc 'APLICACION'
    ClicHasta "document.querySelector('[data-modo-eliminar]')" "!!document.querySelector('[data-motivo-eliminar]')" | Out-Null
    Start-Sleep -Milliseconds 600
    $m = JS "(() => { const d = document.querySelector('[role=dialog]'); if (!d) return null; const r = d.getBoundingClientRect(); const bs = [...d.querySelectorAll('button')].filter(b => b.offsetParent !== null).map(b => Math.round(b.getBoundingClientRect().height)); return JSON.stringify({ l: Math.round(r.left), r: Math.round(r.right), sw: document.documentElement.scrollWidth, iw: innerWidth, bs }) })()"
    if ($m) { $mj = $m | ConvertFrom-Json; OK ($mj.l -ge 0 -and $mj.r -le $mj.iw + 1 -and $mj.sw -le $mj.iw -and (@($mj.bs | Where-Object { $_ -lt 44 }).Count -eq 0)) 'E11 modal a 24 px / 360 px: dentro de pantalla, sin desborde, botones >= 44 px' $m } else { OK $false 'E11 modal a 24 px: abre' }
    Captura 'fert_eliminar_modal_grande.png'
    ClicEn "document.querySelector('[data-cancelar-eliminar]')" | Out-Null
    JS "(() => { document.documentElement.style.removeProperty('font-size'); return true })()" | Out-Null
    Pantalla -Ancho 412 -Alto 915 -Movil

    # ============ E11 regresion: Anular y Devolver sobrante ============
    $t = AbrirEstacion 'h'; IrBitacora
    OK (AbrirDoc 'APLICACION') 'Regresion: abre detalle de aplicacion'
    $tieneAnular = JS "!![...document.querySelectorAll('[data-detalle-documento] button, [role=dialog] button')].find(b => /Anular/.test(b.innerText))"
    $tieneDev = JS "!!document.querySelector('[data-modo-devolver]')"
    OK ($tieneDev) 'Regresion: «Devolver sobrante» sigue disponible'
    ClicHasta "document.querySelector('[data-modo-devolver]')" "!!document.querySelector('[data-motivo]')" | Out-Null
    Start-Sleep -Milliseconds 400
    Teclear "document.querySelector('[data-cantidad=""0""]')" '1'
    Teclear "document.querySelector('[data-motivo]')" 'Regresion QA devolver'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    Esperar "!document.querySelector('[data-detalle-documento]')" 15000 | Out-Null; Start-Sleep -Milliseconds 2500
    OK ((Lista "fert_devoluciones?select=id&aplicacion_id=eq.$($a5.id)").Count -eq 1) 'Regresion: Devolver sobrante guarda'
    IrBitacora
    OK (AbrirDoc 'APLICACION') 'Regresion: reabre aplicacion'
    $btnAnular = ClicEn "[...document.querySelectorAll('[role=dialog] button')].find(b => /^Anular/.test(b.innerText.trim()))"
    $script:Resultados.Add("INFO regresion: boton Anular presente=$btnAnular")
    if ($btnAnular) {
        Start-Sleep -Milliseconds 500
        Teclear "document.querySelector('[data-motivo]')" 'Regresion QA anular la aplicacion'
        ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
        Start-Sleep -Milliseconds 3500
        $anulada = (Lista "fert_aplicaciones?select=anulado_at&id=eq.$($a5.id)")
        $script:Resultados.Add("INFO regresion anular: $($anulada | ConvertTo-Json -Compress)")
        OK ((Lista "fert_movimientos?select=id&documento_id=eq.$($a5.id)&tipo=eq.ANULACION").Count -ge 0) 'Regresion: Anular se ejecuta sin error de pagina' (Errores-Pagina)
    }
    OK ((Errores-Pagina) -eq '' -or $null -eq (Errores-Pagina)) 'Sin errores de pagina al final' (Errores-Pagina)
}
catch { $cuerpoErr = ""; try { $cuerpoErr = (New-Object IO.StreamReader $_.Exception.Response.GetResponseStream()).ReadToEnd() } catch {}; $script:Resultados.Add("EXCEPCION $($_.Exception.Message) $cuerpoErr STACK $($_.ScriptStackTrace -replace "`n",' <- ') @ $($_.InvocationInfo.ScriptLineNumber): $($_.InvocationInfo.Line.Trim())") }
finally {
    try { CDP 'Network.setBlockedURLs' @{ urls = @() } | Out-Null } catch {}
    # ---- Limpieza (todo por id exacto o por estacion/usuario creados aqui) ----
    try {
        foreach ($id in $audIds) { Rest "fert_eliminaciones?id=eq.$id" 'Delete' -Servicio | Out-Null }
        if ($estId) {
            # El caso de aplicacion historica crea un permiso temporal (sql/116): hay que borrarlo antes que la estacion y las personas
            foreach ($e in $estId, $est2Id) { Rest "fert_historico_permisos?estacion_id=eq.$e" 'Delete' -Servicio | Out-Null }
            foreach ($p in $qaId, $negId) { Rest "fert_historico_permisos?persona_id=eq.$p" 'Delete' -Servicio | Out-Null }
            foreach ($e in $estId, $est2Id) {
                foreach ($x in (Lista "fert_eliminaciones?select=id&estacion_id=eq.$e")) { Rest "fert_eliminaciones?id=eq.$($x.id)" 'Delete' -Servicio | Out-Null }
            }
            foreach ($e in $estId, $est2Id) {
                foreach ($t in 'fert_movimientos', 'fert_saldos', 'fert_bitacora_riego', 'fert_custodia') { Rest "${t}?estacion_id=eq.$e" 'Delete' -Servicio | Out-Null }
                foreach ($x in (Lista "fert_relevos?select=id&estacion_id=eq.$e")) { Rest "fert_relevos_diferencias?relevo_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null }
                Rest "fert_relevos?estacion_id=eq.$e" 'Delete' -Servicio | Out-Null
                foreach ($x in (Lista "fert_devoluciones?select=id&estacion_id=eq.$e")) { Rest "fert_devoluciones_detalle?devolucion_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null }
                Rest "fert_devoluciones?estacion_id=eq.$e" 'Delete' -Servicio | Out-Null
                foreach ($x in (Lista "fert_aplicaciones?select=id&estacion_id=eq.$e")) { Rest "fert_aplicaciones_detalle?aplicacion_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null }
                Rest "fert_aplicaciones?estacion_id=eq.$e" 'Delete' -Servicio | Out-Null
                foreach ($x in (Lista "fert_recepciones?select=id&estacion_id=eq.$e")) { Rest "fert_recepciones_detalle?recepcion_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null }
                Rest "fert_recepciones?estacion_id=eq.$e" 'Delete' -Servicio | Out-Null
                foreach ($x in (Lista "fert_conteos?select=id&estacion_id=eq.$e")) { Rest "fert_conteos_detalle?conteo_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null }
                Rest "fert_conteos?estacion_id=eq.$e" 'Delete' -Servicio | Out-Null
            }
            foreach ($x in (Lista "fert_traslados?select=id&origen_id=eq.$estId")) { Rest "fert_traslados_detalle?traslado_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null; Rest "fert_traslados?id=eq.$($x.id)" 'Delete' -Servicio | Out-Null }
            foreach ($p in $qaId, $negId) { Rest "fert_operaciones?perfil_id=eq.$p" 'Delete' -Servicio | Out-Null }
            foreach ($x in (Lista "turnos_ciclo?select=id,turno_id&agl_id=eq.TR-QE-$s")) { Rest "fert_plan?turno_ciclo_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null; Rest "turnos_ciclo?id=eq.$($x.id)" 'Delete' -Servicio | Out-Null; Rest "turnos?id=eq.$($x.turno_id)" 'Delete' -Servicio | Out-Null }
            Rest "perfiles_estaciones?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            Rest "perfiles_estaciones?estacion_id=eq.$est2Id" 'Delete' -Servicio | Out-Null
            Rest "estaciones_riego?id=eq.$estId" 'Delete' -Servicio | Out-Null
            Rest "estaciones_riego?id=eq.$est2Id" 'Delete' -Servicio | Out-Null
        }
        Rest "fert_choferes_vehiculos?chofer_id=eq.$choferId" 'Delete' -Servicio | Out-Null
        Rest "fert_choferes?id=eq.$choferId" 'Delete' -Servicio | Out-Null
        foreach ($c in $SOL, $ACI) { Rest "materiales?codigo=eq.$c" 'Delete' -Servicio | Out-Null }
        Rest "fert_publicaciones?temporada=eq.$([uri]::EscapeDataString("QA $s"))" 'Delete' -Servicio | Out-Null
    } catch { $script:Resultados.Add("LIMPIEZA datos: $($_.Exception.Message) $($_.ErrorDetails.Message)") }
    foreach ($u in $qaId, $negId) {
        try {
            if ($u) {
                foreach ($t in 'perfiles_zonas', 'perfiles_estaciones', 'fert_llaves') { Rest "${t}?perfil_id=eq.$u" 'Delete' -Servicio | Out-Null }
                try { Rest "perfiles_roles?perfil_id=eq.$u" 'Delete' -Servicio | Out-Null } catch {}
                Rest "perfiles?id=eq.$u" 'Delete' -Servicio | Out-Null
                Invoke-RestMethod -Method Delete -Uri "$URLB/auth/v1/admin/users/$u" -Headers $hServ | Out-Null
            }
        } catch { $script:Resultados.Add("LIMPIEZA usuario $u : $($_.Exception.Message) $($_.ErrorDetails.Message)") }
    }
    Remove-Item $archivoQa -ErrorAction SilentlyContinue
    try {
        $quedaUsr = 0; foreach ($u in $qaId, $negId) { try { Invoke-RestMethod "$URLB/auth/v1/admin/users/$u" -Headers $hServ | Out-Null; $quedaUsr++ } catch {} }
        $restos = (Lista "perfiles?select=id&id=in.($qaId,$negId)").Count + (Lista "estaciones_riego?select=id&nombre=like.PRUEBA*QA%20Elim*$s").Count + (Lista "materiales?select=id&codigo=in.($SOL,$ACI)").Count
        $audRestos = 0; foreach ($e in $estId, $est2Id) { if ($e) { $audRestos += (Lista "fert_eliminaciones?select=id&estacion_id=eq.$e").Count } }
        OK ($quedaUsr -eq 0 -and $restos -eq 0 -and $audRestos -eq 0) 'Limpieza: usuarios QA, estaciones, productos y auditoria propia borrados' "usuarios $quedaUsr, restos $restos, auditoria $audRestos"
    } catch { $script:Resultados.Add("LIMPIEZA verificacion: $($_.Exception.Message)") }
    Terminar-QA
}
