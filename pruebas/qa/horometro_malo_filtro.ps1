# QA: tarjeta/filtro rápido «Horómetro malo» en /horometros. Crea un equipo y un ticket QA con dos lecturas (una con la
# marca «[Horómetro malo]» en el comentario) y borra todo al final.
param([string]$Base = 'http://localhost:3100')
. "$PSScriptRoot\comun.ps1"
Iniciar-QA -Base $Base -Ancho 1440 -Alto 900
$ticket = $null; $eq = $null
$BUSCA = "document.querySelector('input[placeholder^=""Buscar en toda la tabla""]')"
$TARJETA = "document.querySelector('[data-filtro-rapido=malo]')"
function FilasCon($c) { [int](JS "[...document.querySelectorAll('tbody tr')].filter(tr => tr.innerText.includes('$c')).length") }
try {
    $hoy = (Get-Date).ToString('yyyy-MM-dd')
    $codigo = "QA-MALO-$(Get-Random -Maximum 99999)"
    $eq = (Rest 'equipos' 'Post' @{ codigo = $codigo; nombre = 'Equipo de prueba QA' } -Servicio)[0].id
    $ticket = (Rest 'tickets' 'Post' @{ usuario_id = $script:QA.id; fecha = $hoy; codigo = "QA-MALO-T-$(Get-Random)"; estado = 'ABIERTO'; proceso = 'REGISTRADO' } -Servicio)[0].id
    Rest 'horometros' 'Post' @{ ticket_id = $ticket; fecha = $hoy; turno = 'DIURNO'; equipo_id = $eq; horometro_inicial = 100; horometro_final = 108; horas_hombre = 8; usuario_id = $script:QA.id; comentario = 'Lectura normal QA' } -Servicio | Out-Null
    Rest 'horometros' 'Post' @{ ticket_id = $ticket; fecha = $hoy; turno = 'NOCTURNO'; equipo_id = $eq; horometro_inicial = 100; horometro_final = 108; horas_hombre = 8; usuario_id = $script:QA.id; comentario = '[Horómetro malo] Lecturas repetidas con otro registro del día. QA' } -Servicio | Out-Null
    $malosBase = @(Rest "horometros?select=id&comentario=like.*Hor%C3%B3metro%20malo*&fecha=gte.$((Get-Date -Day 1).ToString('yyyy-MM-dd'))" -Servicio).Count

    Ir '/horometros'
    $t0 = Esperar "!!($TARJETA) && document.body.innerText.includes('$codigo')" 25000
    OK ($t0 -ge 0) 'Horómetros muestra la tarjeta «Horómetro malo»' "$t0 ms"
    $n = [int](JS "Number($TARJETA.querySelector('span').innerText)")
    OK ($n -ge 1) 'La tarjeta cuenta las lecturas marcadas del periodo' "tarjeta $n · en la base (mes) $malosBase"
    OK ((JS "/equipo/.test($TARJETA.innerText)") -eq $true) 'Dice cuántos equipos están reportados' ((JS "$TARJETA.innerText") -replace "`n", ' ')
    Teclear $BUSCA $codigo; Start-Sleep -Milliseconds 800
    OK ((FilasCon $codigo) -eq 2) 'Sin filtro: el equipo de prueba muestra sus 2 lecturas'
    JS "$TARJETA.click(); true" | Out-Null
    $t1 = Esperar "$TARJETA.getAttribute('aria-pressed') === 'true'" 5000
    Start-Sleep -Milliseconds 500
    OK ($t1 -ge 0 -and (FilasCon $codigo) -eq 1) 'Con el filtro: solo la lectura marcada como horómetro malo'
    OK ((JS "/Filtro rápido: horómetro malo/.test(document.body.innerText)") -eq $true) 'Avisa el filtro activo y permite quitarlo'
    Captura 'horometro_malo_filtro.png'
    JS "$TARJETA.click(); true" | Out-Null
    Start-Sleep -Milliseconds 500
    OK ((FilasCon $codigo) -eq 2) 'Al quitarlo vuelven las 2 lecturas'
    OK ((Errores-Pagina) -eq '') 'Sin errores en la página' (Errores-Pagina)
} catch { $script:Resultados.Add("EXCEPCION $($_.Exception.Message) $($_.ErrorDetails.Message)") }
finally {
    if ($ticket) { Rest "tickets?id=eq.$ticket" 'Delete' -Servicio | Out-Null }
    if ($eq) { try { Rest "equipos?id=eq.$eq" 'Delete' -Servicio | Out-Null } catch { $script:Resultados.Add("(no se pudo borrar el equipo QA $codigo)") } }
    $script:Resultados.Add('(datos de prueba borrados)')
    Terminar-QA
}
