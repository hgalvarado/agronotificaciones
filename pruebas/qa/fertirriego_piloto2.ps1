# QA · Fertirriego · cambios de la segunda prueba piloto (docs/fertirriego-piloto2.md, puntos 1–6; sql/100).
# Copia en :3100 + base de DESARROLLO (con la 100 corrida). El usuario QA cuenta con la calculadora, ve la bodega por
# grupos (Fertilizantes primero), aplica desde CUALQUIER tarjeta de DDT, entrega envases sin producto, filtra la
# bitácora y abre el DETALLE (primero solo «Listo»; Anular / Devolver aparecen al tocarlos). Todo en una estación de
# prueba; al final se borra y el usuario QA queda igual.
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
function CrearEn($selectorJs, $etiqueta, [string[]]$valores) {
    ClicHasta $selectorJs "!!$ULTIMO_DIALOGO.querySelector('input[inputmode=search]')" | Out-Null
    ClicEn "[...$ULTIMO_DIALOGO.querySelectorAll('button')].find(b => b.innerText.includes('$etiqueta'))" | Out-Null
    Start-Sleep -Milliseconds 300
    for ($i = 0; $i -lt $valores.Count; $i++) { if ($valores[$i]) { Teclear "$ULTIMO_DIALOGO.querySelectorAll('input:not([inputmode=search])')[$i]" $valores[$i] } }
    Clic 'Crear y usar' | Out-Null
    Start-Sleep -Milliseconds 500
}
# Fecha en un <input type=date>: setter nativo + evento input (así React recibe el cambio)
function PonerFecha($selectorJs, $valor) {
    JS "(() => { const e = $selectorJs; if (!e) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(e, '$valor'); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true })); return true })()" | Out-Null
    Start-Sleep -Milliseconds 300
}
function SinPendientes([int]$ms = 80000) { Start-Sleep -Milliseconds 1500; Esperar "!document.querySelector('[data-pendientes-cuenta]')" $ms }
function Abrir($estacion, $sufijo) {
    Ir "/fertirriego?r=$s-$sufijo"
    $t = Esperar "!!document.querySelector('[data-barra-estado]') && (!!document.querySelector('[data-estacion]') || !!document.querySelector('[data-selector-estacion]'))" 40000
    if ((JS "document.querySelector('[data-estacion]')?.dataset.estacion") -ne $estacion -and (JS "!!document.querySelector('[data-selector-estacion]')")) {
        ClicHasta "document.querySelector('[data-selector-estacion] button')" "!!$ULTIMO_DIALOGO?.querySelector('input[inputmode=search]')" | Out-Null
        ClicEn "[...$ULTIMO_DIALOGO.querySelectorAll('button')].find(b => b.innerText.trim().startsWith('$estacion'))" | Out-Null
    }
    $t2 = Esperar "document.querySelector('[data-estacion]')?.dataset.estacion === '$estacion'" 15000
    Start-Sleep -Milliseconds 500
    Esperar "!!document.querySelector('[data-actualizar]') && !document.querySelector('[data-actualizar]').disabled" 40000 | Out-Null
    return [Math]::Max($t, $t2)
}
function Dialogo { (JS "${ULTIMO_DIALOGO}?.innerText || ''") -replace "`n", ' / ' }
function Movimientos { JS "[...document.querySelectorAll('[data-movimiento]')].map(b => b.dataset.movimiento).join(',')" }

$s = Get-Random -Maximum 99999
$qaId = $script:QA.id
$orig = (Lista "perfiles?select=rol_id,nombre,todas_las_zonas&id=eq.$qaId")[0]
$origRoles = @(foreach ($x in (Lista 'rpc/fn_roles_de_perfiles' 'Post' @{})) { if ($x.perfil_id -eq $qaId) { [int]$x.rol_id } })
$idAdmin = (Lista 'roles?select=id&acceso_total=eq.true&limit=1')[0].id
$z1 = (Lista 'zonas?select=id,nombre&activo=eq.true&order=nombre&limit=1')[0]
$EST = "QA Piloto2 $s"; $T1 = "TQ1-$s"; $T2 = "TQ2-$s"; $SOL = "QA-SOL2-$s"; $OTRO = "QA-OTR2-$s"
$CHOFER = "Chofer Envases $s"
$hoy = (Get-Date).ToString('yyyy-MM-dd'); $ayer = (Get-Date).AddDays(-1).ToString('yyyy-MM-dd')
$rolEst = $null; $estId = $null

try {
    # ============ Preparación ============
    $rolEst = (Rest 'roles' 'Post' @{ codigo = "QA_ESTP2_$s"; nombre = "QA Estacionero P2 $s" } -Servicio)[0].id
    foreach ($a in 'ver', 'recibir', 'aplicar', 'contar', 'anular') { Rest 'permisos' 'Post' @{ rol_id = $rolEst; recurso = 'fertirriego'; accion = $a; alcance = 'propietario' } -Servicio | Out-Null }
    Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($orig.rol_id, $idAdmin); p_principal = $orig.rol_id } -Servicio | Out-Null
    $estId = (Rest 'estaciones_riego' 'Post' @{ nombre = $EST; zona_id = $z1.id } -Servicio)[0].id
    $siembra = (Get-Date).AddDays(-5).ToString('yyyy-MM-dd')
    $pub = Rest 'rpc/fn_fert_publicar' 'Post' @{ p = @{
        temporada = "QA $s"
        estaciones = @(@{ nombre = $EST; zona = $z1.nombre })
        materiales = @(
            @{ codigo = $SOL; descripcion = "SOLUCION P2 $s"; unidad = 'kg'; grupo = 'Fertilizantes'; analisis = $true },
            @{ codigo = $OTRO; descripcion = "AAA OTRO P2 $s"; unidad = 'L'; grupo = 'Quimicos QA'; analisis = $false })
        turnos = @(
            @{ agl_id = "TR-Q2A-$s"; turno = $T1; temporada = "QA $s"; ciclo = 'Ciclo QA'; fecha_siembra = $siembra; estacion = $EST; zona = $z1.nombre; area_mz = 10; estado = 'Creado' },
            @{ agl_id = "TR-Q2B-$s"; turno = $T2; temporada = "QA $s"; ciclo = 'Ciclo QA'; fecha_siembra = $siembra; estacion = $EST; zona = $z1.nombre; area_mz = 10; estado = 'Creado' })
        plan = @(@{ agl_id = "TR-Q2A-$s"; filas = @(
            @{ fecha = (Get-Date).AddDays(-2).ToString('yyyy-MM-dd'); ddt = 3; material = $SOL; cantidad = 40 },
            @{ fecha = $hoy; ddt = 5; material = $SOL; cantidad = 20 },
            @{ fecha = (Get-Date).AddDays(3).ToString('yyyy-MM-dd'); ddt = 8; material = $SOL; cantidad = 30 }) })
    } }
    Rest 'rpc/fn_fert_asignar_persona' 'Post' @{ p_estacion = $estId; p_perfil = $qaId; p_asignar = $true } | Out-Null
    Rest 'rpc/fn_fert_asignar_custodia' 'Post' @{ p_estacion = $estId; p_perfil = $qaId; p_motivo = 'Arranque QA piloto 2' } | Out-Null
    Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($rolEst); p_principal = $rolEst } -Servicio | Out-Null
    OK ($pub.turnos -eq 2) 'Preparación: estación con 2 turnos, un fertilizante y otro producto'
    CDP 'Browser.grantPermissions' @{ permissions = @('geolocation'); origin = 'http://localhost:3100' } | Out-Null
    CDP 'Emulation.setGeolocationOverride' @{ latitude = 13.312; longitude = -87.195; accuracy = 12 } | Out-Null

    $tok = Entrar-Como $script:QA.email $script:QA.clave
    $t = Abrir $EST 'a1'
    OK ($t -ge 0) 'Abre su estación' "$t ms"

    # ============ Punto 6 + 5: Conteo con calculadora, agrupado ============
    ClicHasta "document.querySelector('[data-accion=contar]')" "!!document.querySelector('[data-conteo]')" | Out-Null
    ClicHasta "document.querySelector('[data-conteo-material=""$SOL""] [data-calculadora]')" "!!document.querySelector('[data-hoja-calculadora]')" | Out-Null
    Teclear "document.querySelector('[data-calc-bultos]')" '4'
    ClicEn "document.querySelector('[data-peso-bulto=""12.5""]')" | Out-Null
    $res = JS "document.querySelector('[data-calc-resultado]')?.dataset.calcResultado"
    OK ($res -eq '50') 'Calculadora: 4 bultos × 12.5 kg = 50' $res
    ClicEn "document.querySelector('[data-usar-resultado]')" | Out-Null
    Esperar "!document.querySelector('[data-hoja-calculadora]')" 3000 | Out-Null
    OK ((JS "document.querySelector('[data-conteo-material=""$SOL""] input')?.value") -eq '50') '«Usar resultado» pone 50 en el campo' (JS "document.querySelector('[data-conteo-material=""$SOL""] input')?.value")
    # Calculadora simple: 2 × 5 = 10 en el otro producto (lo agrega desde «Contar otro producto» si no está)
    if (-not (JS "!!document.querySelector('[data-conteo-material=""$OTRO""]')")) {
        ClicHasta "[...document.querySelectorAll('[role=dialog] button')].find(b => b.innerText.includes('Agregar producto'))" "!!$ULTIMO_DIALOGO.querySelector('input[inputmode=search]')" | Out-Null
        ClicEn "[...$ULTIMO_DIALOGO.querySelectorAll('button')].find(b => b.innerText.trim().startsWith('AAA OTRO P2 $s'))" | Out-Null
        Esperar "!!document.querySelector('[data-conteo-material=""$OTRO""]')" 4000 | Out-Null
    }
    $gruposConteo = JS "[...document.querySelectorAll('[data-grupo-conteo]')].map(g => g.dataset.grupoConteo).join('|')"
    OK ($gruposConteo -match '^Fertilizantes\|') 'Conteo: Fertilizantes primero (y después los demás grupos)' $gruposConteo
    ClicHasta "document.querySelector('[data-conteo-material=""$OTRO""] [data-calculadora]')" "!!document.querySelector('[data-hoja-calculadora]')" | Out-Null
    ClicEn "document.querySelector('[data-modo-calculadora=calculadora]')" | Out-Null
    foreach ($k in '2', '×', '5') { ClicEn "document.querySelector('[data-tecla=""$k""]')" | Out-Null }
    OK ((JS "document.querySelector('[data-calc-resultado]')?.dataset.calcResultado") -eq '10') 'Calculadora simple: 2 × 5 = 10'
    ClicEn "document.querySelector('[data-usar-resultado]')" | Out-Null
    Start-Sleep -Milliseconds 300
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    Esperar "!document.querySelector('[data-conteo]')" 15000 | Out-Null
    $t = SinPendientes
    $sal = Lista "fert_saldos?select=material_id,disponible&estacion_id=eq.$estId"
    OK ($t -ge 0 -and $sal.Count -eq 2) 'La base: conteo con los dos productos' ($sal | ConvertTo-Json -Compress)
    $gruposBodega = JS "[...document.querySelectorAll('[data-grupo-bodega]')].map(g => g.dataset.grupoBodega).join('|')"
    OK ($gruposBodega -match '^Fertilizantes\|') 'Bodega: por grupos, Fertilizantes primero y destacados' $gruposBodega

    # ============ Punto 5: selector de productos con Fertilizantes destacado ============
    ClicHasta "document.querySelector('[data-accion=recibir]')" "!!document.querySelector('[data-lineas]')" | Out-Null
    ClicEn "document.querySelector('[data-agregar-linea]')" | Out-Null
    Start-Sleep -Milliseconds 300
    ClicHasta "[...document.querySelectorAll('[data-linea]')].pop().querySelector('button')" "!!$ULTIMO_DIALOGO.querySelector('input[inputmode=search]')" | Out-Null
    $primer = JS "$ULTIMO_DIALOGO.querySelector('[data-grupo-opciones]')?.dataset.grupoOpciones"
    OK ($primer -eq 'Fertilizantes' -and (JS "!!$ULTIMO_DIALOGO.querySelector('[data-grupo-destacado]')") -eq $true) 'Selector: el grupo Fertilizantes va primero y resaltado' $primer
    JS "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))" | Out-Null
    Start-Sleep -Milliseconds 400
    if (JS "!!document.querySelector('[data-lineas]')") { ClicEn "document.querySelector('[data-cancelar-registro]')" | Out-Null }
    Esperar "!document.querySelector('[data-lineas]')" 4000 | Out-Null
    # El borrador de esta recepción no debe quedar marcado como registro
    ClicEn "document.querySelector('[data-accion=recibir]')" | Out-Null
    Start-Sleep -Milliseconds 500
    ClicEn "document.querySelector('[data-descartar-borrador]')" | Out-Null
    if (JS "!!document.querySelector('[data-lineas]')") { ClicEn "document.querySelector('[data-cancelar-registro]')" | Out-Null }

    # ============ Punto 1: Aplicar y Horas en TODAS las tarjetas ============
    ClicHasta "document.querySelector('[data-pestana=turnos]')" "!!document.querySelector('[data-turno=""$T1""]')" | Out-Null
    ClicHasta "document.querySelector('[data-turno=""$T1""] button[aria-expanded]')" "!!document.querySelector('[data-turno=""$T1""] [data-tarjeta-ddt]')" | Out-Null
    $tarjetas = [int](JS "document.querySelectorAll('[data-turno=""$T1""] [data-tarjeta-ddt]').length")
    $conAplicar = [int](JS "[...document.querySelectorAll('[data-turno=""$T1""] [data-tarjeta-ddt]')].filter(c => c.querySelector('[data-aplicar-dia]') && c.querySelector('[data-horas-dia]')).length")
    $alto = [int](JS "Math.min(...[...document.querySelectorAll('[data-turno=""$T1""] [data-aplicar-dia], [data-turno=""$T1""] [data-horas-dia]')].map(b => b.getBoundingClientRect().height))")
    OK ($tarjetas -ge 3 -and $conAplicar -eq $tarjetas -and $alto -ge 44) 'Turno: Aplicar y Horas en cada tarjeta (también la futura), botones de dedo (≥ 44 px)' "$conAplicar de $tarjetas tarjetas · alto $alto px"
    # La tarjeta futura (DDT 8) abre Aplicar con ese DDT ya elegido y el día de hoy
    ClicHasta "document.querySelector('[data-turno=""$T1""] [data-tarjeta-ddt=""8""] [data-aplicar-dia]')" "!!document.querySelector('[data-selector-turno]')" | Out-Null
    $t = Esperar "!!document.querySelector('[data-ddt-chip=""8""][aria-pressed=true]')" 5000
    OK ($t -ge 0) 'Aplicar desde la tarjeta futura: DDT 8 ya elegido (día = hoy)' (Dialogo)
    ClicEn "document.querySelector('[data-cancelar-registro]')" | Out-Null
    Esperar "!document.querySelector('[data-selector-turno]')" 4000 | Out-Null
    # Aplicar el DDT de hoy desde su tarjeta
    ClicHasta "document.querySelector('[data-turno=""$T1""] [data-tarjeta-ddt=""5""] [data-aplicar-dia]')" "!!document.querySelector('[data-ddt-chip=""5""][aria-pressed=true]')" | Out-Null
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    Esperar "!document.querySelector('[data-selector-turno]')" 15000 | Out-Null
    SinPendientes | Out-Null
    $apl = Lista "fert_aplicaciones?select=id,ddt_plan&estacion_id=eq.$estId"
    OK ($apl.Count -eq 1 -and $apl[0].ddt_plan -eq 5) 'Aplicación desde la tarjeta: DDT plan 5' ($apl | ConvertTo-Json -Compress)

    # ============ Punto 4: Envases sin producto ============
    ClicHasta "document.querySelector('[data-pestana=estacion]')" "!!document.querySelector('[data-accion=envases]')" | Out-Null
    ClicHasta "document.querySelector('[data-accion=envases]')" "!!document.querySelector('[data-form-envases]')" | Out-Null
    $orden = JS "[...document.querySelectorAll('[data-envase=Barril] input')].map(i => i.hasAttribute('data-envase-entregados') ? 'E' : 'R').join('')"
    OK ($orden -eq 'ER') 'Envases: primero «Entregados (vacíos que se llevan)», luego «Recibidos»' $orden
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    OK ((Dialogo) -match 'chofer') 'Sin chofer no deja guardar (es obligatorio)'
    CrearEn "document.querySelector('[data-selector-chofer] button')" 'Agregar chofer' @($CHOFER, '9999-1111')
    Teclear "document.querySelector('[data-envase=Barril] [data-envase-entregados]')" '4'
    Teclear "document.querySelector('[data-envase=Barril] [data-envase-recibidos]')" '1'
    Teclear "document.querySelector('[data-comentario-envases]')" 'Se llevó 4 vacíos (QA)'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    $t = Esperar "!document.querySelector('[data-form-envases]')" 15000
    OK ($t -ge 0 -and $t -lt 3000) 'Guardado rápido de envases' "$t ms $(if ($t -lt 0) { Dialogo })"
    SinPendientes | Out-Null
    $rec = Lista "fert_recepciones?select=id,chofer_id,comentario&estacion_id=eq.$estId"
    $envMov = Lista "fert_envases_movimientos?select=cantidad,motivo&estacion_id=eq.$estId"
    $det = if ($rec.Count) { Lista "fert_recepciones_detalle?select=id&recepcion_id=eq.$($rec[0].id)" } else { @() }
    OK ($rec.Count -eq 1 -and $det.Count -eq 0 -and ($envMov | Where-Object { $_.cantidad -eq -4 }) -and ($envMov | Where-Object { $_.cantidad -eq 1 })) 'La base: recepción SIN productos con 4 entregados y 1 recibido' "rec $($rec.Count) · lineas $($det.Count) · $($envMov | ConvertTo-Json -Compress)"
    $ops = Lista "fert_operaciones?select=datos&perfil_id=eq.$qaId&tipo=eq.recepcion&order=recibido_en.desc&limit=1"
    OK ($ops.Count -eq 1 -and $ops[0].datos.solo_envases -eq $true) 'Se manda solo_envases = true' ''

    # ============ Punto 3: Bitácora con nombre y filtros ============
    ClicHasta "document.querySelector('[data-pestana=bitacora]')" "!!document.querySelector('[data-movimiento]')" | Out-Null
    $mv = Movimientos
    OK ($mv -match 'ENVASE' -and $mv -match 'APLICACION' -and $mv -match 'AJUSTE_CONTEO|SALDO_INICIAL') 'Bitácora: productos y envases en la misma lista' $mv
    $quien = JS "document.querySelector('[data-movimiento] [data-quien-movimiento]')?.textContent || ''"
    OK ($quien -eq $orig.nombre) 'Cada movimiento dice quién lo hizo' "«$quien» (esperado «$($orig.nombre)»)"
    ClicHasta "document.querySelector('[data-filtros-bitacora]')" "!!document.querySelector('[data-panel-filtros]')" | Out-Null
    ClicEn "document.querySelector('[data-interruptor=cantidad] [data-opcion=exacta]')" | Out-Null
    Teclear "document.querySelector('[data-filtro-cantidad-exacta]')" '4'
    Start-Sleep -Milliseconds 300
    $mv = Movimientos
    OK ($mv -eq 'ENVASE') 'Filtro cantidad exacta 4: solo los 4 envases entregados' $mv
    ClicEn "document.querySelector('[data-limpiar-filtros]')" | Out-Null
    Start-Sleep -Milliseconds 300
    PonerFecha "document.querySelector('[data-filtro-dia]')" $ayer
    $vacio = JS "document.querySelectorAll('[data-movimiento]').length"
    PonerFecha "document.querySelector('[data-filtro-dia]')" $hoy
    $deHoy = JS "document.querySelectorAll('[data-movimiento]').length"
    OK ($vacio -eq 0 -and $deHoy -gt 0) 'Filtro por día: ayer nada, hoy todo (hora de Honduras)' "ayer $vacio · hoy $deHoy"
    ClicEn "document.querySelector('[data-interruptor=fecha] [data-opcion=rango]')" | Out-Null
    PonerFecha "document.querySelector('[data-filtro-desde]')" $ayer
    PonerFecha "document.querySelector('[data-filtro-hasta]')" $hoy
    OK ((JS "document.querySelectorAll('[data-movimiento]').length") -eq $deHoy) 'Filtro por rango (ayer–hoy)'
    ClicEn "document.querySelector('[data-limpiar-filtros]')" | Out-Null
    # Turno (selector con buscador y modo único/varios)
    ClicHasta "document.querySelector('[data-filtro-turno] button')" "[...document.querySelectorAll('button, [role=option]')].some(b => b.innerText?.trim() === '$T2')" | Out-Null
    ClicEn "[...document.querySelectorAll('button, [role=option]')].filter(b => b.innerText?.trim() === '$T2').pop()" | Out-Null
    Start-Sleep -Milliseconds 400
    JS "document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))" | Out-Null
    $mv = Movimientos
    OK (-not ($mv -match 'APLICACION')) 'Filtro por turno: la aplicación del otro turno no sale' "«$mv»"
    ClicEn "document.querySelector('[data-limpiar-filtros]')" | Out-Null
    Start-Sleep -Milliseconds 300
    $ancho = JS "document.documentElement.scrollWidth"
    OK ($ancho -le 420) 'Teléfono: bitácora con filtros sin desplazamiento lateral' "scrollWidth $ancho"
    Captura 'piloto2_bitacora.png'

    # ============ Punto 2: el DETALLE primero ============
    ClicHasta "document.querySelector('[data-movimiento=ENVASE]')" "!!document.querySelector('[data-detalle-documento]')" | Out-Null
    OK ((JS "!!document.querySelector('[data-listo-detalle]') && !document.querySelector('[data-guardar-registro]') && !document.querySelector('[data-motivo]')") -eq $true) 'Detalle: el pie dice solo «Listo» (sin motivo ni Guardar)' (Dialogo)
    $choferDet = JS "document.querySelector('[data-detalle-chofer]')?.textContent || ''"
    $envDet = JS "document.querySelector('[data-detalle-envases]')?.textContent || ''"
    OK ($choferDet -eq $CHOFER -and $envDet -match 'Barril' -and (JS "!!document.querySelector('[data-detalle-quien]')") -eq $true) 'Detalle de envases: chofer, quién y los barriles' "$choferDet · $envDet"
    OK ((JS "document.querySelector('[data-detalle-operacion]')?.textContent || ''") -match 'con GPS') 'Detalle: datos de la operación (100) con la ubicación' (JS "document.querySelector('[data-detalle-operacion]')?.textContent || 'sin operacion'")
    Captura 'piloto2_detalle.png'
    ClicHasta "document.querySelector('[data-modo-anular]')" "!!document.querySelector('[data-motivo]')" | Out-Null
    OK ((JS "!!document.querySelector('[data-guardar-registro]') && !document.querySelector('[data-listo-detalle]')") -eq $true) 'Al tocar «Anular» aparecen el motivo y el botón'
    ClicEn "document.querySelector('[data-cancelar-registro]')" | Out-Null
    $t = Esperar "!!document.querySelector('[data-listo-detalle]') && !document.querySelector('[data-motivo]')" 3000
    OK ($t -ge 0) '«Volver» deja otra vez solo el detalle'
    ClicEn "document.querySelector('[data-listo-detalle]')" | Out-Null
    Esperar "!document.querySelector('[data-detalle-documento]')" 4000 | Out-Null
    # Aplicación: DDT y «Devolver sobrante»
    ClicHasta "document.querySelector('[data-movimiento=APLICACION]')" "!!document.querySelector('[data-detalle-documento]')" | Out-Null
    $ddt = JS "document.querySelector('[data-detalle-ddt]')?.textContent || ''"
    OK ($ddt -match 'Plan 5' -and (JS "!!document.querySelector('[data-modo-devolver]')") -eq $true) 'Detalle de aplicación: DDT plan 5 y «Devolver sobrante»' $ddt
    ClicHasta "document.querySelector('[data-modo-devolver]')" "!!document.querySelector('[data-motivo]')" | Out-Null
    OK ((JS "!!document.querySelector('[data-lineas] [data-calculadora]')") -eq $true) 'Devolver: las cantidades traen su calculadora'
    ClicEn "document.querySelector('[data-cancelar-registro]')" | Out-Null
    Start-Sleep -Milliseconds 300
    ClicEn "document.querySelector('[data-listo-detalle]')" | Out-Null
    $e = Errores-Pagina; OK (-not $e) 'Sin errores en la página' $e
}
catch { $script:Resultados.Add("EXCEPCION $($_.Exception.Message) $($_.ErrorDetails.Message)") }
finally {
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
            Rest "fert_operaciones?perfil_id=eq.$qaId&recibido_en=gte.$desde" 'Delete' -Servicio | Out-Null
            foreach ($c in (Lista "fert_choferes?select=id&nombre=eq.$([uri]::EscapeDataString($CHOFER))")) { Rest "fert_choferes_vehiculos?chofer_id=eq.$($c.id)" 'Delete' -Servicio | Out-Null; Rest "fert_choferes?id=eq.$($c.id)" 'Delete' -Servicio | Out-Null }
            foreach ($x in (Lista "turnos_ciclo?select=id,turno_id&agl_id=in.(TR-Q2A-$s,TR-Q2B-$s)")) { Rest "fert_plan?turno_ciclo_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null; Rest "turnos_ciclo?id=eq.$($x.id)" 'Delete' -Servicio | Out-Null; Rest "turnos?id=eq.$($x.turno_id)" 'Delete' -Servicio | Out-Null }
            Rest "perfiles_estaciones?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            Rest "estaciones_riego?id=eq.$estId" 'Delete' -Servicio | Out-Null
        }
        Rest "materiales?codigo=in.($SOL,$OTRO)" 'Delete' -Servicio | Out-Null
        Rest "fert_publicaciones?temporada=eq.$([uri]::EscapeDataString("QA $s"))" 'Delete' -Servicio | Out-Null
    } catch { $script:Resultados.Add("LIMPIEZA datos: $($_.Exception.Message) $($_.ErrorDetails.Message)") }
    try { Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = $origRoles; p_principal = $orig.rol_id } -Servicio | Out-Null } catch { $script:Resultados.Add("LIMPIEZA roles QA: $($_.Exception.Message)") }
    try { if ($rolEst) { Rest "permisos?rol_id=eq.$rolEst" 'Delete' -Servicio | Out-Null; Rest "roles?id=eq.$rolEst" 'Delete' -Servicio | Out-Null } } catch { $script:Resultados.Add("LIMPIEZA rol: $($_.Exception.Message) $($_.ErrorDetails.Message)") }
    try {
        $ahora = @(foreach ($x in (Lista 'rpc/fn_roles_de_perfiles' 'Post' @{})) { if ($x.perfil_id -eq $qaId) { [int]$x.rol_id } }) | Sort-Object
        $queda = (Lista "estaciones_riego?select=id&nombre=eq.$([uri]::EscapeDataString($EST))").Count + (Lista "materiales?select=id&codigo=in.($SOL,$OTRO)").Count
        OK ((($ahora -join ',') -eq (($origRoles | Sort-Object) -join ',')) -and $queda -eq 0) 'Limpieza: nada de la prueba queda en desarrollo y el usuario QA está como estaba' "roles $($ahora -join ','), restos $queda"
    } catch { $script:Resultados.Add("LIMPIEZA verificación: $($_.Exception.Message)") }
    Terminar-QA
}
