# =====================================================================
# Arnés de QA de AgroNotificaciones: Edge real (headless) controlado por CDP, con sesión del usuario de prueba.
#
# Uso (desde una prueba):   . "$PSScriptRoot\comun.ps1"; Iniciar-QA -Base http://localhost:3100
#                           ... OK (condición) "nombre" "detalle" ...;   Terminar-QA
#
# Requisitos:
#   - Un servidor de la app en $Base (idealmente `next build` + `next start -p 3100` sobre una copia del repo).
#   - .env.local apuntando a la base de DESARROLLO (se verifica el ref: nunca corre contra producción).
#   - pruebas/qa/qa_usuario.local.json = { id, email, clave } del usuario de prueba (rol Torre de Control, todas
#     las zonas). NO se sube a git. Si falta, créalo con la API de admin de Supabase (ver MEMORIA_CLAUDE.md).
# =====================================================================

$script:Resultados = New-Object System.Collections.Generic.List[string]
$script:RaizRepo = (Resolve-Path "$PSScriptRoot\..\..").Path

function OK($cond, $nombre, $extra = '') {
    $script:Resultados.Add(("{0} {1}{2}" -f ($(if ($cond) { 'OK' } else { 'FALLO' })), $nombre, $(if ("$extra" -ne '') { " :: $extra" } else { '' })))
}

function Leer-Entorno {
    $v = @{}
    Get-Content "$script:RaizRepo\.env.local" | Where-Object { $_ -match '=' } | ForEach-Object { $k, $x = $_ -split '=', 2; $v[$k.Trim()] = $x.Trim() }
    if ($v['NEXT_PUBLIC_SUPABASE_URL'] -notmatch 'ifzwqdstpoyoidsflvuo') { throw '.env.local NO apunta a desarrollo: QA cancelada' }
    return $v
}

function Iniciar-QA([string]$Base = 'http://localhost:3100', [int]$Ancho = 1440, [int]$Alto = 900, [switch]$Movil, [int]$Puerto = 9334) {
    $script:Base = $Base
    $script:Env = Leer-Entorno
    $script:Url = $script:Env['NEXT_PUBLIC_SUPABASE_URL']
    $script:Anon = $script:Env['NEXT_PUBLIC_SUPABASE_ANON_KEY']
    $script:Serv = $script:Env['SUPABASE_SERVICE_ROLE_KEY']
    $script:QA = Get-Content "$PSScriptRoot\qa_usuario.local.json" -Raw | ConvertFrom-Json
    $ses = Invoke-RestMethod -Method Post -Uri "$script:Url/auth/v1/token?grant_type=password" -Headers @{ apikey = $script:Anon; 'Content-Type' = 'application/json' } -Body (@{ email = $script:QA.email; password = $script:QA.clave } | ConvertTo-Json)
    $script:Token = $ses.access_token
    $json = [pscustomobject]@{ access_token = $ses.access_token; token_type = 'bearer'; expires_in = $ses.expires_in; expires_at = $ses.expires_at; refresh_token = $ses.refresh_token; user = $ses.user } | ConvertTo-Json -Depth 10 -Compress
    $valor = 'base64-' + [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json)).TrimEnd('=').Replace('+', '-').Replace('/', '_')
    $nombre = 'sb-ifzwqdstpoyoidsflvuo-auth-token'
    $cookies = @(); for ($i = 0; $i -lt $valor.Length; $i += 3180) { $cookies += @{ name = "$nombre.$([int]($i / 3180))"; value = $valor.Substring($i, [Math]::Min(3180, $valor.Length - $i)) } }
    if ($cookies.Count -eq 1) { $cookies[0].name = $nombre }

    $script:Perfil = Join-Path $env:TEMP "edge_qa_$(Get-Random)"
    $script:Proc = Start-Process -FilePath "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" -ArgumentList "--headless=new", "--remote-debugging-port=$Puerto", "--user-data-dir=`"$script:Perfil`"", "--disable-gpu", "--window-size=$Ancho,$Alto", "about:blank" -PassThru
    Start-Sleep -Seconds 3
    $tab = (Invoke-RestMethod "http://127.0.0.1:$Puerto/json") | Where-Object type -eq 'page' | Select-Object -First 1
    $script:WS = New-Object System.Net.WebSockets.ClientWebSocket
    $script:WS.ConnectAsync([Uri]$tab.webSocketDebuggerUrl, [Threading.CancellationToken]::None).Wait()
    $script:IdCdp = 0
    foreach ($c in $cookies) { CDP 'Network.setCookie' @{ name = $c.name; value = $c.value; domain = 'localhost'; path = '/' } | Out-Null }
    Pantalla -Ancho $Ancho -Alto $Alto -Movil:$Movil
    # Errores de la página: quedan en window.__err (se leen con Errores-Pagina)
    CDP 'Page.addScriptToEvaluateOnNewDocument' @{ source = "window.__err=[];addEventListener('error',e=>__err.push(String(e.message)));addEventListener('unhandledrejection',e=>__err.push('promesa: '+String(e.reason)));" } | Out-Null
}

function Pantalla([int]$Ancho = 1440, [int]$Alto = 900, [switch]$Movil) {
    CDP 'Emulation.setDeviceMetricsOverride' @{ width = $Ancho; height = $Alto; deviceScaleFactor = 1; mobile = [bool]$Movil } | Out-Null
    if ($Movil) { CDP 'Emulation.setTouchEmulationEnabled' @{ enabled = $true } | Out-Null }
}

function CDP($metodo, $params = @{}) {
    $script:IdCdp++
    $b = [Text.Encoding]::UTF8.GetBytes((@{ id = $script:IdCdp; method = $metodo; params = $params } | ConvertTo-Json -Depth 10 -Compress))
    $script:WS.SendAsync([ArraySegment[byte]]$b, 'Text', $true, [Threading.CancellationToken]::None).Wait()
    while ($true) {
        $buf = New-Object byte[] 8388608; $sb = New-Object Text.StringBuilder
        do { $r = $script:WS.ReceiveAsync([ArraySegment[byte]]$buf, [Threading.CancellationToken]::None).Result; [void]$sb.Append([Text.Encoding]::UTF8.GetString($buf, 0, $r.Count)) } while (-not $r.EndOfMessage)
        $resp = $sb.ToString() | ConvertFrom-Json
        if ($resp.id -eq $script:IdCdp) { return $resp }
    }
}

function JS($codigo) { $r = CDP 'Runtime.evaluate' @{ expression = $codigo; awaitPromise = $true; returnByValue = $true }; return $r.result.result.value }

function Esperar($condicionJs, [int]$ms = 15000) {
    $sw = [Diagnostics.Stopwatch]::StartNew()
    while ($sw.ElapsedMilliseconds -lt $ms) { try { if (JS $condicionJs) { return $sw.ElapsedMilliseconds } } catch {}; Start-Sleep -Milliseconds 100 }
    return -1
}

function Ir($ruta) { CDP 'Page.navigate' @{ url = "$script:Base$ruta" } | Out-Null }

function IrMenu($ruta) { JS "(() => { const a = [...document.querySelectorAll('a[href=""$ruta""]')].find(x => x.offsetParent !== null); if (!a) return false; a.click(); return true })()" }

function Clic($textoBoton) { JS "(() => { const b = [...document.querySelectorAll('button, a')].find(x => x.offsetParent !== null && x.textContent.trim() === '$textoBoton'); if (!b) return false; b.click(); return true })()" }

# Teclea como una persona (foco + selección + texto), para que React vea el cambio
function Teclear($selectorJs, $texto) { JS "(() => { const i = $selectorJs; i.focus(); i.select && i.select(); return true })()" | Out-Null; CDP 'Input.insertText' @{ text = $texto } | Out-Null }

function Captura($archivo) {
    New-Item -ItemType Directory -Force "$PSScriptRoot\capturas" | Out-Null
    $png = CDP 'Page.captureScreenshot' @{ format = 'png' }
    [IO.File]::WriteAllBytes("$PSScriptRoot\capturas\$archivo", [Convert]::FromBase64String($png.result.data))
}

function Errores-Pagina { return (JS "(window.__err||[]).join(' || ')") }

# REST de Supabase (desarrollo). -Servicio usa la llave service_role (para preparar o restaurar datos de prueba)
function Rest($ruta, $metodo = 'Get', $cuerpo = $null, [switch]$Servicio) {
    $llave = if ($Servicio) { $script:Serv } else { $script:Anon }
    $auth = if ($Servicio) { $script:Serv } else { $script:Token }
    $h = @{ apikey = $llave; Authorization = "Bearer $auth"; Prefer = 'return=representation' }
    # -ContentType explícito y cuerpo en bytes UTF-8: en PowerShell 5.1 un POST ignora el Content-Type de -Headers
    if ($null -ne $cuerpo) {
        $bytes = [Text.Encoding]::UTF8.GetBytes(($cuerpo | ConvertTo-Json -Depth 10))
        return Invoke-RestMethod -Method $metodo -Uri "$script:Url/rest/v1/$ruta" -Headers $h -ContentType 'application/json; charset=utf-8' -Body $bytes
    }
    return Invoke-RestMethod -Method $metodo -Uri "$script:Url/rest/v1/$ruta" -Headers $h
}

function Terminar-QA {
    try { $script:WS.Dispose() } catch {}
    Stop-Process -Id $script:Proc.Id -Force -ErrorAction SilentlyContinue
    Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -like "*$script:Perfil*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
    $script:Resultados
    $fallos = ($script:Resultados | Where-Object { $_ -match '^(FALLO|EXCEPCION)' }).Count
    "---- $($script:Resultados.Count - $fallos)/$($script:Resultados.Count) correctas"
}
