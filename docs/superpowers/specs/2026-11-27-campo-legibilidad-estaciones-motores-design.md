# Campo: título del módulo, estaciones con botones, Parámetros y Motores inteligente

Pedido del usuario (2026-11-27). Módulos: Fertirriego, Inyección, Motores y combustible, Parámetros de riego.

## Por qué
La gente no sabe en qué módulo está, elegir estación en una lista es tedioso y se pierde al guardar/salir, hay
usuarios con problemas de vista, los registros de Parámetros se confunden con la captura y muestran otras zonas, y
Motores no anticipa cuándo se acaba el diésel ni cuándo toca mantenimiento.

## Decisiones
1. **Título del módulo**: componente común `EncabezadoModulo` (franja arriba, nombre centrado, grande, ícono y color del
   módulo). La estación pasa a subtítulo. En los 4 módulos.
2. **Estación con botones**: componente común `FiltroEstaciones`: fila de botones «Zona» (solo zonas que la persona
   tiene; oculta si es una) y fila «Estación» (las de la zona). Botones ≥44 px. Se guarda con la preferencia que ya
   existe (`preferencia('estacion')`, compartida por los 3 módulos de estación) y también la zona. Buscar y arreglar
   por qué se pierde al guardar o salir. La estación solo cambia si la persona elige otra (o un enlace de alerta).
3. **Parámetros**: ficha nueva en Campo «Registros de parámetros» → `/agrometricas/registros`. 3.1: `fn_agm_mis_registros`
   y `fn_agm_ic_mis_registros` filtran por las zonas de la persona (mismo alcance por zona que la captura, sql/109),
   en `sql/156`. Admin y «Todas las zonas» ven todo.
3.2 **Legibilidad**: mejora base para todos en los 4 módulos (grises más oscuros, bordes marcados) + botón
   «Letra grande» por persona y teléfono (localStorage con try/catch) que agranda texto y botones en esos módulos.
   Color siempre con ícono o palabra. Componentes del proyecto; claro y oscuro.
4. **Motores**: por motor, «días de combustible» = galones del tanque ÷ gal/día promedio de los últimos 14 días con
   registro; «días para mantenimiento» = horas que faltan ÷ horas/día promedio (mismos 14 días), con fecha estimada.
   Menos de 3 días con registro = «Sin datos suficientes». En la vista General, botones de orden: «Menos días de
   combustible» y «Mantenimiento más cerca». Cálculo puro en `lib/motores/pronostico.ts` con pruebas unitarias.

## Enfoques considerados
- Lista con buscador (actual) vs. botones: el usuario pidió botones.
- Legibilidad siempre vs. botón: el usuario eligió botón «Letra grande».
- Pronóstico en SQL vs. en el teléfono: en el teléfono (los datos ya están en el estado de Motores; sin SQL nuevo).

## No hace
No cambia permisos de captura ni AGL. La pestaña General de Motores «está perfecta»: solo se agregan los dos datos y los
botones de orden, sin rediseñarla.
