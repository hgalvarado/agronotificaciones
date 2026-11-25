# Guía de UI/UX (leer ANTES de escribir una pantalla)

Reglas ya pedidas por el usuario. Las revisa un hook (`scripts/revisar-ui.mjs`, avisa tras cada edición de `.tsx`).
Excepción verificada: comentario `// ui-ok: motivo` en la línea o la anterior.

**a) Densidad.** Las listas son filas compactas (~48–60 px) agrupadas (por día, por DDT…). Nunca una tarjeta gigante por registro. Sin scroll infinito: «Ver más» o ventana. Lo importante se ve sin scroll largo.

**b) Jerarquía.** Nivel 1: producto / dosis / valor principal (negrita, mayor). Nivel 2: contexto (lote, cantidad, DDT, fecha). Nivel 3: detalle (pequeño, gris). El lote siempre «Nombre · código» (`rotuloLote`).

**c) Sin acciones por fila ni casillas de selección.** Tocar la fila abre el DETALLE; solo ahí aparecen Anular / Eliminar / Editar, según permisos (patrón `DetalleDocumento` de Fertirriego).

**d) Botones.** Grandes solo para la acción principal de la pantalla; los secundarios, discretos. Área táctil >= 44 px aunque el dibujo sea pequeño (`min-h-11` o zona ampliada).

**e) Color.** Siempre icono + texto, nunca solo color. Tema claro y oscuro con variables/tonos que `globals.css` ya redefine; sin hex ni `rgb()` sueltos.

**f) Componentes del proyecto**, no estilos inventados: `Tarjeta`, `Insignia`, `Acordeon`, `SelectorBuscable` / `SelectorMultiple` (búsqueda y única/múltiple), `Modal`, `AvisoFlotante`. Sin `<select>` nativo, `alert()` ni `confirm()`.

**g) Filtros** contraídos en una barra delgada con contador de activos.

**h) Mobile-first a 412 px**, sin desborde horizontal. Todo operable con teclado (nada de `div` con `onClick` sin rol).

**i) Estados** vacío, de carga y de error claros; guías y botón «Regresar».

**j) Verbos estándar:** Guardar, Editar, Eliminar, Importar, Exportar. Fechas en `America/Tegucigalpa` (UTC-6).

**k) Comprobar SIEMPRE en el navegador** con datos reales (DEMO: `scripts/sembrar-demo-campo.sql`) a 412 px antes de decir «listo», en 3 estados: **claro, oscuro, vacío**.

## Elegancia (pedido del dueño: «elegante y profesional, no de circo»)

- **Sin fondos de color en filas ni bloques.** La fila lleva el fondo normal de tarjeta. El color vive solo en (1) la **banda vertical fina** (4 px, esquinas redondeadas) al margen izquierdo, con el color del tipo/estado/categoría, y (2) la **insignia sobria** (icono + texto del color + borde fino, sin relleno).
- **Nada de puntos de colores.** Se usa siempre la misma pieza: `BandaLateral` (`components/ui/Banda.tsx`; `absoluta` para toda la fila, o como columna de la rejilla) e `InsigniaSobria` (mismo archivo). Bitácora: `colorBanda(familia)`.
- **Pesos moderados:** `font-medium` o `font-semibold` ligero; **nunca `font-bold`/`font-extrabold` en listas**. Producto 14–15 px `font-medium`; dosis/valor principal `font-semibold`; **el lote («Nombre · código») visible y legible: 13–14 px `font-medium`, texto principal (no gris tenue)**; cantidad/DDT/fecha 12–13 px normal y gris legible; detalle 12 px gris.
- **Paleta contenida:** pocos colores a la vez; la leyenda solo muestra lo que hay en pantalla.
- El hook `scripts/revisar-ui.mjs` avisa (`negrita-en-fila`, `fondo-color-en-fila`); excepción verificada con `// ui-ok: motivo`.

