# QA: Tickets en el celular (panel «Mi trabajo», registrar la jornada, continuar, detalle con la fecha como
# título y el botón fijo «Agregar equipo»). Crea UN ticket de prueba del usuario QA y lo borra al final.
param([string]$Base = 'http://localhost:3100')
. "$PSScriptRoot\comun.ps1"
Iniciar-QA -Base $Base -Ancho 390 -Alto 844 -Movil
$creado = $null
$BUSCA = "document.querySelector('input[placeholder^=""Buscar en todo el historial""]')"
$H1_DETALLE = "[...document.querySelectorAll('main h1')].find(h => h.offsetParent !== null && /\d{4}/.test(h.innerText))"
try {
    # Punto de partida limpio: el usuario QA sin tickets
    foreach ($t in (Rest "tickets?select=id&usuario_id=eq.$($script:QA.id)" -Servicio)) { Rest "tickets?id=eq.$($t.id)" 'Delete' -Servicio | Out-Null }
    Ir '/tickets'
    $t0 = Esperar "!!document.querySelector('[data-mi-trabajo]')"
    OK ($t0 -ge 0) 'Tickets en celular muestra «Mi trabajo» arriba' "$t0 ms"
    $t1 = Esperar "!!document.querySelector('[data-iniciar-hoy]')"
    OK ($t1 -ge 0) 'Sin jornada registrada: botón «Registrar jornada»'
    $alto = JS "document.querySelector('[data-iniciar-hoy]').getBoundingClientRect().height"
    OK ($alto -ge 44) 'Botón principal cómodo para el pulgar (>= 44 px)' "$alto px"
    $arriba = JS "document.querySelector('[data-mi-trabajo]').getBoundingClientRect().top < window.innerHeight * 0.5"
    OK $arriba 'El panel se ve sin desplazarse (mitad superior de la pantalla)'
    Captura 'tickets_movil_inicio.png'

    # Registrar la jornada (la ventana propone la fecha de ayer)
    JS "document.querySelector('[data-iniciar-hoy]').click(); true" | Out-Null
    $tm = Esperar "[...document.querySelectorAll('button')].some(b => b.offsetParent && b.textContent.trim() === 'Crear ticket')"
    OK ($tm -ge 0) 'Abre «Generar ticket»'
    Clic 'Crear ticket' | Out-Null
    $tn = Esperar "/\/tickets\/[0-9a-f-]{36}\/horometros\/nuevo/.test(location.pathname)" 20000
    OK ($tn -ge 0) 'Crear ticket lleva directo a registrar el primer equipo' (JS 'location.pathname')
    $creado = (JS "location.pathname.split('/')[2]")

    # Volver a Tickets: ahora «Continuar jornada»
    IrMenu '/tickets' | Out-Null
    $tc = Esperar "location.pathname === '/tickets' && !!document.querySelector('[data-continuar-hoy]')" 15000
    OK ($tc -ge 0) 'De vuelta en Tickets: «Continuar jornada»' "$tc ms"
    JS "document.querySelector('[data-continuar-hoy]').click(); true" | Out-Null
    $td = Esperar "location.pathname === '/tickets/$creado' && !!($H1_DETALLE)" 20000
    OK ($td -ge 0) 'Continuar abre el ticket de la jornada' "$td ms"
    $titulo = JS "($H1_DETALLE)?.innerText"
    OK ($titulo -match '\d{4}' -and $titulo -notmatch '\[') 'Título del ticket = la fecha (no el código largo)' $titulo
    $boton = JS "(() => { const b = document.querySelector('[data-agregar-equipo]'); if (!b) return 'no existe'; const r = b.getBoundingClientRect(); return (r.bottom <= window.innerHeight && r.height >= 44) ? 'ok' : JSON.stringify(r) })()"
    OK ($boton -eq 'ok') 'Botón fijo «Agregar equipo» visible y al alcance del pulgar' $boton
    OK ((JS 'document.documentElement.scrollWidth') -le 400) 'Detalle en celular sin desborde horizontal'
    Captura 'ticket_detalle_movil.png'

    # Buscar aparta «Mi trabajo» (se viene a consultar el historial)
    IrMenu '/tickets' | Out-Null; Esperar "location.pathname === '/tickets' && !!document.querySelector('[data-mi-trabajo]')" | Out-Null
    Teclear $BUSCA 'fernando'
    $oc = Esperar "!document.querySelector('[data-mi-trabajo]')" 5000
    OK ($oc -ge 0) 'Al buscar, el panel se aparta y queda el historial'
    JS "(() => { const i = $BUSCA; i.focus(); i.select(); return true })()" | Out-Null
    CDP 'Input.dispatchKeyEvent' @{ type = 'keyDown'; key = 'Backspace'; code = 'Backspace'; windowsVirtualKeyCode = 8 } | Out-Null
    CDP 'Input.dispatchKeyEvent' @{ type = 'keyUp'; key = 'Backspace'; code = 'Backspace'; windowsVirtualKeyCode = 8 } | Out-Null
    $vuelve = Esperar "!!document.querySelector('[data-mi-trabajo]')" 5000
    OK ($vuelve -ge 0) 'Al borrar la búsqueda, el panel vuelve'
    OK ((Errores-Pagina) -eq '') 'Sin errores en la página' (Errores-Pagina)
} catch { $script:Resultados.Add("EXCEPCION $($_.Exception.Message)") }
finally {
    if ($creado) { Rest "tickets?id=eq.$creado" 'Delete' -Servicio | Out-Null; $script:Resultados.Add('(ticket de prueba borrado)') }
    Terminar-QA
}
