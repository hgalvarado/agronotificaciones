# QA: Desinfección toma la siembra de AGL (turnos_ciclo, sql/104) y Trasplante/Riego ya no existen en la base.
# Requisitos: sql/104 corrida en DESARROLLO y al menos un turno publicado por AGL («Publicar a campo») con fecha de
# siembra en la temporada ACTIVA. El usuario QA necesita ver/crear/editar en Desinfección › Planificación y ver en
# Ejecución y Reporte. Crea UNA línea de plan de prueba y la borra al final; no guarda ejecuciones.
param([string]$Base = 'http://localhost:3100')
. "$PSScriptRoot\comun.ps1"
Iniciar-QA -Base $Base -Ancho 1440 -Alto 900
$planQA = $null

# Abre un selector con buscador (el botón que está dentro de $contenedorJs) y elige la opción que empieza con $texto
function Elegir($contenedorJs, $texto) {
    JS "(() => { const b = ($contenedorJs)?.querySelector('button[aria-haspopup=listbox]'); if (!b) return false; b.click(); return true })()" | Out-Null
    if ((Esperar "!!document.querySelector('[role=listbox]')" 4000) -lt 0) { return $false }
    return (JS "(() => { const o = [...document.querySelectorAll('[role=listbox] [role=option]')].find(x => x.textContent.trim().startsWith('$texto')); if (!o) return false; o.click(); return true })()")
}
function CampoPorEtiqueta($etiqueta) { "[...document.querySelectorAll('[role=dialog] label, [role=dialog] div')].find(x => x.firstElementChild && x.firstElementChild.textContent.trim().startsWith('$etiqueta'))" }
function Pestana($t) { JS "(() => { const b = [...document.querySelectorAll('button')].find(x => x.offsetParent !== null && x.textContent.trim() === '$t'); if (!b) return false; b.click(); return true })()" }

try {
    # ---------------- 0 · La base ----------------
    $tem = @(Rest 'temporadas?select=id,nombre&activa=eq.true' -Servicio)[0]
    OK ($null -ne $tem) 'Hay temporada activa' $tem.nombre
    $llave = { param($s) ($s.ToLower() -replace '[\s\-_]+', '') }
    $tcs = @(Rest 'turnos_ciclo?select=agl_id,turno_id,temporada,ciclo,fecha_siembra,turnos(codigo)&activo=eq.true&fecha_siembra=not.is.null' -Servicio) |
        Where-Object { (& $llave $_.temporada) -eq (& $llave $tem.nombre) -and $_.ciclo -match '(^|\D)1$' }
    OK ($tcs.Count -ge 1) 'AGL publicó turnos del ciclo 1 con fecha de siembra en la temporada activa' "$($tcs.Count) turnos"
    $tA = $tcs | Sort-Object { $_.turnos.codigo } | Select-Object -First 1
    $codA = $tA.turnos.codigo; $fechaA = $tA.fecha_siembra

    $rpc = @(Rest 'rpc/fn_desinfeccion_siembras_agl' 'Post' @{ p_temporada_id = $tem.id; p_ciclo = 1 })
    $filaA = $rpc | Where-Object { $_.turno_id -eq $tA.turno_id }
    OK ($rpc.Count -ge 1 -and $filaA) 'fn_desinfeccion_siembras_agl responde (sql/104 corrida)' "$($rpc.Count) turnos"
    # Con varias filas del mismo turno la base elige por fecha; aquí basta que la elegida sea una de las publicadas
    $fechasA = @($tcs | Where-Object { $_.turno_id -eq $tA.turno_id } | ForEach-Object { $_.fecha_siembra })
    OK ($fechasA -contains $filaA.fecha_siembra) "La siembra de $codA es la que publicó AGL" "$($filaA.fecha_siembra)"
    $fechaA = $filaA.fecha_siembra

    $retiradas = 0
    foreach ($t in 'siembras', 'planes_siembra', 'turnos_riego', 'turnos_riego_detalle', 'planes_nutricionales', 'recepcion_plantulas') {
        try { Rest "${t}?select=*&limit=1" -Servicio | Out-Null } catch { $retiradas++ }
    }
    OK ($retiradas -eq 6) 'Las tablas de Trasplante y Riego ya no existen en la base' "$retiradas/6"

    $sinAgl = @(Rest 'turnos?select=id,codigo&activo=eq.true&order=codigo' -Servicio) |
        Where-Object { $id = $_.id; -not ($tcs | Where-Object { $_.turno_id -eq $id }) } | Select-Object -First 1

    # ---------------- 1 · Planificación: el turno trae la siembra ----------------
    Ir '/controles/desinfeccion'
    $t0 = Esperar "[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Planificación')" 30000
    OK ($t0 -ge 0) 'Abre Desinfección' "$t0 ms"
    Pestana 'Planificación' | Out-Null
    Esperar "[...document.querySelectorAll('button')].some(b => b.offsetParent && b.textContent.trim() === 'Nuevo')" 20000 | Out-Null
    OK ((JS "[...document.querySelectorAll('th')].some(th => th.textContent.includes('Turno (AGL)'))") -eq $true) 'La cuadrícula del plan muestra la columna «Turno (AGL)»'
    Clic 'Nuevo' | Out-Null
    $t1 = Esperar "!!document.querySelector('[data-turno-agl] button[aria-haspopup=listbox]')" 15000
    OK ($t1 -ge 0) 'El formulario del plan trae el selector «Turno (siembra de AGL)»'
    Start-Sleep -Milliseconds 1500   # que lleguen los turnos de AGL
    OK (Elegir "document.querySelector('[data-turno-agl]')" $codA) "Se elige el turno $codA"
    Start-Sleep -Milliseconds 400
    $fechaInput = JS "[...document.querySelectorAll('[role=dialog] input[type=date]')][0]?.value"
    OK ($fechaInput -eq $fechaA) 'La fecha de siembra se llenó con la de AGL' "$fechaInput (AGL $fechaA)"
    OK ((JS "document.body.innerText.includes('Siembra tomada de AGL')") -eq $true) 'Avisa que la fecha salió de AGL'

    # Lote: el primero de la lista
    $lote = JS "(() => { const c = [...document.querySelectorAll('[role=dialog] *')].find(x => x.textContent.trim() === 'Lote' && x.parentElement?.querySelector('button[aria-haspopup=listbox]')); return c ? true : false })()"
    JS "(() => { const c = [...document.querySelectorAll('[role=dialog] *')].find(x => x.textContent.trim() === 'Lote' && x.parentElement?.querySelector('button[aria-haspopup=listbox]')); c.parentElement.querySelector('button[aria-haspopup=listbox]').click(); return true })()" | Out-Null
    Esperar "!!document.querySelector('[role=listbox] [role=option]')" 4000 | Out-Null
    $loteTexto = JS "(() => { const o = [...document.querySelectorAll('[role=listbox] [role=option]')].find(x => x.textContent.trim() && !x.textContent.includes('Elige')); o.click(); return o.textContent.trim() })()"
    OK ($lote -and $loteTexto) 'Se elige un lote' "$loteTexto"
    Teclear "[...document.querySelectorAll('[role=dialog] input[inputmode=numeric]')][1]" '-70'
    Teclear "[...document.querySelectorAll('[role=dialog] input[inputmode=decimal]')][0]" '300'
    Teclear "[...document.querySelectorAll('[role=dialog] input[inputmode=decimal]')][1]" '1.5'
    Start-Sleep -Milliseconds 300
    JS "(() => { const b = [...document.querySelectorAll('[role=dialog] button')].find(x => x.textContent.trim() === 'Guardar'); b.click(); return true })()" | Out-Null
    $t2 = Esperar "!document.querySelector('[role=dialog]')" 15000
    OK ($t2 -ge 0) 'Guardar cierra el formulario' (JS "document.querySelector('[role=dialog]')?.innerText?.slice(0,200) ?? ''")
    Start-Sleep -Milliseconds 800
    $planQA = @(Rest "desinfeccion_plan?select=id,turno_id,fecha_siembra_congelada,lote_temporada_id&usuario_id=eq.$($script:QA.id)&turno_id=eq.$($tA.turno_id)&order=created_at.desc&limit=1" -Servicio)[0]
    OK ($planQA -and $planQA.fecha_siembra_congelada -eq $fechaA) 'La línea se guardó con el turno y la siembra de AGL' "$($planQA.fecha_siembra_congelada)"

    # ---------------- 2 · Sincronizar vuelve a traer la fecha de AGL ----------------
    if ($planQA) {
        Rest "desinfeccion_plan?id=eq.$($planQA.id)" 'Patch' @{ fecha_siembra_congelada = '2020-01-01' } -Servicio | Out-Null
        Ir '/controles/desinfeccion'
        Esperar "[...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Planificación')" 30000 | Out-Null
        Pestana 'Planificación' | Out-Null
        $t3 = Esperar "[...document.querySelectorAll('tbody tr')].some(tr => tr.innerText.includes('$codA') && /2020/.test(tr.innerText))" 20000
        OK ($t3 -ge 0) 'La cuadrícula muestra la línea con la fecha movida'
        JS "(() => { const tr = [...document.querySelectorAll('tbody tr')].find(tr => tr.innerText.includes('$codA') && /2020/.test(tr.innerText)); tr.querySelector('input[type=checkbox]').click(); return true })()" | Out-Null
        JS "window.confirm = () => true; true" | Out-Null
        Start-Sleep -Milliseconds 300
        JS "(() => { const b = [...document.querySelectorAll('button')].find(x => x.offsetParent && /^Sincronizar \d+$/.test(x.textContent.trim())); if (!b) return false; b.click(); return true })()" | Out-Null
        $t4 = Esperar "document.body.innerText.includes('línea(s) actualizadas')" 15000
        $despues = @(Rest "desinfeccion_plan?select=fecha_siembra_congelada&id=eq.$($planQA.id)" -Servicio)[0].fecha_siembra_congelada
        OK ($t4 -ge 0 -and $despues -eq $fechaA) 'Sincronizar vuelve a copiar la siembra de AGL' "$despues"
    }

    # ---------------- 3 · Ejecución: DDT desde AGL o aviso claro ----------------
    Pestana 'Ejecución' | Out-Null
    Esperar "[...document.querySelectorAll('button')].some(b => b.offsetParent && b.textContent.trim() === 'Nueva ejecución')" 20000 | Out-Null
    Clic 'Nueva ejecución' | Out-Null
    Esperar "!!document.querySelector('[role=dialog]')" 10000 | Out-Null
    $cajaTurno = "[...document.querySelectorAll('[role=dialog] *')].find(x => x.textContent.trim().startsWith('Turno de riego') && x.parentElement?.querySelector('button[aria-haspopup=listbox], select'))?.parentElement"
    if ($sinAgl) {
        $okSel = Elegir $cajaTurno $sinAgl.codigo
        $t5 = Esperar "!!document.querySelector('[data-sin-siembra-agl]')" 10000
        OK ($okSel -and $t5 -ge 0) "Turno sin siembra en AGL ($($sinAgl.codigo)): aviso claro" (JS "document.querySelector('[data-sin-siembra-agl]')?.textContent ?? ''")
        OK ((JS "/no tiene fecha de siembra publicada desde AGL/.test(document.querySelector('[data-sin-siembra-agl]')?.textContent ?? '')") -eq $true) 'El aviso dice qué falta y dónde se arregla'
    } else { OK $true 'Todos los turnos tienen siembra en AGL (no se prueba el aviso)' }
    $okSel = Elegir $cajaTurno $codA
    Start-Sleep -Milliseconds 2500
    OK ($okSel -and (JS "!document.querySelector('[data-sin-siembra-agl]')") -eq $true) "Turno con siembra en AGL ($codA): sin aviso"
    Captura 'desinfeccion_desde_agl_ejecucion.png'
    JS "(() => { const b = [...document.querySelectorAll('[role=dialog] button')].find(x => /Cancelar|Cerrar/.test(x.textContent.trim()) || x.getAttribute('aria-label') === 'Cerrar'); b && b.click(); return true })()" | Out-Null

    # ---------------- 4 · Reporte e Importar ----------------
    Pestana 'Reporte' | Out-Null
    Start-Sleep -Seconds 3
    OK ((Errores-Pagina) -eq '') 'El reporte abre sin errores' (Errores-Pagina)

    Pestana 'Planificación' | Out-Null
    Esperar "[...document.querySelectorAll('button')].some(b => b.offsetParent && b.textContent.trim() === 'Importar')" 15000 | Out-Null
    if ((Clic 'Importar') -eq $true) {
        Esperar "!!document.querySelector('textarea')" 10000 | Out-Null
        Start-Sleep -Milliseconds 1500   # que lleguen los turnos de AGL
        $nom = ($loteTexto -split '\s+[·—]\s+')[0].Trim()
        $pegar = "Lote`tCiclo`tTurno`tDias Aplicacion`tDosis Mz`tArea Planificada`n$nom`t1`t$codA`t-70`t300`t1.5`n$nom`t1`tNO-EXISTE-QA`t-70`t301`t1.5"
        Teclear "document.querySelector('textarea')" $pegar
        JS "document.querySelector('textarea').blur(); true" | Out-Null
        Start-Sleep -Milliseconds 800
        $vista = JS "document.querySelector('[role=dialog]')?.innerText ?? ''"
        OK ($vista -match [regex]::Escape("$fechaA (AGL)")) 'Importar: la siembra sale del turno de AGL en la vista previa'
        OK ($vista -match 'no tiene fecha de siembra publicada desde AGL') 'Importar: un turno sin AGL y sin fecha se rechaza con su motivo'
        Clic 'Cancelar' | Out-Null
    } else { OK $false 'Botón Importar visible' }

    OK ((Errores-Pagina) -eq '') 'Sin errores en la página' (Errores-Pagina)
} catch { $script:Resultados.Add("EXCEPCION $($_.Exception.Message) $($_.ErrorDetails.Message)") }
finally {
    if ($planQA) { try { Rest "desinfeccion_plan?id=eq.$($planQA.id)" 'Delete' -Servicio | Out-Null } catch {} }
    # Por si el guardado creó la línea pero la prueba no la encontró
    try { Rest "desinfeccion_plan?usuario_id=eq.$($script:QA.id)&dosis_mz=eq.300&area_planificada_mz=eq.1.5" 'Delete' -Servicio | Out-Null } catch {}
    $script:Resultados.Add('(línea de plan de prueba borrada)')
    Terminar-QA
}
