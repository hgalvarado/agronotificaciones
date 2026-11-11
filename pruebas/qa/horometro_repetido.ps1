# QA: aviso de equipo registrado dos veces el mismo día con las mismas lecturas (celular).
# Prepara un equipo QA y un ticket QA (ayer) con una lectura 300→308 sin labores. Comprueba: el aviso aparece,
# ofrece ir a ese registro, «Guardar» normal no duplica, «Reportar horómetro malo y guardar» sí guarda con la marca,
# y un traslape sólo se avisa. Borra todo al final.
param([string]$Base = 'http://localhost:3100')
. "$PSScriptRoot\comun.ps1"
Iniciar-QA -Base $Base -Ancho 390 -Alto 844 -Movil
$tk = $null; $eq = $null
$INI = "document.querySelectorAll('input[inputmode=decimal]')[0]"
$FIN = "document.querySelectorAll('input[inputmode=decimal]')[1]"
function Elegir-Equipo($codigo) {
    $BUSCADOR = "document.querySelector('input[placeholder^=""Escribe el código""]')"
    for ($i = 0; $i -lt 20 -and -not (JS "!!($BUSCADOR)"); $i++) { JS "[...document.querySelectorAll('button')].find(b => b.offsetParent && /Buscar equipo/.test(b.textContent))?.click(); true" | Out-Null; Start-Sleep -Milliseconds 500 }
    Teclear $BUSCADOR $codigo
    $OPCION = "[...document.querySelectorAll('button')].find(b => b.offsetParent && b.textContent.startsWith('$codigo'))"
    Esperar "!!($OPCION)" 5000 | Out-Null
    JS "($OPCION).click(); true" | Out-Null
    Start-Sleep -Milliseconds 1500
}
function Horometros { @((Rest "horometros?select=id,horometro_inicial,comentario&ticket_id=eq.$tk&order=created_at" -Servicio) | Where-Object { $_.id }) }
try {
    foreach ($t in (Rest "tickets?select=id&usuario_id=eq.$($script:QA.id)" -Servicio)) { if ($t.id) { Rest "tickets?id=eq.$($t.id)" 'Delete' -Servicio | Out-Null } }
    $ayer = (Get-Date).AddDays(-1).ToString('yyyy-MM-dd')
    $codigo = "QA-REP-$(Get-Random -Maximum 99999)"
    $eq = (Rest 'equipos' 'Post' @{ codigo = $codigo; nombre = 'Equipo de prueba QA' } -Servicio)[0].id
    $tk = (Rest 'tickets' 'Post' @{ usuario_id = $script:QA.id; fecha = $ayer; codigo = "QA-REP-$(Get-Random)"; estado = 'ABIERTO'; proceso = 'REGISTRADO' } -Servicio)[0].id
    $h1 = (Rest 'horometros' 'Post' @{ ticket_id = $tk; fecha = $ayer; turno = 'DIURNO'; equipo_id = $eq; horometro_inicial = 300; horometro_final = 308; horas_hombre = 8; usuario_id = $script:QA.id } -Servicio)[0].id

    Ir "/tickets/$tk/horometros/nuevo"
    Esperar "[...document.querySelectorAll('button')].some(b => b.offsetParent && /Buscar equipo/.test(b.textContent))" 20000 | Out-Null
    Elegir-Equipo $codigo
    Teclear $INI '300'; Teclear $FIN '308'
    $ta = Esperar "!!document.querySelector('[data-repetido]')" 6000
    OK ($ta -ge 0) 'Mismas lecturas el mismo día: aparece el aviso' (JS "document.querySelector('[data-repetido]')?.innerText.split('\n')[0]")
    $href = JS "document.querySelector('[data-ir-repetido]')?.getAttribute('href')"
    OK ($href -eq "/tickets/$tk/horometros/$h1/registros/nuevo") 'Ofrece «Agregar labores a ese registro»' $href
    OK (-not (JS "!!document.querySelector('[data-continuidad]')")) 'No muestra a la vez «sigue la secuencia»'
    Captura 'horometro_repetido_aviso.png'

    OK (-not (JS "[...document.querySelectorAll('button')].some(b => b.offsetParent && b.textContent.trim() === 'Guardar y registrar labores')")) 'El botón fijo no tapa el aviso'
    JS "document.querySelector('form').requestSubmit(); true" | Out-Null; Start-Sleep -Seconds 2
    $n = @(Horometros).Count; OK ($n -eq 1) '«Guardar» normal no duplica el registro' "registros: $n"
    OK (JS "document.body.innerText.includes('Elige una opción del aviso')") 'Dice qué hacer'

    JS "document.querySelector('[data-reportar-malo]').click(); true" | Out-Null
    $tg = Esperar "/registros\/nuevo/.test(location.pathname)" 15000
    $hs = @(Horometros)
    OK ($tg -ge 0 -and $hs.Count -eq 2) '«Reportar horómetro malo y guardar» sí guarda (no bloquea)' "registros: $($hs.Count)"
    OK ("$($hs[1].comentario)" -like '`[Horómetro malo`]*') 'Queda la marca para quien revisa' "$($hs[1].comentario)"

    # Traslape: sólo aviso
    Ir "/tickets/$tk/horometros/nuevo"
    Esperar "[...document.querySelectorAll('button')].some(b => b.offsetParent && /Buscar equipo/.test(b.textContent))" 20000 | Out-Null
    Elegir-Equipo $codigo
    Teclear $INI '304'; Teclear $FIN '310'
    $tt = Esperar "!!document.querySelector('[data-traslape]')" 6000
    OK ($tt -ge 0 -and -not (JS "!!document.querySelector('[data-repetido]')")) 'Lecturas que se pisan: aviso informativo' (JS "document.querySelector('[data-traslape]')?.innerText")
    OK ((Errores-Pagina) -eq '') 'Sin errores en la página' (Errores-Pagina)
} catch { $script:Resultados.Add("EXCEPCION $($_.Exception.Message)") }
finally {
    if ($tk) { Rest "tickets?id=eq.$tk" 'Delete' -Servicio | Out-Null }
    if ($eq) { try { Rest "equipos?id=eq.$eq" 'Delete' -Servicio | Out-Null } catch {} }
    $script:Resultados.Add('(datos de prueba borrados)')
    Terminar-QA
}
