# Requiere una pagina temporal src/app/(app)/qa-bitacora/page.tsx que solo renderice <BitacoraErrores versionActual="0.1.0" puedeAtender puedeExportar /> (no se publica)
# y los JSON de pruebas/sql/118_seed_bitacora_ui.sql (psql -At sobre una replica con la 118; -Datos <carpeta con resumen.json, listar.json, ops.json>).
# QA con clics de la PANTALLA de la bitacora SIN la 118 en la base: fetch simulado con la salida REAL de las funciones sql/118
# (generada en la replica con seed_bitacora.sql). Pagina temporal /qa-bitacora (solo en el worktree de QA, no se publica).
param([string]$Base = 'http://localhost:3109', [int]$PuertoCdp = 9350, [string]$Datos = '')
. "$PSScriptRoot\comun.ps1"
$envQa = Leer-Entorno
$URLB = $envQa['NEXT_PUBLIC_SUPABASE_URL']; $SERV = $envQa['SUPABASE_SERVICE_ROLE_KEY']
$hServ = @{ apikey = $SERV; Authorization = "Bearer $SERV" }
$u = @{ email = "qa.ui.$([guid]::NewGuid().ToString('N').Substring(0,10))@desarrollo.local"; clave = "Qa-$(Get-Random)-x$(Get-Random)" }
$r = Invoke-RestMethod -Method Post -Uri "$URLB/auth/v1/admin/users" -Headers $hServ -ContentType 'application/json' -Body (@{ email = $u.email; password = $u.clave; email_confirm = $true } | ConvertTo-Json)
$id = $r.id
$rolTotal = (Invoke-RestMethod "$URLB/rest/v1/roles?select=id&acceso_total=eq.true&order=id&limit=1" -Headers $hServ)[0].id
Invoke-RestMethod -Method Post "$URLB/rest/v1/perfiles" -Headers $hServ -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes((@{ id = $id; nombre = 'QA UI Bitacora'; rol_id = $rolTotal; todas_las_zonas = $true } | ConvertTo-Json))) | Out-Null
@{ id = $id; email = $u.email; clave = $u.clave } | ConvertTo-Json | Set-Content -Encoding utf8 "$PSScriptRoot\qa_usuario.local.json"
function EsperarB($c, [int]$ms = 15000) { Esperar "!!($c)" $ms }
function ClicEn($js) { JS "(() => { const e = $js; if (!e) return false; e.scrollIntoView({block:'center'}); e.click(); return true })()" }
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
    $res = (Get-Content "$Datos\resumen.json" -Raw -Encoding utf8).Trim(); $lis = (Get-Content "$Datos\listar.json" -Raw -Encoding utf8).Trim(); $ops = (Get-Content "$Datos\ops.json" -Raw -Encoding utf8).Trim()
    $stub = "window.__marcar = 0; const R = $res; const L = $lis; const O = $ops; const f0 = window.fetch; window.fetch = function (u, o) { const s = String(u && u.url || u); const j = (d) => Promise.resolve(new Response(JSON.stringify(d), { status: 200, headers: { 'Content-Type': 'application/json' } })); if (s.includes('/rpc/fn_errores_resumen_por_usuario')) return j(R); if (s.includes('/rpc/fn_errores_listar')) return j(L); if (s.includes('/rpc/fn_errores_operaciones_fallidas')) return j(O); if (s.includes('/rpc/fn_errores_marcar')) { window.__marcar++; return j(1) } if (s.includes('/rpc/fn_errores_registrar')) return j({ recibidos: 0, descartados: 0, limitado: false }); return f0.apply(this, arguments) };"
    Iniciar-QA -Base $Base -Ancho 412 -Alto 915 -Movil -Puerto $PuertoCdp
    CDP 'Page.enable' | Out-Null
    CDP 'Page.addScriptToEvaluateOnNewDocument' @{ source = 'window.__t = 1;' } | Out-Null; $rs = CDP 'Page.addScriptToEvaluateOnNewDocument' @{ source = $stub }; $script:Resultados.Add('DIAG addScript: ' + ($rs | ConvertTo-Json -Compress -Depth 4) + ' len ' + $stub.Length)
    Ir '/qa-bitacora'
    OK ((EsperarB "document.querySelector('[data-bitacora-errores]') && document.querySelectorAll('[data-usuario-fila]').length > 0" 90000) -ge 0) 'U1 la pantalla carga con datos'
    Start-Sleep -Milliseconds 800
    $script:Resultados.Add('DIAG stub: ' + (JS "typeof window.__t + ' | ' + typeof window.__marcar + ' | ' + String(window.fetch).slice(0, 70) + ' | ' + (window.__err || []).join(';')"))
    Captura 'errores_ui_1_normal.png'
    $v = { param($t) JS "document.querySelector('[data-tarjeta=$t] [data-valor]').innerText" }
    OK ([int](& $v 'tarjeta-hoy') -ge 1) 'U2 tarjeta: usuarios con problemas hoy >= 1' (& $v 'tarjeta-hoy')
    OK ([int](& $v 'tarjeta-no-registradas') -ge 1) 'U2 tarjeta: operaciones NO registradas >= 1' (& $v 'tarjeta-no-registradas')
    OK ([int](& $v 'tarjeta-pendientes') -eq 1) 'U2 tarjeta: pendientes viejos = 1 (el de 30 h)' (& $v 'tarjeta-pendientes')
    OK ([int](& $v 'tarjeta-graves') -ge 1) 'U2 tarjeta: graves nuevos >= 1' (& $v 'tarjeta-graves')
    OK ((JS "[...document.querySelectorAll('[data-no-registrado-fila]')].some(e => e.innerText.includes('sin llegar al servidor'))") -eq $true) 'U3 «Lo que NO se registro» lista el pendiente de 30 h'
    OK ((JS "[...document.querySelectorAll('[data-no-registrado-fila]')].some(e => e.innerText.includes('PRODUCTO-CON-NOMBRE-MUY-LARGO'))") -eq $true) 'U3 y la operacion rechazada por saldo'
    OK ((JS "[...document.querySelectorAll('[data-usuario-fila]')].some(e => e.innerText.includes('Campo 118') && e.innerText.includes('Actuar'))") -eq $true) 'U4 semaforo en rojo (Actuar) para quien tiene pendiente de 30 h y error critico'
    $n = [int](JS "document.querySelectorAll('[data-entrada]').length")
    OK ($n -ge 5) 'U5 la linea de tiempo mezcla errores, rechazos y senales de salud' "entradas $n"
    # filtro por gravedad
    ClicEn "document.querySelector('[data-gravedad=critico]')" | Out-Null
    Start-Sleep -Milliseconds 400
    OK ((JS "[...document.querySelectorAll('[data-entrada]')].length > 0 && [...document.querySelectorAll('[data-entrada]')].every(e => e.dataset.gravedadEntrada === 'critico')") -eq $true) 'U6 filtro Critico: solo entradas criticas'
    ClicEn "document.querySelector('[data-gravedad=critico]')" | Out-Null
    # informe
    ClicEn "document.querySelector('[data-entrada]')" | Out-Null
    OK ((EsperarB "document.querySelector('[data-informe]')" 15000) -ge 0) 'U7 el informe se abre al tocar una entrada'
    $inf = JS "document.querySelector('[data-informe]').innerText"
    OK ($inf -match 'Qué pasó' -and $inf -match 'Causa probable' -and $inf -match 'Por qué ocurre' -and $inf -match 'Qué le toca al usuario' -and $inf -match 'Qué le toca al administrador' -and $inf -match 'Cómo verificarlo') 'U7 el informe trae las 6 secciones' ($inf.Substring(0, [Math]::Min(120, $inf.Length)))
    Captura 'errores_ui_2_informe.png'
    Revisar 'U7 informe a 412 px' $null
    if ((JS "!!document.querySelector('[data-atender]')") -eq $true) {
        Teclear "document.querySelector('[data-nota]')" 'Nota de prueba QA'
        ClicEn "document.querySelector('[data-marcar-atendido]')" | Out-Null
        OK ((EsperarB "document.querySelector('[data-informe]').innerText.includes('Marcado como atendido')" 10000) -ge 0) 'U8 «Marcar atendido» responde' 
        OK ([int](JS 'window.__marcar') -ge 1) 'U8 se llamo a fn_errores_marcar' (JS 'window.__marcar')
    } else { OK $true 'U8 (la primera entrada no es un error marcable: es rechazo o senal de salud)' }
    CDP 'Input.dispatchKeyEvent' @{ type = 'keyDown'; key = 'Escape'; code = 'Escape' } | Out-Null
    # un informe de operacion rechazada
    ClicEn "[...document.querySelectorAll('[data-ver-informe]')][0]" | Out-Null
    OK ((EsperarB "document.querySelector('[data-informe]') && document.querySelector('[data-operacion]')" 15000) -ge 0) 'U9 «Ver informe» de un rechazo muestra la operacion afectada'
    CDP 'Input.dispatchKeyEvent' @{ type = 'keyDown'; key = 'Escape'; code = 'Escape' } | Out-Null
    # exportar
    ClicEn "document.querySelector('[data-exportar]')" | Out-Null
    Start-Sleep -Seconds 1
    OK ((Errores-Pagina) -eq '') 'U10 Exportar no produce errores' (Errores-Pagina)
    # letra grande
    CDP 'Page.addScriptToEvaluateOnNewDocument' @{ source = "(function(){function a(){var d=document.documentElement;if(d&&d.style.fontSize!=='24px')d.style.setProperty('font-size','24px','important')}var t=setInterval(function(){var d=document.documentElement;if(!d)return;clearInterval(t);a();new MutationObserver(a).observe(d,{attributes:true,attributeFilter:['style']})},0)})()" } | Out-Null
    Ir '/qa-bitacora'
    EsperarB "document.querySelector('[data-bitacora-errores]') && document.querySelectorAll('[data-usuario-fila]').length > 0" 60000 | Out-Null
    Start-Sleep -Milliseconds 800
    OK ((JS "getComputedStyle(document.documentElement).fontSize") -eq '24px') 'U11 letra base en 24 px' (JS "getComputedStyle(document.documentElement).fontSize")
    Revisar 'U11 pantalla con letra grande' 'errores_ui_3_grande.png'
    ClicEn "document.querySelector('[data-entrada]')" | Out-Null
    EsperarB "document.querySelector('[data-informe]')" 15000 | Out-Null
    Revisar 'U11 informe con letra grande' 'errores_ui_4_informe_grande.png'
} catch {
    $script:Resultados.Add("EXCEPCION: $($_.Exception.Message) $($_.ScriptStackTrace)")
} finally {
    try { Rest "perfiles?id=eq.$id" 'Delete' -Servicio | Out-Null; Invoke-RestMethod -Method Delete -Uri "$URLB/auth/v1/admin/users/$id" -Headers $hServ | Out-Null } catch { $script:Resultados.Add("LIMPIEZA: $($_.Exception.Message)") }
    Remove-Item "$PSScriptRoot\qa_usuario.local.json" -ErrorAction SilentlyContinue
    $queda = 0; try { Invoke-RestMethod "$URLB/auth/v1/admin/users/$id" -Headers $hServ | Out-Null; $queda = 1 } catch { }
    OK ($queda -eq 0) 'Limpieza: usuario QA temporal borrado' "restan $queda"
    Terminar-QA
}
