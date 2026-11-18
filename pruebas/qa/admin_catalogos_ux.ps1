# QA - Administracion: ARBOL de navegacion (catalogos siempre a un clic, favoritos, recientes, buscador, hoja movil) y
# Catalogos en dos niveles (hub + catalogo a ancho completo). Anchos 1568, 1280, 1024, 768 y 412; letra grande (raiz 24 px).
# Crea un usuario QA TEMPORAL (rol de acceso total) y una categoria de labor de prueba; al final borra TODO por id exacto y lo
# verifica. Archivo solo ASCII (PowerShell 5.1).
# Uso: powershell -ExecutionPolicy Bypass -File pruebas/qa/admin_catalogos_ux.ps1 -Base http://localhost:3110 -PuertoCdp 9360
param([string]$Base = 'http://localhost:3110', [int]$PuertoCdp = 9360)
. "$PSScriptRoot\comun.ps1"
# Avance en vivo (hora + resultado) para ver donde se demora
function OK($cond, $nombre, $extra = '') {
    $l = ("{0} {1}{2}" -f ($(if ($cond) { 'OK' } else { 'FALLO' })), $nombre, $(if ("$extra" -ne '') { " :: $extra" } else { '' }))
    $script:Resultados.Add($l); Write-Host ("{0:HH:mm:ss} {1}" -f (Get-Date), $l)
}

$envQa = Leer-Entorno
$URLB = $envQa['NEXT_PUBLIC_SUPABASE_URL']; $SERV = $envQa['SUPABASE_SERVICE_ROLE_KEY']
$hServ = @{ apikey = $SERV; Authorization = "Bearer $SERV" }
$sufijo = Get-Random -Maximum 99999
$qaEmail = "qa.admcat.$([guid]::NewGuid().ToString('N').Substring(0,10))@desarrollo.local"; $qaClave = "Qa-$(Get-Random)-x$(Get-Random)"
$archivoQa = "$PSScriptRoot\qa_usuario.local.json"
$usr = Invoke-RestMethod -Method Post -Uri "$URLB/auth/v1/admin/users" -Headers $hServ -ContentType 'application/json' -Body (@{ email = $qaEmail; password = $qaClave; email_confirm = $true } | ConvertTo-Json)
$qaId = $usr.id
$rolTotal = (Invoke-RestMethod "$URLB/rest/v1/roles?select=id&acceso_total=eq.true&order=id&limit=1" -Headers $hServ)[0].id
Invoke-RestMethod -Method Post "$URLB/rest/v1/perfiles" -Headers $hServ -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes((@{ id = $qaId; nombre = "QA Admin Catalogos $sufijo"; rol_id = $rolTotal; todas_las_zonas = $true } | ConvertTo-Json))) | Out-Null
@{ id = $qaId; email = $qaEmail; clave = $qaClave } | ConvertTo-Json | Set-Content -Encoding utf8 $archivoQa

Iniciar-QA -Base $Base -Ancho 1568 -Alto 698 -Puerto $PuertoCdp
CDP 'Page.enable' | Out-Null
# El pase principal va en tema CLARO (el Edge headless arranca en oscuro); el oscuro se revisa al final.
CDP 'Emulation.setEmulatedMedia' @{ features = @(@{ name = 'prefers-color-scheme'; value = 'light' }) } | Out-Null
function TextoGrande([int]$px) {
    CDP 'Page.addScriptToEvaluateOnNewDocument' @{ source = "(function(){function a(){var d=document.documentElement;if(d&&d.style.fontSize!=='${px}px')d.style.setProperty('font-size','${px}px','important')}var t=setInterval(function(){var d=document.documentElement;if(!d)return;clearInterval(t);a();new MutationObserver(a).observe(d,{attributes:true,attributeFilter:['style']})},0)})()" } | Out-Null
}
function Lista($ruta) { $o = New-Object System.Collections.ArrayList; foreach ($x in (Rest $ruta -Servicio)) { if ($null -ne $x) { [void]$o.Add($x) } }; return ,$o }
function ClicEn($js) { JS "(() => { const e = $js; if (!e) return false; e.scrollIntoView({block:'center'}); e.click(); return true })()" }
function ClicHasta($js, $condicion, [int]$veces = 15) { for ($i = 0; $i -lt $veces; $i++) { ClicEn $js | Out-Null; if ((Esperar $condicion 700) -ge 0) { return $true } }; return $false }
function Tecla($key, $vk) {
    CDP 'Input.dispatchKeyEvent' @{ type = 'rawKeyDown'; key = $key; code = $key; windowsVirtualKeyCode = $vk } | Out-Null
    CDP 'Input.dispatchKeyEvent' @{ type = 'keyUp'; key = $key; code = $key; windowsVirtualKeyCode = $vk } | Out-Null
}
function SinScrollH { JS "document.documentElement.scrollWidth <= window.innerWidth + 1" }
# Marca de que React ya tomo la pagina: el riel pinta «Recientes» desde un efecto (un clic antes de eso se pierde)
$HIDRATADO = "!!document.querySelector('nav[aria-label^=Administraci] section[aria-label=Recientes]')"
function IrH($ruta) { Ir $ruta; Esperar $HIDRATADO 90000 | Out-Null }
function Recargar { JS "location.reload()" | Out-Null; Start-Sleep -Milliseconds 1500; Esperar "document.readyState === 'complete'" 60000 | Out-Null; Start-Sleep -Milliseconds 2500 }
$HUB = "[...document.querySelectorAll('main h2')].filter(h => !h.closest('nav')).length >= 5"
# Raiz del panel de navegacion: el riel (pantalla ancha) o la hoja (pantalla angosta)
$RIEL = "document.querySelector('nav[aria-label^=Administraci]')"
$HOJA = "document.querySelector('[role=dialog]')"
function Raiz([bool]$escritorio) { if ($escritorio) { return $RIEL } else { return $HOJA } }
function AbrirHoja { ClicHasta "[...document.querySelectorAll('button[aria-haspopup=dialog]')].find(b => b.offsetParent !== null)" "!!document.querySelector('[role=dialog]')" }
function EnlaceDeCatalogo($raiz, $clave) { return "[...$raiz.querySelectorAll('a')].find(a => a.getAttribute('href') && a.getAttribute('href').endsWith('catalogo=$clave') && a.offsetParent !== null)" }

$JS_MINFONT = @"
(() => {
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize);
  let min = 999, quien = '';
  for (const e of document.querySelectorAll('main *, nav[aria-label^=Administraci] *')) {
    if (e.offsetParent === null || e.closest('[aria-hidden=true]')) continue;
    const t = [...e.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim()).length;
    if (!t) continue;
    const f = parseFloat(getComputedStyle(e).fontSize);
    if (f < min) { min = f; quien = e.tagName + ':' + e.textContent.trim().slice(0, 25); }
  }
  return JSON.stringify({ rem: rem, min: min, ok: min >= 0.75 * rem - 0.1, quien: quien });
})()
"@

$JS_TRUNC = @"
(() => {
  const malos = [];
  for (const e of document.querySelectorAll('main table td, main table th, main table td *, main dl dd *, main dl dt')) {
    if (e.offsetParent === null) continue;
    const cs = getComputedStyle(e);
    if (cs.textOverflow === 'ellipsis') { malos.push('ellipsis:' + e.tagName); continue; }
    if (e.tagName === 'TEXTAREA' || e.tagName === 'INPUT') { if (e.scrollHeight > e.clientHeight + 2 && e.tagName === 'TEXTAREA') malos.push('textarea-recortado'); continue; }
    if (e.children.length === 0 && e.scrollWidth > e.clientWidth + 1) malos.push('ancho:' + e.textContent.trim().slice(0, 20));
  }
  return malos.join(' | ');
})()
"@

function Contraste($selectorJs) {
    JS @"
(() => {
  const e = $selectorJs; if (!e) return -1;
  const num = s => s.match(/[\d.]+/g).map(Number);
  const lum = c => { const [r,g,b] = c.map(v => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4) }); return 0.2126*r + 0.7152*g + 0.0722*b };
  let fondo = [255,255,255], n = e;
  while (n) { const c = getComputedStyle(n).backgroundColor; const v = num(c); if (v.length < 4 || v[3] > 0.9) { fondo = v.slice(0,3); break } n = n.parentElement }
  const fg = num(getComputedStyle(e).color).slice(0,3);
  const a = lum(fg), b = lum(fondo);
  return Math.round(((Math.max(a,b)+0.05)/(Math.min(a,b)+0.05))*100)/100;
})()
"@
}

# Estructura de la navegacion (arbol) en el riel o en la hoja
function Revisar-Arbol($etq, [bool]$escritorio) {
    $raiz = Raiz $escritorio
    $r = JS "(() => { const n = $raiz; if (!n) return 'sin-panel'; return JSON.stringify({ grupos: [...n.querySelectorAll('h2')].map(p => p.textContent.trim()), links: n.querySelectorAll('a').length, buscador: !!n.querySelector('input[type=search]'), catalogos: [...n.querySelectorAll('a')].filter(a => (a.getAttribute('href')||'').includes('catalogo=')).length, scrollW: n.scrollWidth <= n.clientWidth + 1 }) })()"
    OK ($r -ne 'sin-panel' -and $r -match 'Datos maestros' -and $r -match 'Costos' -and $r -match 'Personas y seguridad' -and $r -match 'Fertirriego') "$etq arbol: 4 grupos de secciones" $r
    $o = $r | ConvertFrom-Json
    OK ($o.buscador) "$etq arbol: buscador arriba"
    $bloques = JS "[...$raiz.querySelectorAll('[data-arbol] button[aria-expanded]')].filter(b => b.textContent.trim().length > 6 && b.getAttribute('aria-label') === null).length"
    OK ($bloques -ge 5) "$etq arbol: 'Catalogos' desplegado con sus 5 bloques a la vista" "bloques=$bloques"
    $bq = "[...$raiz.querySelectorAll('button[aria-expanded]')].find(b => b.textContent.trim() === 'Equipos e implementos')"
    if ((JS "$bq.getAttribute('aria-expanded')") -eq 'false') { ClicHasta $bq "$bq.getAttribute('aria-expanded') === 'true'" | Out-Null }
    $cat = JS "[...$raiz.querySelectorAll('a')].filter(a => (a.getAttribute('href')||'').includes('catalogo=') && a.offsetParent !== null).length"
    OK ($cat -ge 5) "$etq arbol: un clic en el bloque muestra sus catalogos (sin lista desplegable)" "catalogos=$cat"
    OK ($o.scrollW) "$etq arbol: sin scroll lateral"
    OK ((JS "[...$raiz.querySelectorAll('a')].some(a => a.textContent.includes('Equipos') && /\d+/.test(a.textContent))") -eq $true) "$etq arbol: los catalogos muestran su conteo"
}

# Favoritos, recientes, memoria de grupos y buscador del panel
function Probar-Arbol($etq, [bool]$escritorio) {
    if (-not $escritorio) { AbrirHoja | Out-Null }
    $raiz = Raiz $escritorio
    $estrella = "[...$raiz.querySelectorAll('button[aria-pressed]')].find(b => b.getAttribute('aria-label').endsWith(': Equipos') && b.offsetParent !== null)"
    OK ((ClicHasta $estrella "[...$raiz.querySelectorAll('section[aria-label=Favoritos] a')].some(a => a.textContent.includes('Equipos'))") -eq $true) "$etq favoritos: la estrella fija 'Equipos' arriba"
    # recarga: los favoritos se recuerdan por usuario (localStorage)
    Recargar
    if (-not $escritorio) { AbrirHoja | Out-Null }
    OK ((Esperar "[...$raiz.querySelectorAll('section[aria-label=Favoritos] a')].some(a => a.textContent.includes('Equipos'))" 8000) -ge 0) "$etq favoritos: se recuerdan tras recargar"
    $quita = "[...$raiz.querySelectorAll('section[aria-label=Favoritos] button[aria-pressed=true]')][0]"
    ClicHasta $quita "![...$raiz.querySelectorAll('section[aria-label=Favoritos]')].length" | Out-Null
    OK ((Esperar "![...$raiz.querySelectorAll('section[aria-label=Favoritos]')].length" 3000) -ge 0) "$etq favoritos: se quitan con la misma estrella"
    # recientes
    $rec = JS "(() => { const s = $raiz.querySelector('section[aria-label=Recientes]'); return s ? JSON.stringify({ n: s.querySelectorAll('a').length, primero: s.querySelector('a').textContent }) : 'sin' })()"
    OK ($rec -ne 'sin' -and ($rec | ConvertFrom-Json).n -le 5 -and ($rec | ConvertFrom-Json).n -ge 1) "$etq recientes: hay entre 1 y 5" $rec
    # memoria de grupos: abrir 'Campo y cultivo', recargar, sigue abierto
    $bloque = "[...$raiz.querySelectorAll('button[aria-expanded]')].find(b => b.textContent.trim() === 'Campo y cultivo')"
    $abierto = JS "(() => { const b = $bloque; return b ? b.getAttribute('aria-expanded') : 'sin' })()"
    if ($abierto -eq 'false') { ClicHasta $bloque "$bloque.getAttribute('aria-expanded') === 'true'" | Out-Null }
    Recargar
    if (-not $escritorio) { AbrirHoja | Out-Null }
    OK ((Esperar "$bloque && $bloque.getAttribute('aria-expanded') === 'true'" 8000) -ge 0) "$etq arbol: el grupo abierto se recuerda tras recargar"
    # buscador del panel: filtra secciones Y catalogos, Enter salta
    Teclear "$raiz.querySelector('input[type=search]')" 'tarifa'
    Start-Sleep -Milliseconds 400
    $res = JS "[...$raiz.querySelectorAll('section[aria-label=Resultados] a')].map(a => a.textContent.trim()).join(' | ')"
    OK ($res -match 'Tarifas') "$etq buscador del panel: filtra por nombre" $res
    Teclear "$raiz.querySelector('input[type=search]')" 'zonas'
    Start-Sleep -Milliseconds 400
    $res = JS "[...$raiz.querySelectorAll('section[aria-label=Resultados] a')].map(a => a.getAttribute('href')).join(' | ')"
    OK ($res -match 'catalogo=zonas') "$etq buscador del panel: encuentra catalogos (no solo secciones)" $res
    Tecla 'Enter' 13
    OK ((Esperar "location.search.includes('catalogo=zonas')" 15000) -ge 0) "$etq buscador del panel: Enter salta al resultado"
    OK ((Esperar "document.querySelector('main h1') && document.querySelector('main h1').textContent.trim() === 'Zonas'" 15000) -ge 0) "$etq el catalogo elegido se abre (Zonas)"
}

$idCat = $null
try {
    $anchos = @(@(1568, 698, $false), @(1280, 720, $false), @(1024, 768, $false), @(768, 900, $false), @(412, 800, $true))
    foreach ($a in $anchos) {
        $w = $a[0]
        $etq = "w$w"
        $esc = ($w -ge 1280)
        Pantalla -Ancho $w -Alto $a[1] -Movil:$a[2]
        IrH '/admin/catalogos'
        OK ((Esperar $HUB 90000) -ge 0) "$etq hub: tarjetas de bloque visibles" ''
        Start-Sleep -Milliseconds 800
        OK ((SinScrollH) -eq $true) "$etq hub: sin scroll horizontal de pagina"
        OK ((JS "[...document.querySelectorAll('main a')].filter(a => a.href.includes('catalogo=') && !a.closest('nav')).length") -ge 15) "$etq hub: todos los catalogos a la vista sin abrir nada"
        $mf = JS $JS_MINFONT | ConvertFrom-Json
        OK ($mf.ok) "$etq hub: texto minimo >= 12 px (0.75 rem)" "min=$($mf.min) rem=$($mf.rem) $($mf.quien)"
        Captura "admcat_${etq}_hub.png"

        if ($esc) {
            $r = JS "(() => { const n = $RIEL; const c = n.getBoundingClientRect(); const cs = getComputedStyle(n); return JSON.stringify({ pos: cs.position, alto: Math.round(c.height), vh: window.innerHeight, oy: cs.overflowY, ox: cs.overflowX }) })()"
            $ro = $r | ConvertFrom-Json
            OK ($ro.pos -eq 'sticky' -and [Math]::Abs($ro.alto - $ro.vh) -le 2 -and $ro.oy -eq 'auto') "$etq riel: pegajoso, de la altura de la pantalla y con scroll vertical propio" $r
            OK ($ro.ox -ne 'auto' -and $ro.ox -ne 'scroll') "$etq riel: nunca scroll lateral" $r
            OK ((JS "[...document.querySelectorAll('button[aria-haspopup=dialog]')].every(b => b.offsetParent === null)") -eq $true) "$etq sin boton Menu en pantalla ancha"
        } else {
            $barra = JS "(() => { const b = [...document.querySelectorAll('button[aria-haspopup=dialog]')].find(x => x.offsetParent !== null); if (!b) return 'sin-boton'; const f = b.parentElement; return JSON.stringify({ pos: getComputedStyle(f).position, txt: f.textContent.replace(/\s+/g,' ').trim(), alto: Math.round(b.getBoundingClientRect().height) }) })()"
            OK ($barra -ne 'sin-boton' -and $barra -match 'Administraci' -and $barra -match 'Men' -and $barra -match 'Cat.logos') "$etq barra: fila con la seccion actual y boton Menu" $barra
            OK ($barra -match '"pos":"static"') "$etq barra: fila normal del flujo (no pegada)" $barra
            OK ((($barra | ConvertFrom-Json).alto) -ge 43.5) "$etq boton Menu >= 44 px" $barra
            OK ((AbrirHoja) -eq $true) "$etq la hoja se abre con el boton Menu"
        }
        Revisar-Arbol $etq $esc
        if (-not $esc) {
            $h = JS "(() => { const d = document.querySelector('[role=dialog]'); const a = [...d.querySelectorAll('a')].filter(x => x.offsetParent !== null); return Math.min(...a.map(x => x.getBoundingClientRect().height)) })()"
            OK ($h -ge 43.5) "$etq hoja: enlaces del arbol >= 44 px" "$h"
            Captura "admcat_${etq}_hoja.png"
            Tecla 'Escape' 27
            OK ((Esperar "!document.querySelector('[role=dialog]')" 3000) -ge 0) "$etq Esc cierra la hoja"
        }

        # buscador del hub
        Teclear "document.querySelector('#hub-buscar')" 'tractores'
        Start-Sleep -Milliseconds 400
        $n = JS "[...document.querySelectorAll('main h2')].filter(h => !h.closest('nav')).length"
        $e = JS "[...document.querySelectorAll('main a')].filter(a => a.href.includes('catalogo=') && !a.closest('nav')).length"
        OK ($n -eq 1 -and $e -lt 6) "$etq hub: el buscador filtra por nombre o descripcion" "bloques=$n catalogos=$e"
        Teclear "document.querySelector('#hub-buscar')" 'zzzxx'
        Start-Sleep -Milliseconds 300
        OK ((JS "document.body.innerText.includes('Ning')") -eq $true) "$etq hub: sin coincidencias explica que hacer"
        ClicEn "[...document.querySelectorAll('button')].find(b => /Borrar b/.test(b.getAttribute('aria-label') || '') && b.closest('main'))" | Out-Null
        Start-Sleep -Milliseconds 300
        OK ((JS "[...document.querySelectorAll('main h2')].filter(h => !h.closest('nav')).length") -ge 5) "$etq hub: borrar la busqueda restaura los bloques"
        # atajo «/»: enfoca el buscador del panel (o abre la hoja si no hay riel)
        JS "(document.activeElement && document.activeElement.blur(), document.body.focus(), true)" | Out-Null
        CDP 'Input.dispatchKeyEvent' @{ type = 'keyDown'; key = '/'; code = 'Slash'; text = '/'; windowsVirtualKeyCode = 191 } | Out-Null
        CDP 'Input.dispatchKeyEvent' @{ type = 'keyUp'; key = '/'; code = 'Slash'; windowsVirtualKeyCode = 191 } | Out-Null
        OK ((Esperar "document.activeElement && document.activeElement.type === 'search' && document.activeElement.id.startsWith('adm-buscar')" 3000) -ge 0) "$etq la tecla / enfoca el buscador del panel (riel u hoja)"
        if (-not $esc) { Tecla 'Escape' 27; Start-Sleep -Milliseconds 400 }
        JS "(document.activeElement && document.activeElement.blur(), true)" | Out-Null

        # abrir Equipos desde el hub
        $js = "[...document.querySelectorAll('main a')].find(a => a.href.includes('catalogo=equipos') && a.textContent.trim().startsWith('Equipos'))"
        OK ((ClicHasta $js "location.search.includes('catalogo=equipos')") -eq $true) "$etq Equipos: la URL lleva ?catalogo=equipos"
        OK ((Esperar "document.querySelectorAll('main table tbody tr, main dl').length > 3" 20000) -ge 0) "$etq Equipos: filas visibles"
        Start-Sleep -Milliseconds 500
        OK ((SinScrollH) -eq $true) "$etq Equipos: sin scroll horizontal de pagina"
        $tr = JS $JS_TRUNC
        OK ([string]::IsNullOrEmpty($tr)) "$etq Equipos: ningun texto truncado" $tr
        $mig = JS "(() => { const n = document.querySelector('main nav[aria-label=Ruta]'); return n ? n.textContent.replace(/\s+/g,' ') : '' })()"
        if ($esc) { OK ($mig -match 'Cat.logos' -and $mig -match 'Equipos e implementos') "$etq Equipos: migas pequenas Catalogos > Bloque" $mig }
        OK ((JS "document.querySelector('main h1').textContent.trim()") -eq 'Equipos') "$etq Equipos: titulo"
        $btn = JS "[...document.querySelectorAll('main button')].some(b => b.offsetParent !== null && /^Cat.logos$/.test(b.textContent.trim()))"
        if ($esc) { OK ($btn -eq $false) "$etq Equipos: sin boton Catalogos (ya esta el arbol)" } else { OK ($btn -eq $true) "$etq Equipos: boton Catalogos para volver (movil/tableta)" }
        OK ((JS "!document.body.innerText.includes('Ir a otro cat')") -eq $true) "$etq Equipos: sin lista desplegable para cambiar de catalogo"
        $bt = JS "(() => { const t = [...document.querySelectorAll('main button')].filter(b => b.offsetParent !== null).map(b => b.textContent.trim()); return JSON.stringify({ imp: t.includes('Importar'), exp: t.includes('Exportar'), add: t.includes('Agregar') }) })()"
        OK ($bt -eq '{"imp":true,"exp":true,"add":true}') "$etq Equipos: Importar, Exportar y Agregar presentes" $bt
        if ($w -ge 1568) {
            $fila = JS "(() => { const h = document.querySelector('main h1').getBoundingClientRect(); const s = document.querySelector('main input[placeholder*=toda]').getBoundingClientRect(); const b = [...document.querySelectorAll('main button')].find(x => x.textContent.trim() === 'Agregar').getBoundingClientRect(); return JSON.stringify({ h: Math.round(h.top), s: Math.round(s.top), b: Math.round(b.top) }) })()"
            $fo = $fila | ConvertFrom-Json
            OK ([Math]::Abs($fo.s - $fo.b) -le 6 -and [Math]::Abs(($fo.h + 10) - $fo.s) -le 60) "$etq Equipos: titulo, buscador y acciones en una sola fila" $fila
        }
        if ($w -ge 768) {
            $tab = JS "(() => { const t = document.querySelector('main table'); if (!t) return 'sin-tabla'; const c = t.closest('.overflow-auto'); const th = t.querySelector('thead'); const r = c.getBoundingClientRect(); const hr = th.getBoundingClientRect(); return JSON.stringify({ scrollH: c.scrollWidth <= c.clientWidth + 1, sticky: getComputedStyle(th).position, cols: t.querySelectorAll('thead th').length, cabDentro: hr.top >= r.top - 1 }) })()"
            OK ($tab -match '"sticky":"sticky"' -and $tab -match '"cabDentro":true') "$etq Equipos: cabecera pegajosa DENTRO del contenedor de la tabla" $tab
            if ($w -ge 1568) { OK ($tab -match '"scrollH":true') "$etq Equipos: tabla sin scroll horizontal propio" $tab }
        } else {
            OK ((JS "document.querySelectorAll('main dl').length") -gt 3) "$etq Equipos: filas como tarjetas apiladas (campo: valor)"
        }
        $mf = JS $JS_MINFONT | ConvertFrom-Json
        OK ($mf.ok) "$etq Equipos: texto minimo >= 12 px (0.75 rem)" "min=$($mf.min) rem=$($mf.rem) $($mf.quien)"
        if (-not $esc) { AbrirHoja | Out-Null; Captura "admcat_${etq}_hoja_equipos.png"; Tecla 'Escape' 27; Start-Sleep -Milliseconds 300 }
        Captura "admcat_${etq}_equipos.png"

        # saltar a otro catalogo con UN clic en el arbol (en la hoja si no hay riel); Atras / Adelante
        if (-not $esc) { AbrirHoja | Out-Null }
        $raiz = Raiz $esc
        $js = EnlaceDeCatalogo $raiz 'familias'
        $okAbrir = ClicHasta $js "location.search.includes('catalogo=familias')"
        if (-not $okAbrir) {
            # el bloque de Equipos esta abierto por ser el activo; si no lo estuviera, un clic mas
            OK $false "$etq arbol: un clic en 'Familia de los equipos' cambia de catalogo"
        } else { OK $true "$etq arbol: un clic en 'Familia de los equipos' cambia de catalogo (URL)" }
        OK ((Esperar "document.querySelector('main h1') && /Familia/.test(document.querySelector('main h1').textContent)" 8000) -ge 0) "$etq el catalogo cambia en pantalla sin recargar"
        OK ((JS "performance.getEntriesByType('navigation').length === 1") -eq $true) "$etq (misma carga de pagina: sin pedir todo al servidor)"
        JS "history.back()" | Out-Null
        OK ((Esperar "location.search.includes('catalogo=equipos')" 5000) -ge 0) "$etq Atras vuelve a Equipos"
        JS "history.back()" | Out-Null
        OK ((Esperar "!location.search.includes('catalogo=') && [...document.querySelectorAll('main h2')].filter(h => !h.closest('nav')).length >= 5" 5000) -ge 0) "$etq Atras vuelve al hub"
        JS "history.forward()" | Out-Null
        OK ((Esperar "location.search.includes('catalogo=equipos')" 5000) -ge 0) "$etq Adelante reabre Equipos"
        Recargar
        OK ((Esperar "location.search.includes('catalogo=equipos') && document.querySelectorAll('main table tbody tr, main dl').length > 3" 60000) -ge 0) "$etq recargar conserva el catalogo (?catalogo=)"
        # volver al hub: migas siempre; boton solo en movil
        ClicHasta "[...document.querySelectorAll('main a, main button')].find(a => a.offsetParent !== null && /^Cat.logos$/.test(a.textContent.trim()))" "!location.search.includes('catalogo=')" | Out-Null
        OK ((Esperar "!location.search.includes('catalogo=') && [...document.querySelectorAll('main h2')].filter(h => !h.closest('nav')).length >= 5" 5000) -ge 0) "$etq la miga 'Catalogos' regresa al hub"

        if (-not $esc) {
            # elegir otra seccion desde la hoja y volver
            AbrirHoja | Out-Null
            ClicEn "[...document.querySelectorAll('[role=dialog] [data-arbol] a')].find(a => a.textContent.trim() === 'Lotes')" | Out-Null
            OK ((Esperar "location.pathname === '/admin/lotes'" 60000) -ge 0) "$etq elegir 'Lotes' en la hoja navega y la hoja se cierra"
            OK ((Esperar "!document.querySelector('[role=dialog]')" 3000) -ge 0) "$etq la hoja se cierra al navegar"
            OK ((SinScrollH) -eq $true) "$etq /admin/lotes sin scroll horizontal de pagina"
            Captura "admcat_${etq}_lotes.png"
        }
        OK ((Errores-Pagina) -eq '') "$etq sin errores de pagina" (Errores-Pagina)
    }

    # ---------------- Favoritos, recientes, memoria y buscador del panel (ancho y movil) ----------------
    foreach ($a in @(@(1568, 698, $false), @(412, 800, $true))) {
        $w = $a[0]; $etq = "arbol$w"; $esc = ($w -ge 1280)
        Pantalla -Ancho $w -Alto $a[1] -Movil:$a[2]
        IrH '/admin/catalogos?catalogo=equipos'
        OK ((Esperar "document.querySelectorAll('main table tbody tr, main dl').length > 3" 60000) -ge 0) "$etq Equipos abierto"
        Start-Sleep -Milliseconds 1000
        Probar-Arbol $etq $esc
        Captura "admcat_${etq}_busqueda.png"
    }

    # ---------------- Agregar, editar en linea y eliminar (escritorio y movil) ----------------
    foreach ($a in @(@(1568, 698, $false), @(412, 800, $true))) {
        $w = $a[0]; $etq = "ciclo$w"
        Pantalla -Ancho $w -Alto $a[1] -Movil:$a[2]
        $nom = "QA-UX-$sufijo-$w"; $nom2 = "$nom-b"
        IrH '/admin/catalogos?catalogo=categorias_labor'
        OK ((Esperar "document.querySelectorAll('main button').length > 3" 90000) -ge 0) "$etq categorias de labor abierta"
        Start-Sleep -Milliseconds 800
        ClicHasta "[...document.querySelectorAll('main button')].find(b => b.offsetParent !== null && b.textContent.trim() === 'Agregar')" "!!document.querySelector('[role=dialog] input')" | Out-Null
        Teclear "document.querySelector('[role=dialog] input')" $nom
        ClicEn "[...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent.trim() === 'Agregar')" | Out-Null
        $fila = $null
        for ($i = 0; $i -lt 40 -and -not $fila; $i++) { Start-Sleep -Milliseconds 300; $r = Lista "categorias_labor?select=id&nombre=eq.$nom"; if ($r.Count -gt 0) { $fila = $r[0] } }
        OK ($null -ne $fila) "$etq Agregar crea la fila" $nom
        if ($fila) { $idCat = $fila.id }
        OK ((Esperar "!document.querySelector('[role=dialog]')" 5000) -ge 0) "$etq el formulario se cierra al guardar"
        Teclear "document.querySelector('main input[placeholder*=toda]')" $nom
        Start-Sleep -Milliseconds 500
        $celda = "[...document.querySelectorAll('main textarea')].find(t => t.offsetParent !== null && t.value === '$nom')"
        OK ((Esperar "!!($celda)" 15000) -ge 0) "$etq la celda editable (texto que baja de linea) muestra el valor"
        Teclear $celda $nom2
        Tecla 'Enter' 13
        $ok2 = $false
        for ($i = 0; $i -lt 30 -and -not $ok2; $i++) { Start-Sleep -Milliseconds 300; if ((Lista "categorias_labor?select=id&nombre=eq.$nom2").Count -gt 0) { $ok2 = $true } }
        OK $ok2 "$etq edicion en linea guarda con Enter" $nom2
        Captura "admcat_${etq}_editada.png"
        Teclear "document.querySelector('main input[placeholder*=toda]')" $nom2
        Start-Sleep -Milliseconds 600
        OK ((Esperar "[...document.querySelectorAll('main textarea')].filter(t => t.offsetParent !== null).length === 1" 5000) -ge 0) "$etq la tabla quedo filtrada a una sola fila (seguro para borrar)"
        OK ((ClicHasta "[...document.querySelectorAll('main [role=checkbox]')].find(b => b.offsetParent !== null && /^Seleccionar/.test(b.getAttribute('aria-label')))" "/1 seleccionado/.test(document.body.innerText)") -eq $true) "$etq marcar la fila muestra la barra de acciones masivas"
        Captura "admcat_${etq}_seleccion.png"
        ClicEn "[...document.querySelectorAll('main button')].find(b => b.offsetParent !== null && b.textContent.trim() === 'Eliminar')" | Out-Null
        ClicEn "[...document.querySelectorAll('[role=dialog] button')].find(b => /^Eliminar 1/.test(b.textContent.trim()))" | Out-Null
        $borrada = $false
        for ($i = 0; $i -lt 30 -and -not $borrada; $i++) { Start-Sleep -Milliseconds 300; if ((Lista "categorias_labor?select=id&id=eq.$idCat").Count -eq 0) { $borrada = $true } }
        OK $borrada "$etq Eliminar borra la fila"
        if ($borrada) { $idCat = $null }
    }

    # ---------------- Letra grande ----------------
    TextoGrande 24
    foreach ($a in @(@(412, 800, $true), @(1024, 768, $false), @(1568, 698, $false))) {
        $w = $a[0]; $etq = "g24w$w"; $esc = ($w -ge 1280)
        Pantalla -Ancho $w -Alto $a[1] -Movil:$a[2]
        IrH '/admin/catalogos'
        OK ((Esperar $HUB 60000) -ge 0) "$etq hub con letra 24 px" ''
        Start-Sleep -Milliseconds 800
        OK ((SinScrollH) -eq $true) "$etq hub sin scroll horizontal"
        Captura "admcat_${etq}_hub.png"
        $js = "[...document.querySelectorAll('main a')].find(a => a.href.includes('catalogo=equipos') && a.textContent.trim().startsWith('Equipos'))"
        ClicHasta $js "location.search.includes('catalogo=equipos')" | Out-Null
        Esperar "document.querySelectorAll('main table tbody tr, main dl').length > 3" 20000 | Out-Null
        Start-Sleep -Milliseconds 600
        OK ((SinScrollH) -eq $true) "$etq Equipos sin scroll horizontal de pagina"
        $tr = JS $JS_TRUNC
        OK ([string]::IsNullOrEmpty($tr)) "$etq Equipos sin textos truncados" $tr
        Captura "admcat_${etq}_equipos.png"
        if (-not $esc) {
            AbrirHoja | Out-Null
            $d = JS "(() => { const d = document.querySelector('[role=dialog]'); return d ? d.scrollWidth <= d.clientWidth + 1 : false })()"
            OK ($d -eq $true) "$etq hoja de navegacion sin scroll lateral"
            Captura "admcat_${etq}_hoja.png"
            Tecla 'Escape' 27
        } else {
            $d = JS "(() => { const n = $RIEL; return n.scrollWidth <= n.clientWidth + 1 })()"
            OK ($d -eq $true) "$etq riel sin scroll lateral con letra grande"
        }
    }

    # ---------------- Tema oscuro ----------------
    Pantalla -Ancho 1568 -Alto 698
    IrH '/admin/catalogos?catalogo=equipos'
    Esperar "document.querySelectorAll('main table tbody tr').length > 3" 60000 | Out-Null
    JS "document.documentElement.setAttribute('data-tema','oscuro'); true" | Out-Null
    Start-Sleep -Milliseconds 600
    Captura 'admcat_oscuro_equipos.png'
    $c1 = Contraste "document.querySelector('main h1')"
    $c2 = Contraste "document.querySelector('nav[aria-label^=Administraci] [data-arbol] h2')"
    $c3 = Contraste "document.querySelector('nav[aria-label^=Administraci] a[aria-current=page]')"
    $c4 = Contraste "[...document.querySelectorAll('nav[aria-label^=Administraci] [data-arbol] a')].find(a => !a.hasAttribute('aria-current'))"
    $c5 = Contraste "document.querySelector('nav[aria-label^=Administraci] input[type=search]')"
    OK ($c1 -ge 4.5 -and $c2 -ge 4.5 -and $c3 -ge 4.5 -and $c4 -ge 4.5 -and $c5 -ge 4.5) "oscuro: contraste AA en titulo, grupos, activo, enlaces y buscador del arbol" "h1=$c1 grupo=$c2 activo=$c3 enlace=$c4 buscador=$c5"
    $c6 = Contraste "document.querySelector('main table tbody td:nth-child(3) textarea, main table tbody td:nth-child(3)')"
    $c7 = Contraste "document.querySelector('main table thead th:nth-child(2) button')"
    OK ($c6 -ge 4.5 -and $c7 -ge 4.5) "oscuro: contraste AA en celdas y cabecera de la tabla" "celda=$c6 cabecera=$c7"
    IrH '/admin/catalogos'
    Esperar $HUB 60000 | Out-Null
    JS "document.documentElement.setAttribute('data-tema','oscuro'); true" | Out-Null
    Start-Sleep -Milliseconds 500
    Captura 'admcat_oscuro_hub.png'
    OK ((Errores-Pagina) -eq '') 'sin errores de pagina al final' (Errores-Pagina)
}
catch { $script:Resultados.Add("EXCEPCION: $($_.Exception.Message) :: $($_.InvocationInfo.PositionMessage)") }
finally {
    try { if ($idCat) { Rest "categorias_labor?id=eq.$idCat" 'Delete' -Servicio | Out-Null } } catch { $script:Resultados.Add("LIMPIEZA categoria: $($_.Exception.Message)") }
    try { Rest "categorias_labor?nombre=like.QA-UX-$sufijo-*" 'Delete' -Servicio | Out-Null } catch { $script:Resultados.Add("LIMPIEZA categorias: $($_.Exception.Message)") }
    try {
        foreach ($t in 'perfiles_zonas', 'perfiles_estaciones') { Rest "${t}?perfil_id=eq.$qaId" 'Delete' -Servicio | Out-Null }
        Rest "perfiles?id=eq.$qaId" 'Delete' -Servicio | Out-Null
        Invoke-RestMethod -Method Delete -Uri "$URLB/auth/v1/admin/users/$qaId" -Headers $hServ | Out-Null
    } catch { $script:Resultados.Add("LIMPIEZA usuario: $($_.Exception.Message)") }
    try {
        $restos = (Lista "categorias_labor?select=id&nombre=like.QA-UX-$sufijo-*").Count + (Lista "perfiles?select=id&id=eq.$qaId").Count
        OK ($restos -eq 0) 'Limpieza: no queda nada de prueba (categorias, usuario)' "restos=$restos"
    } catch { $script:Resultados.Add("VERIFICACION limpieza: $($_.Exception.Message)") }
    Remove-Item $archivoQa -ErrorAction SilentlyContinue
    Terminar-QA
}
