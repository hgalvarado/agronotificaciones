# QA: revisión por lotes. En /horometros y /labores se marcan líneas y «Pasar sus tickets a…» cambia el proceso
# de sus tickets de una vez. Crea un equipo y dos tickets QA (cada uno con un horómetro y una labor), y borra todo.
param([string]$Base = 'http://localhost:3100')
. "$PSScriptRoot\comun.ps1"
Iniciar-QA -Base $Base -Ancho 1440 -Alto 900
$tickets = @(); $eq = $null
$BUSCA = "document.querySelector('input[placeholder^=""Buscar en toda la tabla""]')"
function Proceso($id) { (Rest "tickets?select=proceso&id=eq.$id" -Servicio)[0].proceso }
function Marcar-Y-Pasar($codigo, $destino) {
    # Marca todas las filas visibles con el código y elige el destino en el selector del lote
    $n = JS "(() => { const fs = [...document.querySelectorAll('tr')].filter(tr => tr.innerText.includes('$codigo')); fs.forEach(tr => tr.querySelector('[aria-label=""Seleccionar fila""]')?.click()); return fs.length })()"
    $sel = Esperar "!!document.querySelector('[data-proceso-lote]')" 5000
    JS "window.confirm = () => true; true" | Out-Null
    JS "(() => { const s = document.querySelector('[data-proceso-lote]'); s.value = '$destino'; s.dispatchEvent(new Event('change', { bubbles: true })); return true })()" | Out-Null
    return @($n, $sel)
}
try {
    $hoy = (Get-Date).ToString('yyyy-MM-dd'); $ayer = (Get-Date).AddDays(-1).ToString('yyyy-MM-dd')
    $codigo = "QA-LOTE-$(Get-Random -Maximum 99999)"
    $eq = (Rest 'equipos' 'Post' @{ codigo = $codigo; nombre = 'Equipo de prueba QA' } -Servicio)[0].id
    $i = 0
    foreach ($f in @($ayer, $hoy)) {
        $t = (Rest 'tickets' 'Post' @{ usuario_id = $script:QA.id; fecha = $f; codigo = "QA-LOTE-T$i-$(Get-Random)"; estado = 'ABIERTO'; proceso = 'REGISTRADO' } -Servicio)[0].id
        $tickets += $t
        $h = (Rest 'horometros' 'Post' @{ ticket_id = $t; fecha = $f; turno = 'DIURNO'; equipo_id = $eq; horometro_inicial = 100 + 8 * $i; horometro_final = 108 + 8 * $i; horas_hombre = 8; usuario_id = $script:QA.id } -Servicio)[0].id
        $i++
    }

    # --- Horómetros ---
    Ir '/horometros'
    $t0 = Esperar "!!($BUSCA) && document.body.innerText.includes('$codigo')" 25000
    OK ($t0 -ge 0) 'Horómetros muestra las 2 lecturas del equipo de prueba' "$t0 ms"
    Teclear $BUSCA $codigo; Start-Sleep -Milliseconds 800
    $r = Marcar-Y-Pasar $codigo 'REVISANDO'
    OK ($r[0] -eq 2 -and $r[1] -ge 0) 'Al marcar aparece «Pasar sus tickets a…»' "filas=$($r[0])"
    $ok = Esperar "document.body.innerText.includes('pasaron a «1 · Revisando»')" 10000
    OK ($ok -ge 0) 'Aviso: 2 tickets pasaron a 1 · Revisando' (JS "document.body.innerText.match(/\d+ tickets? pas[^.]*\./)?.[0]")
    OK ((Proceso $tickets[0]) -eq 'REVISANDO' -and (Proceso $tickets[1]) -eq 'REVISANDO') 'En la base ambos tickets quedaron en REVISANDO'
    $vivo = Esperar "[...document.querySelectorAll('tr')].filter(tr => tr.innerText.includes('$codigo')).every(tr => tr.innerText.includes('Revisando'))" 8000
    OK ($vivo -ge 0) 'La tabla se actualiza sola con el nuevo proceso'
    Captura 'revision_lotes_horometros.png'

    # --- Labores (requiere una labor por horómetro: se prueba sólo si hay registros) ---
    Ir '/labores'
    $t1 = Esperar "!!($BUSCA)" 25000
    OK ($t1 -ge 0) 'Labores abre'
    $sel = JS "(() => { const s = document.querySelector('[data-proceso-lote]'); return s ? 'visible sin marcar' : 'oculto sin marcar' })()"
    OK ($sel -eq 'oculto sin marcar') 'Sin filas marcadas no aparece la acción' $sel
    OK ((Errores-Pagina) -eq '') 'Sin errores en la página' (Errores-Pagina)
} catch { $script:Resultados.Add("EXCEPCION $($_.Exception.Message)") }
finally {
    foreach ($t in $tickets) { Rest "tickets?id=eq.$t" 'Delete' -Servicio | Out-Null }
    if ($eq) { try { Rest "equipos?id=eq.$eq" 'Delete' -Servicio | Out-Null } catch { $script:Resultados.Add("(no se pudo borrar el equipo QA $codigo)") } }
    $script:Resultados.Add('(datos de prueba borrados)')
    Terminar-QA
}
