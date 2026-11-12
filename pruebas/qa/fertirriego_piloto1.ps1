# QA · Fertirriego · cambios de la primera prueba piloto (sql/99). Copia en :3100 + base de DESARROLLO.
# A (usuario QA) recibe con turnos, comentario, envases y un producto de campo; aplica por DDT y Extra; ve la pestaña
# Turno; anota cloro; entrega de noche con el código de 12 horas y B lo recibe SIN señal. Después, como administrador,
# valida en «Choferes y catálogos de campo». Todo en estaciones de prueba; al final se borra y el usuario QA queda igual.
param([string]$CarpetaServidor = 'C:\Users\Hhernandez\AppData\Local\Temp\claude\8cd082265f21e390\d424e4b3-aa92-4945-a284-5a2cd4214bdd\scratchpad\qa_prod')
. "$PSScriptRoot\comun.ps1"
Iniciar-QA -Base http://localhost:3100 -Ancho 412 -Alto 915 -Movil

function Lista($ruta, $metodo = 'Get', $cuerpo = $null) {
    $r = Rest $ruta $metodo $cuerpo -Servicio
    $o = New-Object System.Collections.ArrayList; foreach ($x in $r) { if ($null -ne $x) { [void]$o.Add($x) } }; return ,$o
}
function ClicEn($js) { JS "(() => { const e = $js; if (!e) return false; e.scrollIntoView({block:'center'}); e.click(); return true })()" }
function ClicHasta($js, $condicion, [int]$veces = 15) { for ($i = 0; $i -lt $veces; $i++) { ClicEn $js | Out-Null; if ((Esperar $condicion 700) -ge 0) { return $true } }; return $false }
$ULTIMO_DIALOGO = "[...document.querySelectorAll('[role=dialog]')].pop()"
function ElegirOpcion($selectorJs, $texto) {
    ClicHasta $selectorJs "document.querySelectorAll('[role=dialog]').length > 0 && !!$ULTIMO_DIALOGO.querySelector('input[inputmode=search]')" | Out-Null
    $ok = ClicEn "[...$ULTIMO_DIALOGO.querySelectorAll('button')].find(b => b.innerText.trim().startsWith('$texto'))"
    Start-Sleep -Milliseconds 400
    return $ok
}
function CrearEn($selectorJs, $etiqueta, [string[]]$valores) {
    ClicHasta $selectorJs "!!$ULTIMO_DIALOGO.querySelector('input[inputmode=search]')" | Out-Null
    ClicEn "[...$ULTIMO_DIALOGO.querySelectorAll('button')].find(b => b.innerText.includes('$etiqueta'))" | Out-Null
    Start-Sleep -Milliseconds 300
    for ($i = 0; $i -lt $valores.Count; $i++) { if ($valores[$i]) { Teclear "$ULTIMO_DIALOGO.querySelectorAll('input:not([inputmode=search])')[$i]" $valores[$i] } }
    Clic 'Crear y usar' | Out-Null
    Start-Sleep -Milliseconds 500
}
function SinPendientes([int]$ms = 80000) { Start-Sleep -Milliseconds 1500; Esperar "!document.querySelector('[data-pendientes-cuenta]')" $ms }
function Pendientes { [int](JS "Number((document.querySelector('[data-pendientes-cuenta]')?.innerText.match(/\d+/) || [0])[0])") }
function Abrir($estacion, $sufijo) {
    Ir "/fertirriego?r=$s-$sufijo"
    $t = Esperar "!!document.querySelector('[data-barra-estado]') && (!!document.querySelector('[data-estacion]') || !!document.querySelector('[data-selector-estacion]'))" 40000
    if ((JS "document.querySelector('[data-estacion]')?.dataset.estacion") -ne $estacion -and (JS "!!document.querySelector('[data-selector-estacion]')")) {
        ElegirOpcion "document.querySelector('[data-selector-estacion] button')" $estacion | Out-Null
    }
    $t2 = Esperar "document.querySelector('[data-estacion]')?.dataset.estacion === '$estacion'" 15000
    Start-Sleep -Milliseconds 500
    Esperar "!!document.querySelector('[data-actualizar]') && !document.querySelector('[data-actualizar]').disabled" 40000 | Out-Null
    return [Math]::Max($t, $t2)
}
function Dialogo { (JS "${ULTIMO_DIALOGO}?.innerText || ''") -replace "`n", ' / ' }

$s = Get-Random -Maximum 99999
$qaId = $script:QA.id
$orig = (Lista "perfiles?select=rol_id,todas_las_zonas&id=eq.$qaId")[0]
$origRoles = @(foreach ($x in (Lista 'rpc/fn_roles_de_perfiles' 'Post' @{})) { if ($x.perfil_id -eq $qaId) { [int]$x.rol_id } })
$idAdmin = (Lista 'roles?select=id&acceso_total=eq.true&limit=1')[0].id
$z1 = (Lista 'zonas?select=id,nombre&activo=eq.true&order=nombre&limit=1')[0]
$EST = "QA Piloto $s"; $T1 = "TP1-$s"; $T2 = "TP2-$s"; $SOL = "QA-SOLP-$s"
$CHOFER = "Chofer Piloto $s"; $ENVASE = "QA Bidon $s"; $RADIO = "QA Radio $s"
$hoy = (Get-Date).ToString('yyyy-MM-dd')
$rolEst = $null; $bId = $null; $estId = $null
$bEmail = "qa.$([guid]::NewGuid().ToString('N').Substring(0,10))@desarrollo.local"; $bClave = "Qa-$(Get-Random)-x$(Get-Random)"
$BARRIL = '99000000-0000-4000-8000-000000000001'

try {
    # ============ Preparación ============
    $u = Invoke-RestMethod -Method Post -Uri "$script:Url/auth/v1/admin/users" -Headers @{ apikey = $script:Serv; Authorization = "Bearer $script:Serv" } -ContentType 'application/json' -Body (@{ email = $bEmail; password = $bClave; email_confirm = $true } | ConvertTo-Json)
    $bId = $u.id
    $rolEst = (Rest 'roles' 'Post' @{ codigo = "QA_ESTP_$s"; nombre = "QA Estacionero P $s" } -Servicio)[0].id
    foreach ($a in 'ver', 'recibir', 'aplicar', 'contar', 'relevo') { Rest 'permisos' 'Post' @{ rol_id = $rolEst; recurso = 'fertirriego'; accion = $a; alcance = 'propietario' } -Servicio | Out-Null }
    Rest 'perfiles' 'Post' @{ id = $bId; nombre = "QA Mañana $s"; rol_id = $rolEst; todas_las_zonas = $false } -Servicio | Out-Null
    Rest 'perfiles_zonas' 'Post' @{ perfil_id = $bId; zona_id = $z1.id } -Servicio | Out-Null
    Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($orig.rol_id, $idAdmin); p_principal = $orig.rol_id } -Servicio | Out-Null
    $estId = (Rest 'estaciones_riego' 'Post' @{ nombre = $EST; zona_id = $z1.id } -Servicio)[0].id
    $siembra = (Get-Date).AddDays(-5).ToString('yyyy-MM-dd')
    $pub = Rest 'rpc/fn_fert_publicar' 'Post' @{ p = @{
        temporada = "QA $s"
        estaciones = @(@{ nombre = $EST; zona = $z1.nombre })
        materiales = @(@{ codigo = $SOL; descripcion = "SOLUCION P $s"; unidad = 'L'; grupo = 'Fertilizantes'; analisis = $true })
        turnos = @(
            @{ agl_id = "TR-QP1-$s"; turno = $T1; temporada = "QA $s"; ciclo = 'Ciclo QA'; fecha_siembra = $siembra; estacion = $EST; zona = $z1.nombre; area_mz = 10; estado = 'Creado' },
            @{ agl_id = "TR-QP2-$s"; turno = $T2; temporada = "QA $s"; ciclo = 'Ciclo QA'; fecha_siembra = $siembra; estacion = $EST; zona = $z1.nombre; area_mz = 10; estado = 'Creado' })
        plan = @(@{ agl_id = "TR-QP1-$s"; filas = @(
            @{ fecha = $hoy; ddt = 5; material = $SOL; cantidad = 120 },
            @{ fecha = (Get-Date).AddDays(3).ToString('yyyy-MM-dd'); ddt = 8; material = $SOL; cantidad = 90 }) })
    } }
    $solId = (Lista "materiales?select=id,fert_analisis&codigo=eq.$SOL")[0]
    foreach ($p in $qaId, $bId) { Rest 'rpc/fn_fert_asignar_persona' 'Post' @{ p_estacion = $estId; p_perfil = $p; p_asignar = $true } | Out-Null }
    Rest 'rpc/fn_fert_asignar_custodia' 'Post' @{ p_estacion = $estId; p_perfil = $qaId; p_motivo = 'Arranque QA' } | Out-Null
    Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($rolEst); p_principal = $rolEst } -Servicio | Out-Null
    OK ($pub.turnos -eq 2 -and $solId.fert_analisis -eq $true) 'Preparación: estación con 2 turnos; AGL publica el producto como fertilizante'
    CDP 'Browser.grantPermissions' @{ permissions = @('geolocation'); origin = 'http://localhost:3100' } | Out-Null
    CDP 'Emulation.setGeolocationOverride' @{ latitude = 13.312; longitude = -87.195; accuracy = 12 } | Out-Null

    # B abre una vez con señal (baja las llaves)
    $tokB = Entrar-Como $bEmail $bClave
    Abrir $EST 'b0' | Out-Null
    Start-Sleep 2

    # ============ A: RECIBIR (punto 1, 5 y 10) ============
    $tokA = Entrar-Como $script:QA.email $script:QA.clave
    $t = Abrir $EST 'a1'
    OK ($t -ge 0) 'A abre su estación' "$t ms"
    ClicHasta "document.querySelector('[data-accion=recibir]')" "!!document.querySelector('[data-turnos-recepcion]')" | Out-Null
    $chips = JS "[...document.querySelectorAll('[data-turnos-recepcion] [data-turno-chip]')].map(b => b.dataset.turnoChip).sort().join('|')"
    OK ($chips -eq ((@($T1, $T2) | Sort-Object) -join '|') -and -not (JS "!!document.querySelector('[data-turnos-recepcion] select')")) 'Recibir: los turnos de la estación salen como botones (no lista desplegable)' $chips
    ClicEn "document.querySelector('[data-turnos-recepcion] [data-turno-chip=""$T1""]')" | Out-Null
    ClicEn "document.querySelector('[data-turnos-recepcion] [data-turno-chip=""$T2""]')" | Out-Null
    OK ((JS "[...document.querySelectorAll('[data-turnos-recepcion] [aria-pressed=true]')].length") -eq 2) 'Se marcan los dos turnos con un toque cada uno'
    Teclear "document.querySelector('[data-comentario-recepcion]')" 'Un barril llegó golpeado (QA)'
    CrearEn "document.querySelector('[data-selector-chofer] button')" 'Agregar chofer' @($CHOFER, '9999-0000')
    Teclear "document.querySelector('[data-linea-codigo=""$SOL""] [data-cantidad]')" '300'
    # Envases: barriles recibidos/entregados y un tipo nuevo creado aquí mismo
    OK ((JS "!!document.querySelector('[data-envases-recepcion] [data-envase=Barril]')") -eq $true) 'Recibir: bloque de envases con Barril y Caneca'
    Teclear "document.querySelector('[data-envase=Barril] [data-envase-recibidos]')" '3'
    Teclear "document.querySelector('[data-envase=Barril] [data-envase-entregados]')" '1'
    ClicHasta "document.querySelector('[data-agregar-envase]')" "!!document.querySelector('[data-nombre-envase-nuevo]')" | Out-Null
    Teclear "document.querySelector('[data-nombre-envase-nuevo]')" $ENVASE
    ClicEn "document.querySelector('[data-crear-envase]')" | Out-Null
    Esperar "!!document.querySelector('[data-envase=""$ENVASE""]')" 4000 | Out-Null
    Teclear "document.querySelector('[data-envase=""$ENVASE""] [data-envase-recibidos]')" '2'
    # Producto que no está en MARA
    ClicEn "document.querySelector('[data-agregar-linea]')" | Out-Null
    Start-Sleep -Milliseconds 400
    $ult = "[...document.querySelectorAll('[data-linea]')].pop()"
    CrearEn "$ult.querySelector('button')" 'Agregar producto que no está en la lista' @($RADIO, 'UN', 'Otros objetos')
    Teclear "$ult.querySelector('[data-cantidad]')" '1'
    Captura 'piloto_recibir.png'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    $t = Esperar "!document.querySelector('[data-turnos-recepcion]')" 15000
    OK ($t -ge 0 -and $t -lt 3000) 'Guardado rápido: el formulario se cierra enseguida' "$t ms $(if ($t -lt 0) { Dialogo })"
    $t = SinPendientes
    $rec = Lista "fert_recepciones?select=id,turnos,comentario&estacion_id=eq.$estId"
    OK ($t -ge 0 -and $rec.Count -eq 1 -and @($rec[0].turnos).Count -eq 2 -and $rec[0].comentario -match 'golpeado') 'La base: recepción con sus 2 turnos y el comentario' "$($rec.Count) · $(@($rec[0].turnos).Count) · $($rec[0].comentario)"
    if ($rec.Count -ne 1) {
        $script:Resultados.Add("DIAG pendientes=$(Pendientes) fallo=$((JS "document.querySelector('[data-guardado-fallido]')?.innerText || ''") -replace "`n", ' / ') barra=$((JS "document.querySelector('[data-barra-estado]')?.innerText") -replace "`n", ' ')")
        foreach ($x in (Lista "fert_operaciones?select=tipo,resultado,mensaje&perfil_id=eq.$qaId&order=recibido_en.desc&limit=6")) { $script:Resultados.Add("DIAG op $($x.tipo) $($x.resultado) $($x.mensaje)") }
    }
    $prodCampo = Lista "materiales?select=id,origen,activo,validado,fert_analisis,grupo&descripcion=eq.$([uri]::EscapeDataString($RADIO))"
    OK ($prodCampo.Count -eq 1 -and $prodCampo[0].origen -eq 'CAMPO' -and $prodCampo[0].activo -eq $false -and $prodCampo[0].validado -eq $false -and $prodCampo[0].fert_analisis -eq $false -and $prodCampo[0].grupo -eq 'Otros objetos') 'Producto de campo: CAMPO, por validar, fuera de MARA y de los análisis' ($prodCampo | ConvertTo-Json -Compress)
    $panel = JS "document.querySelector('[data-envases-estacion]')?.innerText || ''"
    OK ((JS "document.querySelector('[data-saldo-envase=Barril]')?.innerText || ''") -match '\b2\b' -and $panel -match [regex]::Escape($ENVASE)) 'La estación muestra sus envases: 2 barriles y 2 del envase nuevo' ($panel -replace "`n", ' ')

    # ============ A: APLICAR por DDT (puntos 3 y 4) ============
    ClicHasta "document.querySelector('[data-accion=aplicar]')" "!!document.querySelector('[data-selector-turno]')" | Out-Null
    ClicEn "document.querySelector('[data-selector-turno] [data-turno-chip=""$T1""]')" | Out-Null
    $t = Esperar "!!document.querySelector('[data-ddt-chip=""5""][aria-pressed=true]')" 5000
    OK ($t -ge 0 -and (JS "!!document.querySelector('[data-ddt-chip=extra]')") -eq $true) 'Aplicar: DDT del plan con botones (el de hoy ya elegido) y la opción Extra'
    OK ((JS "document.querySelector('[data-linea-codigo=""$SOL""] [data-cantidad]')?.value") -eq '120') 'Con el DDT elegido se cargan sus productos (120 L)'
    OK ((JS "document.body.textContent.includes('Día de aplicación')") -eq $true -and (JS "document.querySelector('[data-ddt-real]')?.dataset.ddtReal") -eq '5') 'Dice «Día de aplicación» y calcula el DDT real (5)'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    Esperar "!document.querySelector('[data-selector-turno]')" 15000 | Out-Null
    SinPendientes | Out-Null
    $apl = Lista "fert_aplicaciones?select=ddt_plan,fecha_plan,extra,ddt_real&estacion_id=eq.$estId"
    OK ($apl.Count -eq 1 -and $apl[0].ddt_plan -eq 5 -and $apl[0].ddt_real -eq 5 -and $apl[0].extra -eq $false) 'La base: DDT plan 5 y DDT real 5' ($apl | ConvertTo-Json -Compress)

    # Extra
    ClicHasta "document.querySelector('[data-accion=aplicar]')" "!!document.querySelector('[data-selector-turno]')" | Out-Null
    ClicEn "document.querySelector('[data-selector-turno] [data-turno-chip=""$T1""]')" | Out-Null
    ClicHasta "document.querySelector('[data-ddt-chip=extra]')" "!!document.querySelector('[data-ddt-chip=extra][aria-pressed=true]')" | Out-Null
    OK (-not (JS "!!document.querySelector('[data-linea-codigo=""$SOL""]')")) 'Extra: empieza sin productos (los pone el estacionero)'
    ElegirOpcion "[...document.querySelectorAll('[data-linea]')].pop().querySelector('button')" "SOLUCION P $s" | Out-Null
    Teclear "[...document.querySelectorAll('[data-linea]')].pop().querySelector('[data-cantidad]')" '10'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    Esperar "!document.querySelector('[data-selector-turno]')" 15000 | Out-Null
    SinPendientes | Out-Null
    $ext = Lista "fert_aplicaciones?select=ddt_plan,extra,ddt_real&estacion_id=eq.$estId&extra=eq.true"
    OK ($ext.Count -eq 1 -and $null -eq $ext[0].ddt_plan -and $ext[0].ddt_real -eq 5) 'La base: aplicación Extra con su DDT real' ($ext | ConvertTo-Json -Compress)

    # ============ Pestaña Turno (punto 7) y cloro (punto 8) ============
    ClicHasta "document.querySelector('[data-pestana=turnos]')" "!!document.querySelector('[data-turno=""$T1""]')" | Out-Null
    # Con más de un turno, cada uno se abre con un toque
    ClicHasta "document.querySelector('[data-turno=""$T1""] button[aria-expanded]')" "!!document.querySelector('[data-turno=""$T1""] [data-tarjeta-ddt]')" | Out-Null
    Esperar "!!document.querySelector('[data-turno=""$T1""] [data-tarjeta-ddt=""5""]')" 8000 | Out-Null
    $tar = JS "document.querySelector('[data-turno=""$T1""] [data-tarjeta-ddt=""5""]')?.textContent || ''"
    if (-not $tar) { $script:Resultados.Add("DIAG turnos: $((JS "[...document.querySelectorAll('[data-turno]')].map(t => t.dataset.turno + ' > ' + [...t.querySelectorAll('[data-tarjeta-ddt]')].map(c => c.dataset.tarjetaDdt).join(',')).join(' | ')") -replace "`n", ' ')") }
    $fila = JS "document.querySelector('[data-turno=""$T1""] [data-tarjeta-ddt=""5""] [data-producto-tarjeta=""$SOL""]')?.innerText || ''"
    OK ($tar -match 'DDT plan 5' -and (($fila -split '\s+' | Where-Object { $_ -eq '120' }).Count -ge 2)) 'Turno: tarjeta del DDT 5 con plan 120 y real 120' ($tar -replace "`n", ' · ')
    OK ((JS "!!document.querySelector('[data-turno=""$T1""] [data-tarjeta-ddt=extra]')") -eq $true) 'Turno: la aplicación extra sale en su tarjeta «Extra»'
    Captura 'piloto_turno.png'
    ClicHasta "document.querySelector('[data-turno=""$T1""] [data-tarjeta-ddt=""5""] [data-horas-dia]')" "!!document.querySelector('[data-ppm-cabezal]')" | Out-Null
    Teclear "document.querySelector('[data-horas-riego]')" '6'
    Teclear "document.querySelector('[data-ppm-cabezal]')" '1.5'
    Teclear "document.querySelector('[data-ppm-campo]')" '0.8'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    Esperar "!document.querySelector('[data-ppm-cabezal]')" 15000 | Out-Null
    SinPendientes | Out-Null
    $bit = Lista "fert_bitacora_riego?select=ppm_cloro_cabezal,ppm_cloro_campo&estacion_id=eq.$estId"
    OK ($bit.Count -eq 1 -and [double]$bit[0].ppm_cloro_cabezal -eq 1.5 -and [double]$bit[0].ppm_cloro_campo -eq 0.8) 'Horas: guarda ppm de cloro en cabezal y en campo' ($bit | ConvertTo-Json -Compress)
    $ancho = JS "document.documentElement.scrollWidth"
    OK ($ancho -le 420) 'Teléfono: sin desplazamiento lateral en la pestaña Turno' "scrollWidth $ancho"

    # ============ Relevo de noche: código de 12 horas (punto 6) ============
    ClicHasta "document.querySelector('[data-pestana=estacion]')" "!!document.querySelector('[data-entregar-estacion]')" | Out-Null
    ClicHasta "document.querySelector('[data-entregar-estacion]')" "!!document.querySelector('[data-novedades]')" | Out-Null
    foreach ($tt in $T1, $T2) { ClicEn "document.querySelector('[data-novedad-turno=""$tt""] [data-estado-novedad=TERMINADO]')" | Out-Null }
    Teclear "document.querySelector('[data-nota-relevo]')" 'Termino a las 12; queda todo terminado (QA)'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    Esperar "!!document.querySelector('[data-ver-codigo-largo]')" 15000 | Out-Null
    ClicEn "document.querySelector('[data-ver-codigo-largo]')" | Out-Null
    $t = Esperar "/^\d{8}$/.test(document.querySelector('[data-codigo-largo]')?.dataset.codigoLargo || '')" 8000
    $largo = JS "document.querySelector('[data-codigo-largo]')?.dataset.codigoLargo"
    OK ($t -ge 0 -and (JS "/Vale hasta/.test(document.querySelector('[data-codigo-largo]').innerText)") -eq $true) 'Al entregar: código de entrega de 8 dígitos que dice hasta cuándo vale' $largo
    Captura 'piloto_codigo_largo.png'
    SinPendientes | Out-Null
    ClicEn "[...document.querySelectorAll('button')].find(b => b.innerText.trim() === 'Listo')" | Out-Null

    # B llega en la mañana, SIN señal, y escribe el código que le dejaron
    $tokB = Entrar-Como $bEmail $bClave
    Abrir $EST 'b1' | Out-Null
    # Como en campo: abrió con señal antes (ya bajó la entrega); en la madrugada no hay señal
    Esperar "/te la entregaron/.test(document.querySelector('[data-recibir-estacion]')?.innerText || '')" 30000 | Out-Null
    if (-not (JS "!!document.querySelector('[data-recibir-estacion]')")) { $script:Resultados.Add("DIAG B: $((JS "document.querySelector('[data-custodia]')?.innerText || document.body.innerText.slice(0, 300)") -replace "`n", ' / ')") }
    CDP 'Network.enable' | Out-Null
    CDP 'Network.setBlockedURLs' @{ urls = @('*supabase.co*') } | Out-Null
    ClicHasta "document.querySelector('[data-recibir-estacion]')" "!!document.querySelector('[data-metodo=CODIGO_LARGO]')" | Out-Null
    ClicHasta "document.querySelector('[data-metodo=CODIGO_LARGO]')" "document.querySelector('[data-codigo-recibir]')?.maxLength === 8" | Out-Null
    Teclear "document.querySelector('[data-codigo-recibir]')" '12345678'
    $t = Esperar "!!document.querySelector('[data-codigo-error]')" 6000
    OK ($t -ge 0 -and -not (JS "!!document.querySelector('[data-codigo-ok]')")) 'Sin señal: un código inventado NO pasa'
    Teclear "document.querySelector('[data-codigo-recibir]')" $largo
    $t = Esperar "!!document.querySelector('[data-codigo-ok]')" 6000
    OK ($t -ge 0) 'Sin señal: el código de 12 horas se verifica en el teléfono de B' (JS "document.querySelector('[data-codigo-ok]')?.innerText")
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    Esperar "!document.querySelector('[data-codigo-recibir]')" 15000 | Out-Null
    CDP 'Network.setBlockedURLs' @{ urls = @() } | Out-Null
    ClicEn "document.querySelector('[data-actualizar]')" | Out-Null
    SinPendientes 40000 | Out-Null
    $rel = Lista "fert_relevos?select=estado,metodo,recibe_id,codigo_verificado&estacion_id=eq.$estId&estado=eq.RECIBIDO"
    $cus = (Lista "fert_custodia?select=estado,custodio_id&estacion_id=eq.$estId")[0]
    OK ($rel.Count -eq 1 -and $rel[0].metodo -eq 'CODIGO_LARGO' -and $rel[0].codigo_verificado -eq $true -and $cus.custodio_id -eq $bId) 'La base verifica el código de 12 horas: la estación queda a cargo de B' ($rel | ConvertTo-Json -Compress)

    # ============ Administración: choferes y catálogos de campo (punto 9) ============
    $tokA = Entrar-Como $script:QA.email $script:QA.clave
    Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($rolEst, $idAdmin); p_principal = $rolEst } -Servicio | Out-Null
    Ir "/admin/fertirriego-catalogos?r=$s"
    $t = Esperar "!!document.querySelector('[data-catalogos-campo]')" 30000
    OK ($t -ge 0 -and (JS "/Choferes y catálogos de campo/.test(document.body.innerText)") -eq $true) 'Administración › Choferes y catálogos de campo abre' "$t ms"
    Teclear "document.querySelector('[data-buscar-catalogo]')" $CHOFER
    $fila = "document.querySelector('[data-fila-catalogo=""$CHOFER""]')"
    OK ((JS "/Por validar/i.test(${fila}?.textContent || '')") -eq $true) 'El chofer creado en campo aparece «Por validar»'
    ClicEn "${fila}.querySelector('[data-validar-fila]')" | Out-Null
    $t = Esperar "/Validado/i.test(${fila}?.textContent || '')" 15000
    OK ($t -ge 0 -and (Lista "fert_choferes?select=validado&nombre=eq.$([uri]::EscapeDataString($CHOFER))")[0].validado -eq $true) 'Validar el chofer'
    Ir "/admin/fertirriego-catalogos?r=$s-p"
    Esperar "!!document.querySelector('[data-pestana-catalogo=productos]')" 30000 | Out-Null
    ClicHasta "document.querySelector('[data-pestana-catalogo=productos]')" "!!document.querySelector('[data-fila-catalogo=""$RADIO""]')" | Out-Null
    Start-Sleep 1
    ClicHasta "document.querySelector('[data-fila-catalogo=""$RADIO""] [data-editar-fila]')" "!!document.querySelector('[data-editar-campo=descripcion]')" | Out-Null
    if (-not (JS "!!document.querySelector('[data-editar-campo=descripcion]')")) { $script:Resultados.Add("DIAG editar: $((JS "document.querySelector('[data-fila-catalogo=""$RADIO""]')?.outerHTML.slice(0, 400)") -replace "`n", ' ')") }
    Teclear "document.querySelector('[data-editar-campo=descripcion]')" "$RADIO Motorola"
    ClicEn "document.querySelector('[data-guardar-edicion]')" | Out-Null
    $t = Esperar "!!document.querySelector('[data-fila-catalogo=""$RADIO Motorola""]')" 15000
    if ($t -lt 0) { $script:Resultados.Add("DIAG producto: $((JS "document.querySelector('[data-catalogos-campo]')?.innerText.slice(0, 600)") -replace "`n", ' / ')") }
    $m = (Lista "materiales?select=descripcion,validado&id=eq.$($prodCampo[0].id)")[0]
    OK ($t -ge 0 -and $m.descripcion -eq "$RADIO Motorola" -and $m.validado -eq $true) 'Corregir el nombre del producto de campo (queda validado)' ($m | ConvertTo-Json -Compress)
    $e = Errores-Pagina; OK (-not $e) 'Sin errores en la página' $e
}
catch { $script:Resultados.Add("EXCEPCION $($_.Exception.Message) $($_.ErrorDetails.Message)") }
finally {
    try { CDP 'Network.setBlockedURLs' @{ urls = @() } | Out-Null } catch {}
    try {
        if ($estId) {
            foreach ($t in 'fert_movimientos', 'fert_saldos', 'fert_bitacora_riego', 'fert_custodia', 'fert_relevos', 'fert_envases_movimientos') { Rest "${t}?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null }
            foreach ($x in (Lista "fert_aplicaciones?select=id&estacion_id=eq.$estId")) { Rest "fert_aplicaciones_detalle?aplicacion_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null }
            Rest "fert_aplicaciones?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            foreach ($x in (Lista "fert_recepciones?select=id&estacion_id=eq.$estId")) { Rest "fert_recepciones_detalle?recepcion_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null }
            Rest "fert_recepciones?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            foreach ($x in (Lista "fert_conteos?select=id&estacion_id=eq.$estId")) { Rest "fert_conteos_detalle?conteo_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null }
            Rest "fert_conteos?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            $desde = "$((Get-Date).AddHours(-3).ToString('yyyy-MM-ddTHH:mm:ss'))-06:00"
            foreach ($p in $qaId, $bId) { if ($p) { Rest "fert_operaciones?perfil_id=eq.$p&recibido_en=gte.$desde" 'Delete' -Servicio | Out-Null } }
            foreach ($c in (Lista "fert_choferes?select=id&nombre=eq.$([uri]::EscapeDataString($CHOFER))")) { Rest "fert_choferes_vehiculos?chofer_id=eq.$($c.id)" 'Delete' -Servicio | Out-Null; Rest "fert_choferes?id=eq.$($c.id)" 'Delete' -Servicio | Out-Null }
            Rest "fert_envases_tipos?nombre=eq.$([uri]::EscapeDataString($ENVASE))" 'Delete' -Servicio | Out-Null
            Rest "materiales?origen=eq.CAMPO&descripcion=like.$([uri]::EscapeDataString("$RADIO*"))" 'Delete' -Servicio | Out-Null
            foreach ($x in (Lista "turnos_ciclo?select=id,turno_id&agl_id=in.(TR-QP1-$s,TR-QP2-$s)")) { Rest "fert_plan?turno_ciclo_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null; Rest "turnos_ciclo?id=eq.$($x.id)" 'Delete' -Servicio | Out-Null; Rest "turnos?id=eq.$($x.turno_id)" 'Delete' -Servicio | Out-Null }
            Rest "perfiles_estaciones?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            Rest "estaciones_riego?id=eq.$estId" 'Delete' -Servicio | Out-Null
        }
        Rest "materiales?codigo=eq.$SOL" 'Delete' -Servicio | Out-Null
        Rest "fert_publicaciones?temporada=eq.$([uri]::EscapeDataString("QA $s"))" 'Delete' -Servicio | Out-Null
        if ($bId) {
            Rest "fert_llaves?perfil_id=eq.$bId" 'Delete' -Servicio | Out-Null
            Rest "perfiles_zonas?perfil_id=eq.$bId" 'Delete' -Servicio | Out-Null
        }
    } catch { $script:Resultados.Add("LIMPIEZA datos: $($_.Exception.Message) $($_.ErrorDetails.Message)") }
    try { if ($bId) { Rest "perfiles?id=eq.$bId" 'Delete' -Servicio | Out-Null; Invoke-RestMethod -Method Delete -Uri "$script:Url/auth/v1/admin/users/$bId" -Headers @{ apikey = $script:Serv; Authorization = "Bearer $script:Serv" } | Out-Null } } catch { $script:Resultados.Add("LIMPIEZA usuario B: $($_.Exception.Message) $($_.ErrorDetails.Message)") }
    try { Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = $origRoles; p_principal = $orig.rol_id } -Servicio | Out-Null } catch { $script:Resultados.Add("LIMPIEZA roles QA: $($_.Exception.Message)") }
    try { if ($rolEst) { Rest "permisos?rol_id=eq.$rolEst" 'Delete' -Servicio | Out-Null; Rest "roles?id=eq.$rolEst" 'Delete' -Servicio | Out-Null } } catch { $script:Resultados.Add("LIMPIEZA rol: $($_.Exception.Message) $($_.ErrorDetails.Message)") }
    try {
        $ahora = @(foreach ($x in (Lista 'rpc/fn_roles_de_perfiles' 'Post' @{})) { if ($x.perfil_id -eq $qaId) { [int]$x.rol_id } }) | Sort-Object
        $queda = (Lista "estaciones_riego?select=id&nombre=eq.$([uri]::EscapeDataString($EST))").Count + (Lista "materiales?select=id&codigo=eq.$SOL").Count + (Lista "fert_envases_tipos?select=id&nombre=eq.$([uri]::EscapeDataString($ENVASE))").Count + (Lista "perfiles?select=id&id=eq.$bId").Count
        OK ((($ahora -join ',') -eq (($origRoles | Sort-Object) -join ',')) -and $queda -eq 0) 'Limpieza: nada de la prueba queda en desarrollo y el usuario QA está como estaba' "roles $($ahora -join ','), restos $queda"
    } catch { $script:Resultados.Add("LIMPIEZA verificación: $($_.Exception.Message)") }
    Terminar-QA
}
