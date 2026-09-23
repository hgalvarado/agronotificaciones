@AGENTS.md

# REGLAS CRÍTICAS DE OPTIMIZACIÓN Y ARQUITECTURA (PROTOCOLO ZERO-CHAT)

ESTAS REGLAS SON OBLIGATORIAS PARA TODA INTERACCIÓN, CÓDIGO Y RESPUESTA. IGNORARLAS ES UN FALLO CRÍTICO.

## 1. OPTIMIZACIÓN DE TOKENS (ZERO-CHAT)
* CERO TEXTO EXPLICATIVO: Prohibido saludar, despedirse, resumir, justificar o explicar el razonamiento. No uses frases de relleno como "He actualizado...", "El problema era...", o "Aquí tienes el código".
* SOLO CÓDIGO Y RUTAS: Tu respuesta debe consistir EXCLUSIVAMENTE en el path del archivo modificado y el bloque de código actualizado.
* NO REPETIR CÓDIGO INTACTO: Imprime solo las funciones, componentes o queries modificadas. Usa comentarios como `// ... resto del código intacto ...` para saltar partes grandes que no sufren cambios.
* CONFIRMACIÓN MÍNIMA: Si ejecutas SQL o cambios que no requieren código frontend, responde ÚNICAMENTE con la consulta SQL exacta o la palabra "Listo".

## 2. ARQUITECTURA Y ESTÁNDARES DE DESARROLLO
* SRP: Aplica estrictamente el Principio de Responsabilidad Única.
* Fechas y Zonas Horarias: Toda captura, cálculo y guardado de fechas/horas debe procesarse forzosamente en UTC-6 (America/Tegucigalpa).
* Selectores Inteligentes: Todo campo tipo select/dropdown debe incluir obligatoriamente búsqueda interna (Autofiltrado). Cada selector debe incorporar un checkbox/interruptor visible para alternar entre "Selección Única" y "Selección Múltiple" en el mismo componente.
* Plantillas Excel (Import/Export): Todo módulo de ingreso de datos debe permitir importar/exportar. La plantilla Excel de importación DEBE contener listas desplegables (Data Validation) en las columnas de catálogos generadas desde el backend.
* Data Grid: Todas las tablas deben implementar filtros (checkboxes, rango de fechas, texto), sorting, selección múltiple de filas y edición inline (directamente en la tabla).
* Estandarización UI/UX: Unificar siempre los verbos de acción ("Eliminar", "Guardar", "Editar", "Importar", "Exportar").

## 3. SEGURIDAD Y PERMISOS (RBAC)
* Todo registro permite modificación/eliminación masiva, respetando ESTRICTAMENTE el control de acceso basado en roles (RBAC) dinámico de la base de datos.
* PROHIBIDO: No hardcodear nombres de roles en el código frontend ni backend. Todo se valida a través de la matriz de permisos de la base de datos (ej. fn_tiene_permiso).