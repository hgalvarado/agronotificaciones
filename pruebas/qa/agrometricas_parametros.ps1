# QA · AgroMétricas parte 1 (Parámetros de riego) y el % de fertilización de Fertirriego › Horas, a ancho de teléfono.
# Copia de la app (next start) + base de DESARROLLO. Crea un usuario QA TEMPORAL (rol con acceso total, todas las zonas),
# una estación y un turno de prueba en «Zona 3C» (sin clima registrado) y un rango de pH; al final borra TODO por id
# exacto (incluido el usuario) y lo verifica.
# Uso: powershell -ExecutionPolicy Bypass -File pruebas/qa/agrometricas_parametros.ps1 -Base http://localhost:3101
param([string]$Base = 'http://localhost:3101')
. "$PSScriptRoot\comun.ps1"

# ---------------------------------------------------------------- usuario QA temporal (antes de abrir el navegador)
$envQa = Leer-Entorno
$URLB = $envQa['NEXT_PUBLIC_SUPABASE_URL']; $SERV = $envQa['SUPABASE_SERVICE_ROLE_KEY']
$hServ = @{ apikey = $SERV; Authorization = "Bearer $SERV" }
$sufijo = Get-Random -Maximum 99999
$qaEmail = "qa.agm.$([guid]::NewGuid().ToString('N').Substring(0,10))@desarrollo.local"; $qaClave = "Qa-$(Get-Random)-x$(Get-Random)"
$archivoQa = "$PSScriptRoot\qa_usuario.local.json"
$qaId = $null
$usr = Invoke-RestMethod -Method Post -Uri "$URLB/auth/v1/admin/users" -Headers $hServ -ContentType 'application/json' -Body (@{ email = $qaEmail; password = $qaClave; email_confirm = $true } | ConvertTo-Json)
$qaId = $usr.id
$rolTotal = (Invoke-RestMethod "$URLB/rest/v1/roles?select=id&acceso_total=eq.true&order=id&limit=1" -Headers $hServ)[0].id
Invoke-RestMethod -Method Post "$URLB/rest/v1/perfiles" -Headers $hServ -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes((@{ id = $qaId; nombre = "QA AgroMétricas $sufijo"; rol_id = $rolTotal; todas_las_zonas = $true } | ConvertTo-Json))) | Out-Null
@{ id = $qaId; email = $qaEmail; clave = $qaClave } | ConvertTo-Json | Set-Content -Encoding utf8 $archivoQa

Iniciar-QA -Base $Base -Ancho 412 -Alto 915 -Movil

function Lista($ruta, $metodo = 'Get', $cuerpo = $null) {
    $r = Rest $ruta $metodo $cuerpo -Servicio
    $o = New-Object System.Collections.ArrayList; foreach ($x in $r) { if ($null -ne $x) { [void]$o.Add($x) } }; return ,$o
}
function ClicEn($js) { JS "(() => { const e = $js; if (!e) return false; e.scrollIntoView({block:'center'}); e.click(); return true })()" }
function ClicHasta($js, $condicion, [int]$veces = 15) { for ($i = 0; $i -lt $veces; $i++) { ClicEn $js | Out-Null; if ((Esperar $condicion 700) -ge 0) { return $true } }; return $false }
$ULTIMO_DIALOGO = "[...document.querySelectorAll('[role=dialog]')].pop()"
function ElegirOpcion($selectorJs, $texto) {
    ClicHasta $selectorJs "document.querySelectorAll('[role=dialog]').length > 0 && !!$ULTIMO_DIALOGO.querySelector('input[inputmode=search]')" | Out-Null
    Teclear "$ULTIMO_DIALOGO.querySelector('input[inputmode=search]')" $texto
    Start-Sleep -Milliseconds 300
    $ok = ClicEn "[...$ULTIMO_DIALOGO.querySelectorAll('button')].find(b => b.innerText.trim().startsWith('$texto'))"
    Start-Sleep -Milliseconds 400
    return $ok
}
function Aviso { JS "document.querySelector('[data-aviso-flotante]')?.textContent || ''" }
function EsperarAviso($texto, [int]$ms = 15000) { Esperar "(document.querySelector('[data-aviso-flotante]')?.textContent || '').includes('$texto')" $ms }
function Cola { JS "document.querySelector('[data-estado-cola]')?.textContent || ''" }
function Campo($clave) { "document.querySelector('[data-campo=$clave]')" }
function AbrirSeccion($titulo) { ClicHasta "[...document.querySelectorAll('button')].find(b => b.textContent.includes('$titulo'))" "!!document.querySelector('[data-campo]') && [...document.querySelectorAll('button[aria-expanded=true]')].some(b => b.textContent.includes('$titulo'))" 5 | Out-Null }
function Abrir-Parametros {
    Ir "/agrometricas/parametros?r=$(Get-Random)"
    $t = Esperar "!!document.querySelector('[data-guardar]') && [...document.querySelectorAll('button')].some(b => b.textContent.includes('Elige el turno') || b.textContent.includes('$T1'))" 40000
    Start-Sleep -Milliseconds 800
    return $t
}
function Elegir-Turno { ElegirOpcion "[...document.querySelectorAll('button')].find(b => b.textContent.includes('Elige el turno') || b.textContent.trim().startsWith('$T1'))" $T1 | Out-Null; Esperar "!!document.querySelector('[data-ddt]')" 10000 | Out-Null }

$tz = [TimeZoneInfo]::FindSystemTimeZoneById('Central America Standard Time')
$hoyHn = [TimeZoneInfo]::ConvertTimeFromUtc((Get-Date).ToUniversalTime(), $tz).Date
$HOY = $hoyHn.ToString('yyyy-MM-dd'); $AYER = $hoyHn.AddDays(-1).ToString('yyyy-MM-dd')
$SIEMBRA = $hoyHn.AddDays(-20).ToString('yyyy-MM-dd')
$EST = "QA AGM $sufijo"; $T1 = "TAGM-$sufijo"; $AGLID = "TR-AGM-$sufijo"; $SOL = "QA-SOLAGM-$sufijo"; $TEMP = "QA AGM $sufijo"
$z = (Lista "zonas?select=id,nombre&nombre=eq.$([uri]::EscapeDataString('Zona 3C'))")[0]
$estId = $null; $tcId = $null; $rangoCreado = $false
$foto = Join-Path $env:TEMP "qa_calicata_$sufijo.jpg"

try {
    # ============ Preparación ============
    OK ((Lista "agm_clima?select=id&zona_id=eq.$($z.id)&fecha=in.($HOY,$AYER)").Count -eq 0) 'Preparación: Zona 3C sin clima hoy ni ayer (la prueba no pisa datos de nadie)'
    if ((Lista 'agm_rangos?select=parametro&parametro=eq.ph_agua').Count -eq 0) {
        Rest 'agm_rangos' 'Post' @{ parametro = 'ph_agua'; nombre = 'pH agua'; minimo = 5; maximo = 9 } -Servicio | Out-Null; $rangoCreado = $true
    }
    $pub = Rest 'rpc/fn_fert_publicar' 'Post' @{ p = @{
        temporada = $TEMP
        estaciones = @(@{ nombre = $EST; zona = $z.nombre })
        materiales = @(@{ codigo = $SOL; descripcion = "SOLUCION AGM $sufijo"; unidad = 'L'; grupo = 'Fertilizantes'; analisis = $true })
        turnos = @(@{ agl_id = $AGLID; turno = $T1; temporada = $TEMP; ciclo = 'Ciclo QA'; fecha_siembra = $SIEMBRA; estacion = $EST; zona = $z.nombre; area_mz = 10; estado = 'Creado' })
        plan = @(@{ agl_id = $AGLID; filas = @(@{ fecha = $HOY; ddt = 20; material = $SOL; cantidad = 50 }) })
    } }
    $estId = (Lista "estaciones_riego?select=id&nombre=eq.$([uri]::EscapeDataString($EST))")[0].id
    $tcId = (Lista "turnos_ciclo?select=id&agl_id=eq.$AGLID")[0].id
    Rest 'rpc/fn_fert_asignar_persona' 'Post' @{ p_estacion = $estId; p_perfil = $qaId; p_asignar = $true } | Out-Null
    OK ($pub.turnos -eq 1 -and $tcId) 'Preparación: estación y turno de prueba publicados como AGL' "siembra $SIEMBRA"
    CDP 'Browser.grantPermissions' @{ permissions = @('geolocation'); origin = $Base } | Out-Null
    CDP 'Emulation.setGeolocationOverride' @{ latitude = 13.4087123; longitude = -87.5359456; accuracy = 3 } | Out-Null

    # ============ Menú y portada de AgroMétricas ============
    Ir '/agrometricas'
    $t = Esperar "[...document.querySelectorAll('h1')].some(h => h.textContent.trim() === 'AgroMétricas') && !!document.querySelector('a[href=""/agrometricas/parametros""]')" 40000
    if ($t -lt 0) { Ir '/agrometricas'; $t = Esperar "!!document.querySelector('a[href=""/agrometricas/parametros""]')" 40000 }   # arranque en frío
    OK ($t -ge 0) 'Portada /agrometricas con el botón «Parámetros de riego»' "$t ms"
    $menu = JS "[...document.querySelectorAll('a[href=""/agrometricas""]')].map(a => a.textContent.trim()).filter(Boolean).join(' | ')"
    OK ($menu -ne '') 'El menú tiene la entrada de AgroMétricas (pantallas.en_menu)' $menu
    $alto = JS "Math.round(document.querySelector('a[href=""/agrometricas/parametros""]').getBoundingClientRect().height)"
    OK ([int]$alto -ge 44) 'Botón grande para el dedo (≥ 44 px)' "$alto px"
    $prox = JS "[...document.querySelectorAll('[aria-disabled=true]')].length"
    OK ([int]$prox -ge 1) 'Las partes que faltan salen como «Próximamente» (sin enlace)' "$prox"
    $anchoDoc = JS "document.documentElement.scrollWidth"
    OK ([int]$anchoDoc -le 412) 'Sin desplazamiento horizontal a 412 px' "$anchoDoc px"
    Captura 'agm_portada.png'

    ClicHasta "document.querySelector('a[href=""/agrometricas/parametros""]')" "!!document.querySelector('[data-guardar]')" 10 | Out-Null
    $t = Esperar "!!document.querySelector('[data-guardar]') && [...document.querySelectorAll('button')].some(b => b.textContent.includes('Elige el turno'))" 40000
    OK ($t -ge 0) 'Abre Parámetros de riego desde la portada' "$t ms"
    Start-Sleep -Milliseconds 800

    # ============ Jornada: Hoy / Ayer / otra fecha ============
    $fechaVal = JS "document.querySelector('input[type=date]').value"
    OK ($fechaVal -eq $HOY) 'La jornada empieza en hoy (hora de Honduras)' $fechaVal
    ClicHasta "[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Ayer')" "document.querySelector('input[type=date]').value === '$AYER'" 5 | Out-Null
    OK ((JS "document.querySelector('input[type=date]').value") -eq $AYER) 'Botón «Ayer» cambia la jornada'
    ClicHasta "[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Hoy')" "document.querySelector('input[type=date]').value === '$HOY'" 5 | Out-Null
    OK ((JS "document.querySelector('input[type=date]').max") -eq $HOY) 'No deja elegir días futuros (máx. = hoy)'

    # ============ Turno con búsqueda y DDT ============
    Elegir-Turno
    $ddt = JS "document.querySelector('[data-ddt]')?.textContent || ''"
    OK ($ddt -match 'DDT 20' -and $ddt -match [regex]::Escape($EST)) 'Turno elegido con búsqueda: DDT calculado (20) y su estación' $ddt

    # ============ Lecturas, fuera de rango y «Usar 7.97» ============
    Teclear (Campo 'tensiometro_12_am') '15'
    AbrirSeccion 'Agua y solución'
    Teclear (Campo 'ph_agua') '797'
    $t = Esperar "[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Usar 7.97')" 5000
    $msg = JS "document.body.textContent.includes('¿Quisiste decir 7.97?')"
    OK ($t -ge 0 -and $msg) 'pH 797 fuera de rango: avisa «¿Quisiste decir 7.97?» con botón «Usar 7.97»'
    $fueraAcordeon = JS "[...document.querySelectorAll('button[aria-expanded]')].find(b => b.textContent.includes('Agua y solución'))?.textContent.includes('Revisar datos')"
    OK ($fueraAcordeon -and -not (JS "document.querySelector('[data-guardar]').disabled")) 'La sección avisa «Revisar datos» y no bloquea Guardar'
    ClicEn "[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Usar 7.97')" | Out-Null
    Start-Sleep -Milliseconds 300
    OK ((JS "$(Campo 'ph_agua').value") -eq '7.97' -and -not (JS "[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Usar 7.97')")) '«Usar 7.97» corrige el campo y el aviso se va'

    # ============ Calicata con GPS (precisión) y foto ============
    ClicEn "[...document.querySelectorAll('button')].find(b => b.textContent.includes('Ubicar calicata con GPS'))" | Out-Null
    $t = EsperarAviso 'Calicata ubicada' 20000
    OK ($t -ge 0 -and (JS "document.querySelector('[data-calicata]').textContent.includes('13.408712')")) 'Calicata ubicada con GPS: aviso flotante con la precisión y la ubicación en pantalla' (Aviso)
    Add-Type -AssemblyName System.Drawing
    $bmp = New-Object System.Drawing.Bitmap 1600, 1200; $g = [System.Drawing.Graphics]::FromImage($bmp); $g.Clear([System.Drawing.Color]::SaddleBrown); $g.Dispose()
    $bmp.Save($foto, [System.Drawing.Imaging.ImageFormat]::Jpeg); $bmp.Dispose()
    $obj = CDP 'Runtime.evaluate' @{ expression = "document.querySelector('[data-foto]')" }
    CDP 'DOM.enable' | Out-Null
    CDP 'DOM.setFileInputFiles' @{ files = @($foto); objectId = $obj.result.result.objectId } | Out-Null
    $t = Esperar "document.querySelector('[data-calicata]').textContent.includes('Foto lista') && !!document.querySelector('[data-calicata] img')" 10000
    OK ($t -ge 0) 'Foto de la calicata: se comprime y se ve la vista previa' "$t ms"

    # ============ Clima del día por zona ============
    AbrirSeccion 'Clima del día'
    Teclear (Campo 'eto') '4.5'
    Captura 'agm_formulario.png'

    # ============ Guardar (con señal) ============
    ClicEn "document.querySelector('[data-guardar]')" | Out-Null
    $t = EsperarAviso 'Registrado' 5000
    OK ($t -ge 0) 'Guardar: aviso flotante «Registrado…» (se ve abajo, sobre el botón)' (Aviso)
    $t = Esperar "(document.querySelector('[data-estado-cola]')?.textContent || '') === 'Todo enviado'" 40000
    OK ($t -ge 0) 'La cola queda en «Todo enviado»' (Cola)
    Start-Sleep -Milliseconds 800
    $fila = (Lista "agm_parametros?select=*&turno_ciclo_id=eq.$tcId&fecha=eq.$HOY")
    OK ($fila.Count -eq 1 -and [double]$fila[0].tensiometro_12_am -eq 15 -and [double]$fila[0].ph_agua -eq 7.97 -and $fila[0].ddt -eq 20 -and @($fila[0].fuera_rango).Count -eq 0 -and $fila[0].foto_calicata) 'La base: tensiómetro 15, pH 7.97, DDT 20, sin fuera de rango y con la ruta de la foto' (($fila | Select-Object tensiometro_12_am, ph_agua, ddt, fuera_rango, foto_calicata) | ConvertTo-Json -Compress)
    $clima = Lista "agm_clima?select=*&zona_id=eq.$($z.id)&fecha=eq.$HOY"
    OK ($clima.Count -eq 1 -and [double]$clima[0].eto -eq 4.5) 'La base: clima de la zona del turno (ETo 4.5) una vez por día'
    $cal = Lista "agm_calicatas?select=*&turno_ciclo_id=eq.$tcId"
    OK ($cal.Count -eq 1 -and [double]$cal[0].precision_m -eq 3) 'La base: calicata del ciclo con su precisión (±3 m)' ($cal | ConvertTo-Json -Compress)
    $rutaFoto = "$($fila[0].foto_calicata)"
    $carpeta = $rutaFoto.Substring(0, $rutaFoto.LastIndexOf('/'))
    $objs = Invoke-RestMethod -Method Post "$URLB/storage/v1/object/list/agrometricas" -Headers $hServ -ContentType 'application/json' -Body (@{ prefix = $carpeta; limit = 10 } | ConvertTo-Json)
    $tam = @($objs | Where-Object { "$carpeta/$($_.name)" -eq $rutaFoto })[0].metadata.size
    OK ($tam -gt 0 -and $tam -lt 400000) 'Storage: la foto subió al bucket privado y comprimida' "$tam bytes"

    # ============ Lo ya registrado se carga y se edita (sin borrar) ============
    Abrir-Parametros | Out-Null
    Elegir-Turno
    $t = Esperar "document.body.textContent.includes('Ya registrado: se puede editar') && $(Campo 'tensiometro_12_am').value === '15'" 15000
    OK ($t -ge 0) 'Al volver: «Ya registrado: se puede editar» y el valor guardado en el campo'
    OK ((JS "document.querySelector('[data-calicata]').textContent.includes('Foto del día guardada')")) 'Al volver: la foto del día figura como guardada'
    ClicEn "document.querySelector('[data-guardar]')" | Out-Null
    $t = EsperarAviso 'No hay cambios' 4000
    OK ($t -ge 0) 'Guardar sin cambios: «No hay cambios para guardar.» (no reenvía)' (Aviso)
    Teclear (Campo 'tensiometro_12_am') '18'
    ClicEn "document.querySelector('[data-guardar]')" | Out-Null
    Esperar "(document.querySelector('[data-estado-cola]')?.textContent || '') === 'Todo enviado'" 30000 | Out-Null
    Start-Sleep -Milliseconds 1500
    $fila = (Lista "agm_parametros?select=*&turno_ciclo_id=eq.$tcId&fecha=eq.$HOY")
    OK ($fila.Count -eq 1 -and [double]$fila[0].tensiometro_12_am -eq 18 -and [double]$fila[0].ph_agua -eq 7.97 -and $fila[0].foto_calicata) 'Editar: cambia el tensiómetro a 18 y NO borra el pH ni la foto (misma fila)'

    # ============ Sin señal: queda en el teléfono y se envía al volver ============
    ClicHasta "[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Ayer')" "document.querySelector('input[type=date]').value === '$AYER'" 5 | Out-Null
    Start-Sleep -Milliseconds 1200
    OK ((JS "document.querySelector('[data-ddt]')?.textContent || ''") -match 'DDT 19') 'Ayer: el DDT pasa a 19'
    CDP 'Network.enable' | Out-Null
    CDP 'Network.emulateNetworkConditions' @{ offline = $true; latency = 0; downloadThroughput = -1; uploadThroughput = -1 } | Out-Null
    Start-Sleep -Milliseconds 500
    Teclear (Campo 'tensiometro_24_am') '22'
    ClicEn "document.querySelector('[data-guardar]')" | Out-Null
    $t = EsperarAviso 'Registrado en el teléfono' 5000
    Start-Sleep -Milliseconds 1500
    OK ($t -ge 0 -and (Cola) -eq '1 por enviar') 'Sin señal: «Registrado en el teléfono…» y «1 por enviar»' "$(Aviso) / $(Cola)"
    OK ((Lista "agm_parametros?select=id&turno_ciclo_id=eq.$tcId&fecha=eq.$AYER").Count -eq 0) 'Sin señal: todavía no está en la base'
    CDP 'Network.emulateNetworkConditions' @{ offline = $false; latency = 0; downloadThroughput = -1; uploadThroughput = -1 } | Out-Null
    $t = Esperar "(document.querySelector('[data-estado-cola]')?.textContent || '') === 'Todo enviado'" 40000
    $ay = Lista "agm_parametros?select=*&turno_ciclo_id=eq.$tcId&fecha=eq.$AYER"
    OK ($t -ge 0 -and $ay.Count -eq 1 -and [double]$ay[0].tensiometro_24_am -eq 22 -and $ay[0].ddt -eq 19) 'Al volver la señal se envía solo (sin tocar nada) y queda una sola fila' "$t ms"

    # ============ Un dato imposible: se avisa en español y no entra a la cola ============
    Teclear (Campo 'tensiometro_12_pm') '123456789012'
    ClicEn "document.querySelector('[data-guardar]')" | Out-Null
    $t = Esperar "document.body.textContent.includes('es demasiado grande. Revisa la lectura.')" 5000
    Start-Sleep -Milliseconds 500
    OK ($t -ge 0 -and (Cola) -eq 'Todo enviado') 'Un número imposible: «… es demasiado grande. Revisa la lectura.» y no se encola' (Cola)
    # Un registro que la base rechaza (permiso, dato) va a «No se guardó…» con «Quitar aviso» y NO traba la cola
    JS "(() => { const k = 'agm_cola_$qaId'; const c = JSON.parse(localStorage.getItem(k) || '[]'); c.push({ id: crypto.randomUUID(), tipo: 'parametros', resumen: 'Prueba rechazo', datos: { id: crypto.randomUUID(), turno_ciclo_id: '$tcId', fecha: '$AYER', tensiometro_12_pm: 123456789012 } }); localStorage.setItem(k, JSON.stringify(c)); return true })()" | Out-Null
    Teclear (Campo 'tensiometro_12_pm') '30'
    ClicEn "document.querySelector('[data-guardar]')" | Out-Null
    $t = Esperar "document.body.textContent.includes('No se guardó Prueba rechazo') && (document.querySelector('[data-estado-cola]')?.textContent || '') === 'Todo enviado'" 30000
    Start-Sleep -Milliseconds 800
    $ay = Lista "agm_parametros?select=tensiometro_12_pm&turno_ciclo_id=eq.$tcId&fecha=eq.$AYER"
    OK ($t -ge 0 -and [double]$ay[0].tensiometro_12_pm -eq 30 -and (JS "document.body.textContent.includes('demasiado grande para guardarse')")) 'Rechazo de la base: aviso en español, la cola sigue y el registro de después se guarda' ((JS "[...document.querySelectorAll('[role=alert]')].map(x => x.textContent).join(' | ')") -replace "`n", ' ')
    ClicEn "[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Quitar aviso')" | Out-Null
    Start-Sleep -Milliseconds 400
    OK (-not (JS "document.body.textContent.includes('No se guardó')")) '«Quitar aviso» lo quita'
    $err = Errores-Pagina
    OK (-not $err) 'Parámetros: sin errores de JavaScript en la página' $err

    # ============ Fertirriego › Horas: % de fertilización ============
    Ir "/fertirriego?r=$sufijo"
    $t = Esperar "!!document.querySelector('[data-barra-estado]') && (!!document.querySelector('[data-estacion]') || !!document.querySelector('[data-selector-estacion]'))" 40000
    if ((JS "document.querySelector('[data-estacion]')?.dataset.estacion") -ne $EST -and (JS "!!document.querySelector('[data-selector-estacion]')")) {
        ClicHasta "document.querySelector('[data-selector-estacion] button')" "!!$ULTIMO_DIALOGO?.querySelector('input[inputmode=search]')" | Out-Null
        Teclear "$ULTIMO_DIALOGO.querySelector('input[inputmode=search]')" $EST
        Start-Sleep -Milliseconds 300
        ClicEn "[...$ULTIMO_DIALOGO.querySelectorAll('button')].find(b => b.innerText.trim().startsWith('$EST'))" | Out-Null
    }
    $t2 = Esperar "document.querySelector('[data-estacion]')?.dataset.estacion === '$EST'" 20000
    if ($t2 -lt 0) { $script:Resultados.Add("DIAG fertirriego: t=$t; estacion=$(JS "document.querySelector('[data-estacion]')?.dataset.estacion"); selector=$(JS "!!document.querySelector('[data-selector-estacion]')"); texto=$((JS "document.querySelector('main')?.innerText.slice(0, 400)") -replace "`n", ' / ')") }
    Esperar "!!document.querySelector('[data-actualizar]') && !document.querySelector('[data-actualizar]').disabled" 40000 | Out-Null
    OK ($t2 -ge 0) 'Fertirriego: abre la estación de prueba' "$t2 ms"
    ClicHasta "document.querySelector('[data-pestana=turnos]')" "!!document.querySelector('[data-turno=""$T1""]')" | Out-Null
    if (-not (JS "!!document.querySelector('[data-turno=""$T1""] [data-horas-dia]')")) {
        ClicHasta "document.querySelector('[data-turno=""$T1""] button[aria-expanded]')" "!!document.querySelector('[data-turno=""$T1""] [data-horas-dia]')" | Out-Null
    }
    ClicHasta "document.querySelector('[data-turno=""$T1""] [data-horas-dia]')" "!!document.querySelector('[data-pct-fert]')" | Out-Null
    OK ((JS "!!document.querySelector('[data-pct-fert]')") -and (JS "document.querySelector('[data-pct-fert]').closest('label, div').textContent.includes('% de fertilización')")) 'Horas: tiene el campo «% de fertilización»'
    Teclear "document.querySelector('[data-pct-fert]')" '85,5'
    Teclear "document.querySelector('[data-horas-fert]')" '2'
    Captura 'agm_horas_pct.png'
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    Esperar "!document.querySelector('[data-pct-fert]')" 15000 | Out-Null
    Start-Sleep -Milliseconds 1500
    Esperar "!document.querySelector('[data-pendientes-cuenta]')" 80000 | Out-Null
    $op = @(); for ($i = 0; $i -lt 30 -and $op.Count -eq 0; $i++) { $op = Lista "fert_operaciones?select=resultado,mensaje,datos&perfil_id=eq.$qaId&tipo=eq.bitacora&order=recibido_en.desc&limit=1"; if ($op.Count -eq 0) { Start-Sleep 2 } }
    if ($op.Count -eq 0) { $script:Resultados.Add("DIAG horas: form=$(JS "!!document.querySelector('[data-pct-fert]')"); pendientes=$(JS "document.querySelector('[data-pendientes-cuenta]')?.textContent"); fallo=$(JS "document.querySelector('[data-guardado-fallido]')?.textContent"); alerta=$((JS "[...document.querySelectorAll('[role=alert], [role=dialog]')].map(x => x.innerText.slice(0, 200)).join(' | ')") -replace "`n", ' / '); barra=$((JS "document.querySelector('[data-barra-estado]')?.innerText") -replace "`n", ' / ')") }
    OK ($op.Count -eq 1 -and $op[0].resultado -like 'ACEPTADO*' -and [double]$op[0].datos.pct_fertilizacion -eq 85.5) 'Horas: la cola manda el % (85,5 → 85.5) y la base acepta la operación' (($op | Select-Object resultado) | ConvertTo-Json -Compress)
    $con112 = $true
    try { Rest "fert_bitacora_riego?select=pct_fertilizacion&limit=1" -Servicio | Out-Null } catch { $con112 = $false }
    if ($con112) {
        $bit = Lista "fert_bitacora_riego?select=pct_fertilizacion,horas_fertilizacion&estacion_id=eq.$estId"
        OK ($bit.Count -eq 1 -and [double]$bit[0].pct_fertilizacion -eq 85.5) 'Horas: la base guarda el % (sql/112)' ($bit | ConvertTo-Json -Compress)
        Esperar "(document.querySelector('[data-turno=""$T1""]')?.textContent || '').includes('fertilización 85.5 %')" 20000 | Out-Null
        OK ((JS "(document.querySelector('[data-turno=""$T1""]')?.textContent || '').includes('85.5 %')")) 'Turno: la tarjeta del DDT muestra el %'
    } else {
        $bit = Lista "fert_bitacora_riego?select=horas_fertilizacion&estacion_id=eq.$estId"
        OK ($bit.Count -eq 1 -and [double]$bit[0].horas_fertilizacion -eq 2) 'Horas: SIN la sql/112 en esta base el resto se guarda igual (el % se ignora sin fallar)' ($bit | ConvertTo-Json -Compress)
        $script:Resultados.Add('PENDIENTE sql/112 sin correr en desarrollo: el % aún no se guarda en la base (probado en la réplica)')
    }
    $err = Errores-Pagina
    OK (-not $err) 'Fertirriego: sin errores de JavaScript en la página' $err
}
catch { $script:Resultados.Add("EXCEPCION $($_.Exception.Message) $($_.ErrorDetails.Message) @ $($_.InvocationInfo.ScriptLineNumber)") }
finally {
    try { CDP 'Network.emulateNetworkConditions' @{ offline = $false; latency = 0; downloadThroughput = -1; uploadThroughput = -1 } | Out-Null } catch {}
    try {
        if ($tcId) {
            foreach ($f in (Lista "agm_parametros?select=id,foto_calicata&turno_ciclo_id=eq.$tcId")) {
                if ($f.foto_calicata) { Invoke-RestMethod -Method Delete "$URLB/storage/v1/object/agrometricas" -Headers $hServ -ContentType 'application/json' -Body (@{ prefixes = @($f.foto_calicata) } | ConvertTo-Json) | Out-Null }
                Rest "agm_parametros?id=eq.$($f.id)" 'Delete' -Servicio | Out-Null
            }
            Rest "agm_calicatas?turno_ciclo_id=eq.$tcId" 'Delete' -Servicio | Out-Null
        }
        foreach ($c in (Lista "agm_clima?select=id&zona_id=eq.$($z.id)&fecha=in.($HOY,$AYER)&creado_por=eq.$qaId")) { Rest "agm_clima?id=eq.$($c.id)" 'Delete' -Servicio | Out-Null }
        if ($rangoCreado) { Rest 'agm_rangos?parametro=eq.ph_agua' 'Delete' -Servicio | Out-Null }
        if ($estId) {
            Rest "fert_bitacora_riego?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            if ($qaId) { Rest "fert_operaciones?perfil_id=eq.$qaId" 'Delete' -Servicio | Out-Null }
            foreach ($x in (Lista "turnos_ciclo?select=id,turno_id&agl_id=eq.$AGLID")) { Rest "fert_plan?turno_ciclo_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null; Rest "turnos_ciclo?id=eq.$($x.id)" 'Delete' -Servicio | Out-Null; Rest "turnos?id=eq.$($x.turno_id)" 'Delete' -Servicio | Out-Null }
            Rest "perfiles_estaciones?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            Rest "fert_custodia?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            Rest "estaciones_riego?id=eq.$estId" 'Delete' -Servicio | Out-Null
        }
        Rest "materiales?codigo=eq.$SOL" 'Delete' -Servicio | Out-Null
        Rest "fert_publicaciones?temporada=eq.$([uri]::EscapeDataString($TEMP))" 'Delete' -Servicio | Out-Null
    } catch { $script:Resultados.Add("LIMPIEZA datos: $($_.Exception.Message) $($_.ErrorDetails.Message)") }
    try {
        if ($qaId) {
            foreach ($t in 'perfiles_zonas', 'perfiles_estaciones', 'fert_llaves') { Rest "${t}?perfil_id=eq.$qaId" 'Delete' -Servicio | Out-Null }
            Rest "perfiles?id=eq.$qaId" 'Delete' -Servicio | Out-Null
            Invoke-RestMethod -Method Delete -Uri "$URLB/auth/v1/admin/users/$qaId" -Headers $hServ | Out-Null
        }
    } catch { $script:Resultados.Add("LIMPIEZA usuario QA: $($_.Exception.Message) $($_.ErrorDetails.Message)") }
    Remove-Item $archivoQa, $foto -ErrorAction SilentlyContinue
    try {
        $quedaUsr = 0; try { Invoke-RestMethod "$URLB/auth/v1/admin/users/$qaId" -Headers $hServ | Out-Null; $quedaUsr = 1 } catch {}
        $restos = (Lista "perfiles?select=id&id=eq.$qaId").Count + (Lista "estaciones_riego?select=id&nombre=eq.$([uri]::EscapeDataString($EST))").Count + (Lista "materiales?select=id&codigo=eq.$SOL").Count + (Lista "turnos_ciclo?select=id&agl_id=eq.$AGLID").Count + $(if ($rangoCreado) { (Lista 'agm_rangos?select=parametro&parametro=eq.ph_agua').Count } else { 0 })
        OK ($quedaUsr -eq 0 -and $restos -eq 0) 'Limpieza: el usuario QA temporal y todos los datos de prueba se borraron de desarrollo' "usuario $quedaUsr, restos $restos"
    } catch { $script:Resultados.Add("LIMPIEZA verificación: $($_.Exception.Message)") }
    Terminar-QA
}
