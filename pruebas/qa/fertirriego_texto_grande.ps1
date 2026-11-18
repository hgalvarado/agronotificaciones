# QA - Fertirriego con TEXTO GRANDE: ninguna pantalla oculta informacion (fuente raiz 24 y 32 px; 360 y 412 px de ancho).
# Servidor en :3107 + base de DESARROLLO. Crea usuario QA temporal, estacion de prueba con custodia, un turno con plan y
# 3 productos de nombre muy largo; al final borra todo. Revisa por JS: sin ellipsis activo, sin recorte por overflow
# (horizontal ni vertical), sin scroll horizontal (pagina, dialogo o interno), sin texto fuera de pantalla, pestañas visibles.
param([string]$Base = 'http://localhost:3107', [int]$PuertoCdp = 9347)
. "$PSScriptRoot\comun.ps1"

$envQa = Leer-Entorno
$URLB = $envQa['NEXT_PUBLIC_SUPABASE_URL']; $SERV = $envQa['SUPABASE_SERVICE_ROLE_KEY']
$hServ = @{ apikey = $SERV; Authorization = "Bearer $SERV" }
$s = Get-Random -Maximum 99999
$qaEmail = "qa.grande.$([guid]::NewGuid().ToString('N').Substring(0,10))@desarrollo.local"; $qaClave = "Qa-$(Get-Random)-x$(Get-Random)"
$archivoQa = "$PSScriptRoot\qa_usuario.local.json"
$qaId = $null; $estId = $null; $rolEst = $null
$usr = Invoke-RestMethod -Method Post -Uri "$URLB/auth/v1/admin/users" -Headers $hServ -ContentType 'application/json' -Body (@{ email = $qaEmail; password = $qaClave; email_confirm = $true } | ConvertTo-Json)
$qaId = $usr.id
$rolTotal = (Invoke-RestMethod "$URLB/rest/v1/roles?select=id&acceso_total=eq.true&order=id&limit=1" -Headers $hServ)[0].id
Invoke-RestMethod -Method Post "$URLB/rest/v1/perfiles" -Headers $hServ -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes((@{ id = $qaId; nombre = "QA Grande $s"; rol_id = $rolTotal; todas_las_zonas = $true } | ConvertTo-Json))) | Out-Null
@{ id = $qaId; email = $qaEmail; clave = $qaClave } | ConvertTo-Json | Set-Content -Encoding utf8 $archivoQa

Iniciar-QA -Base $Base -Ancho 412 -Alto 915 -Movil -Puerto $PuertoCdp

function Lista($ruta) { $r = Rest $ruta -Servicio; $o = New-Object System.Collections.ArrayList; foreach ($x in $r) { if ($null -ne $x) { [void]$o.Add($x) } }; return ,$o }
function ClicEn($js) { JS "(() => { const e = $js; if (!e) return false; e.scrollIntoView({block:'center'}); e.click(); return true })()" }
function ClicHasta($js, $condicion, [int]$veces = 15) { for ($i = 0; $i -lt $veces; $i++) { ClicEn $js | Out-Null; if ((Esperar $condicion 700) -ge 0) { return $true } }; return $false }
$ULTIMO_DIALOGO = "[...document.querySelectorAll('[role=dialog]')].pop()"
function ElegirOpcion($selectorBoton, $texto) {
    ClicHasta "document.querySelector('$selectorBoton')" "document.querySelectorAll('[role=dialog]').length > 0 && !!$ULTIMO_DIALOGO.querySelector('input[inputmode=search]')" | Out-Null
    $ok = ClicEn "[...$ULTIMO_DIALOGO.querySelectorAll('button')].find(b => b.innerText.trim().startsWith('$texto'))"
    Start-Sleep -Milliseconds 400
    return $ok
}
function Cant($cod) { "document.querySelector('[data-linea-codigo=""$cod""] [data-cantidad]')" }
function EsperarSync { Start-Sleep -Milliseconds 1500; Esperar "!document.querySelector('[data-pendientes-cuenta]')" 80000 }
function Dlg { JS "document.querySelectorAll('[role=dialog]').length" }
function CerrarDialogos { for ($i = 0; $i -lt 4 -and [int](Dlg) -gt 0; $i++) { ClicEn "(() => { const d = $ULTIMO_DIALOGO; return d && (d.querySelector('[data-cancelar-registro]') || d.querySelector('[data-listo-detalle]') || document.querySelector('[aria-label=Cerrar]')) })()" | Out-Null; Start-Sleep -Milliseconds 500 } }
# Texto grande: un script al cargar cada pagina con el tamaño fijo; se reemplaza entre pasadas
$script:IdFuente = $null
function TextoGrande([int]$px) {
    if ($script:IdFuente) { CDP 'Page.removeScriptToEvaluateOnNewDocument' @{ identifier = $script:IdFuente } | Out-Null }
    $r = CDP 'Page.addScriptToEvaluateOnNewDocument' @{ source = "(function(){function a(){var d=document.documentElement;if(d&&d.style.fontSize!=='${px}px')d.style.setProperty('font-size','${px}px','important')}var t=setInterval(function(){var d=document.documentElement;if(!d)return;clearInterval(t);a();new MutationObserver(a).observe(d,{attributes:true,attributeFilter:['style']})},0)})()" }
    $script:IdFuente = $r.result.identifier
}

$JS_REVISAR = @'
(() => {
  const dl = [...document.querySelectorAll('[role=dialog]')]; const dlg = dl[dl.length - 1];
  const raiz = dlg || document.querySelector('main') || document.body;
  const prob = []; const add = (m) => { if (prob.length < 6 && !prob.includes(m)) prob.push(m) };
  const desc = (e) => e.tagName + '.' + String(e.className).slice(0, 50) + '[' + (e.textContent || '').trim().slice(0, 28) + ']';
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1 && getComputedStyle(e).visibility !== 'hidden' };
  for (const e of [...raiz.querySelectorAll('*')].filter(vis)) {
    if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(e.tagName) && ![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const cs = getComputedStyle(e);
    if (cs.textOverflow === 'ellipsis' && cs.overflowX !== 'visible') add('ellipsis ' + desc(e));
    for (let n = e; n; n = n.parentElement) {
      const c = getComputedStyle(n);
      if (['hidden', 'clip'].includes(c.overflowX) && n.scrollWidth > n.clientWidth + 1) add('recorte-H ' + desc(n) + ' sw' + n.scrollWidth + '>cw' + n.clientWidth);
      if (['hidden', 'clip'].includes(c.overflowY) && n.scrollHeight > n.clientHeight + 1) add('recorte-V ' + desc(n) + ' sh' + n.scrollHeight + '>ch' + n.clientHeight);
      if (['auto', 'scroll'].includes(c.overflowX) && n.scrollWidth > n.clientWidth + 1) add('scroll-H-interno ' + desc(n));
      if (n === raiz || n.tagName === 'MAIN' || n.tagName === 'BODY') break;
    }
    const r = e.getBoundingClientRect();
    if (r.right > innerWidth + 1 || r.left < -1) add('fuera-de-pantalla ' + desc(e) + ' l' + Math.round(r.left) + ' r' + Math.round(r.right));
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) add('scroll-H-pagina sw' + document.documentElement.scrollWidth + ' iw' + innerWidth);
  return prob.join(' || ');
})()
'@
$JS_PESTANAS = "(() => { const t = [...document.querySelectorAll('[data-pestana]')]; if (t.length !== 6) return 'pestanas ' + t.length; const mal = t.filter(b => { const r = b.getBoundingClientRect(); return r.width < 20 || r.left < -1 || r.right > innerWidth + 1 || b.scrollWidth > b.clientWidth + 1 }); return mal.length ? 'fuera: ' + mal.map(b => b.dataset.pestana).join(',') : 'ok' })()"
function Revisar($etq, $captura = $null) {
    $p = JS $JS_REVISAR
    OK (-not $p) "[$script:Tag] $etq sin informacion oculta" $p
    Write-Host "[$script:Tag] $etq -> $(if ($p) { $p } else { 'ok' })"
    if ($captura) { Captura "grande_$($script:Tag -replace '[^\w]','_')_$captura.png" }
}

$EST = "QA Estacion Grande $s"; $TURNO = "TQA-$s"
$P1 = "QA1-$s"; $P2 = "QA2-$s"; $P3 = "QA3-$s"
$N1 = "FERTILIZANTE LIQUIDO COMPLEJO NITROGENO FOSFORO POTASIO CON MICROELEMENTOS QUELATADOS 20-10-10 LOTE $s"
$N2 = "SOLUCION NUTRITIVA CONCENTRADA DE NITRATO DE CALCIO Y MAGNESIO CON BORO Y ZINC GRANULADO SACO 25 KG LOTE $s"
$N3 = "ACIDO FOSFORICO DE GRADO AGRICOLA AL 85 POR CIENTO PARA CORRECCION DE PH EN AGUA DE RIEGO GARRAFA LOTE $s"
$hoy = (Get-Date).ToString('yyyy-MM-dd'); $ayer = (Get-Date).AddDays(-1).ToString('yyyy-MM-dd')
$z1 = (Lista 'zonas?select=id,nombre&activo=eq.true&order=nombre&limit=1')[0]
$script:Tag = 'prep'

try {
    # ============ Preparacion ============
    $estId = (Rest 'estaciones_riego' 'Post' @{ nombre = $EST; zona_id = $z1.id } -Servicio)[0].id
    $pub = Rest 'rpc/fn_fert_publicar' 'Post' @{ p = @{
        temporada = "QA $s"
        estaciones = @(@{ nombre = $EST; zona = $z1.nombre })
        materiales = @(@{ codigo = $P1; descripcion = $N1; unidad = 'L'; grupo = '1800' }, @{ codigo = $P2; descripcion = $N2; unidad = 'KG'; grupo = '1800' }, @{ codigo = $P3; descripcion = $N3; unidad = 'L'; grupo = '1800' })
        turnos = @(@{ agl_id = "TR-QA-$s"; turno = $TURNO; temporada = "QA $s"; ciclo = 'Ciclo QA'; fecha_siembra = (Get-Date).AddDays(-5).ToString('yyyy-MM-dd'); estacion = $EST; zona = $z1.nombre; area_mz = 10; estado = 'Creado' })
        plan = @(@{ agl_id = "TR-QA-$s"; filas = @(
            @{ fecha = $hoy; ddt = 5; material = $P1; cantidad = 12 }, @{ fecha = $hoy; ddt = 5; material = $P2; cantidad = 8 }, @{ fecha = $hoy; ddt = 5; material = $P3; cantidad = 4 },
            @{ fecha = $ayer; ddt = 4; material = $P1; cantidad = 6 }, @{ fecha = $ayer; ddt = 4; material = $P2; cantidad = 4 }, @{ fecha = $ayer; ddt = 4; material = $P3; cantidad = 2 }) })
    } }
    OK ($pub.turnos -eq 1 -and $pub.filas_plan -eq 6) 'Preparacion: turno, plan y 3 productos de nombre largo publicados' "turnos $($pub.turnos), plan $($pub.filas_plan)"
    Rest 'perfiles_estaciones' 'Post' @{ perfil_id = $qaId; estacion_id = $estId } -Servicio | Out-Null

    Ir "/fertirriego?r=$s"
    $t = Esperar "!!document.querySelector('[data-barra-estado]') && !!document.querySelector('[data-estacion]')" 90000
    OK ($t -ge 0) 'Abre Fertirriego' "$t ms"
    ElegirOpcion '[data-selector-estacion] button' $EST | Out-Null
    Esperar "document.querySelector('[data-estacion]')?.dataset.estacion === '$EST'" 10000 | Out-Null
    ClicHasta "document.querySelector('[data-asignar-custodia]')" "!!document.querySelector('[data-selector-custodio]')" | Out-Null
    ElegirOpcion '[data-selector-custodio] button' "QA Grande $s" | Out-Null
    Teclear "document.querySelector('[data-motivo-custodia]')" 'Arranque QA'
    ClicEn "document.querySelector('[data-guardar-custodia]')" | Out-Null
    $t = Esperar "/a tu cargo/.test(document.querySelector('[data-custodia]')?.innerText || '')" 20000
    OK ($t -ge 0) 'Custodia asignada al usuario QA'
    Write-Host 'prep: custodia ok'

    $rolEst = (Rest 'roles' 'Post' @{ codigo = "QA_EST_$s"; nombre = "QA Estacionero $s" } -Servicio)[0].id
    foreach ($a in 'ver', 'recibir', 'aplicar', 'contar', 'relevo') { Rest 'permisos' 'Post' @{ rol_id = $rolEst; recurso = 'fertirriego'; accion = $a; alcance = 'propietario' } -Servicio | Out-Null }
    Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($rolEst); p_principal = $rolEst } -Servicio | Out-Null
    CDP 'Browser.grantPermissions' @{ permissions = @('geolocation'); origin = $Base } | Out-Null
    CDP 'Emulation.setGeolocationOverride' @{ latitude = 13.312; longitude = -87.195; accuracy = 12 } | Out-Null
    Ir "/fertirriego?r=$s-b"
    $t = Esperar "document.querySelector('[data-estacion]')?.dataset.estacion === '$EST'" 90000
    OK ($t -ge 0) 'El estacionero ve su estacion' "$t ms"

    # Conteo inicial (100 de cada uno) por la pantalla
    ClicHasta "document.querySelector('[data-accion=contar]')" "!!document.querySelector('[data-conteo]')" | Out-Null
    foreach ($c in $P1, $P2, $P3) { Teclear "document.querySelector('[data-conteo-material=""$c""] input')" '100' }
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    Esperar "!document.querySelector('[data-conteo]')" 15000 | Out-Null
    $t = EsperarSync
    $m = Lista "fert_movimientos?select=tipo&estacion_id=eq.$estId"
    OK ($t -ge 0 -and $m.Count -eq 3) 'Saldo inicial 100 x 3 productos registrado (conteo)' "movs $($m.Count)"
    # Una aplicacion del DDT 4
    ClicHasta "document.querySelector('[data-accion=aplicar]')" "!!document.querySelector('[data-selector-turno]')" | Out-Null
    Start-Sleep -Milliseconds 800
    ClicHasta "document.querySelector('[data-ddt-chip=""4""]')" "document.querySelector('[data-ddt-chip=""4""]')?.getAttribute('aria-pressed') === 'true'" | Out-Null
    Start-Sleep -Milliseconds 500
    ClicEn "document.querySelector('[data-guardar-registro]')" | Out-Null
    Esperar "!document.querySelector('[data-selector-turno]')" 10000 | Out-Null
    $t = EsperarSync
    $apl = Lista "fert_aplicaciones?select=id&estacion_id=eq.$estId"
    OK ($t -ge 0 -and $apl.Count -eq 1) 'Aplicacion de prueba registrada (DDT 4)' "aplicaciones $($apl.Count)"
    Write-Host 'prep: datos sembrados'

    # ============ Recorrido: fuente x ancho ============
    foreach ($px in 24, 32) {
        foreach ($ancho in 360, 412) {
            $script:Tag = "$ancho@${px}px"
            Write-Host "=== $($script:Tag) ==="
            Pantalla -Ancho $ancho -Alto 800 -Movil
            TextoGrande $px
            Ir "/fertirriego?r=$s-$px-$ancho"
            $t = Esperar "document.querySelector('[data-estacion]')?.dataset.estacion === '$EST' && document.querySelectorAll('[data-pestana]').length === 6" 90000
            OK ($t -ge 0) "[$script:Tag] Abre la estacion" "$t ms"
            # Respaldo: si el script de carga no alcanzo, aplicar la fuente ahora y mantenerla (como TextoGrande)
            JS "(() => { const d = document.documentElement; const a = () => { if (d.style.fontSize !== '${px}px') d.style.setProperty('font-size', '${px}px', 'important') }; a(); new MutationObserver(a).observe(d, { attributes: true, attributeFilter: ['style'] }); return true })()" | Out-Null
            Start-Sleep -Milliseconds 1500
            $fs = JS "getComputedStyle(document.documentElement).fontSize"
            OK ($fs -eq "${px}px") "[$script:Tag] Fuente raiz $px px activa" $fs

            # --- Estacion + tarjetas de saldos
            Esperar "!!document.querySelector('[data-saldos]')" 15000 | Out-Null
            $pst = JS $JS_PESTANAS
            OK ($pst -eq 'ok') "[$script:Tag] Las 6 pestañas se ven dentro de la pantalla (sin scroll lateral)" $pst
            JS "(() => { const d = document.createElement('div'); d.id = '__ctl'; d.textContent = 'TEXTO DE CONTROL MUY LARGO QUE NO CABE'; d.style.cssText = 'width:60px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis'; document.querySelector('main').prepend(d); return true })()" | Out-Null
            $ctl = JS $JS_REVISAR
            OK ($ctl -match 'ellipsis' -and $ctl -match 'recorte-H') "[$script:Tag] Control negativo: el detector SI detecta un texto con ellipsis" $ctl
            JS "document.getElementById('__ctl').remove(); true" | Out-Null
            Revisar 'Estacion (saldos)' 'estacion'
            $nom = JS "(() => { const s = document.querySelector('[data-saldos]'); const t = s ? s.textContent : ''; return ['QUELATADOS','GRANULADO','GARRAFA'].filter(w => t.includes(w)).length })()"
            OK ($nom -eq 3) "[$script:Tag] Tarjetas de saldos: los 3 nombres completos en el texto" "$nom de 3"

            # --- Conteo
            ClicHasta "document.querySelector('[data-accion=contar]')" "!!document.querySelector('[data-conteo]')" | Out-Null
            Start-Sleep -Milliseconds 500
            $cont = JS "(() => { const out = []; for (const c of ['$P1','$P2','$P3']) { const f = document.querySelector('[data-conteo-material=""' + c + '""]'); if (!f) { out.push(c + ':sin fila'); continue } const nom = f.querySelector('p'); const inp = f.querySelector('input'); const ri = inp.getBoundingClientRect(), rn = nom.getBoundingClientRect(); const u = [...f.querySelectorAll('span')].find(x => /^(L|KG)$/.test(x.textContent.trim())); const ru = u ? u.getBoundingClientRect() : null; const ok = rn.bottom <= ri.top + 1 && ri.width >= 60 && ri.left >= 0 && ri.right <= innerWidth && ru && ru.right <= innerWidth && ru.width > 4 && nom.scrollWidth <= nom.clientWidth + 1; out.push(c + ':' + (ok ? 'ok' : 'MAL nom.bottom ' + Math.round(rn.bottom) + ' inp.top ' + Math.round(ri.top) + ' inp.w ' + Math.round(ri.width) + ' inp.r ' + Math.round(ri.right) + ' u.r ' + (ru ? Math.round(ru.right) : 'null'))) } return out.join(' | ') })()"
            OK (-not ($cont -match 'MAL|sin fila')) "[$script:Tag] Conteo: nombre completo en su fila, campo Contado y unidad usables" $cont
            Teclear "document.querySelector('[data-conteo-material=""$P1""] input')" '99.5'
            $val = JS "document.querySelector('[data-conteo-material=""$P1""] input').value"
            OK ($val -eq '99.5') "[$script:Tag] Conteo: se puede teclear en Contado" $val
            Revisar 'Conteo' 'conteo'
            JS "(() => { const d = [...document.querySelectorAll('[role=dialog]')].pop(); const sc = d.querySelector('.overflow-y-auto'); if (sc) sc.scrollTop = 0; return true })()" | Out-Null
            CerrarDialogos
            Write-Host "  conteo cerrado, dialogos: $(Dlg)"

            # --- Aplicar
            ClicHasta "document.querySelector('[data-accion=aplicar]')" "!!document.querySelector('[data-selector-turno]')" | Out-Null
            Start-Sleep -Milliseconds 800
            ClicHasta "document.querySelector('[data-ddt-chip=""5""]')" "document.querySelector('[data-ddt-chip=""5""]')?.getAttribute('aria-pressed') === 'true'" | Out-Null
            Start-Sleep -Milliseconds 600
            $aplf = JS "(() => { const f = document.querySelector('[data-linea-codigo=""$P1""]'); const i = f && f.querySelector('[data-cantidad]'); if (!i) return 'sin linea'; const r = i.getBoundingClientRect(); const t = f.textContent; return (r.width >= 40 && r.left >= 0 && r.right <= innerWidth && t.includes('QUELATADOS')) ? 'ok' : 'MAL w' + Math.round(r.width) + ' r' + Math.round(r.right) + ' nombre completo ' + t.includes('QUELATADOS') })()"
            OK ($aplf -eq 'ok') "[$script:Tag] Aplicar: linea con nombre completo y cantidad usable" $aplf
            Revisar 'Aplicar' 'aplicar'
            CerrarDialogos

            # --- Recibir
            ClicHasta "document.querySelector('[data-accion=recibir]')" "document.querySelectorAll('[role=dialog]').length > 0" | Out-Null
            Start-Sleep -Milliseconds 800
            Revisar 'Recibir' 'recibir'
            CerrarDialogos

            # --- Pestañas
            foreach ($pn in 'turnos', 'bitacora', 'relevos', 'traslados', 'envios') {
                ClicHasta "document.querySelector('[data-pestana=$pn]')" "document.querySelector('[data-pestana=$pn]')?.getAttribute('aria-selected') === 'true'" | Out-Null
                Start-Sleep -Milliseconds 900
                if ($pn -eq 'turnos') {
                    ClicHasta "document.querySelector('[data-turno=""$TURNO""] button[aria-expanded]')" "document.querySelector('[data-turno=""$TURNO""] button[aria-expanded]')?.getAttribute('aria-expanded') === 'true' && !!document.querySelector('[data-producto-tarjeta]')" 4 | Out-Null
                    Start-Sleep -Milliseconds 700
                    $pt = JS "(() => { const f = [...document.querySelectorAll('[data-producto-tarjeta]')]; const t = document.querySelector('[data-turno=""$TURNO""]').textContent; return f.length + ' filas; nombres completos ' + (['QUELATADOS','GRANULADO','GARRAFA'].filter(w => t.includes(w)).length) })()"
                    OK ($pt -match '^[1-9]\d* filas; nombres completos 3') "[$script:Tag] Por turno: tablas de productos con nombres completos" $pt
                    Revisar 'Por turno' 'turnos'
                }
                elseif ($pn -eq 'bitacora') {
                    Revisar 'Bitacora (lista)' 'bitacora'
                    Write-Host "  tipos en bitacora: $(JS "[...document.querySelectorAll('[data-movimiento]')].map(b => b.dataset.movimiento).join(',')")"
                    foreach ($tipo in 'conteo', 'aplicacion') {
                        $esAp = if ($tipo -eq 'aplicacion') { 'true' } else { 'false' }
                        $abierto = ClicHasta "[...document.querySelectorAll('[data-movimiento]')].find(b => !b.disabled && /Aplicaci/.test(b.textContent) === $esAp)" "document.querySelectorAll('[role=dialog]').length > 0"
                        Start-Sleep -Milliseconds 800
                        OK $abierto "[$script:Tag] Bitacora: abre el detalle de un $tipo"
                        Revisar "Detalle de $tipo" "detalle_$tipo"
                        CerrarDialogos
                    }
                }
                else { Revisar "Pestaña $pn" $pn }
                $pst = JS $JS_PESTANAS
                OK ($pst -eq 'ok') "[$script:Tag] Pestañas visibles tras abrir $pn" $pst
            }
            $e = Errores-Pagina; OK (-not $e) "[$script:Tag] Sin errores de pagina" $e
        }
    }
}
catch { $script:Resultados.Add("EXCEPCION (linea $($_.InvocationInfo.ScriptLineNumber)) $($_.Exception.Message) $($_.ErrorDetails.Message)") }
finally {
    try {
        if ($estId) {
            foreach ($t in 'fert_movimientos', 'fert_saldos', 'fert_bitacora_riego', 'fert_custodia', 'fert_relevos') { Rest "${t}?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null }
            foreach ($x in (Lista "fert_devoluciones?select=id&estacion_id=eq.$estId")) { Rest "fert_devoluciones_detalle?devolucion_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null }
            Rest "fert_devoluciones?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            foreach ($x in (Lista "fert_aplicaciones?select=id&estacion_id=eq.$estId")) { Rest "fert_aplicaciones_detalle?aplicacion_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null }
            Rest "fert_aplicaciones?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            foreach ($x in (Lista "fert_recepciones?select=id&estacion_id=eq.$estId")) { Rest "fert_recepciones_detalle?recepcion_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null }
            Rest "fert_recepciones?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            foreach ($x in (Lista "fert_conteos?select=id&estacion_id=eq.$estId")) { Rest "fert_conteos_detalle?conteo_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null }
            Rest "fert_conteos?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            if ($qaId) { Rest "fert_operaciones?perfil_id=eq.$qaId" 'Delete' -Servicio | Out-Null }
            $tc = Lista "turnos_ciclo?select=id,turno_id&agl_id=eq.TR-QA-$s"
            foreach ($x in $tc) { Rest "fert_plan?turno_ciclo_id=eq.$($x.id)" 'Delete' -Servicio | Out-Null; Rest "turnos_ciclo?id=eq.$($x.id)" 'Delete' -Servicio | Out-Null; Rest "turnos?id=eq.$($x.turno_id)" 'Delete' -Servicio | Out-Null }
            Rest "perfiles_estaciones?estacion_id=eq.$estId" 'Delete' -Servicio | Out-Null
            Rest "estaciones_riego?id=eq.$estId" 'Delete' -Servicio | Out-Null
        }
        foreach ($c in $P1, $P2, $P3) { Rest "materiales?codigo=eq.$c" 'Delete' -Servicio | Out-Null }
        Rest "fert_publicaciones?temporada=eq.$([uri]::EscapeDataString("QA $s"))" 'Delete' -Servicio | Out-Null
    } catch { $script:Resultados.Add("LIMPIEZA datos: $($_.Exception.Message) $($_.ErrorDetails.Message)") }
    try { if ($rolEst) { Rest "permisos?rol_id=eq.$rolEst" 'Delete' -Servicio | Out-Null } } catch { $script:Resultados.Add("LIMPIEZA permisos rol: $($_.Exception.Message)") }
    try {
        if ($qaId) {
            foreach ($t in 'perfiles_zonas', 'perfiles_estaciones', 'fert_llaves') { Rest "${t}?perfil_id=eq.$qaId" 'Delete' -Servicio | Out-Null }
            try { Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($rolTotal); p_principal = $rolTotal } -Servicio | Out-Null } catch {}
            Rest "perfiles?id=eq.$qaId" 'Delete' -Servicio | Out-Null
            Invoke-RestMethod -Method Delete -Uri "$URLB/auth/v1/admin/users/$qaId" -Headers $hServ | Out-Null
        }
    } catch { $script:Resultados.Add("LIMPIEZA usuario QA: $($_.Exception.Message) $($_.ErrorDetails.Message)") }
    try { if ($rolEst) { Rest "roles?id=eq.$rolEst" 'Delete' -Servicio | Out-Null } } catch { $script:Resultados.Add("LIMPIEZA rol: $($_.Exception.Message)") }
    Remove-Item $archivoQa -ErrorAction SilentlyContinue
    try {
        $quedaUsr = 0; try { Invoke-RestMethod "$URLB/auth/v1/admin/users/$qaId" -Headers $hServ | Out-Null; $quedaUsr = 1 } catch {}
        $restos = (Lista "perfiles?select=id&id=eq.$qaId").Count + (Lista "estaciones_riego?select=id&nombre=eq.$([uri]::EscapeDataString($EST))").Count + (Lista "materiales?select=id&codigo=in.($P1,$P2,$P3)").Count + (Lista "turnos_ciclo?select=id&agl_id=eq.TR-QA-$s").Count + $(if ($rolEst) { (Lista "roles?select=id&id=eq.$rolEst").Count } else { 0 })
        OK ($quedaUsr -eq 0 -and $restos -eq 0) 'Limpieza: usuario QA temporal y datos de prueba borrados de desarrollo' "usuario $quedaUsr, restos $restos"
    } catch { $script:Resultados.Add("LIMPIEZA verificacion: $($_.Exception.Message)") }
    Terminar-QA
}
