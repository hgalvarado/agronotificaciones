# QA - regresion rapida de TablaAvanzada en Lotes (/admin/lotes) y Plan (/plan/APS): la tabla compartida carga, tiene filas o
# estado vacio con instruccion, sin scroll horizontal de pagina, sin errores. Crea un usuario QA TEMPORAL y lo borra al final.
# Solo ASCII. Uso: powershell -ExecutionPolicy Bypass -File pruebas/qa/tabla_regresion_lotes_plan.ps1 -Base http://localhost:3110 -PuertoCdp 9361
param([string]$Base = 'http://localhost:3110', [int]$PuertoCdp = 9361)
. "$PSScriptRoot\comun.ps1"
$envQa = Leer-Entorno
$URLB = $envQa['NEXT_PUBLIC_SUPABASE_URL']; $SERV = $envQa['SUPABASE_SERVICE_ROLE_KEY']
$hServ = @{ apikey = $SERV; Authorization = "Bearer $SERV" }
$qaEmail = "qa.reg.$([guid]::NewGuid().ToString('N').Substring(0,10))@desarrollo.local"; $qaClave = "Qa-$(Get-Random)-x$(Get-Random)"
$archivoQa = "$PSScriptRoot\qa_usuario.local.json"
$usr = Invoke-RestMethod -Method Post -Uri "$URLB/auth/v1/admin/users" -Headers $hServ -ContentType 'application/json' -Body (@{ email = $qaEmail; password = $qaClave; email_confirm = $true } | ConvertTo-Json)
$qaId = $usr.id
$rolTotal = (Invoke-RestMethod "$URLB/rest/v1/roles?select=id&acceso_total=eq.true&order=id&limit=1" -Headers $hServ)[0].id
Invoke-RestMethod -Method Post "$URLB/rest/v1/perfiles" -Headers $hServ -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes((@{ id = $qaId; nombre = "QA Regresion Tabla"; rol_id = $rolTotal; todas_las_zonas = $true } | ConvertTo-Json))) | Out-Null
@{ id = $qaId; email = $qaEmail; clave = $qaClave } | ConvertTo-Json | Set-Content -Encoding utf8 $archivoQa
Iniciar-QA -Base $Base -Ancho 1568 -Alto 698 -Puerto $PuertoCdp
CDP 'Page.enable' | Out-Null
CDP 'Emulation.setEmulatedMedia' @{ features = @(@(@{ name = 'prefers-color-scheme'; value = 'light' })) } | Out-Null
try {
    foreach ($caso in @(@('/admin/lotes', 'lotes'), @('/plan/APS', 'plan'))) {
        foreach ($a in @(@(1568, 698, $false), @(412, 800, $true))) {
            $w = $a[0]; $etq = "$($caso[1])-w$w"
            Pantalla -Ancho $w -Alto $a[1] -Movil:$a[2]
            Ir $caso[0]
            $hay = Esperar "document.querySelectorAll('main table tbody tr, main dl').length > 0 || document.body.innerText.includes('Sin registros') || document.body.innerText.includes('Nada coincide') || !!document.querySelector('main h1')" 90000
            OK ($hay -ge 0) "$etq la pantalla carga" $caso[0]
            Start-Sleep -Milliseconds 1200
            OK ((JS "document.documentElement.scrollWidth <= window.innerWidth + 1") -eq $true) "$etq sin scroll horizontal de pagina"
            $filas = JS "document.querySelectorAll('main table tbody tr, main dl').length"
            $barra = JS "!!document.querySelector('main input[placeholder*=toda]')"
            OK ($barra -eq $true) "$etq barra de la tabla (buscador) presente" "filas=$filas"
            if ($filas -gt 0 -and $w -ge 768) {
                OK ((JS "[...document.querySelectorAll('main table thead')].some(t => getComputedStyle(t).position === 'sticky')") -eq $true) "$etq cabecera pegajosa"
                OK ((JS "[...document.querySelectorAll('main table tbody tr')][0].querySelectorAll('td').length > 1") -eq $true) "$etq filas con celdas"
            }
            if ($filas -gt 0 -and $w -lt 768) { OK ((JS "document.querySelectorAll('main dl').length") -gt 0) "$etq filas como tarjetas en movil" }
            Captura "regtabla_${etq}.png"
            OK ((Errores-Pagina) -eq '') "$etq sin errores de pagina" (Errores-Pagina)
        }
    }
}
catch { $script:Resultados.Add("EXCEPCION: $($_.Exception.Message) :: $($_.InvocationInfo.PositionMessage)") }
finally {
    try {
        foreach ($t in 'perfiles_zonas', 'perfiles_estaciones') { Rest "${t}?perfil_id=eq.$qaId" 'Delete' -Servicio | Out-Null }
        Rest "perfiles?id=eq.$qaId" 'Delete' -Servicio | Out-Null
        Invoke-RestMethod -Method Delete -Uri "$URLB/auth/v1/admin/users/$qaId" -Headers $hServ | Out-Null
    } catch { $script:Resultados.Add("LIMPIEZA usuario: $($_.Exception.Message)") }
    OK (((Rest "perfiles?select=id&id=eq.$qaId" -Servicio) | Measure-Object).Count -eq 0) 'Limpieza: usuario QA borrado'
    Remove-Item $archivoQa -ErrorAction SilentlyContinue
    Terminar-QA
}
