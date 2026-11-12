# QA · Fertirriego Etapa B (app de campo sin señal). Copia en :3100 + base de DESARROLLO.
# Trabaja sobre una ESTACIÓN DE PRUEBA propia (nada toca las estaciones reales) y al final borra todo lo que creó y
# deja al usuario QA como estaba. Simula «sin señal» bloqueando Supabase en el navegador y apagando el servidor web.
param([string]$CarpetaServidor = 'C:\Users\Hhernandez\AppData\Local\Temp\claude\8cd082265f21e390\d424e4b3-aa92-4945-a284-5a2cd4214bdd\scratchpad\qa_prod')
. "$PSScriptRoot\comun.ps1"
Iniciar-QA -Base http://localhost:3100 -Ancho 412 -Alto 915 -Movil

function Lista($ruta, $metodo = 'Get', $cuerpo = $null, [switch]$ComoUsuario) {
    $r = if ($ComoUsuario) { Rest $ruta $metodo $cuerpo } else { Rest $ruta $metodo $cuerpo -Servicio }
    $o = New-Object System.Collections.ArrayList; foreach ($x in $r) { if ($null -ne $x) { [void]$o.Add($x) } }; return ,$o
}
function ClicEn($js) { JS "(() => { const e = $js; if (!e) return false; e.scrollIntoView({block:'center'}); e.click(); return true })()" }
# Repite el clic hasta que se cumpla la condición (un clic antes de que React tome la página se pierde)
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
function Servidor([switch]$Apagar) {
    if ($Apagar) { Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'start -p 3100' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Start-Sleep 1 }
    else { Start-Process -FilePath 'cmd.exe' -ArgumentList '/c npx next start -p 3100' -WorkingDirectory $CarpetaServidor -WindowStyle Hidden; for ($i = 0; $i -lt 30; $i++) { try { if ((Invoke-WebRequest http://localhost:3100/login -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { return } } catch {}; Start-Sleep 1 } }
}

$s = Get-Random -Maximum 99999
$qaId = $script:QA.id
$orig = (Lista "perfiles?select=rol_id,todas_las_zonas&id=eq.$qaId")[0]
$origRoles = @(foreach ($x in (Lista 'rpc/fn_roles_de_perfiles' 'Post' @{})) { if ($x.perfil_id -eq $qaId) { [int]$x.rol_id } })
$idAdmin = (Lista 'roles?select=id&acceso_total=eq.true&limit=1')[0].id
$z1 = (Lista 'zonas?select=id,nombre&activo=eq.true&order=nombre&limit=1')[0]
$EST = "QA Estacion $s"; $TURNO = "TQA-$s"; $SOL = "QA-SOL-$s"; $ACI = "QA-ACI-$s"
$hoy = (Get-Date).ToString('yyyy-MM-dd'); $ayer = (Get-Date).AddDays(-1).ToString('yyyy-MM-dd')
$rolEst = $null

try {
    # ============ Preparación: estación, turno, plan y materiales de prueba (publicados como lo haría AGL) ============
    Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($orig.rol_id, $idAdmin); p_principal = $orig.rol_id } -Servicio | Out-Null
    $estId = (Rest 'estaciones_riego' 'Post' @{ nombre = $EST; zona_id = $z1.id } -Servicio)[0].id
    $pub = Rest 'rpc/fn_fert_publicar' 'Post' @{ p = @{
        temporada = "QA $s"
        estaciones = @(@{ nombre = $EST; zona = $z1.nombre })
        materiales = @(@{ codigo = $SOL; descripcion = "SOLUCION QA $s"; unidad = 'L'; grupo = '1800' }, @{ codigo = $ACI; descripcion = "ACIDO QA $s"; unidad = 'L'; grupo = '1800' })
        turnos = @(@{ agl_id = "TR-QA-$s"; turno = $TURNO; temporada = "QA $s"; ciclo = 'Ciclo QA'; fecha_siembra = (Get-Date).AddDays(-5).ToString('yyyy-MM-dd'); estacion = $EST; zona = $z1.nombre; area_mz = 10; estado = 'Creado' })
        plan = @(@{ agl_id = "TR-QA-$s"; filas = @(
            @{ fecha = $hoy; ddt = 5; material = $SOL; cantidad = 120 }, @{ fecha = $hoy; ddt = 5; material = $ACI; cantidad = 4 },
            @{ fecha = $ayer; ddt = 4; material = $SOL; cantidad = 100 }) })
    } }
    OK ($pub.turnos -eq 1 -and $pub.filas_plan -eq 3) 'Preparación: AGL publica el turno, el plan y los productos de prueba' "turnos $($pub.turnos), plan $($pub.filas_plan)"
    Rest 'perfiles_estaciones' 'Post' @{ perfil_id = $qaId; estacion_id = $estId } -Servicio | Out-Null

    # ============ Como JEFE (administrador): asignar la estación ============
    Ir "/fertirriego?r=$s"
    $t = Esperar "!!document.querySelector('[data-barra-estado]') && !!document.querySelector('[data-estacion]')" 40000
    OK ($t -ge 0) 'Abre Fertirriego en el teléfono' "$t ms"
    OK ((JS "!![...document.querySelectorAll('a[href=""/fertirriego""]')].length") -eq $true -or (JS "document.body.innerHTML.includes('/fertirriego')") -eq $true) 'Fertirriego aparece en el menú'
    ElegirOpcion '[data-selector-estacion] button' $EST | Out-Null
    $t = Esperar "document.querySelector('[data-estacion]')?.dataset.estacion === '$EST'" 10000
    OK ($t -ge 0) 'Elige la estación de prueba'
    ClicHasta "document.querySelector('[data-asignar-custodia]')" "!!document.querySelector('[data-selector-custodio]')" | Out-Null
    $nombreQa = (Lista "perfiles?select=nombre&id=eq.$qaId")[0].nombre
    ElegirOpcion '[data-selector-custodio] button' $nombreQa | Out-Null
    Teclear "document.querySelector('[data-motivo-custodia]')" 'Arranque QA'
    ClicEn "document.querySelector('[data-guardar-custodia]')" | Out-Null
    $t = Esperar "/a tu cargo/.test(document.querySelector('[data-custodia]')?.innerText || '')" 20000
    OK ($t -ge 0) 'El jefe asigna la estación: queda «a tu cargo»'

    # ============ Como ESTACIONERO ============
    $rolEst = (Rest 'roles' 'Post' @{ codigo = "QA_EST_$s"; nombre = "QA Estacionero $s" } -Servicio)[0].id
    foreach ($a in 'ver', 'recibir', 'aplicar', 'contar', 'relevo') { Rest 'permisos' 'Post' @{ rol_id = $rolEst; recurso = 'fertirriego'; accion = $a; alcance = 'propietario' } -Servicio | Out-Null }
    Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($rolEst); p_principal = $rolEst } -Servicio | Out-Null
    CDP 'Browser.grantPermissions' @{ permissions = @('geolocation'); origin = 'http://localhost:3100' } | Out-Null
    CDP 'Emulation.setGeolocationOverride' @{ latitude = 13.312; longitude = -87.195; accuracy = 12 } | Out-Null
    Ir "/fertirriego?r=$s-b"
    $t = Esperar "document.querySelector('[data-estacion]')?.dataset.estacion === '$EST'" 40000
    OK ($t -ge 0 -and -not (JS "!!document.querySelector('[data-selector-estacion]')")) 'El estacionero ve SOLO su estación' "$t ms"

    # Conteo inicial
    ClicHasta "document.querySelector('[data-accion=contar]')" "!!document.querySelector('[data-conteo]')" | Out-Null
    Teclear "document.querySelector('[data-conteo-material=""$SOL""] input')" '500'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    Esperar "!document.querySelector('[data-conteo]')" 15000 | Out-Null
    $t = Esperar "!document.querySelector('[data-pendientes-cuenta]')" 30000
    $m = Lista "fert_movimientos?select=tipo,cantidad&estacion_id=eq.$estId"
    OK ($t -ge 0 -and $m.Count -eq 1 -and $m[0].tipo -eq 'SALDO_INICIAL' -and [double]$m[0].cantidad -eq 500) 'Conteo inicial: saldo inicial 500, enviado solo'

    # Recepción: sin «¿Dónde?» y con los productos del plan de la estación ya puestos
    ClicHasta "document.querySelector('[data-accion=recibir]')" "!!document.querySelector('[data-selector-chofer]')" | Out-Null
    OK (-not (JS "/¿Dónde\?/.test(${ULTIMO_DIALOGO}?.innerText || '')")) 'Recibir: ya no pide «¿Dónde?» (siempre es la bodega de la estación)'
    $cods = JS "[...document.querySelectorAll('[data-linea-codigo]')].map(d => d.dataset.lineaCodigo).sort().join('|')"
    OK ($cods -eq ((@($ACI, $SOL) | Sort-Object) -join '|') -and (JS "!!document.querySelector('[data-productos-del-plan]')") -eq $true) 'Los productos del plan de la estación vienen por defecto (vacíos)' $cods
    OK ((JS "document.querySelector('[data-linea-codigo=""$SOL""] [data-plan-linea]')?.innerText") -match 'Plan 7 días: 120') 'Junto a cada producto: lo planificado para los próximos 7 días' (JS "document.querySelector('[data-linea-codigo=""$SOL""] [data-plan-linea]')?.innerText")
    CrearEnSelector '[data-selector-chofer] button' 'Agregar chofer' @("Chofer QA $s", '9999-0000')
    CrearEnSelector '[data-selector-vehiculo] button' 'Agregar vehículo' @("qa $s", 'Camión', 'Isuzu', 'Blanco')
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    $t = Esperar "/cantidad de al menos un producto recibido/.test(${ULTIMO_DIALOGO}?.innerText || '')" 15000
    OK ($t -ge 0) 'Sin cantidades: no registra nada y lo explica'
    Teclear "document.querySelector('[data-linea-codigo=""$SOL""] [data-cantidad]')" '1000'

    # Borrador: salir sin guardar y volver (aunque se recargue la página)
    ClicEn "[...${ULTIMO_DIALOGO}.querySelectorAll('button')].find(b => b.innerText.trim() === 'Cancelar')" | Out-Null
    $t = Esperar "!document.querySelector('[data-selector-chofer]') && !!document.querySelector('[data-accion=recibir] [data-marca-borrador]')" 8000
    OK ($t -ge 0 -and (JS "!!document.querySelector('[data-hay-borradores]')") -eq $true) 'Salir sin guardar: el botón Recibir queda marcado «Borrador»' (JS "document.querySelector('[data-hay-borradores]')?.innerText")
    OK ((Lista "fert_recepciones?select=id&estacion_id=eq.$estId").Count -eq 0) 'Un borrador NO es un registro: la bodega no se movió'
    Ir "/fertirriego?r=$s-borrador"
    Esperar "document.querySelector('[data-estacion]')?.dataset.estacion === '$EST'" 40000 | Out-Null
    $t = Esperar "!!document.querySelector('[data-accion=recibir] [data-marca-borrador]')" 10000
    OK ($t -ge 0) 'Después de recargar la página, el borrador sigue ahí'
    ClicHasta "document.querySelector('[data-accion=recibir]')" "!!document.querySelector('[data-selector-chofer]')" | Out-Null
    $rec0 = JS "document.querySelector('[data-linea-codigo=""$SOL""] [data-cantidad]')?.value + ' · ' + document.querySelector('[data-selector-chofer]').innerText"
    OK ((JS "!!document.querySelector('[data-borrador-recuperado]')") -eq $true -and $rec0 -match '^1000 · ' -and $rec0 -match "Chofer QA $s") 'Al volver: «Continuando tu borrador» con la cantidad y el chofer nuevo' (($rec0 + ' · ' + (JS "document.querySelector('[data-borrador-recuperado]')?.innerText")) -replace "`n", ' ')
    Teclear "document.querySelector('[data-linea-codigo=""$ACI""] [data-cantidad]')" '50'
    Captura 'fert_recepcion_antes.png'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    $tr = Esperar "!document.querySelector('[data-selector-chofer]')" 15000
    # Guardado justo al abrir la pantalla (mientras ya sincronizaba): el envío va en la vuelta siguiente (hasta 1 min)
    if ($tr -lt 0) { $script:Resultados.Add("DIAG recepción: $((JS "[...document.querySelectorAll('[role=dialog]')].map(d => d.innerText).join(' ||| ')") -replace "`n", ' / ')"); Captura 'fert_recepcion_error.png' }
    $t = Esperar "!document.querySelector('[data-pendientes-cuenta]')" 80000
    if ($t -lt 0) {
        $script:Resultados.Add("DIAG pendientes=$(Pendientes) barra=$(JS "document.querySelector('[data-barra-estado]')?.dataset.barraEstado") texto=$((JS "document.querySelector('[data-barra-estado]')?.innerText") -replace "`n", ' ')")
        foreach ($x in (Lista "fert_operaciones?select=tipo,resultado,mensaje,recibido_en&perfil_id=eq.$qaId&order=recibido_en.desc&limit=5")) { $script:Resultados.Add("DIAG op $($x.tipo) $($x.resultado) $($x.mensaje)") }
        $script:Resultados.Add("DIAG envíos: $((JS "document.body.innerText.match(/Envíos[\s\S]{0,300}/)?.[0] || ''") -replace "`n", ' / ')")
    }
    $rec = Lista "fert_recepciones?select=id,chofer_id,vehiculo_id&estacion_id=eq.$estId"
    foreach ($x in (Lista "fert_operaciones?select=tipo,resultado,mensaje&perfil_id=eq.$qaId&resultado=eq.RECHAZADO&order=recibido_en.desc&limit=3")) { $script:Resultados.Add("DIAG rechazado $($x.tipo): $($x.mensaje)") }
    $op = if ($rec.Count) { (Lista "fert_operaciones?select=lat,lon,observaciones&id=eq.$($rec[0].id)")[0] } else { $null }
    $placa = if ($rec.Count -and $rec[0].vehiculo_id) { (Lista "fert_vehiculos?select=placa&id=eq.$($rec[0].vehiculo_id)")[0].placa } else { '' }
    OK ($t -ge 0 -and $rec.Count -eq 1 -and $placa -eq "QA$s") 'Recepción con chofer y vehículo creados en el momento (placa normalizada)' $placa
    OK ($op -and [double]$op.lat -eq 13.312) 'La recepción guarda la ubicación del teléfono' "$($op.lat), $($op.lon)"
    $sal = JS "document.querySelector('[data-saldo=""$SOL""]')?.innerText"
    OK ($sal -match '1[.,]?500') 'La bodega muestra 1,500 L' ($sal -replace "`n", ' ')
    $lugar = (Lista "fert_recepciones?select=lugar&estacion_id=eq.$estId")[0].lugar
    OK ($lugar -eq $EST -and -not (JS "!!document.querySelector('[data-accion=recibir] [data-marca-borrador]')")) 'Guardado: el lugar es la estación y el borrador desaparece' $lugar

    # Descartar un borrador
    $nMov = (Lista "fert_movimientos?select=id&estacion_id=eq.$estId").Count
    ClicHasta "document.querySelector('[data-accion=contar]')" "!!document.querySelector('[data-conteo]')" | Out-Null
    Teclear "document.querySelector('[data-conteo-material=""$ACI""] input')" '7'
    ClicEn "[...${ULTIMO_DIALOGO}.querySelectorAll('button')].find(b => b.innerText.trim() === 'Cancelar')" | Out-Null
    Esperar "!!document.querySelector('[data-accion=contar] [data-marca-borrador]')" 8000 | Out-Null
    ClicHasta "document.querySelector('[data-accion=contar]')" "!!document.querySelector('[data-conteo]')" | Out-Null
    $t = Esperar "!!document.querySelector('[data-descartar-borrador]')" 5000
    ClicEn "document.querySelector('[data-descartar-borrador]')" | Out-Null
    $t2 = Esperar "!document.querySelector('[data-conteo]') && !document.querySelector('[data-accion=contar] [data-marca-borrador]')" 8000
    OK ($t -ge 0 -and $t2 -ge 0 -and (Lista "fert_movimientos?select=id&estacion_id=eq.$estId").Count -eq $nMov) 'Descartar: borra el borrador sin registrar nada'

    # ---------- SIN SEÑAL: Supabase bloqueado ----------
    CDP 'Network.enable' | Out-Null
    CDP 'Network.setBlockedURLs' @{ urls = @('*supabase.co*') } | Out-Null
    ClicHasta "document.querySelector('[data-plan-turno=""$TURNO""]')" "!!document.querySelector('[data-selector-turno]')" | Out-Null
    $pre = JS "[...document.querySelectorAll('[data-cantidad]')].map(i => i.value).join('|')"
    OK ($pre -eq '120|4') 'Aplicar desde «Plan de hoy»: propone las cantidades del plan' $pre
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    Esperar "!document.querySelector('[data-selector-turno]')" 15000 | Out-Null
    Start-Sleep 2
    OK ((Pendientes) -eq 1 -and (JS "document.querySelector('[data-barra-estado]').dataset.barraEstado") -eq 'sin_senal') 'Sin señal: queda guardada en el teléfono (1 por enviar)'
    $sal = JS "document.querySelector('[data-saldo=""$SOL""]')?.innerText"
    OK ($sal -match '1[.,]?380') 'Sin señal, la bodega ya descuenta lo aplicado (1,380 L)' ($sal -replace "`n", ' ')

    # Sin servidor web: la pantalla abre desde el teléfono (service worker) y lo pendiente sigue ahí
    $sw = Esperar "!!navigator.serviceWorker.controller" 15000
    OK ($sw -ge 0) 'El service worker controla la pantalla de campo'
    Servidor -Apagar
    CDP 'Page.reload' @{ ignoreCache = $false } | Out-Null
    $t = Esperar "document.querySelector('[data-estacion]')?.dataset.estacion === '$EST'" 30000
    OK ($t -ge 0 -and (Pendientes) -eq 1) 'Sin servidor ni señal: la app abre y conserva lo pendiente' "$t ms"
    Captura 'fert_sin_senal.png'
    Servidor

    # ---------- VUELVE LA SEÑAL ----------
    CDP 'Network.setBlockedURLs' @{ urls = @() } | Out-Null
    ClicEn "document.querySelector('[data-actualizar]')" | Out-Null
    $t = Esperar "!document.querySelector('[data-pendientes-cuenta]') && document.querySelector('[data-barra-estado]').dataset.barraEstado === 'en_linea'" 40000
    $apl = Lista "fert_aplicaciones?select=id,fecha&estacion_id=eq.$estId"
    OK ($t -ge 0 -and $apl.Count -eq 1 -and $apl[0].fecha -eq $hoy) 'Con señal: la aplicación se envía sola y llega una vez' "$t ms"
    $saldoBase = (Lista "fert_saldos?select=disponible&estacion_id=eq.$estId&material_id=eq.$((Lista "materiales?select=id&codigo=eq.$SOL")[0].id)")[0].disponible
    OK ([double]$saldoBase -eq 1380) 'La base cuadra con el teléfono: 1,380 L' $saldoBase

    # Por turno: plan contra aplicado y horas
    ClicHasta "document.querySelector('[data-pestana=turnos]')" "!!document.querySelector('[data-turno=""$TURNO""]')" | Out-Null
    $dia = JS "document.querySelector('[data-dia-turno=""$hoy""]')?.innerText"
    OK ($dia -match 'plan 120' -and $dia -match 'aplicado 120') 'Por turno: plan 120 · aplicado 120' (($dia -split "`n") -join ' · ')
    ClicHasta "document.querySelector('[data-dia-turno=""$hoy""] [data-horas-dia]')" "!!document.querySelector('[data-horas-fert]')" | Out-Null
    Teclear "document.querySelector('[data-horas-fert]')" '2.5'
    Teclear "document.querySelector('[data-horas-riego]')" '6'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    Esperar "!document.querySelector('[data-horas-fert]')" 15000 | Out-Null
    Esperar "!document.querySelector('[data-pendientes-cuenta]')" 30000 | Out-Null
    $bit = Lista "fert_bitacora_riego?select=horas_fertilizacion,horas_riego&estacion_id=eq.$estId"
    OK ($bit.Count -eq 1 -and [double]$bit[0].horas_riego -eq 6 -and [double]$bit[0].horas_fertilizacion -eq 2.5) 'Bitácora de riego: horas de fertilización y de riego'

    # Bitácora (kardex) y devolución del sobrante
    ClicHasta "document.querySelector('[data-pestana=bitacora]')" "!!document.querySelector('[data-movimiento]')" | Out-Null
    $kx = JS "[...document.querySelectorAll('[data-movimiento]')].map(b => b.dataset.movimiento).join(',')"
    OK ($kx -match 'APLICACION' -and $kx -match 'RECEPCION' -and $kx -match 'SALDO_INICIAL') 'Bitácora: saldo inicial, entrega y aplicación con saldo' $kx
    ClicHasta "document.querySelector('[data-movimiento=APLICACION]')" "!!document.querySelector('[data-detalle-documento]')" | Out-Null
    ClicEn "document.querySelector('[data-modo-devolver]')" | Out-Null
    Start-Sleep -Milliseconds 400
    Teclear "document.querySelector('[data-cantidad=""0""]')" '10'
    Teclear "document.querySelector('[data-motivo]')" 'Sobró en el tanque (QA)'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    Esperar "!document.querySelector('[data-detalle-documento]')" 15000 | Out-Null
    Esperar "!document.querySelector('[data-pendientes-cuenta]')" 30000 | Out-Null
    $dev = Lista "fert_devoluciones?select=id&estacion_id=eq.$estId"
    if ($dev.Count -ne 1) { foreach ($x in (Lista "fert_operaciones?select=tipo,resultado,mensaje,datos&perfil_id=eq.$qaId&order=recibido_en.desc&limit=3")) { $script:Resultados.Add("DIAG op $($x.tipo) $($x.resultado) $($x.mensaje) $($x.datos | ConvertTo-Json -Compress -Depth 5)") }; $script:Resultados.Add("DIAG pantalla: $((JS "[...document.querySelectorAll('[role=dialog]')].map(d => d.innerText).join(' ||| ')") -replace "`n", ' / ')"); Captura 'fert_devolucion_diag.png' }
    OK ($dev.Count -eq 1) 'Devolución del sobrante a la bodega'

    # Anular la recepción ya consumida: la base lo rechaza y el teléfono lo explica
    ClicHasta "document.querySelector('[data-movimiento=RECEPCION]')" "!!document.querySelector('[data-detalle-documento]')" | Out-Null
    Teclear "document.querySelector('[data-motivo]')" 'Prueba de rechazo (QA)'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    Esperar "!document.querySelector('[data-detalle-documento]')" 15000 | Out-Null
    $t = Esperar "/rechazado/.test(document.querySelector('[data-barra-estado]')?.innerText || '')" 30000
    OK ($t -ge 0) 'Anular una entrega ya usada: rechazado con el motivo'
    ClicHasta "document.querySelector('[data-pestana=envios]')" "!!document.querySelector('[data-rechazados]')" | Out-Null
    $motivo = JS "document.querySelector('[data-rechazados] li')?.innerText"
    OK ($motivo -match 'saldo') 'Envíos: muestra el motivo del rechazo' (($motivo -split "`n")[1])
    ClicEn "document.querySelector('[data-descartar]')" | Out-Null
    $t = Esperar "!document.querySelector('[data-rechazados]')" 5000
    OK ($t -ge 0) 'Quitar el rechazado de la lista'

    $ancho = JS "document.documentElement.scrollWidth"
    OK ($ancho -le 420) 'Teléfono: sin desplazamiento lateral' "scrollWidth $ancho"
    ClicHasta "document.querySelector('[data-pestana=estacion]')" "!!document.querySelector('[data-saldos]')" | Out-Null
    Captura 'fert_estacion_movil.png'
    $e = Errores-Pagina; OK (-not $e) 'Sin errores en la página' $e
}
catch { $script:Resultados.Add("EXCEPCION $($_.Exception.Message)") }
finally {
    try { CDP 'Network.setBlockedURLs' @{ urls = @() } | Out-Null } catch {}
    if (-not (Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'start -p 3100' })) { Servidor }
    # ---- Limpieza: todo lo de la estación de prueba ----
    try {
        if ($estId) {
            $docs = @{}
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
            Rest "fert_operaciones?perfil_id=eq.$qaId&recibido_en=gte.$((Get-Date).AddHours(-3).ToString('yyyy-MM-ddTHH:mm:ss'))-06:00" 'Delete' -Servicio | Out-Null
            foreach ($c in ($choferes | Select-Object -Unique)) { Rest "fert_choferes_vehiculos?chofer_id=eq.$c" 'Delete' -Servicio | Out-Null; Rest "fert_choferes?id=eq.$c" 'Delete' -Servicio | Out-Null }
            foreach ($v in ($vehiculos | Select-Object -Unique)) { Rest "fert_vehiculos?id=eq.$v" 'Delete' -Servicio | Out-Null }
            Rest "fert_choferes?nombre=eq.$([uri]::EscapeDataString("Chofer QA $s"))" 'Delete' -Servicio | Out-Null
            Rest "fert_vehiculos?placa=eq.QA$s" 'Delete' -Servicio | Out-Null
            $tc = Lista "turnos_ciclo?select=id,turno_id&agl_id=eq.TR-QA-$s"
            foreach ($x in $tc) { Rest "fert_plan?turno_ciclo_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null; Rest "turnos_ciclo?id=eq.$($x.id)" 'Delete' -Servicio | Out-Null; Rest "turnos?id=eq.$($x.turno_id)" 'Delete' -Servicio | Out-Null }
            Rest "perfiles_estaciones?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            Rest "estaciones_riego?id=eq.$estId" 'Delete' -Servicio | Out-Null
        }
        foreach ($c in $SOL, $ACI) { Rest "materiales?codigo=eq.$c" 'Delete' -Servicio | Out-Null }
        Rest "fert_publicaciones?temporada=eq.$([uri]::EscapeDataString("QA $s"))" 'Delete' -Servicio | Out-Null
    } catch { $script:Resultados.Add("LIMPIEZA datos: $($_.Exception.Message) $($_.ErrorDetails.Message)") }
    try { Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = $origRoles; p_principal = $orig.rol_id } -Servicio | Out-Null } catch { $script:Resultados.Add("LIMPIEZA roles QA: $($_.Exception.Message)") }
    try { if ($rolEst) { Rest "permisos?rol_id=eq.$rolEst" 'Delete' -Servicio | Out-Null; Rest "roles?id=eq.$rolEst" 'Delete' -Servicio | Out-Null } } catch { $script:Resultados.Add("LIMPIEZA rol: $($_.Exception.Message)") }
    try {
        $ahora = @(foreach ($x in (Lista 'rpc/fn_roles_de_perfiles' 'Post' @{})) { if ($x.perfil_id -eq $qaId) { [int]$x.rol_id } }) | Sort-Object
        $queda = (Lista "estaciones_riego?select=id&nombre=eq.$([uri]::EscapeDataString($EST))").Count + (Lista "materiales?select=id&codigo=in.($SOL,$ACI)").Count
        OK ((($ahora -join ',') -eq (($origRoles | Sort-Object) -join ',')) -and $queda -eq 0) 'Limpieza: nada de la prueba queda en desarrollo y el usuario QA está como estaba' "roles $($ahora -join ','), restos $queda"
    } catch { $script:Resultados.Add("LIMPIEZA verificación: $($_.Exception.Message)") }
    Terminar-QA
}
