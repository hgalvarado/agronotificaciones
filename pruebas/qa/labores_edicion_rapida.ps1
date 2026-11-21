# QA: edición en línea de /labores sin «Consultando…» (parche local + conciliación por horómetro).
# Crea SUS PROPIOS datos (equipo, ticket, horómetro y 3 labores con 7 líneas) y los borra al final.
# Uso: powershell -ExecutionPolicy Bypass -File pruebas/qa/labores_edicion_rapida.ps1 [-Movil]
param([string]$Base = 'http://localhost:3100', [switch]$Movil)
. "$PSScriptRoot\comun.ps1"
if ($Movil) { Iniciar-QA -Base $Base -Ancho 412 -Alto 915 -Movil -Puerto 9336 } else { Iniciar-QA -Base $Base -Ancho 1440 -Alto 900 -Puerto 9335 }
$ESC = if ($Movil) { '412px' } else { 'escritorio' }
$ticket = $null; $eq = $null; $hm = $null; $hm2 = $null
$BUSCA = "document.querySelector('input[placeholder^=""Buscar en toda la tabla""]')"
$PRE = @'
window.__qa = {
  colIdx(l) { const b = document.querySelector(`button[title="Ordenar por ${l}"]`); if (!b) return -1; const th = b.closest('th');
    const cols = [...th.parentElement.children].filter(x => !x.querySelector('[aria-label="Seleccionar todas"],[aria-label="Limpiar selección"]')); return cols.indexOf(th) },
  fila(ut) { const iu = this.colIdx('UT'); return [...document.querySelectorAll('tbody tr')].find(tr => { const td = tr.querySelector(`td[data-col="${iu}"]`); return td && td.textContent.trim() === ut }) || null },
  celda(ut, l) { const r = this.fila(ut); return r ? r.querySelector(`td[data-col="${this.colIdx(l)}"]`) : null },
  texto(ut, l) { const c = this.celda(ut, l); return c ? c.textContent.trim() : null },
};
if (!window.__mon) { window.__mon = { veces: 0, ms: 0, on: false, desde: 0 };
  setInterval(() => { const v = document.body.textContent.includes('Consultando…'); const m = window.__mon;
    if (v && !m.on) { m.on = true; m.veces++; m.desde = performance.now() } else if (!v && m.on) { m.on = false; m.ms += performance.now() - m.desde } }, 40) }
window.__mirar = (ut, l, esp) => { const t0 = performance.now(); window.__w = { t1: null };
  const f = () => { const t = __qa.texto(ut, l); if (t !== null && t.includes(esp)) { __w.t1 = Math.round(performance.now() - t0); return } if (performance.now() - t0 < 10000) requestAnimationFrame(f) }; requestAnimationFrame(f) };
window.__rpc = (n) => { const e = performance.getEntriesByType('resource').filter(x => x.name.includes(n)); return e.length ? Math.round(e[e.length - 1].duration) : -1 };
true
'@

function Tecla([string]$k) {
    $m = @{ 'Enter' = @('Enter', 13); 'Delete' = @('Delete', 46); 'Escape' = @('Escape', 27) }[$k]
    foreach ($t in 'rawKeyDown', 'keyUp') { CDP 'Input.dispatchKeyEvent' @{ type = $t; key = $k; code = $m[0]; windowsVirtualKeyCode = $m[1]; nativeVirtualKeyCode = $m[1] } | Out-Null }
}
function ClicEn($exprJs) {
    $r = JS "(() => { const e = $exprJs; if (!e) return null; e.scrollIntoView({ block: 'center', inline: 'center' }); const b = e.getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2] })()"
    if (-not $r) { return $false }
    CDP 'Input.dispatchMouseEvent' @{ type = 'mouseMoved'; x = $r[0]; y = $r[1] } | Out-Null
    foreach ($t in 'mousePressed', 'mouseReleased') { CDP 'Input.dispatchMouseEvent' @{ type = $t; x = $r[0]; y = $r[1]; button = 'left'; clickCount = 1 } | Out-Null }
    return $true
}
function Txt($ut, $col) { JS "__qa.texto('$ut', '$col')" }
function Celda($ut, $col) { "__qa.celda('$ut', '$col')" }
function Mon { JS "JSON.stringify({ veces: __mon.veces, ms: Math.round(__mon.ms + (__mon.on ? performance.now() - __mon.desde : 0)), on: __mon.on })" | ConvertFrom-Json }
function Reiniciar-Mon { JS "__mon.veces = 0; __mon.ms = 0; __mon.on = false; true" | Out-Null }
function Esperar-Visto { $s = [Diagnostics.Stopwatch]::StartNew(); while ($s.ElapsedMilliseconds -lt 10000) { $t = JS "window.__w && window.__w.t1"; if ($null -ne $t) { return $t }; Start-Sleep -Milliseconds 50 }; return -1 }

# Editar una celda de texto/número con teclado real: clic, Enter, escribir, Enter. Devuelve ms hasta verse.
function Editar-Texto($ut, $col, $valor) {
    if (-not (ClicEn "$(Celda $ut $col)?.querySelector('[data-vista]')")) { return -2 }
    Tecla 'Enter'
    if ((Esperar "!!$(Celda $ut $col)?.querySelector('input')" 3000) -lt 0) { return -3 }
    CDP 'Input.insertText' @{ text = "$valor" } | Out-Null
    JS "__mirar('$ut', '$col', '$valor'); true" | Out-Null
    Tecla 'Enter'
    return (Esperar-Visto)
}
# Elegir en una celda de catálogo. $etiqueta = texto de la opción (o parte). Devuelve ms hasta verse.
function Editar-Seleccion($ut, $col, $etiqueta, $busqueda = $etiqueta) {
    if (-not (ClicEn "$(Celda $ut $col)?.querySelector('[data-vista]')")) { return -2 }
    Tecla 'Enter'
    $hay = Esperar "!!$(Celda $ut $col)?.querySelector('select') || !!document.querySelector('[role=listbox] input[placeholder=""Buscar…""]')" 3000
    if ($hay -lt 0) { return -3 }
    $nativo = JS "!!$(Celda $ut $col)?.querySelector('select')"
    if ($nativo) {
        $vigila = if ($col -eq 'UT') { $etiqueta } else { $ut }
        JS "__mirar('$vigila', '$col', '$etiqueta'); true" | Out-Null
        $ok = JS "(() => { const s = $(Celda $ut $col).querySelector('select'); const o = [...s.options].find(o => o.textContent.includes('$etiqueta')); if (!o) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, o.value); s.dispatchEvent(new Event('change', { bubbles: true })); return true })()"
        if (-not $ok) { return -4 }
    } else {
        CDP 'Input.insertText' @{ text = "$busqueda" } | Out-Null
        $op = "[...document.querySelectorAll('[role=listbox] [role=option]')].find(b => b.textContent.includes('$etiqueta'))"
        if ((Esperar "!!$op" 3000) -lt 0) { Tecla 'Escape'; return -4 }
        $vigila = if ($col -eq 'UT') { $etiqueta } else { $ut }   # al cambiar la UT la fila se busca por la nueva
        JS "__mirar('$vigila', '$col', '$etiqueta'); true" | Out-Null
        ClicEn $op | Out-Null
    }
    return (Esperar-Visto)
}
function Vista {
    for ($i = 0; $i -lt 4; $i++) {
        try { $r = @(); foreach ($x in (Rest "v_labores_control?select=*&horometro_id=in.($hm,$hm2)")) { $r += $x }; return $r }
        catch { $script:Resultados.Add("(aviso: la vista respondió error al leer, reintento $($i + 1): $($_.Exception.Message) $($_.ErrorDetails.Message))"); Start-Sleep -Milliseconds 700 }
    }
    throw 'la vista no respondió tras 4 intentos'
}
function Linea($id) { (Vista) | Where-Object { $_.detalle_id -eq $id } | Select-Object -First 1 }
function Num($t) { if ($null -eq $t) { return $null }; $s = ($t -replace '[^0-9.\-]', ''); if ($s -eq '') { return $null }; return [double]$s }
# La pantalla muestra lo mismo que la base (horas, mz, comentario, tarea, labor) para la línea $id con UT $ut
function Cuadra($id, $ut) {
    $b = Linea $id; if (-not $b) { return "no está en la base" }
    $dif = @()
    $hu = Num (Txt $ut 'H. notificadas'); $hb = if ($null -ne $b.horas_linea) { [double]$b.horas_linea } else { $null }
    if ($null -ne $hb -and [Math]::Abs($hu - $hb) -gt 0.011) { $dif += "horas pantalla=$hu base=$hb" }
    $mu = Num (Txt $ut 'Mz'); if ($null -ne $b.avance_mz -and [Math]::Abs($mu - [double]$b.avance_mz) -gt 0.011) { $dif += "mz pantalla=$mu base=$($b.avance_mz)" }
    $cu = Txt $ut 'Comentarios'; $cb = if ($b.detalle_comentarios) { $b.detalle_comentarios } else { '—' }; if ($cu -ne $cb) { $dif += "coment pantalla=$cu base=$cb" }
    $tu = Txt $ut 'Tarea'; if ($tu -notlike "$($b.tarea_codigo)*") { $dif += "tarea pantalla=$tu base=$($b.tarea_codigo)" }
    $lu = Txt $ut 'Labor'; if ($lu -ne $b.labor_nombre) { $dif += "labor pantalla=$lu base=$($b.labor_nombre)" }
    return ($dif -join '; ')
}
function Esperar-Cuadre($pares, [int]$ms = 8000) {
    $s = [Diagnostics.Stopwatch]::StartNew(); $ult = ''
    while ($s.ElapsedMilliseconds -lt $ms) {
        $ult = (($pares | ForEach-Object { $d = Cuadra $_[0] $_[1]; if ($d) { "$($_[1]): $d" } }) -join ' | ')
        if ($ult -eq '') { return @($s.ElapsedMilliseconds, '') }
        Start-Sleep -Milliseconds 400
    }
    return @(-1, $ult)
}

try {
    # ------------------------------ Datos propios ------------------------------
    $temp = (Rest 'temporadas?select=id,nombre&activa=eq.true' -Servicio)[0]
    $otraTemp = (Rest "temporadas?select=id,nombre&id=neq.$($temp.id)" -Servicio)[0]
    $lts = @(); foreach ($x in (Rest "lotes_temporada?select=id,lote_id,zona_id,lotes!inner(nomenclatura,tipo)&temporada_id=eq.$($temp.id)&activo=eq.true&zona_id=not.is.null&lotes.tipo=eq.AGRICOLA&order=id&limit=8" -Servicio)) { $lts += $x }
    $LAB_ETAPA = (Rest 'labores?select=id,nombre&seguimiento_emplasticado=eq.true&activo=eq.true&limit=1' -Servicio)[0]
    $LAB_OTRA = (Rest "labores?select=id,nombre&seguimiento_emplasticado=eq.false&activo=eq.true&order=nombre&limit=1" -Servicio)[0]
    $tareas = @(); foreach ($x in (Rest 'tareas_sap?select=id,codigo,nombre&activo=eq.true&order=codigo&limit=4' -Servicio)) { $tareas += $x }
    $provP = (Rest 'proveedores?select=id,nombre&tipo=eq.PLASTICO&activo=eq.true&limit=1' -Servicio)[0]
    $provM = (Rest 'proveedores?select=id,nombre&tipo=eq.MANGUERA&activo=eq.true&order=nombre.desc&limit=1' -Servicio)[0]
    $impl = (Rest 'implementos_fisicos?select=id,codigo,descripcion&activo=eq.true&implemento_id=not.is.null&order=codigo&limit=1' -Servicio)[0]
    $fecha = (Get-Date).AddDays(-1).ToString('yyyy-MM-dd')
    $codigo = "QA-LAB-$(Get-Random -Maximum 99999)"
    $eq = (Rest 'equipos' 'Post' @{ codigo = $codigo; nombre = 'Equipo de prueba QA labores' } -Servicio)[0].id
    $ticket = (Rest 'tickets' 'Post' @{ usuario_id = $script:QA.id; fecha = $fecha; codigo = "$codigo-T"; estado = 'ABIERTO'; proceso = 'REGISTRADO'; temporada_id = $temp.id } -Servicio)[0].id
    $hm = (Rest 'horometros' 'Post' @{ ticket_id = $ticket; fecha = $fecha; turno = 'DIURNO'; equipo_id = $eq; horometro_inicial = 1000; horometro_final = 1012; horas_hombre = 12; usuario_id = $script:QA.id } -Servicio)[0].id
    function NuevoRegistro($labor, $tarea) { (Rest 'registros' 'Post' @{ ticket_id = $ticket; horometro_id = $hm; temporada_id = $temp.id; fecha = $fecha; labor_id = $labor; tarea_id = $tarea; usuario_id = $script:QA.id } -Servicio)[0].id }
    $rA = NuevoRegistro $LAB_ETAPA.id $tareas[0].id
    $rB = NuevoRegistro $LAB_ETAPA.id $tareas[0].id
    $rC = NuevoRegistro $LAB_ETAPA.id $tareas[0].id
    $L = @{}; $UT = @{}
    $plan = @(@('L1', $rA, 0, 3), @('L2', $rA, 1, 2), @('L3', $rA, 2, 1), @('L4', $rB, 3, 4), @('L6', $rC, 5, 1), @('L7', $rC, 6, 1))
    foreach ($p in $plan) {
        $lt = $lts[$p[2]]
        $L[$p[0]] = (Rest 'registro_detalle' 'Post' @{ registro_id = $p[1]; lote_temporada_id = $lt.id; avance_mz = $p[3]; fecha = $fecha; usuario_id = $script:QA.id; ciclo = 1 } -Servicio)[0].id
        $UT[$p[0]] = $lt.lotes.nomenclatura
    }
    $UT5 = $lts[4].lotes.nomenclatura   # lote libre para el cambio de UT
    # Otro horómetro (otra pasada del mismo día) para los cambios «de otro usuario»: así no los trae la relectura propia
    $hm2 = (Rest 'horometros' 'Post' @{ ticket_id = $ticket; fecha = $fecha; turno = 'NOCTURNO'; equipo_id = $eq; horometro_inicial = 1012; horometro_final = 1016; horas_hombre = 4; usuario_id = $script:QA.id } -Servicio)[0].id
    $rD = (Rest 'registros' 'Post' @{ ticket_id = $ticket; horometro_id = $hm2; temporada_id = $temp.id; fecha = $fecha; labor_id = $LAB_ETAPA.id; tarea_id = $tareas[0].id; usuario_id = $script:QA.id } -Servicio)[0].id
    $L.L8 = (Rest 'registro_detalle' 'Post' @{ registro_id = $rD; lote_temporada_id = $lts[7].id; avance_mz = 2; fecha = $fecha; usuario_id = $script:QA.id; ciclo = 1 } -Servicio)[0].id
    $UT.L8 = $lts[7].lotes.nomenclatura
    $script:Resultados.Add("(datos: equipo $codigo, 3 labores, 6 líneas; pantalla $ESC)")

    # ------------------------------ Abrir /labores ------------------------------
    Ir '/labores'
    $t0 = Esperar "!!($BUSCA) && document.querySelectorAll('tbody tr').length > 0" 30000
    OK ($t0 -ge 0) "[$ESC] Labores abre" "$t0 ms"
    Teclear $BUSCA $codigo
    $t1 = Esperar "[...document.querySelectorAll('tbody tr')].filter(tr => tr.textContent.includes('$codigo')).length === 7" 20000
    OK ($t1 -ge 0) "[$ESC] Se ven las 7 líneas de prueba" "$t1 ms"
    JS $PRE | Out-Null
    Start-Sleep -Seconds 4   # canal de avisos suscrito
    Reiniciar-Mon

    # ------------------------------ Celdas una a una ------------------------------
    $ms = Editar-Texto $UT.L1 'Comentarios' 'QA comentario 1'
    OK ($ms -ge 0 -and $ms -lt 300) "[$ESC] Comentario: se ve al instante" "$ms ms; rpc $(JS "__rpc('fn_editar_linea_labor')") ms"
    $ms = Editar-Texto $UT.L2 'Mz' '5'
    OK ($ms -ge 0 -and $ms -lt 300) "[$ESC] Mz: se ve al instante" "$ms ms; rpc $(JS "__rpc('fn_editar_linea_labor')") ms"
    $c = Esperar-Cuadre @(@($L.L1, $UT.L1), @($L.L2, $UT.L2), @($L.L3, $UT.L3)) 8000
    OK ($c[0] -ge 0) "[$ESC] Tras cambiar Mz, las horas prorrateadas de las 3 líneas cuadran con la base" "$($c[0]) ms $($c[1]); relectura $(JS "__rpc('horometro_id=in')") ms"
    $ms = Editar-Seleccion $UT.L1 'Etapa' 'Etapa 2'
    OK ($ms -ge 0 -and $ms -lt 300) "[$ESC] Etapa: se ve al instante" "$ms ms"
    $ms = Editar-Seleccion $UT.L1 'Prov. plástico' $provP.nombre
    OK ($ms -ge 0 -and $ms -lt 300) "[$ESC] Proveedor plástico: se ve al instante" "$ms ms"
    $ms = Editar-Seleccion $UT.L2 'Prov. manguera' $provM.nombre.Trim()
    OK ($ms -ge 0 -and $ms -lt 300) "[$ESC] Proveedor manguera: se ve al instante" "$ms ms"
    $ms = Editar-Texto $UT.L3 'H. notificadas' '1.5'
    OK ($ms -ge 0 -and $ms -lt 300) "[$ESC] Horas notificadas a mano: se ve al instante" "$ms ms; rpc $(JS "__rpc('fn_horas_de_linea')") ms"
    $c = Esperar-Cuadre @(@($L.L1, $UT.L1), @($L.L2, $UT.L2), @($L.L3, $UT.L3)) 8000
    OK ($c[0] -ge 0) "[$ESC] Horas a mano: el resto se repartió y cuadra con la base" "$($c[0]) ms $($c[1])"
    OK ((Txt $UT.L3 'H. notificadas') -like '*mano*') "[$ESC] La línea queda marcada «mano»"
    # Vaciar = volver al reparto automático (tecla Supr sobre la celda)
    ClicEn "$(Celda $UT.L3 'H. notificadas')?.querySelector('[data-vista]')" | Out-Null; Tecla 'Delete'
    $c = Esperar-Cuadre @(@($L.L1, $UT.L1), @($L.L2, $UT.L2), @($L.L3, $UT.L3)) 8000
    $manual = (Linea $L.L3).horas_manual
    OK ($c[0] -ge 0 -and -not $manual -and (Txt $UT.L3 'H. notificadas') -notlike '*mano*') "[$ESC] Vaciar horas vuelve al reparto automático" "$($c[0]) ms $($c[1]); manual=$manual"
    # Tarea en una línea de un registro con 3 lotes: se separa
    $ms = Editar-Seleccion $UT.L1 'Tarea' $tareas[1].codigo
    OK ($ms -ge 0 -and $ms -lt 300) "[$ESC] Tarea: se ve al instante" "$ms ms"
    Start-Sleep -Seconds 3
    $b1 = Linea $L.L1; $b2 = Linea $L.L2
    OK ($b1.registro_id -ne $rA -and $b2.registro_id -eq $rA -and [int]$b2.lotes_del_registro -eq 2) "[$ESC] La tarea separó la línea a un registro propio (los otros 2 lotes quedaron)" "L1 reg=$($b1.registro_id) L2 lotes=$($b2.lotes_del_registro)"
    $c = Esperar-Cuadre @(@($L.L1, $UT.L1), @($L.L2, $UT.L2), @($L.L3, $UT.L3)) 6000
    OK ($c[0] -ge 0) "[$ESC] Tras separar, pantalla = base" "$($c[1])"
    $ms = Editar-Seleccion $UT.L4 'Labor' $LAB_OTRA.nombre
    OK ($ms -ge 0 -and $ms -lt 300) "[$ESC] Labor: se ve al instante" "$ms ms"
    $ms = Editar-Seleccion $UT.L2 'Código impl.' $impl.codigo
    OK ($ms -ge 0 -and $ms -lt 300) "[$ESC] Código implemento: se ve al instante" "$ms ms"
    $ms = Editar-Seleccion $UT.L4 'UT' $UT5
    OK ($ms -ge 0 -and $ms -lt 300) "[$ESC] UT: se ve al instante" "$ms ms"
    if ($ms -ge 0) { $UT.L4 = $UT5 }
    Start-Sleep -Seconds 3
    OK ((Linea $L.L4).ut -eq $UT5 -and (Linea $L.L2).codigo_implemento -eq $impl.codigo -and (Linea $L.L4).labor_nombre -eq $LAB_OTRA.nombre) "[$ESC] UT, implemento y labor quedaron en la base" "ut=$((Linea $L.L4).ut) impl=$((Linea $L.L2).codigo_implemento)"
    $m = Mon
    OK ($m.veces -eq 0) "[$ESC] Ninguna edición mostró «Consultando…»" "veces=$($m.veces) ms=$($m.ms)"

    # ------------------------------ Cinco seguidas ------------------------------
    $sw = [Diagnostics.Stopwatch]::StartNew(); $tiempos = @()
    $tiempos += Editar-Texto $UT.L1 'Comentarios' 'QA seguido 1'
    $tiempos += Editar-Texto $UT.L2 'Comentarios' 'QA seguido 2'
    $tiempos += Editar-Texto $UT.L3 'Comentarios' 'QA seguido 3'
    $tiempos += Editar-Texto $UT.L4 'Comentarios' 'QA seguido 4'
    $tiempos += Editar-Texto $UT.L1 'Mz' '2.5'
    $total = $sw.ElapsedMilliseconds
    OK (@($tiempos | Where-Object { $_ -lt 0 -or $_ -ge 300 }).Count -eq 0) "[$ESC] 5 ediciones seguidas: cada una se ve al instante" "$($tiempos -join ', ') ms; total $total ms"
    $c = Esperar-Cuadre @(@($L.L1, $UT.L1), @($L.L2, $UT.L2), @($L.L3, $UT.L3), @($L.L4, $UT.L4)) 10000
    $alerta = JS "[...document.querySelectorAll('[role=alert], .text-red-700, .text-red-800')].map(x => x.textContent.trim()).filter(Boolean).join(' / ').slice(0, 300)"
    OK ($c[0] -ge 0) "[$ESC] 5 seguidas: al final pantalla = base" "$($c[0]) ms $($c[1]); avisos en pantalla: $alerta"

    # ------------------------------ Pegar (Ctrl+V) ------------------------------
    CDP 'Browser.grantPermissions' @{ permissions = @('clipboardReadWrite', 'clipboardSanitizedWrite'); origin = $script:Base } | Out-Null
    Tecla 'Escape'; Start-Sleep -Milliseconds 300
    $orden = JS "(() => { const iu = __qa.colIdx('UT'); return [...document.querySelectorAll('tbody tr')].map(tr => tr.querySelector('td[data-col=""' + iu + '""]')?.textContent.trim()) })()"
    $i1 = if ($orden) { [array]::IndexOf(@($orden), $UT.L1) } else { -1 }; $debajo = if ($i1 -ge 0 -and $i1 + 1 -lt $orden.Count) { $orden[$i1 + 1] } else { $null }
    $okClip = JS "navigator.clipboard.writeText('QA pegado A\nQA pegado B').then(() => true, () => false)"
    if ($okClip) {
        ClicEn "$(Celda $UT.L1 'Comentarios')?.querySelector('[data-vista]')" | Out-Null
        foreach ($t in 'rawKeyDown', 'keyUp') { CDP 'Input.dispatchKeyEvent' @{ type = $t; key = 'v'; code = 'KeyV'; windowsVirtualKeyCode = 86; modifiers = 2; commands = @('paste') } | Out-Null }
    } else {
        JS "(() => { const d = new DataTransfer(); d.setData('text/plain', 'QA pegado A\nQA pegado B'); $(Celda $UT.L1 'Comentarios').querySelector('[data-vista]').dispatchEvent(new ClipboardEvent('paste', { clipboardData: d, bubbles: true })); return true })()" | Out-Null
    }
    $p = Esperar "__qa.texto('$($UT.L1)', 'Comentarios') === 'QA pegado A' && __qa.texto('$debajo', 'Comentarios') === 'QA pegado B'" 8000
    OK ($p -ge 0) "[$ESC] Pegar 2 celdas con Ctrl+V" "$p ms (portapapeles real=$okClip; fila de abajo $debajo)"
    Start-Sleep -Seconds 3
    $pb = (Vista | Where-Object { $_.detalle_comentarios -like 'QA pegado*' }).Count
    OK ($pb -eq 2) "[$ESC] Lo pegado quedó en la base" "$pb líneas"

    # ------------------------------ En masa ------------------------------
    foreach ($k in 'L2', 'L3', 'L4') { ClicEn "__qa.fila('$($UT[$k])')?.querySelector('[aria-label=""Seleccionar fila""]')" | Out-Null }
    $hay = Esperar "!!document.querySelector('select[aria-label=""Tarea en masa""]')" 4000
    Reiniciar-Mon
    JS "__mirar('$($UT.L4)', 'Tarea', '$($tareas[2].codigo)'); true" | Out-Null
    JS "(() => { const s = document.querySelector('select[aria-label=""Tarea en masa""]'); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '$($tareas[2].id)'); s.dispatchEvent(new Event('change', { bubbles: true })); return true })()" | Out-Null
    $ms = Esperar-Visto
    $vistos = JS "['$($UT.L2)', '$($UT.L3)', '$($UT.L4)'].every(u => (__qa.texto(u, 'Tarea') || '').startsWith('$($tareas[2].codigo)'))"
    OK ($hay -ge 0 -and $ms -ge 0 -and $vistos) "[$ESC] Cambiar tarea en masa (3 líneas, 2 del mismo registro) se ve sin esperar la lectura" "$ms ms desde elegir (incluye 3 llamadas)"
    Start-Sleep -Seconds 4
    $b2 = Linea $L.L2; $b3 = Linea $L.L3
    OK ($b2.registro_id -ne $b3.registro_id -and $b2.tarea_codigo -eq $tareas[2].codigo -and $b3.tarea_codigo -eq $tareas[2].codigo) "[$ESC] En masa: L2 se separó de L3 y ambas tienen la tarea nueva" "L2 reg=$($b2.registro_id) L3 reg=$($b3.registro_id)"
    $c = Esperar-Cuadre @(@($L.L1, $UT.L1), @($L.L2, $UT.L2), @($L.L3, $UT.L3), @($L.L4, $UT.L4)) 8000
    OK ($c[0] -ge 0) "[$ESC] En masa: pantalla = base" "$($c[1])"
    $m = Mon; OK ($m.veces -eq 0) "[$ESC] En masa sin «Consultando…»" "veces=$($m.veces)"

    # ------------------------------ Otro usuario ------------------------------
    Start-Sleep -Seconds 5   # fuera de la ventana de silencio
    Rest "registro_detalle?id=eq.$($L.L8)" 'Patch' @{ comentarios = 'QA de otro usuario' } -Servicio | Out-Null
    $ta = Esperar "__qa.texto('$($UT.L8)', 'Comentarios') === 'QA de otro usuario'" 10000
    OK ($ta -ge 0 -and $ta -le 5000) "[$ESC] Cambio de OTRO usuario aparece solo" "$ta ms"
    # Otro usuario cambia algo justo después de una edición propia (dentro de los 4 s de silencio)
    Start-Sleep -Seconds 5
    $ms = Editar-Texto $UT.L1 'Comentarios' 'QA propio antes'
    Start-Sleep -Milliseconds 800
    Rest "registro_detalle?id=eq.$($L.L8)" 'Patch' @{ comentarios = 'QA ajeno en silencio' } -Servicio | Out-Null
    $ta = Esperar "__qa.texto('$($UT.L8)', 'Comentarios') === 'QA ajeno en silencio'" 12000
    OK ($ta -ge 0 -and $ta -le 6500) "[$ESC] Cambio ajeno 0.8 s después de una edición propia también aparece" $(if ($ta -ge 0) { "$ta ms" } else { 'NO apareció en 12 s: silenciarAvisos se lo tragó' })

    # ------------------------------ Bug original ------------------------------
    Start-Sleep -Seconds 5
    Reiniciar-Mon
    Clic 'Consultar' | Out-Null
    Rest "registro_detalle?id=eq.$($L.L4)" 'Patch' @{ comentarios = 'QA aviso durante lectura' } -Servicio | Out-Null
    Start-Sleep -Milliseconds 1300
    $ms = Editar-Texto $UT.L2 'Comentarios' 'QA editado durante lectura'
    $fin = Esperar "!__mon.on && !document.body.textContent.includes('Consultando…')" 15000
    OK ($fin -ge 0) "[$ESC] Consultar + aviso de la base + edición: «Consultando…» NO se queda pegado" "se apagó a los $fin ms"
    Start-Sleep -Seconds 4
    $c = Esperar-Cuadre @(@($L.L2, $UT.L2), @($L.L4, $UT.L4)) 8000
    OK ($c[0] -ge 0) "[$ESC] Tras la carrera lectura/aviso/edición: pantalla = base" "$($c[1])"

    # ------------------------------ Error de red ------------------------------
    CDP 'Network.enable' | Out-Null
    CDP 'Network.setBlockedURLs' @{ urls = @('*fn_editar_linea_labor*') } | Out-Null
    $antes = Txt $UT.L3 'Comentarios'
    $ms = Editar-Texto $UT.L3 'Comentarios' 'QA no debe quedar'
    Start-Sleep -Seconds 2
    $ahora = Txt $UT.L3 'Comentarios'
    $msj = JS "document.body.textContent.includes('No se pudo guardar el cambio') || document.body.textContent.includes('Failed to fetch')"
    # Pegar 2 celdas sin red: el aviso debe contar 2 rechazadas y las celdas volver a lo de la base
    Tecla 'Escape'; Start-Sleep -Milliseconds 300
    $orden2 = JS "(() => { const iu = __qa.colIdx('UT'); return [...document.querySelectorAll('tbody tr')].map(tr => tr.querySelector('td[data-col=""' + iu + '""]')?.textContent.trim()) })()"
    $j1 = [array]::IndexOf(@($orden2), $UT.L1); $deb2 = if ($j1 -ge 0 -and $j1 + 1 -lt @($orden2).Count) { @($orden2)[$j1 + 1] } else { $null }
    $c1 = Txt $UT.L1 'Comentarios'; $c2 = Txt $deb2 'Comentarios'
    JS "navigator.clipboard.writeText('QA rechazo A\nQA rechazo B').then(() => true, () => false)" | Out-Null
    ClicEn "$(Celda $UT.L1 'Comentarios')?.querySelector('[data-vista]')" | Out-Null
    foreach ($t in 'rawKeyDown', 'keyUp') { CDP 'Input.dispatchKeyEvent' @{ type = $t; key = 'v'; code = 'KeyV'; windowsVirtualKeyCode = 86; modifiers = 2; commands = @('paste') } | Out-Null }
    $rech = Esperar "/2 rechazadas al guardar/.test(document.body.textContent)" 10000
    Start-Sleep -Milliseconds 500
    $r1 = Txt $UT.L1 'Comentarios'; $r2 = Txt $deb2 'Comentarios'
    OK ($rech -ge 0) "[$ESC] Pegar sin red: el aviso cuenta «2 rechazadas al guardar»" (JS "(document.body.textContent.match(/\d+ celdas pegadas[^.]*\./) || ['sin aviso'])[0]")
    OK ($r1 -eq $c1 -and $r2 -eq $c2) "[$ESC] Pegar sin red: las 2 celdas vuelven a lo de la base" "L1 '$c1'→'$r1'; $deb2 '$c2'→'$r2'"
    CDP 'Network.setBlockedURLs' @{ urls = @() } | Out-Null
    OK ($msj) "[$ESC] Error de red al guardar: se avisa" ''
    OK ($ahora -eq $antes) "[$ESC] Error de red: la celda vuelve al valor real (sin dato falso)" "antes='$antes' ahora='$ahora' base='$((Linea $L.L3).detalle_comentarios)'"

    # ------------------------------ Editar todo ------------------------------
    JS "window.confirm = () => true; true" | Out-Null
    Clic 'Cerrar' | Out-Null
    $okM = ClicEn "[...(__qa.fila('$($UT.L4)')?.querySelectorAll('button') ?? [])].find(b => b.textContent.trim() === 'Editar todo')"
    $abre = Esperar "[...document.querySelectorAll('label, span, p')].some(x => x.textContent.trim().startsWith('Comentario de la línea'))" 5000
    $ta2 = "[...document.querySelectorAll('[role=dialog] textarea')].find(t => { let p = t.parentElement; for (let i = 0; i < 4 && p; i++, p = p.parentElement) { if (p.textContent.trim().startsWith('Comentario de la línea')) return true } return false })"
    Teclear $ta2 'QA desde Editar todo'
    $sw = [Diagnostics.Stopwatch]::StartNew()
    Clic 'Guardar cambios' | Out-Null
    $cierra = Esperar "![...document.querySelectorAll('button')].some(b => b.offsetParent !== null && b.textContent.trim() === 'Guardar cambios')" 10000
    $vis = Esperar "__qa.texto('$($UT.L4)', 'Comentarios') === 'QA desde Editar todo'" 8000
    OK ($okM -and $abre -ge 0 -and $cierra -ge 0) "[$ESC] «Editar todo» guarda y se cierra sin esperar la lectura completa" "cierra en $cierra ms"
    OK ($vis -ge 0 -and (Linea $L.L4).detalle_comentarios -eq 'QA desde Editar todo') "[$ESC] «Editar todo»: el cambio se ve y está en la base" "$vis ms"

    # ------------------------------ Temporada ------------------------------
    if ($otraTemp) {
        ClicEn "__qa.fila('$($UT.L4)')?.querySelector('[aria-label=""Seleccionar fila""]')" | Out-Null
        $hayT = Esperar "[...document.querySelectorAll('button')].some(b => b.offsetParent !== null && b.textContent.trim() === 'Cambiar temporada')" 4000
        if ($hayT -ge 0) {
            Clic 'Cambiar temporada' | Out-Null
            Esperar "!!document.querySelector('select option[value=""$($otraTemp.id)""]')" 4000 | Out-Null
            JS "(() => { const s = [...document.querySelectorAll('select')].find(x => x.querySelector('option[value=""$($otraTemp.id)""]')); Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(s, '$($otraTemp.id)'); s.dispatchEvent(new Event('change', { bubbles: true })); return true })()" | Out-Null
            $sw = [Diagnostics.Stopwatch]::StartNew()
            JS "[...document.querySelectorAll('[role=dialog] button')].find(b => b.textContent.trim() === 'Guardar').click(); true" | Out-Null
            # El modal se queda abierto con el resumen («N líneas movidas» / lotes que faltan)
            $res = Esperar "/(línea movida|líneas movidas)/.test(document.querySelector('[role=dialog]')?.textContent || '')" 10000
            $texto = JS "(document.querySelector('[role=dialog]')?.textContent || 'sin modal').match(/\d+ l[ií]neas? movidas?[^.]*\./)?.[0] || (document.querySelector('[role=dialog]')?.textContent || 'sin modal').slice(0, 200)"
            OK ($res -ge 0) "[$ESC] Cambiar temporada responde y el modal muestra el resumen" "$res ms: $texto"
            Clic 'Cancelar' | Out-Null
            $bt = Linea $L.L4
            if ($bt -and $bt.temporada_id -ne $temp.id) {
                Rest 'rpc/fn_reasignar_temporada_detalle' 'Post' @{ p_detalle_ids = @($L.L4); p_temporada_id = $temp.id } | Out-Null
                $script:Resultados.Add('(temporada de L4 devuelta a la original)')
            }
        } else { OK $false "[$ESC] Botón «Cambiar temporada» visible" }
    }

    # ------------------------------ Eliminar ------------------------------
    JS "window.confirm = () => true; [...document.querySelectorAll('[aria-label=""Limpiar selección""]')].forEach(b => b.click()); true" | Out-Null
    Start-Sleep -Milliseconds 500
    ClicEn "__qa.fila('$($UT.L6)')?.querySelector('[aria-label=""Seleccionar fila""]')" | Out-Null
    Esperar "[...document.querySelectorAll('button')].some(b => b.offsetParent !== null && /^Eliminar \d/.test(b.textContent.trim()))" 4000 | Out-Null
    JS "__w = { t1: null }; window.__t0 = performance.now(); (() => { const f = () => { if (!__qa.fila('$($UT.L6)')) { __w.t1 = Math.round(performance.now() - __t0); return } if (performance.now() - __t0 < 10000) requestAnimationFrame(f) }; requestAnimationFrame(f) })(); true" | Out-Null
    JS "[...document.querySelectorAll('button')].find(b => b.offsetParent !== null && /^Eliminar \d/.test(b.textContent.trim())).click(); true" | Out-Null
    $ms = Esperar-Visto
    Start-Sleep -Seconds 3
    $quedan = Vista
    OK ($ms -ge 0 -and -not ($quedan | Where-Object { $_.detalle_id -eq $L.L6 }) -and ($quedan | Where-Object { $_.detalle_id -eq $L.L7 })) "[$ESC] Eliminar una línea: desaparece (su labor sigue con el otro lote)" "$ms ms (incluye el borrado)"
    $c = Esperar-Cuadre @(,@($L.L7, $UT.L7)) 6000
    OK ($c[0] -ge 0) "[$ESC] Tras eliminar, horas repartidas = base" "$($c[1])"
    ClicEn "__qa.fila('$($UT.L4)')?.querySelector('[aria-label=""Seleccionar fila""]')" | Out-Null
    Esperar "[...document.querySelectorAll('button')].some(b => b.offsetParent !== null && /^Eliminar \d/.test(b.textContent.trim()))" 4000 | Out-Null
    JS "[...document.querySelectorAll('button')].find(b => b.offsetParent !== null && /^Eliminar \d/.test(b.textContent.trim())).click(); true" | Out-Null
    $gone = Esperar "!__qa.fila('$($UT.L4)')" 6000
    Start-Sleep -Seconds 2
    $regB = @(); foreach ($x in (Rest "registros?select=id&id=eq.$rB" -Servicio)) { $regB += $x }
    OK ($gone -ge 0 -and $regB.Count -eq 0) "[$ESC] Eliminar la labor completa (se queda sin lotes)" "$gone ms; registro en base=$($regB.Count)"

    # ------------------------------ Final ------------------------------
    Start-Sleep -Seconds 3
    $c = Esperar-Cuadre @(@($L.L1, $UT.L1), @($L.L2, $UT.L2), @($L.L3, $UT.L3), @($L.L7, $UT.L7)) 8000
    OK ($c[0] -ge 0) "[$ESC] Final: lo que muestra la pantalla = la base" "$($c[1])"
    $nUi = JS "[...document.querySelectorAll('tbody tr')].filter(tr => tr.textContent.includes('$codigo')).length"
    $nDb = (Vista).Count
    OK ($nUi -eq $nDb) "[$ESC] Final: mismas líneas en pantalla y en la base" "pantalla=$nUi base=$nDb"
    Captura "labores_edicion_rapida_$ESC.png"
    OK ((Errores-Pagina) -eq '') "[$ESC] Sin errores en la página" (Errores-Pagina)
} catch { $script:Resultados.Add("EXCEPCION $($_.Exception.Message) (línea $($_.InvocationInfo.ScriptLineNumber))") }
finally {
    try {
        if ($hm) {
            # registro_detalle no admite DELETE directo ni con la llave de servicio: se va en cascada con su registro
            Rest "registros?horometro_id=eq.$hm" 'Delete' -Servicio | Out-Null
            Rest "horometros?id=eq.$hm" 'Delete' -Servicio | Out-Null
        }
        if ($hm2) { Rest "registros?horometro_id=eq.$hm2" 'Delete' -Servicio | Out-Null; Rest "horometros?id=eq.$hm2" 'Delete' -Servicio | Out-Null }
        if ($ticket) { Rest "tickets?id=eq.$ticket" 'Delete' -Servicio | Out-Null }
        if ($eq) { Rest "equipos?id=eq.$eq" 'Delete' -Servicio | Out-Null }
        $resto = @(); if ($ticket) { foreach ($x in (Rest "tickets?select=id&id=eq.$ticket" -Servicio)) { $resto += $x } }
        $script:Resultados.Add("(datos de prueba borrados; quedan $($resto.Count) tickets QA)")
    } catch { $script:Resultados.Add("(LIMPIEZA INCOMPLETA: $($_.Exception.Message) — borrar a mano equipo $codigo)") }
    Terminar-QA
}
