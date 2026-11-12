# QA · «¿Cómo se usa?» en Fertirriego: el Manual del estacionero dentro de la app, también SIN SEÑAL. Copia en :3100.
param([string]$CarpetaServidor = 'C:\Users\Hhernandez\AppData\Local\Temp\claude\8cd082265f21e390\d424e4b3-aa92-4945-a284-5a2cd4214bdd\scratchpad\qa_prod')
. "$PSScriptRoot\comun.ps1"
Iniciar-QA -Base http://localhost:3100 -Ancho 412 -Alto 915 -Movil
function ClicEn($js) { JS "(() => { const e = $js; if (!e) return false; e.scrollIntoView({block:'center'}); e.click(); return true })()" }
function ClicHasta($js, $condicion, [int]$veces = 15) { for ($i = 0; $i -lt $veces; $i++) { ClicEn $js | Out-Null; if ((Esperar $condicion 700) -ge 0) { return $true } }; return $false }
function Servidor([switch]$Apagar) {
    if ($Apagar) { Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'start -p 3100' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }; Start-Sleep 1 }
    else { Start-Process -FilePath 'cmd.exe' -ArgumentList '/c npx next start -p 3100' -WorkingDirectory $CarpetaServidor -WindowStyle Hidden; for ($i = 0; $i -lt 30; $i++) { try { if ((Invoke-WebRequest http://localhost:3100/login -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200) { return } } catch {}; Start-Sleep 1 } }
}
# Rol temporal con «Ver» en Fertirriego (no depende de cómo esté configurado el rol del usuario QA); se borra al final
$qaId = $script:QA.id
$origRoles = @(foreach ($x in (Rest 'rpc/fn_roles_de_perfiles' 'Post' @{} -Servicio)) { if ($x.perfil_id -eq $qaId) { [int]$x.rol_id } })
$origPrincipal = (Rest "perfiles?select=rol_id&id=eq.$qaId" -Servicio)[0].rol_id
$rolTmp = $null
try {
    $rolTmp = (Rest 'roles' 'Post' @{ codigo = "QA_AYUDA_$(Get-Random)"; nombre = "QA Ayuda $(Get-Random)" } -Servicio)[0].id
    Rest 'permisos' 'Post' @{ rol_id = $rolTmp; recurso = 'fertirriego'; accion = 'ver'; alcance = 'propietario' } -Servicio | Out-Null
    Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = @($origRoles + $rolTmp); p_principal = $origPrincipal } -Servicio | Out-Null
    Ir "/fertirriego?r=$(Get-Random)"
    $t = Esperar "!!document.querySelector('[data-barra-estado]') && !!document.querySelector('[data-ayuda]')" 40000
    OK ($t -ge 0) 'Fertirriego muestra «¿Cómo se usa?»' "$t ms"
    OK (ClicHasta "document.querySelector('[data-ayuda]')" "!!document.querySelector('[data-manual]')") 'Abre el Manual del estacionero'
    $txt = JS "document.querySelector('[data-manual]').innerText"
    OK ($txt -match 'Antes de empezar' -and $txt -match 'Cambio de jornada' -and $txt -match 'Traslados') 'Trae las secciones del manual'
    OK ((JS "document.querySelectorAll('[data-manual] table').length") -ge 3) 'Las tablas se ven como tablas'
    OK ((JS "!document.querySelector('[data-manual]').innerHTML.includes('**')")) 'Sin símbolos de Markdown sueltos (negritas bien)'
    OK ((JS "[...document.querySelectorAll('[data-manual] ol > li > ul > li')].some(li => /Todavía en aplicación/.test(li.innerText))") -eq $true) 'Las sub-viñetas quedan dentro de su paso (estados del turno)'
    OK ((JS "[...document.querySelectorAll('[data-manual] ol > li')].some(li => /Cómo dejas cada turno/.test(li.innerText) && /escribe una nota si hace falta/.test(li.lastElementChild?.innerText || ''))") -eq $true) 'El texto después de las sub-viñetas vuelve al paso'
    ClicEn "[...document.querySelectorAll('[data-manual] nav button')].find(b => /Cambio de jornada/.test(b.innerText))" | Out-Null
    Start-Sleep 1
    $y = JS "Math.round(document.getElementById('9-cambio-de-jornada-entregar-y-recibir-la-estacion-relevo')?.getBoundingClientRect().top ?? -999)"
    OK ($y -ge -5 -and $y -le 400) 'El índice lleva al tema (Cambio de jornada)' "top $y"
    $ancho = JS "document.documentElement.scrollWidth"
    OK ($ancho -le 420) 'En el teléfono: sin desplazamiento lateral' "scrollWidth $ancho"
    Captura 'fert_ayuda.png'
    ClicEn "document.querySelector('[role=dialog] button[aria-label]')" | Out-Null
    CDP 'Input.dispatchKeyEvent' @{ type = 'keyDown'; key = 'Escape'; code = 'Escape'; windowsVirtualKeyCode = 27 } | Out-Null
    Start-Sleep 1

    # Sin señal ni servidor: la ayuda sigue disponible (viene con la pantalla guardada)
    Esperar "!!navigator.serviceWorker.controller" 15000 | Out-Null
    CDP 'Network.enable' | Out-Null
    CDP 'Network.setBlockedURLs' @{ urls = @('*supabase.co*') } | Out-Null
    Servidor -Apagar
    CDP 'Page.reload' @{ ignoreCache = $false } | Out-Null
    $t = Esperar "!!document.querySelector('[data-ayuda]')" 30000
    OK ($t -ge 0) 'Sin señal: el botón de ayuda sigue ahí' "$t ms"
    OK (ClicHasta "document.querySelector('[data-ayuda]')" "!!document.querySelector('[data-manual]')") 'Sin señal: el manual se abre'
    Servidor
    $e = Errores-Pagina; OK (-not $e) 'Sin errores en la página' $e
}
catch { $script:Resultados.Add("EXCEPCION $($_.Exception.Message)") }
finally {
    try { Rest 'rpc/fn_asignar_roles' 'Post' @{ p_perfil = $qaId; p_roles = $origRoles; p_principal = $origPrincipal } -Servicio | Out-Null } catch { $script:Resultados.Add("LIMPIEZA roles: $($_.Exception.Message)") }
    try { if ($rolTmp) { Rest "permisos?rol_id=eq.$rolTmp" 'Delete' -Servicio | Out-Null; Rest "roles?id=eq.$rolTmp" 'Delete' -Servicio | Out-Null } } catch { $script:Resultados.Add("LIMPIEZA rol: $($_.Exception.Message)") }
    try { CDP 'Network.setBlockedURLs' @{ urls = @() } | Out-Null } catch {}
    if (-not (Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'start -p 3100' })) { Servidor }
    Terminar-QA
}
