# QA · UX móvil de tickets de maquinaria con TEXTO GRANDE del teléfono (fuente raíz 24 px = 150 %; 32 px = 200 %).
# Comprueba: (a) equipo con código y nombre largos se lee completo (sin «…», sin scroll horizontal) en lista de tickets,
# detalle del ticket y página del horómetro; (b) botón «Volver al ticket TK-…» (>= 44 px, navega) y aviso «Guardado»
# con las dos salidas tras guardar una labor; (c) selector de ubicaciones técnicas: nombre del lote protagonista, código
# secundario, área Neta y Bruta (y lote sin bruta sin «Bruta — mz»), búsqueda por nombre y por código; (d) sin errores.
# Crea un usuario QA TEMPORAL (rol con acceso total, todas las zonas), un equipo, 2 lotes con su asignación a la
# temporada activa, un ticket y un horómetro de prueba; al final borra TODO por id exacto y lo verifica.
# Uso: powershell -ExecutionPolicy Bypass -File pruebas/qa/tickets_ux.ps1 -Base http://localhost:3105 -PuertoCdp 9355
param([string]$Base = 'http://localhost:3105', [int]$PuertoCdp = 9355)
. "$PSScriptRoot\comun.ps1"

# ------------------------------------------------------------ usuario QA temporal
$envQa = Leer-Entorno
$URLB = $envQa['NEXT_PUBLIC_SUPABASE_URL']; $SERV = $envQa['SUPABASE_SERVICE_ROLE_KEY']
$hServ = @{ apikey = $SERV; Authorization = "Bearer $SERV" }
$sufijo = Get-Random -Maximum 99999
$qaEmail = "qa.ux.$([guid]::NewGuid().ToString('N').Substring(0,10))@desarrollo.local"; $qaClave = "Qa-$(Get-Random)-x$(Get-Random)"
$archivoQa = "$PSScriptRoot\qa_usuario.local.json"
$usr = Invoke-RestMethod -Method Post -Uri "$URLB/auth/v1/admin/users" -Headers $hServ -ContentType 'application/json' -Body (@{ email = $qaEmail; password = $qaClave; email_confirm = $true } | ConvertTo-Json)
$qaId = $usr.id
$rolTotal = (Invoke-RestMethod "$URLB/rest/v1/roles?select=id&acceso_total=eq.true&order=id&limit=1" -Headers $hServ)[0].id
Invoke-RestMethod -Method Post "$URLB/rest/v1/perfiles" -Headers $hServ -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes((@{ id = $qaId; nombre = "QA UX Tickets $sufijo"; rol_id = $rolTotal; todas_las_zonas = $true } | ConvertTo-Json))) | Out-Null
@{ id = $qaId; email = $qaEmail; clave = $qaClave } | ConvertTo-Json | Set-Content -Encoding utf8 $archivoQa

Iniciar-QA -Base $Base -Ancho 360 -Alto 780 -Movil -Puerto $PuertoCdp
CDP 'Page.enable' | Out-Null   # sin esto los scripts de «documento nuevo» (texto grande, window.__err) no corren
# Texto grande del sistema: la raíz a 24 px reescala todo lo que está en rem (Tailwind). Se reaplica en cada página.
$script:FS = 24
function TextoGrande([int]$px) {
    $script:FS = $px
    CDP 'Page.addScriptToEvaluateOnNewDocument' @{ source = "(function(){function a(){var d=document.documentElement;if(d&&d.style.fontSize!=='${px}px')d.style.setProperty('font-size','${px}px','important')}var t=setInterval(function(){var d=document.documentElement;if(!d)return;clearInterval(t);a();new MutationObserver(a).observe(d,{attributes:true,attributeFilter:['style']})},0)})()" } | Out-Null
}
function Lista($ruta) { $o = New-Object System.Collections.ArrayList; foreach ($x in (Rest $ruta -Servicio)) { if ($null -ne $x) { [void]$o.Add($x) } }; return ,$o }
function ClicEn($js) { JS "(() => { const e = $js; if (!e) return false; e.scrollIntoView({block:'center'}); e.click(); return true })()" }
function ClicHasta($js, $condicion, [int]$veces = 15) { for ($i = 0; $i -lt $veces; $i++) { ClicEn $js | Out-Null; if ((Esperar $condicion 700) -ge 0) { return $true } }; return $false }
$DLG = "[...document.querySelectorAll('[role=dialog]')].pop()"
# Sin ellipsis activo ni recorte sobre el texto dado: sube por los ancestros hasta <main>
function SinCorte($texto) {
    JS @"
(() => {
  const t = '$texto'.toLowerCase();
  const els = [...document.querySelectorAll('main *')].filter(e => e.offsetParent !== null && e.children.length === 0 && (e.textContent||'').toLowerCase().includes(t));
  if (!els.length) return 'no-encontrado';
  for (const e of els) {
    for (let n = e; n && n.tagName !== 'MAIN'; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.textOverflow === 'ellipsis') return 'ellipsis en ' + n.tagName + '.' + n.className.toString().slice(0,60);
      if ((cs.overflowX === 'hidden' || cs.overflowX === 'clip') && n.scrollWidth > n.clientWidth + 1 && n.contains(e)) return 'recortado por ' + n.tagName;
    }
    if (e.scrollWidth > e.clientWidth + 1) return 'scrollWidth>clientWidth';
  }
  return 'ok';
})()
"@
}
function SinScrollH { JS "document.documentElement.scrollWidth <= window.innerWidth + 1" }

$ids = @{}
$creados = @{ lotes = @(); lt = @(); equipos = @(); tickets = @(); hor = @() }
try {
    # ------------------------------------------------------------ datos de prueba
    $temp = (Lista 'temporadas?select=id,nombre&activa=eq.true&limit=1')[0]
    $zona = (Lista 'zonas?select=id&activo=eq.true&limit=1')[0]
    $EQ_COD = "QAUXTRACTOR-ARTICULADO-$sufijo"
    $EQ_NOM = "Tractor articulado de orugas con subsolador profundo y cabina QA $sufijo"
    $eq = (Rest 'equipos' 'Post' @{ codigo = $EQ_COD; nombre = $EQ_NOM; activo = $true; visible_app = $true } -Servicio)[0]
    $creados.equipos += $eq.id
    $L1_NOM = "Carretillo Largo de Prueba Experimental $sufijo"; $L1_COD = "QAUX-$sufijo-A"
    $L2_NOM = "Lote Sin Bruta $sufijo"; $L2_COD = "QAUX-$sufijo-B"
    $l1 = (Rest 'lotes' 'Post' @{ nomenclatura = $L1_COD; nombre = $L1_NOM } -Servicio)[0]; $creados.lotes += $l1.id
    $l2 = (Rest 'lotes' 'Post' @{ nomenclatura = $L2_COD; nombre = $L2_NOM } -Servicio)[0]; $creados.lotes += $l2.id
    $lt1 = (Rest 'lotes_temporada' 'Post' @{ lote_id = $l1.id; temporada_id = $temp.id; zona_id = $zona.id; area_bruta = 13.8; area_neta = 12.5; ciclo = 1 } -Servicio)[0]; $creados.lt += $lt1.id
    $lt2 = (Rest 'lotes_temporada' 'Post' @{ lote_id = $l2.id; temporada_id = $temp.id; zona_id = $zona.id; area_neta = 7.25; ciclo = 1 } -Servicio)[0]; $creados.lt += $lt2.id
    $fecha = (Get-Date).AddDays(-1).ToString('yyyy-MM-dd')
    $TK_COD = "QA-UX-$sufijo"
    $tk = (Rest 'tickets' 'Post' @{ usuario_id = $qaId; fecha = $fecha; codigo = $TK_COD; estado = 'ABIERTO'; proceso = 'REGISTRADO'; temporada_id = $temp.id } -Servicio)[0]; $creados.tickets += $tk.id
    $h = (Rest 'horometros' 'Post' @{ ticket_id = $tk.id; fecha = $fecha; turno = 'DIURNO'; equipo_id = $eq.id; horometro_inicial = 100; horometro_final = 108; horas_hombre = 8; usuario_id = $qaId } -Servicio)[0]; $creados.hor += $h.id
    $h2 = (Rest 'horometros' 'Post' @{ ticket_id = $tk.id; fecha = $fecha; turno = 'NOCTURNO'; equipo_id = $eq.id; horometro_inicial = 100; horometro_final = 108; horas_hombre = 8; usuario_id = $qaId } -Servicio)[0]; $creados.hor += $h2.id
    OK ($eq.id -and $lt1.id -and $lt2.id -and $tk.id -and $h.id) 'Datos de prueba creados' "equipo=$EQ_COD ticket=$TK_COD"
    $RUTA_TK = "/tickets/$($tk.id)"
    $RUTA_H = "/tickets/$($tk.id)/horometros/$($h.id)"
    $RUTA_H2 = "/tickets/$($tk.id)/horometros/$($h2.id)"

    foreach ($ancho in 360, 412) {
        Pantalla -Ancho $ancho -Alto 800 -Movil
        TextoGrande 24
        $tag = "$ancho"

        # ---------------------------------------------------------- (a) lista de tickets
        Ir '/tickets'
        $t = Esperar "document.body.innerText.includes('$TK_COD')" 25000
        OK ($t -ge 0) "[$tag] Lista de tickets muestra el ticket de prueba" "$t ms"
        OK ((JS "parseFloat(getComputedStyle(document.documentElement).fontSize)") -ge 24) "[$tag] Texto grande activo (fuente raíz >= 24 px)" (JS "getComputedStyle(document.documentElement).fontSize")
        OK ((SinCorte $TK_COD) -eq 'ok') "[$tag] Lista: el código del ticket no se corta" (SinCorte $TK_COD)
        OK ([bool](SinScrollH)) "[$tag] Lista: sin scroll horizontal"
        Captura "ux_${tag}_lista.png"

        # ---------------------------------------------------------- (a) detalle del ticket
        Ir $RUTA_TK
        $t = Esperar "document.body.innerText.includes('$EQ_COD')" 25000
        OK ($t -ge 0) "[$tag] Detalle del ticket lista el equipo" "$t ms"
        OK ((SinCorte $EQ_COD) -eq 'ok') "[$tag] Detalle: el CÓDIGO del equipo se lee completo" (SinCorte $EQ_COD)
        OK ((SinCorte 'subsolador profundo') -eq 'ok') "[$tag] Detalle: el NOMBRE del equipo se lee completo" (SinCorte 'subsolador profundo')
        $lineas = JS "(() => { const e = document.querySelector('[data-equipo-nombre]'); if (!e) return 0; return Math.round(e.getBoundingClientRect().height / parseFloat(getComputedStyle(e).lineHeight)) })()"
        OK ($lineas -ge 2 -and $lineas -le 4) "[$tag] Detalle: el nombre baja a 2-4 líneas (no se trunca)" "$lineas líneas"
        Start-Sleep -Milliseconds 800
        $ratio = JS @"
(() => { const e = document.querySelector('[data-equipo-nombre]'); const lum = c => { const v = c.match(/[\d.]+/g).slice(0,3).map(Number).map(x => { x/=255; return x<=0.03928 ? x/12.92 : Math.pow((x+0.055)/1.055,2.4) }); return 0.2126*v[0]+0.7152*v[1]+0.0722*v[2] };
  let bg = 'rgb(255,255,255)'; for (let n = e; n; n = n.parentElement) { const b = getComputedStyle(n).backgroundColor; if (b && !/rgba\(.*, 0\)|transparent/.test(b)) { bg = b; break } }
  const l1 = lum(getComputedStyle(e).color), l2 = lum(bg); return ((Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05)).toFixed(2) })()
"@
        OK ([double]$ratio -ge 4.5) "[$tag] Detalle: nombre del equipo con contraste AA (>= 4.5)" "$ratio : 1 (color $(JS "getComputedStyle(document.querySelector('[data-equipo-nombre]')).color"))"
        OK ([bool](SinScrollH)) "[$tag] Detalle: sin scroll horizontal"
        Captura "ux_${tag}_ticket.png"

        # ---------------------------------------------------------- (a)(b) página del horómetro
        Ir $RUTA_H
        $t = Esperar "!!document.querySelector('[data-volver-ticket]')" 25000
        OK ($t -ge 0) "[$tag] Horómetro: aparece el botón de volver" "$t ms"
        Start-Sleep -Milliseconds 800
        OK ((SinCorte $EQ_COD) -eq 'ok') "[$tag] Horómetro: código del equipo completo" (SinCorte $EQ_COD)
        OK ((SinCorte 'subsolador profundo') -eq 'ok') "[$tag] Horómetro: nombre del equipo completo" (SinCorte 'subsolador profundo')
        OK ([bool](SinScrollH)) "[$tag] Horómetro: sin scroll horizontal"
        $txt = JS "document.querySelector('[data-volver-ticket] a').innerText.trim()"
        OK ($txt -eq "Volver al ticket $TK_COD") "[$tag] Botón dice «Volver al ticket TK-…»" $txt
        $alto = JS "document.querySelector('[data-volver-ticket] a').getBoundingClientRect().height"
        OK ($alto -ge 43.5) "[$tag] Botón de volver mide >= 44 px" "$alto px"
        OK ((JS "document.querySelector('[data-volver-ticket]').innerText") -match 'agregas otro equipo o cierras el ticket') "[$tag] Línea de ayuda «Ahí agregas otro equipo o cierras el ticket»"
        Captura "ux_${tag}_horometro_vacio.png"
        ClicEn "document.querySelector('[data-volver-ticket] a')" | Out-Null
        $t = Esperar "location.pathname === '$RUTA_TK'" 20000
        OK ($t -ge 0) "[$tag] Clic en volver navega al ticket" (JS 'location.pathname')
    }

    # ---------------------------------------------------------- (b)(c) agregar una labor (412 px, texto grande)
    Pantalla -Ancho 412 -Alto 800 -Movil
    Ir "$RUTA_H/registros/nuevo"
    $t = Esperar "[...document.querySelectorAll('button')].some(b => b.textContent.includes('Buscar labor'))" 30000
    OK ($t -ge 0) 'Formulario de labor abre' "$t ms"
    # Labor: la primera de la lista
    ClicHasta "[...document.querySelectorAll('button')].find(b => b.offsetParent && b.textContent.includes('Buscar labor'))" "document.querySelectorAll('[role=dialog]').length > 0" | Out-Null
    $okL = ClicEn "[...$DLG.querySelectorAll('button')].find(b => b.offsetParent && b.querySelector('span.block') && !/Cancelar|Cerrar|Crear/i.test(b.textContent))"
    Esperar "document.querySelectorAll('[role=dialog]').length === 0" 5000 | Out-Null
    OK ([bool]$okL) 'Elige una labor'
    # Tarea SAP: la primera
    ClicHasta "[...document.querySelectorAll('button')].find(b => b.offsetParent && b.textContent.includes('Selecciona una tarea'))" "document.querySelectorAll('[role=dialog]').length > 0" | Out-Null
    ClicEn "[...$DLG.querySelectorAll('button')].find(b => b.offsetParent && b.querySelector('span.block') && !/Cancelar|Cerrar|Crear/i.test(b.textContent))" | Out-Null
    Esperar "document.querySelectorAll('[role=dialog]').length === 0" 5000 | Out-Null

    # Selector de ubicaciones técnicas
    ClicHasta "[...document.querySelectorAll('button')].find(b => b.offsetParent && /Agregar ubicaciones técnicas/.test(b.textContent))" "!!$DLG && !!$DLG.querySelector('input[placeholder=""Buscar lote…""]')" | Out-Null
    $INPUT = "$DLG.querySelector('input[placeholder=""Buscar lote…""]')"
    # Búsqueda por NOMBRE
    Teclear $INPUT "Carretillo Largo de Prueba Experimental $sufijo"
    Start-Sleep -Milliseconds 400
    $n = JS "[...$DLG.querySelectorAll('button')].filter(b => b.textContent.includes('$L1_COD')).length"
    OK ($n -eq 1) 'Búsqueda por NOMBRE del lote lo encuentra' "coincidencias=$n"
    # Búsqueda por CÓDIGO
    Teclear $INPUT $L2_COD
    Start-Sleep -Milliseconds 400
    $n2 = JS "[...$DLG.querySelectorAll('button')].filter(b => b.textContent.includes('$L2_NOM')).length"
    OK ($n2 -eq 1) 'Búsqueda por CÓDIGO del lote lo encuentra' "coincidencias=$n2"
    # Ver los dos lotes
    Teclear $INPUT "QAUX-$sufijo"
    Start-Sleep -Milliseconds 400
    $f1 = JS "(() => { const b = [...$DLG.querySelectorAll('button')].find(b => b.textContent.includes('$L1_COD')); if (!b) return 'no'; const nom = b.querySelector('[data-lote-nombre]'); const cod = b.querySelector('[data-lote-codigo]'); const ar = b.querySelector('[data-areas-lote]'); return JSON.stringify({ nom: nom && nom.textContent, cod: cod && cod.textContent, areas: ar && ar.textContent, nomPx: nom && parseFloat(getComputedStyle(nom).fontSize), codPx: cod && parseFloat(getComputedStyle(cod).fontSize), nomPeso: nom && getComputedStyle(nom).fontWeight, codPeso: cod && getComputedStyle(cod).fontWeight }) })()"
    Captura 'ux_412_selector_lotes.png'
    $o1 = $f1 | ConvertFrom-Json
    OK ($o1.nom -eq $L1_NOM -and $o1.cod -eq $L1_COD) 'Selector: nombre del lote (principal) y código (secundario)' $f1
    OK ($o1.nomPx -ge $o1.codPx -and [int]$o1.codPeso -ge 700) 'Selector: nombre >= tamaño del código; código en negrita' "nom=$($o1.nomPx)px cod=$($o1.codPx)px/$($o1.codPeso)"
    OK ($o1.areas -match 'Neta\s*12\.5 mz' -and $o1.areas -match 'Bruta\s*13\.8 mz') 'Selector: lote con Neta 12.5 mz · Bruta 13.8 mz' $o1.areas
    $a2 = JS "(() => { const b = [...$DLG.querySelectorAll('button')].find(b => b.textContent.includes('$L2_COD')); return b && b.querySelector('[data-areas-lote]') && b.querySelector('[data-areas-lote]').textContent })()"
    OK ($a2 -match 'Neta\s*7\.25 mz' -and $a2 -notmatch 'Bruta') 'Selector: lote sin bruta muestra solo la neta (sin «Bruta — mz»)' $a2
    # Marcar los dos y confirmar
    ClicEn "[...$DLG.querySelectorAll('button')].find(b => b.textContent.includes('$L1_COD'))" | Out-Null
    ClicEn "[...$DLG.querySelectorAll('button')].find(b => b.textContent.includes('$L2_COD'))" | Out-Null
    ClicEn "[...$DLG.querySelectorAll('button')].find(b => /^Agregar\s*\d/.test(b.textContent.trim()))" | Out-Null
    $t = Esperar "document.querySelectorAll('[role=dialog]').length === 0" 6000
    OK ($t -ge 0) 'Los lotes se agregan a la labor'
    # Tarjetas de lote ya elegido
    $c1 = JS "(() => { const n = [...document.querySelectorAll('[data-lote-nombre]')].find(e => e.textContent === '$L1_NOM'); if (!n) return 'no'; const card = n.closest('div.px-3'); return JSON.stringify({ cod: card.querySelector('[data-lote-codigo]').textContent, areas: card.querySelector('[data-areas-lote]').textContent }) })()"
    OK ($c1 -match 'Neta\s*12\.5 mz' -and $c1 -match 'Bruta\s*13\.8 mz' -and $c1 -match $L1_COD) 'Tarjeta del lote elegido: nombre, código, neta y bruta' $c1
    $c2 = JS "(() => { const n = [...document.querySelectorAll('[data-lote-nombre]')].find(e => e.textContent === '$L2_NOM'); if (!n) return 'no'; const card = n.closest('div.px-3'); return card.querySelector('[data-areas-lote]').textContent })()"
    OK ($c2 -match 'Neta\s*7\.25 mz' -and $c2 -notmatch 'Bruta') 'Tarjeta del lote sin bruta: solo neta' $c2
    OK ((SinCorte $L1_NOM) -eq 'ok') 'Tarjeta: el nombre largo del lote no se corta' (SinCorte $L1_NOM)
    OK ([bool](SinScrollH)) 'Formulario de labor: sin scroll horizontal con texto grande'
    Captura 'ux_412_form_lotes_elegidos.png'

    # Horas: dejar las propuestas. Guardar y agregar otra (queda en el formulario con aviso y salida al ticket)
    $t = ClicEn "[...document.querySelectorAll('button')].find(b => b.offsetParent && /Guardar y agregar otra labor/.test(b.textContent))"
    $t = Esperar "!!document.querySelector('[data-aviso-guardado]')" 25000
    OK ($t -ge 0) '«Guardar y agregar otra»: aviso «Guardado» visible' (JS "document.querySelector('[data-aviso-guardado]')?.innerText")
    $bv = JS "(() => { const a = document.querySelector('[data-aviso-guardado] a'); return a ? a.innerText.trim() + '|' + a.getBoundingClientRect().height : 'no' })()"
    OK ($bv -match "^Volver al ticket $TK_COD\|") 'Aviso del formulario ofrece «Volver al ticket TK-…»' $bv
    OK ([double]($bv.Split('|')[1]) -ge 43.5) 'Esa salida mide >= 44 px'
    Captura 'ux_412_guardado_otra.png'

    # Guardar y terminar: en el SEGUNDO horómetro (el primero ya repartió sus 8 h entre las labores)
    Ir "$RUTA_H2/registros/nuevo"
    Esperar "[...document.querySelectorAll('button')].some(b => b.textContent.includes('Buscar labor'))" 30000 | Out-Null
    ClicHasta "[...document.querySelectorAll('button')].find(b => b.offsetParent && b.textContent.includes('Buscar labor'))" "document.querySelectorAll('[role=dialog]').length > 0" | Out-Null
    ClicEn "[...$DLG.querySelectorAll('button')].find(b => b.offsetParent && b.querySelector('span.block') && !/Cancelar|Cerrar|Crear/i.test(b.textContent))" | Out-Null
    Esperar "document.querySelectorAll('[role=dialog]').length === 0" 5000 | Out-Null
    ClicHasta "[...document.querySelectorAll('button')].find(b => b.offsetParent && b.textContent.includes('Selecciona una tarea'))" "document.querySelectorAll('[role=dialog]').length > 0" | Out-Null
    ClicEn "[...$DLG.querySelectorAll('button')].find(b => b.offsetParent && b.querySelector('span.block') && !/Cancelar|Cerrar|Crear/i.test(b.textContent))" | Out-Null
    Esperar "document.querySelectorAll('[role=dialog]').length === 0" 5000 | Out-Null
    ClicHasta "[...document.querySelectorAll('button')].find(b => b.offsetParent && /Agregar ubicaciones técnicas/.test(b.textContent))" "!!$DLG && !!$DLG.querySelector('input[placeholder=""Buscar lote…""]')" | Out-Null
    Teclear "$DLG.querySelector('input[placeholder=""Buscar lote…""]')" "QAUX-$sufijo"
    Start-Sleep -Milliseconds 400
    ClicEn "[...$DLG.querySelectorAll('button')].find(b => b.textContent.includes('$L1_COD'))" | Out-Null
    ClicEn "[...$DLG.querySelectorAll('button')].find(b => b.textContent.includes('$L2_COD'))" | Out-Null
    ClicEn "[...$DLG.querySelectorAll('button')].find(b => /^Agregar\s*\d/.test(b.textContent.trim()))" | Out-Null
    Esperar "document.querySelectorAll('[role=dialog]').length === 0" 6000 | Out-Null
    ClicEn "[...document.querySelectorAll('button')].find(b => b.offsetParent && /Guardar y terminar/.test(b.textContent))" | Out-Null
    $t = Esperar "location.pathname === '$RUTA_H2' && !!document.querySelector('[data-aviso-guardado]')" 30000
    Write-Host "DIAG url=$(JS 'location.pathname+location.search') alertas=[$(JS "[...document.querySelectorAll('[role=alert]')].map(e=>e.innerText.trim()).join(' || ')")] enfondo=$(JS "[...document.querySelectorAll('button')].filter(b=>/Guardando/.test(b.textContent)).length")"
    OK ($t -ge 0) '«Guardar y terminar»: llega al horómetro con el aviso «Guardado»' "$t ms $(JS 'location.pathname+location.search')"
    $botones = JS "[...document.querySelectorAll('[data-aviso-guardado] a')].map(a => a.innerText.trim() + '|' + Math.round(a.getBoundingClientRect().height)).join(' ;; ')"
    OK ($botones -match 'Agregar otra labor\|' -and $botones -match "Volver al ticket $TK_COD\|") 'Aviso ofrece «Agregar otra labor» y «Volver al ticket TK-…»' $botones
    OK ((JS "[...document.querySelectorAll('[data-aviso-guardado] a')].every(a => a.getBoundingClientRect().height >= 43.5)")) 'Las dos salidas miden >= 44 px'
    OK ((JS "document.querySelectorAll('[data-volver-ticket]').length") -eq 2) 'Botón de volver arriba Y al final de la lista de labores'
    # Labores guardadas: lotes con nombre, código, neta y bruta
    $chips = JS "[...document.querySelectorAll('[data-chip-lote]')].filter(c => c.offsetParent).map(c => c.innerText.replace(/\s+/g,' ').trim()).join(' ;; ')"
    OK ($chips -match [regex]::Escape($L1_NOM) -and $chips -match 'Neta 12\.5 mz' -and $chips -match 'Bruta 13\.8 mz' -and $chips -match $L1_COD) 'Labor guardada: lote con nombre, código, neta y bruta' $chips
    OK ($chips -match 'Neta 7\.25 mz') 'Labor guardada: lote sin bruta con su neta' ''
    OK ((SinCorte $L1_NOM) -eq 'ok') 'Labor guardada: nombre del lote completo' (SinCorte $L1_NOM)
    OK ([bool](SinScrollH)) 'Horómetro con labores: sin scroll horizontal'
    Captura 'ux_412_horometro_guardado.png'
    # al final: segundo botón de volver navega
    $ult = JS "(() => { const a = [...document.querySelectorAll('[data-volver-ticket] a')].pop(); a.scrollIntoView({block:'center'}); return a.innerText.trim() })()"
    ClicEn "[...document.querySelectorAll('[data-volver-ticket] a')].pop()" | Out-Null
    $t = Esperar "location.pathname === '$RUTA_TK'" 20000
    OK ($t -ge 0) 'El botón de volver del final navega al ticket' $ult

    # 200 % en 360 px: ticket y horómetro
    Pantalla -Ancho 360 -Alto 800 -Movil
    TextoGrande 32
    Ir $RUTA_TK
    $t = Esperar "document.body.innerText.includes('$EQ_COD')" 25000
    $pre = $EQ_NOM.Substring(0, 20)
    OK ((SinCorte $pre) -eq 'ok' -and [bool](SinScrollH)) '[360 @ 200%] Ticket: equipo completo y sin scroll horizontal'
    Captura 'ux_360_200pct_ticket.png'
    Ir $RUTA_H
    $t = Esperar "!!document.querySelector('[data-volver-ticket]')" 25000
    OK ((SinCorte 'subsolador profundo') -eq 'ok' -and [bool](SinScrollH)) '[360 @ 200%] Horómetro: nombre completo y sin scroll horizontal'
    Captura 'ux_360_200pct_horometro.png'

    OK ((Errores-Pagina) -eq '') 'Sin errores en la página' (Errores-Pagina)
} catch { $script:Resultados.Add("EXCEPCION $($_.Exception.Message) $($_.ErrorDetails.Message) @ $($_.InvocationInfo.PositionMessage)") }
finally {
    try { foreach ($i in $creados.tickets) { Rest "tickets?id=eq.$i" 'Delete' -Servicio | Out-Null } } catch { $script:Resultados.Add("LIMPIEZA tickets: $($_.Exception.Message)") }
    try { foreach ($i in $creados.lt) { Rest "lotes_temporada?id=eq.$i" 'Delete' -Servicio | Out-Null } } catch { $script:Resultados.Add("LIMPIEZA lotes_temporada: $($_.Exception.Message)") }
    try { foreach ($i in $creados.lotes) { Rest "lotes?id=eq.$i" 'Delete' -Servicio | Out-Null } } catch { $script:Resultados.Add("LIMPIEZA lotes: $($_.Exception.Message)") }
    try { foreach ($i in $creados.equipos) { Rest "equipos?id=eq.$i" 'Delete' -Servicio | Out-Null } } catch { $script:Resultados.Add("LIMPIEZA equipos: $($_.Exception.Message)") }
    try {
        foreach ($t in 'perfiles_zonas', 'perfiles_estaciones') { Rest "${t}?perfil_id=eq.$qaId" 'Delete' -Servicio | Out-Null }
        Rest "perfiles?id=eq.$qaId" 'Delete' -Servicio | Out-Null
        Invoke-RestMethod -Method Delete -Uri "$URLB/auth/v1/admin/users/$qaId" -Headers $hServ | Out-Null
    } catch { $script:Resultados.Add("LIMPIEZA usuario: $($_.Exception.Message)") }
    try {
        $restos = (Lista "tickets?select=id&id=eq.$($creados.tickets -join '')").Count + (Lista "equipos?select=id&codigo=eq.$EQ_COD").Count + (Lista "lotes?select=id&nomenclatura=like.QAUX-$sufijo-*").Count + (Lista "perfiles?select=id&id=eq.$qaId").Count
        OK ($restos -eq 0) 'Limpieza: no queda nada de prueba (ticket, equipo, lotes, usuario)' "restos=$restos"
    } catch { $script:Resultados.Add("VERIFICACION limpieza: $($_.Exception.Message)") }
    Remove-Item $archivoQa -ErrorAction SilentlyContinue
    Terminar-QA
}
