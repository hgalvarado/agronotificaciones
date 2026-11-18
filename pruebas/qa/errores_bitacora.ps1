# QA con clics reales - Bitacora de errores (sql/118). Servidor en :3109 + base de DESARROLLO. CDP 9349.
#   Parte A (corre SIEMPRE, con o sin la 118): captura en el telefono. Error JS inyectado -> cola local saneada y con
#     contador; sin la 118 la app NO se rompe, no insiste cada minuto y la cola conserva el error; anti-bucle; pantalla
#     caida (ErrorBoundary) con «Reintentar» y «Avisar al administrador»; usuario sin permiso no entra a /admin/errores;
#     letra grande (24 px) a 412 px sin recortes.
#   Parte B (solo con -Con118, es decir, DESPUES de correr sql/118 en desarrollo): el error llega a la base, el admin lo ve en
#     /admin/errores con su informe, lo marca atendido con nota; operacion rechazada por el servidor y pendiente viejo
#     aparecen en «Lo que NO se registro»; el usuario sin permiso no puede leer nada; letra grande en la pantalla de admin.
# Crea usuarios QA temporales (admin y limitado) y SIEMPRE los borra al final junto con lo que crearon.
param([string]$Base = 'http://localhost:3109', [int]$PuertoCdp = 9349, [switch]$Con118)
. "$PSScriptRoot\comun.ps1"

$envQa = Leer-Entorno
$URLB = $envQa['NEXT_PUBLIC_SUPABASE_URL']; $SERV = $envQa['SUPABASE_SERVICE_ROLE_KEY']
$hServ = @{ apikey = $SERV; Authorization = "Bearer $SERV" }
$archivoQa = "$PSScriptRoot\qa_usuario.local.json"
$s = Get-Random -Maximum 99999
$adm = @{ email = "qa.err.adm.$([guid]::NewGuid().ToString('N').Substring(0,10))@desarrollo.local"; clave = "Qa-$(Get-Random)-x$(Get-Random)"; id = $null }
$lim = @{ email = "qa.err.lim.$([guid]::NewGuid().ToString('N').Substring(0,10))@desarrollo.local"; clave = "Qa-$(Get-Random)-x$(Get-Random)"; id = $null }
$opId = $null

function Crear-Usuario($u, $nombre, $rol) {
    $r = Invoke-RestMethod -Method Post -Uri "$URLB/auth/v1/admin/users" -Headers $hServ -ContentType 'application/json' -Body (@{ email = $u.email; password = $u.clave; email_confirm = $true } | ConvertTo-Json)
    $u.id = $r.id
    Invoke-RestMethod -Method Post "$URLB/rest/v1/perfiles" -Headers $hServ -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes((@{ id = $u.id; nombre = $nombre; rol_id = $rol; todas_las_zonas = $true } | ConvertTo-Json))) | Out-Null
}
$rolTotal = (Invoke-RestMethod "$URLB/rest/v1/roles?select=id&acceso_total=eq.true&order=id&limit=1" -Headers $hServ)[0].id
$rolLim = (Invoke-RestMethod "$URLB/rest/v1/roles?select=id&acceso_total=eq.false&solo_lectura=eq.false&order=id&limit=1" -Headers $hServ)[0].id
Crear-Usuario $adm "QA Errores Admin $s" $rolTotal
Crear-Usuario $lim "QA Errores Limitado $s" $rolLim
@{ id = $adm.id; email = $adm.email; clave = $adm.clave } | ConvertTo-Json | Set-Content -Encoding utf8 $archivoQa

Iniciar-QA -Base $Base -Ancho 412 -Alto 915 -Movil -Puerto $PuertoCdp
function ClicEn($js) { JS "(() => { const e = $js; if (!e) return false; e.scrollIntoView({block:'center'}); e.click(); return true })()" }
function ClicHasta($js, $condicion, [int]$veces = 15) { for ($i = 0; $i -lt $veces; $i++) { ClicEn $js | Out-Null; if ((Esperar $condicion 700) -ge 0) { return $true } }; return $false }
$COLA = "(() => { try { return JSON.parse(localStorage.getItem('agn-errores-cola-v1') || '[]') } catch (e) { return [] } })()"
function Cola { $r = JS "JSON.stringify($COLA)"; if (-not $r) { return @() }; $x = $r | ConvertFrom-Json; if ($null -eq $x) { return @() }; return @($x) }
function Lanzar($mensaje) { JS "(() => { setTimeout(() => { throw new Error('$mensaje') }, 0); return true })()" | Out-Null; Start-Sleep -Milliseconds 400 }
function TextoGrande([int]$px) { CDP 'Page.addScriptToEvaluateOnNewDocument' @{ source = "(function(){function a(){var d=document.documentElement;if(d&&d.style.fontSize!=='${px}px')d.style.setProperty('font-size','${px}px','important')}var t=setInterval(function(){var d=document.documentElement;if(!d)return;clearInterval(t);a();new MutationObserver(a).observe(d,{attributes:true,attributeFilter:['style']})},0)})()" } | Out-Null }
$JS_REVISAR = @'
(() => {
  const dl = [...document.querySelectorAll('[role=dialog]')]; const dlg = dl[dl.length - 1];
  const raiz = dlg || document.querySelector('main') || document.body;
  const prob = []; const add = (m) => { if (prob.length < 6 && !prob.includes(m)) prob.push(m) };
  const desc = (e) => e.tagName + '.' + String(e.className).slice(0, 40) + '[' + (e.textContent || '').trim().slice(0, 24) + ']';
  const vis = (e) => { const r = e.getBoundingClientRect(); return r.width > 1 && r.height > 1 && getComputedStyle(e).visibility !== 'hidden' };
  for (const e of [raiz, ...raiz.querySelectorAll('*')].filter(vis)) {
    if (!['INPUT', 'SELECT', 'TEXTAREA'].includes(e.tagName) && ![...e.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    const cs = getComputedStyle(e);
    if (cs.textOverflow === 'ellipsis' && cs.overflowX !== 'visible') add('ellipsis ' + desc(e));
    for (let n = e; n; n = n.parentElement) {
      const c = getComputedStyle(n);
      if (['hidden', 'clip'].includes(c.overflowX) && n.scrollWidth > n.clientWidth + 1) add('recorte-H ' + desc(n));
      if (['hidden', 'clip'].includes(c.overflowY) && n.scrollHeight > n.clientHeight + 1) add('recorte-V ' + desc(n));
      if (n === raiz || ['MAIN', 'BODY'].includes(n.tagName)) break;
    }
    const r = e.getBoundingClientRect();
    if (r.right > innerWidth + 1 || r.left < -1) add('fuera-de-pantalla ' + desc(e));
  }
  if (document.documentElement.scrollWidth > innerWidth + 1) add('scroll-H-pagina sw' + document.documentElement.scrollWidth);
  return prob.join(' || ');
})()
'@
function Revisar($etq, $png) { $p = JS $JS_REVISAR; OK (-not $p) "$etq sin informacion oculta" $p; if ($png) { Captura $png } }

try {
    # ============================================================ PARTE A
    Ir '/tickets'
    OK ((Esperar "document.querySelector('main') && document.body.innerText.length > 50" 60000) -ge 0) 'A0 la aplicacion abre (tickets)'
    Start-Sleep -Milliseconds 2500

    # A1 · error JS inyectado: cola local saneada
    Lanzar 'QA error JS inyectado 12345 password=secreto123 y Bearer abc.def-9'
    $c = Cola
    $it = $c | Where-Object { $_.mensaje -like 'QA error JS*' } | Select-Object -First 1
    OK ($null -ne $it) 'A1 un error de JavaScript queda anotado en la cola local' "items $($c.Count)"
    if ($it) {
        OK ($it.mensaje -notmatch 'secreto123|abc\.def') 'A1 la cola NO guarda contrasenas ni Bearer' $it.mensaje
        OK ($it.detalle.version -and $it.detalle.navegador -and $it.detalle.zona) 'A1 lleva version, navegador y zona horaria' (($it.detalle | ConvertTo-Json -Compress).Substring(0, 120))
        OK ($it.usuario -eq $adm.id) 'A1 el error queda a nombre de quien tenia la sesion'
    }

    # A2 · sin la 118 la app no se rompe, no insiste cada minuto y no pierde el error
    Start-Sleep -Seconds 5
    $envios = [int](JS "performance.getEntriesByType('resource').filter(r => r.name.includes('fn_errores_registrar')).length")
    OK ((JS "!document.querySelector('[data-limite-error]') && document.body.innerText.length > 50") -eq $true) 'A2 la aplicacion sigue viva tras el error (sin pantalla de error)'
    if (-not $Con118) {
        OK ($envios -ge 1 -and $envios -le 3) 'A2 sin la 118: se intento enviar pero solo 1-3 veces (no cada minuto)' "envios $envios"
        $c = Cola
        OK ((@($c | Where-Object { $_.mensaje -like 'QA error JS*' })).Count -eq 1) 'A2 sin la 118: el error SIGUE en la cola local (no se pierde)'
    } else {
        $c = Cola
        OK ((@($c | Where-Object { $_.mensaje -like 'QA error JS*' })).Count -eq 0) 'A2 con la 118: el error salio de la cola (llego a la base)' "cola $($c.Count)"
    }

    # A3 · el mismo error con otros numeros se suma
    Lanzar 'QA repetido numero 1'; Lanzar 'QA repetido numero 22'; Lanzar 'QA repetido numero 333'
    $r = (Cola) | Where-Object { $_.mensaje -like 'QA repetido*' }
    OK ((@($r)).Count -eq 1 -and $r.repeticiones -eq 3) 'A3 el mismo error con otros numeros se suma en UN elemento (x3)' "elementos $(@($r).Count) rep $($r.repeticiones)"

    # A4 · anti-bucle
    JS "(() => { for (let i = 0; i < 60; i++) setTimeout(() => { throw new Error('QA bucle infinito') }, 0); return true })()" | Out-Null
    Start-Sleep -Milliseconds 1500
    $b = (Cola) | Where-Object { $_.mensaje -like 'QA bucle*' }
    OK ($b -and $b.repeticiones -le 20) 'A4 anti-bucle: 60 errores iguales seguidos se registran como maximo 20' "rep $($b.repeticiones)"

    # A5 · pantalla caida: datos locales dañados -> «Algo falló en esta pantalla»
    Ir '/fertirriego'
    $ok = (Esperar "document.querySelector('[data-actualizar]') && !document.querySelector('[data-actualizar]').disabled" 90000) -ge 0
    OK $ok 'A5 Fertirriego abre'
    $danar = @"
(async () => {
  const nombre = 'agn-fertirriego-$($adm.id)';
  const db = await new Promise((res, rej) => { const q = indexedDB.open(nombre); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error) });
  await new Promise((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put({ yo: { id: '$($adm.id)', nombre: 'x' }, estaciones: 7, turnos: 7, materiales: 7, saldos: 7, plan: 7, choferes: 7, vehiculos: 7, relevos: 7, traslados: 7, movimientos: 7 }, 'estado'); tx.oncomplete = res; tx.onerror = () => rej(tx.error) });
  db.close(); return true })()
"@
    JS $danar | Out-Null
    # Sin señal: para que la sincronización no reemplace el estado dañado antes de que se vea el aviso
    CDP 'Network.enable' | Out-Null
    CDP 'Network.emulateNetworkConditions' @{ offline = $true; latency = 0; downloadThroughput = 0; uploadThroughput = 0 } | Out-Null
    Ir '/fertirriego'
    $cae = (Esperar "document.querySelector('[data-limite-error]')" 40000) -ge 0
    OK $cae 'A5 una pantalla caida muestra el aviso amable (no pantalla blanca)'
    if ($cae) {
        $t = JS "document.querySelector('[data-limite-error]').innerText"
        OK ($t -match 'Algo falló en esta pantalla' -and $t -match 'Lo que ya guardaste está a salvo') 'A5 el texto es el acordado' $t
        $altos = JS "[...document.querySelectorAll('[data-limite-error] button')].map(b => Math.round(b.getBoundingClientRect().height)).join(',')"
        OK (($altos -split ',' | Where-Object { [int]$_ -lt 44 }).Count -eq 0 -and ($altos -split ',').Count -ge 2) 'A5 botones Reintentar y Avisar de al menos 44 px' $altos
        $pa = (Cola) | Where-Object { $_.origen -eq 'pantalla' -and $_.modulo -eq 'fertirriego' }
        OK ($null -ne $pa) 'A5 el error de pantalla queda anotado (origen pantalla, modulo fertirriego)'
        Captura 'errores_a5_pantalla_caida.png'
        ClicEn "document.querySelector('[data-avisar-admin]')" | Out-Null
        OK ((Esperar "document.querySelector('[data-limite-error]').innerText.includes('aviso')" 20000) -ge 0) 'A5 «Avisar al administrador» responde con un mensaje claro' (JS "document.querySelector('[data-limite-error]').innerText")
        # Arreglar el dato local y «Reintentar»
        CDP 'Network.emulateNetworkConditions' @{ offline = $false; latency = 0; downloadThroughput = -1; uploadThroughput = -1 } | Out-Null
        JS "(async () => { const db = await new Promise(r => { const q = indexedDB.open('agn-fertirriego-$($adm.id)'); q.onsuccess = () => r(q.result) }); await new Promise(r => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').delete('estado'); tx.oncomplete = r }); db.close(); return true })()" | Out-Null
        ClicEn "document.querySelector('[data-reintentar]')" | Out-Null
        OK ((Esperar "!document.querySelector('[data-limite-error]') && document.querySelector('[data-actualizar]')" 40000) -ge 0) '«Reintentar» recupera la pantalla cuando el dato ya esta bien'
    }
    CDP 'Network.emulateNetworkConditions' @{ offline = $false; latency = 0; downloadThroughput = -1; uploadThroughput = -1 } | Out-Null

    # A6 · usuario sin permiso no entra a /admin/errores
    $tokLim = Entrar-Como $lim.email $lim.clave
    Ir '/admin/errores'
    Start-Sleep -Seconds 4
    OK ((Esperar "location.pathname !== '/admin/errores'" 30000) -ge 0) 'A6 el usuario sin permiso NO entra a /admin/errores (lo mandan al inicio)' (JS 'location.pathname')
    $hLim = @{ apikey = $script:Anon; Authorization = "Bearer $tokLim"; 'Content-Type' = 'application/json' }
    if ($Con118) {
        $x = $null; try { Invoke-RestMethod -Method Post -Uri "$URLB/rest/v1/rpc/fn_errores_listar" -Headers $hLim -Body '{"p_filtros":{}}' | Out-Null } catch { $x = $_.ErrorDetails.Message }
        OK ($x -match '42501|Bitácora') 'A6 la base tambien le niega fn_errores_listar al usuario sin permiso' $x
    }
    $null = Entrar-Como $adm.email $adm.clave

    # A7 · letra grande en tickets y en la pantalla de error
    TextoGrande 24
    Ir '/tickets'
    Esperar "document.querySelector('main') && document.body.innerText.length > 50" 60000 | Out-Null
    Start-Sleep -Seconds 2
    Revisar 'A7 tickets con letra grande (24 px, 412 px)' 'errores_a7_tickets_grande.png'

    # ============================================================ PARTE B
    if ($Con118) {
        Ir '/admin/errores'
        $abre = (Esperar "document.querySelector('[data-bitacora-errores]')" 60000) -ge 0
        OK $abre 'B1 el administrador entra a /admin/errores' (JS 'location.pathname')
        if ($abre) {
            # un error real llega a la base
            Lanzar "QA error para la bitacora $s"
            JS "(() => { window.dispatchEvent(new Event('online')); return true })()" | Out-Null
            Start-Sleep -Seconds 4
            $fil = Rest "registro_errores?select=id,mensaje,estado,repeticiones,detalle&usuario_id=eq.$($adm.id)&mensaje=like.QA error para la bitacora*" -Servicio
            OK (@($fil).Count -eq 1) 'B2 el error de JavaScript llego a registro_errores' "filas $(@($fil).Count)"
            ClicEn "document.querySelector('[data-actualizar]')" | Out-Null
            OK ((Esperar "[...document.querySelectorAll('[data-entrada]')].some(e => e.innerText.includes('Se cayó una pantalla') || e.innerText.includes('Error no clasificado') || e.innerText.includes('QA'))" 30000) -ge 0) 'B3 aparece en la linea de tiempo'
            # operacion rechazada por el servidor
            $op = [guid]::NewGuid().ToString()
            Rest 'fert_operaciones' 'Post' @{ id = $op; tipo = 'aplicacion'; perfil_id = $adm.id; creado_en = (Get-Date).AddHours(-5).ToUniversalTime().ToString('o'); resultado = 'RECHAZADO'; mensaje = 'No alcanza el saldo de PRUEBA QA en la bodega: quedaria en -5.' } -Servicio | Out-Null
            $opId = $op
            ClicEn "document.querySelector('[data-actualizar]')" | Out-Null
            OK ((Esperar "[...document.querySelectorAll('[data-no-registrado-fila]')].some(e => e.innerText.includes('No alcanza el saldo'))" 30000) -ge 0) 'B4 la operacion rechazada sale en «Lo que NO se registro»'
            OK ((JS "document.querySelector('[data-tarjeta=tarjeta-no-registradas] [data-valor]').innerText") -ge 1) 'B4 la tarjeta de operaciones NO registradas cuenta al menos 1'
            ClicEn "[...document.querySelectorAll('[data-ver-informe]')].pop()" | Out-Null
            OK ((Esperar "document.querySelector('[data-informe]')" 15000) -ge 0) 'B5 el informe se abre'
            $inf = JS "document.querySelector('[data-informe]').innerText"
            OK ($inf -match 'Qué pasó' -and $inf -match 'Causa probable' -and $inf -match 'Qué le toca al administrador' -and $inf -match 'No alcanzaba el saldo') 'B5 el informe trae diagnostico completo' ($inf.Substring(0, [Math]::Min(160, $inf.Length)))
            Revisar 'B5 informe con letra grande' 'errores_b5_informe.png'
            ClicEn "document.querySelector('[data-informe] details summary')" | Out-Null
            OK ((JS "document.querySelector('[data-datos-tecnicos]').innerText.includes('INFORME DE ERROR')") -eq $true) 'B5 datos tecnicos copiables a la vista'
            CDP 'Input.dispatchKeyEvent' @{ type = 'keyDown'; key = 'Escape'; code = 'Escape' } | Out-Null
            # marcar atendido con nota (sobre el error real)
            ClicEn "[...document.querySelectorAll('[data-entrada]')].find(e => e.innerText.includes('QA') || e.innerText.includes('Se cayó'))" | Out-Null
            if ((Esperar "document.querySelector('[data-atender]')" 15000) -ge 0) {
                Teclear "document.querySelector('[data-nota]')" 'Se hablo con la persona (QA)'
                ClicEn "document.querySelector('[data-marcar-atendido]')" | Out-Null
                Start-Sleep -Seconds 2
                $f2 = Rest "registro_errores?select=estado,nota_admin&id=eq.$($fil[0].id)" -Servicio
                OK ($f2[0].estado -eq 'atendido' -and $f2[0].nota_admin -like 'Se hablo*') 'B6 marcar atendido guarda estado y nota' (($f2[0] | ConvertTo-Json -Compress))
            } else { OK $false 'B6 el panel «Marcar atendido» aparece' }
            # pendiente viejo (latido)
            Invoke-RestMethod -Method Post -Uri "$URLB/rest/v1/rpc/fn_errores_registrar" -Headers @{ apikey = $script:Anon; Authorization = "Bearer $script:Token"; 'Content-Type' = 'application/json' } -Body (@{ p_lote = @(@{ tipo = 'latido'; version = '0.0.1'; pendientes = 3; pendiente_mas_viejo_h = 30; en_linea = $false; hora_telefono = (Get-Date).ToUniversalTime().ToString('o') }) } | ConvertTo-Json -Depth 6) | Out-Null
            Ir '/admin/errores'
            Esperar "document.querySelector('[data-bitacora-errores]')" 60000 | Out-Null
            OK ((Esperar "[...document.querySelectorAll('[data-no-registrado-fila]')].some(e => e.innerText.includes('sin llegar al servidor'))" 30000) -ge 0) 'B7 un pendiente de 30 h aparece como «no se registro»'
            OK ((Esperar "[...document.querySelectorAll('[data-usuario-fila]')].some(e => e.innerText.includes('Actuar'))" 20000) -ge 0) 'B7 el semaforo del usuario esta en rojo (Actuar)'
            Revisar 'B8 pantalla de administracion con letra grande' 'errores_b8_admin_grande.png'
            Ir '/admin/errores'
        }
    }
} catch {
    $script:Resultados.Add("EXCEPCION: $($_.Exception.Message) $($_.ScriptStackTrace)")
} finally {
    try { if ($opId) { Rest "fert_operaciones?id=eq.$opId" 'Delete' -Servicio | Out-Null } } catch { $script:Resultados.Add("LIMPIEZA operacion: $($_.Exception.Message)") }
    foreach ($u in @($adm, $lim)) {
        try {
            if ($u.id) {
                Rest "registro_errores?usuario_id=eq.$($u.id)" 'Delete' -Servicio | Out-Null
                Rest "registro_salud?usuario_id=eq.$($u.id)" 'Delete' -Servicio | Out-Null
            }
        } catch { }
        try { if ($u.id) { Rest "perfiles?id=eq.$($u.id)" 'Delete' -Servicio | Out-Null; Invoke-RestMethod -Method Delete -Uri "$URLB/auth/v1/admin/users/$($u.id)" -Headers $hServ | Out-Null } } catch { $script:Resultados.Add("LIMPIEZA usuario: $($_.Exception.Message) $($_.ErrorDetails.Message)") }
    }
    Remove-Item $archivoQa -ErrorAction SilentlyContinue
    $queda = 0; foreach ($u in @($adm, $lim)) { try { Invoke-RestMethod "$URLB/auth/v1/admin/users/$($u.id)" -Headers $hServ | Out-Null; $queda++ } catch { } }
    OK ($queda -eq 0) 'Limpieza: usuarios QA temporales borrados de desarrollo' "restan $queda"
    Terminar-QA
}
