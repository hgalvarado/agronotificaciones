# QA - Administracion: navegacion agrupada (sin scroll lateral) y Catalogos en dos niveles (hub + catalogo a ancho completo).
# Anchos 1568, 1024, 768 y 412; letra grande (raiz 24 px). Crea un usuario QA TEMPORAL (rol de acceso total) y una categoria
# de labor de prueba; al final borra TODO por id exacto y lo verifica. Archivo solo ASCII (PowerShell 5.1).
# Uso: powershell -ExecutionPolicy Bypass -File pruebas/qa/admin_catalogos_ux.ps1 -Base http://localhost:3110 -PuertoCdp 9360
param([string]$Base = 'http://localhost:3110', [int]$PuertoCdp = 9360)
. "$PSScriptRoot\comun.ps1"

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
$script:FS = 16
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
$HUB = "document.querySelectorAll('main h2').length >= 5"
$ENLACE_NAV = "[...document.querySelectorAll('nav a')].find(a => a.offsetParent !== null"

# Texto minimo visible (px) y rem actual, en main
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

# Cuantos textos truncados hay dentro de la tabla (ellipsis o contenido mas ancho que su caja)
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

# Contraste (WCAG) de un elemento contra su fondo efectivo
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

function Revisar-Nav($etq, [bool]$escritorio) {
    if ($escritorio) {
        $r = JS "(() => { const n = [...document.querySelectorAll('nav[aria-label^=Administraci]')].find(x => x.offsetParent !== null); if (!n) return 'sin-riel'; return JSON.stringify({ grupos: [...n.querySelectorAll('p')].map(p => p.textContent.trim()), links: n.querySelectorAll('a').length, scrollW: n.scrollWidth <= n.clientWidth + 1, activo: !!n.querySelector('a[aria-current=page]') }) })()"
        OK ($r -ne 'sin-riel' -and $r -match 'Datos maestros' -and $r -match 'Costos' -and $r -match 'Personas y seguridad' -and $r -match 'Fertirriego') "$etq riel agrupado con 4 grupos" $r
        OK ($r -match '"scrollW":true') "$etq riel sin scroll lateral"
        OK ($r -match '"activo":true') "$etq seccion activa resaltada"
        $pos = JS "(() => { const n = [...document.querySelectorAll('nav[aria-label^=Administraci]')].find(x => x.offsetParent !== null); return getComputedStyle(n).position })()"
        OK ($pos -eq 'sticky') "$etq riel pegajoso" $pos
        $barra = JS "[...document.querySelectorAll('button[aria-haspopup=dialog]')].some(b => b.offsetParent !== null)"
        OK (-not $barra) "$etq sin barra movil en escritorio"
    } else {
        $b = JS "[...document.querySelectorAll('button[aria-haspopup=dialog]')].some(b => b.offsetParent !== null && /Administraci/.test(b.textContent))"
        OK ($b -eq $true) "$etq barra 'Administracion > seccion' visible"
        $txt = JS "([...document.querySelectorAll('button[aria-haspopup=dialog]')].find(b => b.offsetParent !== null)||{textContent:''}).textContent.replace(/\s+/g,' ').trim()"
        OK ($txt -match 'Cat.logos') "$etq barra muestra la seccion actual" $txt
        OK ((ClicHasta "[...document.querySelectorAll('button[aria-haspopup=dialog]')].find(b => b.offsetParent !== null)" "!!document.querySelector('[role=dialog]')") -eq $true) "$etq la hoja se abre"
        $h = JS "(() => { const d = document.querySelector('[role=dialog]'); const a = [...d.querySelectorAll('a')]; return JSON.stringify({ n: a.length, minAlto: Math.min(...a.map(x => x.getBoundingClientRect().height)), grupos: [...d.querySelectorAll('p')].map(p => p.textContent.trim()), sinScroll: d.scrollWidth <= d.clientWidth + 1 }) })()"
        $ho = $h | ConvertFrom-Json
        OK ($ho.n -ge 8 -and ($ho.grupos -contains 'Datos maestros') -and ($ho.grupos -contains 'Fertirriego')) "$etq hoja con la lista agrupada completa" $h
        OK ($ho.minAlto -ge 43.5) "$etq enlaces de la hoja >= 44 px" "$($ho.minAlto)"
        OK ($ho.sinScroll) "$etq hoja sin scroll lateral"
        Captura "admcat_${etq}_hoja.png"
        Tecla 'Escape' 27
        OK ((Esperar "!document.querySelector('[role=dialog]')" 3000) -ge 0) "$etq Esc cierra la hoja"
    }
}

$idCat = $null
try {
    $anchos = @(@(1568, 698, $false), @(1280, 720, $false), @(1024, 768, $false), @(768, 900, $false), @(412, 800, $true))
    foreach ($a in $anchos) {
        $w = $a[0]
        $etq = "w$w"
        Pantalla -Ancho $w -Alto $a[1] -Movil:$a[2]
        Ir '/admin/catalogos'
        OK ((Esperar $HUB 90000) -ge 0) "$etq hub: tarjetas de bloque visibles" ''
        Start-Sleep -Milliseconds 600
        OK ((SinScrollH) -eq $true) "$etq hub: sin scroll horizontal de pagina"
        OK ((JS "[...document.querySelectorAll('main a')].filter(a => a.href.includes('catalogo=')).length") -ge 15) "$etq hub: todos los catalogos a la vista sin abrir nada"
        $mf = JS $JS_MINFONT | ConvertFrom-Json
        OK ($mf.ok) "$etq hub: texto minimo >= 12 px (0.75 rem)" "min=$($mf.min) rem=$($mf.rem) $($mf.quien)"
        Captura "admcat_${etq}_hub.png"
        Revisar-Nav $etq ($w -ge 1280)

        # buscador del hub
        Teclear "document.querySelector('main input[type=search]')" 'tractores'
        Start-Sleep -Milliseconds 400
        $n = JS "document.querySelectorAll('main h2').length"
        $e = JS "[...document.querySelectorAll('main a')].filter(a => a.href.includes('catalogo=')).length"
        OK ($n -eq 1 -and $e -lt 6) "$etq hub: el buscador filtra por nombre o descripcion" "bloques=$n catalogos=$e"
        Captura "admcat_${etq}_hub_busqueda.png"
        Teclear "document.querySelector('main input[type=search]')" 'zzzxx'
        Start-Sleep -Milliseconds 300
        OK ((JS "document.body.innerText.includes('Ning')") -eq $true) "$etq hub: sin coincidencias explica que hacer"
        ClicEn "[...document.querySelectorAll('button')].find(b => /Borrar b/.test(b.getAttribute('aria-label') || ''))" | Out-Null
        Start-Sleep -Milliseconds 300
        OK ((JS "document.querySelectorAll('main h2').length") -ge 5) "$etq hub: borrar la busqueda restaura los bloques"
        if ($w -ge 640) {
            JS "(document.activeElement && document.activeElement.blur(), document.body.focus(), true)" | Out-Null
            CDP 'Input.dispatchKeyEvent' @{ type = 'keyDown'; key = '/'; code = 'Slash'; text = '/'; windowsVirtualKeyCode = 191 } | Out-Null
            CDP 'Input.dispatchKeyEvent' @{ type = 'keyUp'; key = '/'; code = 'Slash'; windowsVirtualKeyCode = 191 } | Out-Null
            OK ((Esperar "document.activeElement && document.activeElement.type === 'search'" 2000) -ge 0) "$etq hub: la tecla / enfoca el buscador"
        }

        # abrir Equipos a ancho completo
        $js = "[...document.querySelectorAll('main a')].find(a => a.href.includes('catalogo=equipos') && a.textContent.trim().startsWith('Equipos'))"
        OK ((ClicHasta $js "location.search.includes('catalogo=equipos')") -eq $true) "$etq Equipos: la URL lleva ?catalogo=equipos"
        OK ((Esperar "document.querySelectorAll('main table tbody tr, main dl').length > 3" 20000) -ge 0) "$etq Equipos: filas visibles"
        Start-Sleep -Milliseconds 500
        OK ((SinScrollH) -eq $true) "$etq Equipos: sin scroll horizontal de pagina"
        $tr = JS $JS_TRUNC
        OK ([string]::IsNullOrEmpty($tr)) "$etq Equipos: ningun texto truncado" $tr
        $mig = JS "(() => { const n = document.querySelector('nav[aria-label=Ruta]'); return n ? n.textContent.replace(/\s+/g,' ') : '' })()"
        OK ($mig -match 'Cat.logos' -and $mig -match 'Equipos e implementos' -and $mig -match 'Equipos$') "$etq Equipos: migas Catalogos > Grupo > Catalogo" $mig
        OK ((JS "[...document.querySelectorAll('main button')].some(b => b.offsetParent !== null && /^Cat.logos$/.test(b.textContent.trim()))") -eq $true) "$etq Equipos: boton Catalogos para volver"
        $bt = JS "(() => { const t = [...document.querySelectorAll('main button')].filter(b => b.offsetParent !== null).map(b => b.textContent.trim()); return JSON.stringify({ imp: t.includes('Importar'), exp: t.includes('Exportar'), add: t.includes('Agregar') }) })()"
        OK ($bt -eq '{"imp":true,"exp":true,"add":true}') "$etq Equipos: Importar, Exportar y Agregar presentes" $bt
        OK ((JS "[...document.querySelectorAll('main select')].some(s => s.offsetParent !== null && s.options.length > 1)") -eq $true) "$etq Equipos: selector para saltar a otro catalogo del bloque"
        if ($w -ge 768) {
            $tab = JS "(() => { const t = document.querySelector('main table'); if (!t) return 'sin-tabla'; const c = t.closest('.overflow-auto'); const th = t.querySelector('thead'); return JSON.stringify({ scrollH: c.scrollWidth <= c.clientWidth + 1, sticky: getComputedStyle(th).position, cols: t.querySelectorAll('thead th').length }) })()"
            OK ($tab -match '"sticky":"sticky"') "$etq Equipos: cabecera pegajosa" $tab
            if ($w -ge 1568) { OK ($tab -match '"scrollH":true') "$etq Equipos: tabla sin scroll horizontal propio" $tab }
        } else {
            OK ((JS "document.querySelectorAll('main dl').length") -gt 3) "$etq Equipos: filas como tarjetas apiladas (campo: valor)"
        }
        $mf = JS $JS_MINFONT | ConvertFrom-Json
        OK ($mf.ok) "$etq Equipos: texto minimo >= 12 px (0.75 rem)" "min=$($mf.min) rem=$($mf.rem) $($mf.quien)"
        Captura "admcat_${etq}_equipos.png"

        # saltar a otro catalogo del bloque, Atras y Adelante
        JS "(() => { const s = [...document.querySelectorAll('main select')].find(x => x.offsetParent !== null && x.options.length > 1); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, 'familias'); s.dispatchEvent(new Event('change', { bubbles: true })); return true })()" | Out-Null
        OK ((Esperar "location.search.includes('catalogo=familias')" 5000) -ge 0) "$etq salto rapido a Familias actualiza la URL"
        JS "history.back()" | Out-Null
        OK ((Esperar "location.search.includes('catalogo=equipos')" 5000) -ge 0) "$etq Atras vuelve a Equipos"
        JS "history.back()" | Out-Null
        OK ((Esperar "!location.search.includes('catalogo=') && document.querySelectorAll('main h2').length >= 5" 5000) -ge 0) "$etq Atras vuelve al hub"
        JS "history.forward()" | Out-Null
        OK ((Esperar "location.search.includes('catalogo=equipos')" 5000) -ge 0) "$etq Adelante reabre Equipos"
        JS "location.reload()" | Out-Null
        OK ((Esperar "location.search.includes('catalogo=equipos') && document.querySelectorAll('main table tbody tr, main dl').length > 3" 60000) -ge 0) "$etq recargar conserva el catalogo (?catalogo=)"
        # boton volver
ClicHasta "[...document.querySelectorAll('main button')].find(b => b.offsetParent !== null && /^Cat.logos$/.test(b.textContent.trim()))" "!location.search.includes('catalogo=')" | Out-Null
        OK ((Esperar "!location.search.includes('catalogo=') && document.querySelectorAll('main h2').length >= 5" 5000) -ge 0) "$etq boton Catalogos regresa al hub"

        if ($w -lt 1280) {
            # movil: elegir otra seccion desde la hoja y volver
            ClicHasta "[...document.querySelectorAll('button[aria-haspopup=dialog]')].find(b => b.offsetParent !== null)" "!!document.querySelector('[role=dialog]')" | Out-Null
            ClicEn "[...document.querySelectorAll('[role=dialog] a')].find(a => a.textContent.trim() === 'Lotes')" | Out-Null
            OK ((Esperar "location.pathname === '/admin/lotes'" 60000) -ge 0) "$etq elegir 'Lotes' en la hoja navega y la hoja se cierra"
            OK ((SinScrollH) -eq $true) "$etq /admin/lotes sin scroll horizontal de pagina"
            Captura "admcat_${etq}_lotes.png"
        }
        OK ((Errores-Pagina) -eq '') "$etq sin errores de pagina" (Errores-Pagina)
    }

    # ---------------- Agregar, editar en linea y eliminar (escritorio y movil) ----------------
    foreach ($a in @(@(1568, 698, $false), @(412, 800, $true))) {
        $w = $a[0]; $etq = "ciclo$w"
        Pantalla -Ancho $w -Alto $a[1] -Movil:$a[2]
        $nom = "QA-UX-$sufijo-$w"; $nom2 = "$nom-b"
        Ir '/admin/catalogos?catalogo=categorias_labor'
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
        # editar en linea: buscar la fila y teclear en su celda
        Teclear "document.querySelector('main input[placeholder^=Buscar]')" $nom
        Start-Sleep -Milliseconds 500
        $celda = "[...document.querySelectorAll('main textarea')].find(t => t.offsetParent !== null && t.value === '$nom')"
        OK ((Esperar "!!($celda)" 15000) -ge 0) "$etq la celda editable (texto que baja de linea) muestra el valor"
        Teclear $celda $nom2
        Tecla 'Enter' 13
        $ok2 = $false
        for ($i = 0; $i -lt 30 -and -not $ok2; $i++) { Start-Sleep -Milliseconds 300; if ((Lista "categorias_labor?select=id&nombre=eq.$nom2").Count -gt 0) { $ok2 = $true } }
        OK $ok2 "$etq edicion en linea guarda con Enter" $nom2
        Captura "admcat_${etq}_editada.png"
        # seleccionar y eliminar
        Teclear "document.querySelector('main input[placeholder^=Buscar]')" $nom2
        Start-Sleep -Milliseconds 600
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
    foreach ($a in @(@(412, 800, $true), @(1024, 768, $false))) {
        $w = $a[0]; $etq = "g24w$w"
        Pantalla -Ancho $w -Alto $a[1] -Movil:$a[2]
        Ir '/admin/catalogos'
        OK ((Esperar $HUB 60000) -ge 0) "$etq hub con letra 24 px" ''
        Start-Sleep -Milliseconds 600
        OK ((SinScrollH) -eq $true) "$etq hub sin scroll horizontal"
        Captura "admcat_${etq}_hub.png"
        $js = "[...document.querySelectorAll('main a')].find(a => a.href.includes('catalogo=equipos') && a.textContent.trim().startsWith('Equipos'))"
        ClicHasta $js "location.search.includes('catalogo=equipos')" | Out-Null
        Esperar "document.querySelectorAll('main table tbody tr, main dl').length > 3" 20000 | Out-Null
        Start-Sleep -Milliseconds 500
        OK ((SinScrollH) -eq $true) "$etq Equipos sin scroll horizontal de pagina"
        $tr = JS $JS_TRUNC
        OK ([string]::IsNullOrEmpty($tr)) "$etq Equipos sin textos truncados" $tr
        Captura "admcat_${etq}_equipos.png"
        if ($a[2]) {
            ClicHasta "[...document.querySelectorAll('button[aria-haspopup=dialog]')].find(b => b.offsetParent !== null)" "!!document.querySelector('[role=dialog]')" | Out-Null
            $d = JS "(() => { const d = document.querySelector('[role=dialog]'); return d ? d.scrollWidth <= d.clientWidth + 1 : false })()"
            OK ($d -eq $true) "$etq hoja de navegacion sin scroll lateral"
            Captura "admcat_${etq}_hoja.png"
            Tecla 'Escape' 27
        }
    }
    CDP 'Page.addScriptToEvaluateOnNewDocument' @{ source = "" } | Out-Null

    # ---------------- Tema oscuro ----------------
    Pantalla -Ancho 1568 -Alto 698
    Ir '/admin/catalogos'
    Esperar $HUB 60000 | Out-Null
    JS "document.documentElement.setAttribute('data-tema','oscuro'); true" | Out-Null
    Start-Sleep -Milliseconds 500
    Captura 'admcat_oscuro_hub.png'
    $c1 = Contraste "document.querySelector('main h1')"
    $c2 = Contraste "document.querySelector('main h2')"
    $c3 = Contraste "document.querySelector('main ul a span span:nth-child(2)')"
    $c4 = Contraste "document.querySelector('nav[aria-label^=Administraci] a[aria-current=page]')"
    $c5 = Contraste "document.querySelector('nav[aria-label^=Administraci] a:not([aria-current])')"
    OK ($c1 -ge 4.5 -and $c2 -ge 4.5 -and $c3 -ge 4.5 -and $c4 -ge 4.5 -and $c5 -ge 4.5) "oscuro: contraste AA en titulo, bloque, descripcion y riel" "h1=$c1 h2=$c2 desc=$c3 activo=$c4 enlace=$c5"
    $js = "[...document.querySelectorAll('main a')].find(a => a.href.includes('catalogo=equipos') && a.textContent.trim().startsWith('Equipos'))"
    ClicHasta $js "location.search.includes('catalogo=equipos')" | Out-Null
    Esperar "document.querySelectorAll('main table tbody tr').length > 3" 20000 | Out-Null
    Start-Sleep -Milliseconds 500
    Captura 'admcat_oscuro_equipos.png'
    $c6 = Contraste "document.querySelector('main table tbody td:nth-child(3) textarea, main table tbody td:nth-child(3)')"
    $c7 = Contraste "document.querySelector('main table thead th:nth-child(2) button')"
    OK ($c6 -ge 4.5 -and $c7 -ge 4.5) "oscuro: contraste AA en celdas y cabecera de la tabla" "celda=$c6 cabecera=$c7"
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
