# QA · Fertirriego Etapa C (relevo con código sin internet y traslados). Copia en :3100 + base de DESARROLLO con sql/96.
# Dos personas en el mismo navegador (se cambia la sesión, como si fueran dos teléfonos):
#   A = usuario QA (estacionero que entrega)   B = persona de prueba creada aquí y borrada al final
# Todo ocurre en DOS ESTACIONES DE PRUEBA propias; al final se borra lo creado y A queda como estaba.
# El código de relevo se LEE de la pantalla de A (nunca se tocan las llaves).
param([string]$CarpetaServidor = 'C:\Users\Hhernandez\AppData\Local\Temp\claude\8cd082265f21e390\d424e4b3-aa92-4945-a284-5a2cd4214bdd\scratchpad\qa_prod')
. "$PSScriptRoot\comun.ps1"
Iniciar-QA -Base http://localhost:3100 -Ancho 412 -Alto 915 -Movil

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
function SinPendientes([int]$ms = 30000) { Esperar "!document.querySelector('[data-pendientes-cuenta]')" $ms }
function Pendientes { [int](JS "Number((document.querySelector('[data-pendientes-cuenta]')?.innerText.match(/\d+/) || [0])[0])") }
function Abrir($estacion, $sufijo) {
    Ir "/fertirriego?r=$s-$sufijo"
    $t = Esperar "!!document.querySelector('[data-barra-estado]') && (!!document.querySelector('[data-estacion]') || !!document.querySelector('[data-selector-estacion]'))" 40000
    if ((JS "document.querySelector('[data-estacion]')?.dataset.estacion") -ne $estacion -and (JS "!!document.querySelector('[data-selector-estacion]')")) {
        ElegirOpcion '[data-selector-estacion] button' $estacion | Out-Null
    }
    $t2 = Esperar "document.querySelector('[data-estacion]')?.dataset.estacion === '$estacion'" 15000
    return [Math]::Max($t, $t2)
}
function SaldoBase($est, $mat) { $x = Lista "fert_saldos?select=disponible,en_transito&estacion_id=eq.$est&material_id=eq.$mat"; if ($x.Count) { return $x[0] } else { return @{ disponible = 0; en_transito = 0 } } }

$s = Get-Random -Maximum 99999
$qaId = $script:QA.id
$orig = (Lista "perfiles?select=rol_id,todas_las_zonas&id=eq.$qaId")[0]
$origRoles = @(foreach ($x in (Lista 'rpc/fn_roles_de_perfiles' 'Post' @{})) { if ($x.perfil_id -eq $qaId) { [int]$x.rol_id } })
$idAdmin = (Lista 'roles?select=id&acceso_total=eq.true&limit=1')[0].id
$z1 = (Lista 'zonas?select=id,nombre&activo=eq.true&order=nombre&limit=1')[0]
$NOMBRE_EST1 = "QA Relevo $s"; $NOMBRE_EST2 = "QA Destino $s"; $TURNO = "TQC-$s"; $SOL = "QA-SOLC-$s"
$rolEst = $null; $bId = $null; $est1 = $null; $est2 = $null
$bEmail = "qa.$([guid]::NewGuid().ToString('N').Substring(0,10))@desarrollo.local"; $bClave = "Qa-$(Get-Random)-x$(Get-Random)"
$bNombre = "QA Compañero $s"

try {
    # ============ Preparación ============
    $u = Invoke-RestMethod -Method Post -Uri "$script:Url/auth/v1/admin/users" -Headers @{ apikey = $script:Serv; Authorization = "Bearer $script:Serv" } -ContentType 'application/json' -Body (@{ email = $bEmail; password = $bClave; email_confirm = $true } | ConvertTo-Json)
    $bId = $u.id
    $rolEst = (Rest 'roles' 'Post' @{ codigo = "QA_ESTC_$s"; nombre = "QA Estacionero C $s" } -Servicio)[0].id
    foreach ($a in 'ver', 'recibir', 'aplicar', 'contar', 'relevo', 'trasladar', 'autorizar_traslado') { Rest 'permisos' 'Post' @{ rol_id = $rolEst; recurso = 'fertirriego'; accion = $a; alcance = 'propietario' } -Servicio | Out-Null }
    Rest 'perfiles' 'Post' @{ id = $bId; nombre = $bNombre; rol_id = $rolEst; todas_las_zonas = $false } -Servicio | Out-Null
    Rest 'perfiles_zonas' 'Post' @{ perfil_id = $bId; zona_id = $z1.id } -Servicio | Out-Null
    Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($orig.rol_id, $idAdmin); p_principal = $orig.rol_id } -Servicio | Out-Null
    $est1 = (Rest 'estaciones_riego' 'Post' @{ nombre = $NOMBRE_EST1; zona_id = $z1.id } -Servicio)[0].id
    $est2 = (Rest 'estaciones_riego' 'Post' @{ nombre = $NOMBRE_EST2; zona_id = $z1.id } -Servicio)[0].id
    $pub = Rest 'rpc/fn_fert_publicar' 'Post' @{ p = @{
        temporada = "QA $s"
        estaciones = @(@{ nombre = $NOMBRE_EST1; zona = $z1.nombre }, @{ nombre = $NOMBRE_EST2; zona = $z1.nombre })
        materiales = @(@{ codigo = $SOL; descripcion = "SOLUCION C $s"; unidad = 'L'; grupo = '1800' })
        turnos = @(@{ agl_id = "TR-QC-$s"; turno = $TURNO; temporada = "QA $s"; ciclo = 'Ciclo QA'; fecha_siembra = (Get-Date).AddDays(-5).ToString('yyyy-MM-dd'); estacion = $NOMBRE_EST1; zona = $z1.nombre; area_mz = 10; estado = 'Creado' })
        plan = @()
    } }
    $solId = (Lista "materiales?select=id&codigo=eq.$SOL")[0].id
    foreach ($par in @(@($qaId, $est1), @($bId, $est1), @($bId, $est2))) { Rest 'rpc/fn_fert_asignar_persona' 'Post' @{ p_estacion = $par[1]; p_perfil = $par[0]; p_asignar = $true } | Out-Null }
    Rest 'rpc/fn_fert_asignar_custodia' 'Post' @{ p_estacion = $est1; p_perfil = $qaId; p_motivo = 'Arranque QA' } | Out-Null
    Rest 'rpc/fn_fert_asignar_custodia' 'Post' @{ p_estacion = $est2; p_perfil = $bId; p_motivo = 'Arranque QA' } | Out-Null
    Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($rolEst); p_principal = $rolEst } -Servicio | Out-Null
    OK ($pub.turnos -eq 1 -and $solId) 'Preparación: dos estaciones, un turno y un producto de prueba; A tiene la 1, B la 2'
    CDP 'Browser.grantPermissions' @{ permissions = @('geolocation'); origin = 'http://localhost:3100' } | Out-Null
    CDP 'Emulation.setGeolocationOverride' @{ latitude = 13.312; longitude = -87.195; accuracy = 12 } | Out-Null

    # ============ B abre la app una vez CON señal (baja las llaves de sus compañeros) ============
    $tokB = Entrar-Como $bEmail $bClave
    $t = Abrir $NOMBRE_EST1 'b0'
    OK ($t -ge 0) 'B abre Fertirriego con señal (baja las llaves de la estación)' "$t ms"
    Start-Sleep 2

    # ============ A: saldo inicial y ENTREGA ============
    $tokA = Entrar-Como $script:QA.email $script:QA.clave
    $t = Abrir $NOMBRE_EST1 'a1'
    OK ($t -ge 0 -and (JS "/a tu cargo/.test(document.querySelector('[data-custodia]')?.innerText || '')")) 'A abre su estación (a su cargo)'
    ClicHasta "document.querySelector('[data-accion=contar]')" "!!document.querySelector('[data-conteo]')" | Out-Null
    # Producto nuevo (sin saldo ni plan): se agrega con «Contar otro producto», como en campo
    $FILA_SOL = "document.querySelector('[data-conteo-material=""$SOL""]')"
    if (-not (JS "!!$FILA_SOL")) {
        ClicHasta "[...$ULTIMO_DIALOGO.querySelectorAll('button')].find(b => /Agregar producto/.test(b.innerText))" "document.querySelectorAll('[role=dialog]').length > 1 && !!$ULTIMO_DIALOGO.querySelector('input[inputmode=search]')" | Out-Null
        ClicEn "[...$ULTIMO_DIALOGO.querySelectorAll('button')].find(b => b.innerText.includes('$SOL'))" | Out-Null
        Esperar "!!$FILA_SOL" 4000 | Out-Null
    }
    Teclear "document.querySelector('[data-conteo-material=""$SOL""] input')" '500'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    SinPendientes | Out-Null
    OK ([double](SaldoBase $est1 $solId).disponible -eq 500) 'A cuenta 500 L en la bodega'

    ClicHasta "document.querySelector('[data-entregar-estacion]')" "!!document.querySelector('[data-novedades]')" | Out-Null
    # Sin novedades no deja entregar
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    $sinNov = Esperar "/Escribe las novedades|estado de cada turno/.test(${ULTIMO_DIALOGO}?.innerText || '')" 15000
    OK ($sinNov -ge 0) 'Entregar sin novedades: pide la bitácora'
    ClicEn "document.querySelector('[data-novedad-turno=""$TURNO""] [data-estado-novedad=EN_APLICACION]')" | Out-Null
    Teclear "document.querySelector('[data-novedad-turno=""$TURNO""] input')" 'Va por la mitad del tanque'
    Teclear "document.querySelector('[data-nota-relevo]')" 'Bomba 2 con fuga leve (QA)'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    $t = Esperar "/^\d{6}$/.test(document.querySelector('[data-codigo-relevo]')?.dataset.codigoRelevo || '')" 15000
    OK ($t -ge 0) 'Al entregar aparece el código de 6 dígitos'
    Captura 'fert_codigo_relevo.png'
    SinPendientes | Out-Null
    $rel = Lista "fert_relevos?select=id,estado,novedades&estacion_id=eq.$est1&estado=eq.EN_ENTREGA"
    $cus = (Lista "fert_custodia?select=estado,custodio_id&estacion_id=eq.$est1")[0]
    OK ($rel.Count -eq 1 -and $cus.estado -eq 'EN_ENTREGA' -and $cus.custodio_id -eq $qaId) 'La base: entrega registrada y A bloqueado (EN_ENTREGA)'
    ClicEn "[...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Listo')" | Out-Null
    Start-Sleep 1
    $bloq = JS "document.querySelector('[data-accion=aplicar]')?.disabled"
    OK ($bloq -eq $true) 'A ya no puede aplicar en la estación entregada'

    # ============ B recibe SIN SEÑAL con el código que le muestra A ============
    ClicHasta "document.querySelector('[data-ver-codigo]')" "!!document.querySelector('[data-codigo-relevo]')" | Out-Null
    Esperar "/^\d{6}$/.test(document.querySelector('[data-codigo-relevo]')?.dataset.codigoRelevo || '')" 10000 | Out-Null
    # Espera a que queden al menos 12 s del código (para escribirlo a tiempo, como en campo)
    Esperar "(() => { const r = 30 - Math.floor(Date.now() / 1000) % 30; return r > 12 })()" 20000 | Out-Null
    $codigo = JS "document.querySelector('[data-codigo-relevo]').dataset.codigoRelevo"
    $tokB = Entrar-Como $bEmail $bClave
    $t = Abrir $NOMBRE_EST1 'b1'
    CDP 'Network.enable' | Out-Null
    CDP 'Network.setBlockedURLs' @{ urls = @('*supabase.co*') } | Out-Null
    ClicHasta "document.querySelector('[data-recibir-estacion]')" "!!document.querySelector('[data-codigo-recibir]')" | Out-Null
    $malo = if ($codigo -eq '123456') { '654321' } else { '123456' }
    Teclear "document.querySelector('[data-codigo-recibir]')" $malo
    $t = Esperar "!!document.querySelector('[data-codigo-error]')" 5000
    OK ($t -ge 0 -and -not (JS "!!document.querySelector('[data-codigo-ok]')")) 'Sin señal: un código equivocado NO pasa' (JS "document.querySelector('[data-codigo-error]')?.innerText")
    Teclear "document.querySelector('[data-codigo-recibir]')" $codigo
    $t = Esperar "!!document.querySelector('[data-codigo-ok]')" 5000
    OK ($t -ge 0) 'Sin señal: el código correcto se verifica en el teléfono de B' (JS "document.querySelector('[data-codigo-ok]')?.innerText")
    OK ((JS "/Va por la mitad/.test(document.querySelector('[data-novedades-recibidas]')?.innerText || '')") -eq $true) 'B ve las novedades que dejó A (bajadas antes de perder la señal)'
    ClicEn "document.querySelector('[data-cuadre-material=""$SOL""] [data-hay-diferencia]')" | Out-Null
    Start-Sleep -Milliseconds 300
    Teclear "document.querySelector('[data-cuadre-material=""$SOL""] input')" '490'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    Esperar "!document.querySelector('[data-codigo-recibir]')" 15000 | Out-Null
    Start-Sleep 1
    OK ((Pendientes) -ge 1) 'Sin señal: la recepción queda guardada en el teléfono'
    CDP 'Network.setBlockedURLs' @{ urls = @() } | Out-Null
    ClicEn "document.querySelector('[data-actualizar]')" | Out-Null
    $t = SinPendientes 40000
    $rel = Lista "fert_relevos?select=estado,recibe_id,codigo_verificado,revisar&estacion_id=eq.$est1&estado=eq.RECIBIDO"
    $cus = (Lista "fert_custodia?select=estado,custodio_id&estacion_id=eq.$est1")[0]
    OK ($t -ge 0 -and $rel.Count -eq 1 -and $rel[0].recibe_id -eq $bId -and $rel[0].codigo_verificado -eq $true) 'Con señal: la base vuelve a verificar el código y registra el relevo'
    OK ($cus.custodio_id -eq $bId -and $cus.estado -eq 'ACTIVA') 'La estación queda a cargo de B'
    OK ($rel.Count -eq 1 -and $rel[0].revisar -eq $true -and [double](SaldoBase $est1 $solId).disponible -eq 490) 'Diferencia de 10 L: ajusta la bodega a 490 y marca el relevo para revisar'
    $t = Esperar "/a tu cargo/.test(document.querySelector('[data-custodia]')?.innerText || '')" 20000
    OK ($t -ge 0) 'En el teléfono de B: «La estación está a tu cargo»'

    # ============ TRASLADO: B pide, A autoriza, B recibe en la otra estación ============
    ClicHasta "document.querySelector('[data-pestana=traslados]')" "!!document.querySelector('[data-nuevo-traslado]')" | Out-Null
    ClicHasta "document.querySelector('[data-nuevo-traslado]')" "!!document.querySelector('[data-selector-destino]')" | Out-Null
    ElegirOpcion '[data-selector-destino] button' $NOMBRE_EST2 | Out-Null
    $nombreA = (Lista "perfiles?select=nombre&id=eq.$qaId")[0].nombre
    if (-not (JS "/$([regex]::Escape($nombreA))/.test(document.querySelector('[data-selector-autorizador]')?.innerText || '')")) { ElegirOpcion '[data-selector-autorizador] button' $nombreA | Out-Null }
    Teclear "document.querySelector('[data-motivo-traslado]')" 'A Destino se le acabó la solución (QA)'
    ElegirOpcion '[data-linea="0"] button' "SOLUCION C $s" | Out-Null
    Teclear "document.querySelector('[data-cantidad=""0""]')" '100'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    SinPendientes | Out-Null
    $tr = Lista "fert_traslados?select=id,estado,autorizador_id&origen_id=eq.$est1"
    OK ($tr.Count -eq 1 -and $tr[0].estado -eq 'POR_AUTORIZAR' -and $tr[0].autorizador_id -eq $qaId) 'B crea el traslado: queda «por autorizar» a nombre de A'
    OK ([double](SaldoBase $est1 $solId).disponible -eq 490) 'Sin autorizar, la bodega no se mueve'

    $tokA = Entrar-Como $script:QA.email $script:QA.clave
    Abrir $NOMBRE_EST1 'a2' | Out-Null
    ClicHasta "document.querySelector('[data-pestana=traslados]')" "!!document.querySelector('[data-por-autorizar], [data-accion-traslado=autorizar]')" | Out-Null
    ClicHasta "document.querySelector('[data-accion-traslado=autorizar]')" "!!document.querySelector('[data-detalle-traslado]')" | Out-Null
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    SinPendientes | Out-Null
    $tr = (Lista "fert_traslados?select=estado&origen_id=eq.$est1")[0]
    $s1 = SaldoBase $est1 $solId; $s2 = SaldoBase $est2 $solId
    OK ($tr.estado -eq 'EN_TRANSITO' -and [double]$s1.disponible -eq 390 -and [double]$s2.en_transito -eq 100) 'A autoriza (sin tener la estación): sale de la 1 y queda «en camino» a la 2'

    $tokB = Entrar-Como $bEmail $bClave
    Abrir $NOMBRE_EST2 'b2' | Out-Null
    ClicHasta "document.querySelector('[data-pestana=traslados]')" "!!document.querySelector('[data-llegando]')" | Out-Null
    ClicHasta "document.querySelector('[data-llegando] [data-accion-traslado=aceptar]')" "!!document.querySelector('[data-recibido=""0""]')" | Out-Null
    Teclear "document.querySelector('[data-recibido=""0""]')" '95'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    SinPendientes | Out-Null
    $tr = (Lista "fert_traslados?select=estado&origen_id=eq.$est1")[0]
    $s2 = SaldoBase $est2 $solId
    OK ($tr.estado -eq 'ACEPTADO' -and [double]$s2.disponible -eq 95 -and [double]$s2.en_transito -eq 0) 'B recibe 95 de 100: la estación 2 queda con 95 y nada en camino'
    $obs = Lista "fert_operaciones?select=observaciones&perfil_id=eq.$bId&tipo=eq.traslado_aceptar"
    OK ($obs.Count -eq 1 -and ($obs[0].observaciones -contains 'DIFERENCIA_TRASLADO')) 'Llegó menos: queda marcado para revisar'
    Captura 'fert_traslado_recibido.png'

    # ============ TRASLADO RECHAZADO: vuelve a la estación de origen ============
    Abrir $NOMBRE_EST1 'b3' | Out-Null
    ClicHasta "document.querySelector('[data-pestana=traslados]')" "!!document.querySelector('[data-nuevo-traslado]')" | Out-Null
    ClicHasta "document.querySelector('[data-nuevo-traslado]')" "!!document.querySelector('[data-selector-destino]')" | Out-Null
    ElegirOpcion '[data-selector-destino] button' $NOMBRE_EST2 | Out-Null
    if (-not (JS "/$([regex]::Escape($nombreA))/.test(document.querySelector('[data-selector-autorizador]')?.innerText || '')")) { ElegirOpcion '[data-selector-autorizador] button' $nombreA | Out-Null }
    Teclear "document.querySelector('[data-motivo-traslado]')" 'Segundo traslado (QA)'
    ElegirOpcion '[data-linea="0"] button' "SOLUCION C $s" | Out-Null
    Teclear "document.querySelector('[data-cantidad=""0""]')" '50'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    SinPendientes | Out-Null
    $t2id = (Lista "fert_traslados?select=id&origen_id=eq.$est1&estado=eq.POR_AUTORIZAR")[0].id
    # A autoriza desde su teléfono (por la base, igual que el teléfono)
    $op = @{ id = [guid]::NewGuid().ToString(); tipo = 'traslado_autorizar'; creado_en = (Get-Date).ToString('o'); dispositivo = 'QA'; datos = @{ traslado_id = $t2id; aprobar = $true; nota = 'ok' } }
    $r = Rest 'rpc/fn_fert_sincronizar' 'Post' @{ p_ops = @($op) } -Token $tokA
    Abrir $NOMBRE_EST2 'b4' | Out-Null
    ClicHasta "document.querySelector('[data-pestana=traslados]')" "!!document.querySelector('[data-llegando]')" | Out-Null
    ClicHasta "document.querySelector('[data-llegando] [data-accion-traslado=rechazar]')" "!!document.querySelector('[data-nota-traslado]')" | Out-Null
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    $sinMotivo = Esperar "/Escribe el motivo/.test(${ULTIMO_DIALOGO}?.innerText || '') && !!document.querySelector('[data-nota-traslado]')" 15000
    OK ($sinMotivo -ge 0) 'Rechazar sin motivo: lo pide'
    Teclear "document.querySelector('[data-nota-traslado]')" 'No lo pedimos (QA)'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    SinPendientes | Out-Null
    $tr2 = (Lista "fert_traslados?select=estado&id=eq.$t2id")[0]
    OK ($tr2.estado -eq 'RECHAZADO' -and [double](SaldoBase $est1 $solId).disponible -eq 390 -and [double](SaldoBase $est2 $solId).en_transito -eq 0) 'Rechazado: los 50 vuelven a la estación 1 (390)'

    # ============ AGL baja todo (exportación) ============
    $ok = $true; try { Rest 'rpc/fn_fert_exportar' 'Post' @{ p_cursor = 0; p_limite = 10 } -Token $tokB | Out-Null; $ok = $false } catch { }
    OK $ok 'Un estacionero NO puede usar la exportación de AGL'

    $ancho = JS "document.documentElement.scrollWidth"
    OK ($ancho -le 420) 'Teléfono: sin desplazamiento lateral' "scrollWidth $ancho"
    $e = Errores-Pagina; OK (-not $e) 'Sin errores en la página' $e
}
catch {
    $cuerpo = $_.ErrorDetails.Message
    if (-not $cuerpo -and $_.Exception.Response) { try { $cuerpo = (New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() } catch {} }
    $script:Resultados.Add("EXCEPCION (línea $($_.InvocationInfo.ScriptLineNumber)) $($_.Exception.Message) $cuerpo")
}
finally {
    try { CDP 'Network.setBlockedURLs' @{ urls = @() } | Out-Null } catch {}
    try {
        foreach ($est in @($est1, $est2)) {
            if (-not $est) { continue }
            foreach ($x in (Lista "fert_traslados?select=id&or=(origen_id.eq.$est,destino_id.eq.$est)")) { Rest "fert_traslados_detalle?traslado_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null; Rest "fert_traslados?id=eq.$($x.id)" 'Delete' -Servicio | Out-Null }
        }
        foreach ($est in @($est1, $est2)) {
            if (-not $est) { continue }
            foreach ($t in 'fert_movimientos', 'fert_saldos', 'fert_bitacora_riego', 'fert_custodia', 'fert_relevos') { Rest "${t}?estacion_id=eq.$est" 'Delete' -Servicio | Out-Null }
            foreach ($x in (Lista "fert_conteos?select=id&estacion_id=eq.$est")) { Rest "fert_conteos_detalle?conteo_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null }
            Rest "fert_conteos?estacion_id=eq.$est" 'Delete' -Servicio | Out-Null
            Rest "perfiles_estaciones?estacion_id=eq.$est" 'Delete' -Servicio | Out-Null
        }
        $desde = "$((Get-Date).AddHours(-3).ToString('yyyy-MM-ddTHH:mm:ss'))-06:00"
        Rest "fert_operaciones?perfil_id=eq.$qaId&recibido_en=gte.$desde" 'Delete' -Servicio | Out-Null
        if ($bId) { Rest "fert_operaciones?perfil_id=eq.$bId" 'Delete' -Servicio | Out-Null }
        foreach ($x in (Lista "turnos_ciclo?select=id,turno_id&agl_id=eq.TR-QC-$s")) { Rest "fert_plan?turno_ciclo_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null; Rest "turnos_ciclo?id=eq.$($x.id)" 'Delete' -Servicio | Out-Null; Rest "turnos?id=eq.$($x.turno_id)" 'Delete' -Servicio | Out-Null }
        foreach ($est in @($est1, $est2)) { if ($est) { Rest "estaciones_riego?id=eq.$est" 'Delete' -Servicio | Out-Null } }
        Rest "materiales?codigo=eq.$SOL" 'Delete' -Servicio | Out-Null
        Rest "fert_publicaciones?temporada=eq.$([uri]::EscapeDataString("QA $s"))" 'Delete' -Servicio | Out-Null
    } catch { $script:Resultados.Add("LIMPIEZA datos: $($_.Exception.Message) $($_.ErrorDetails.Message)") }
    try { Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = $origRoles; p_principal = $orig.rol_id } -Servicio | Out-Null } catch { $script:Resultados.Add("LIMPIEZA roles QA: $($_.Exception.Message)") }
    try {
        if ($bId) {
            Rest "fert_llaves?perfil_id=eq.$bId" 'Delete' -Servicio | Out-Null
            Rest "perfiles_zonas?perfil_id=eq.$bId" 'Delete' -Servicio | Out-Null
            Rest "perfiles?id=eq.$bId" 'Delete' -Servicio | Out-Null
            Invoke-RestMethod -Method Delete -Uri "$script:Url/auth/v1/admin/users/$bId" -Headers @{ apikey = $script:Serv; Authorization = "Bearer $script:Serv" } | Out-Null
        }
    } catch { $script:Resultados.Add("LIMPIEZA persona B: $($_.Exception.Message) $($_.ErrorDetails.Message)") }
    try { if ($rolEst) { Rest "permisos?rol_id=eq.$rolEst" 'Delete' -Servicio | Out-Null; Rest "roles?id=eq.$rolEst" 'Delete' -Servicio | Out-Null } } catch { $script:Resultados.Add("LIMPIEZA rol: $($_.Exception.Message)") }
    try {
        $ahora = @(foreach ($x in (Lista 'rpc/fn_roles_de_perfiles' 'Post' @{})) { if ($x.perfil_id -eq $qaId) { [int]$x.rol_id } }) | Sort-Object
        $queda = (Lista "estaciones_riego?select=id&nombre=in.(""$NOMBRE_EST1"",""$NOMBRE_EST2"")").Count + (Lista "materiales?select=id&codigo=eq.$SOL").Count
        OK ((($ahora -join ',') -eq (($origRoles | Sort-Object) -join ',')) -and $queda -eq 0) 'Limpieza: nada de la prueba queda en desarrollo y el usuario QA está como estaba' "roles $($ahora -join ','), restos $queda"
    } catch { $script:Resultados.Add("LIMPIEZA verificación: $($_.Exception.Message)") }
    Terminar-QA
}
