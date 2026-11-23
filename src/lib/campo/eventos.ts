/** Eventos de ventana que comparten el indicador del encabezado y las pantallas de Campo (sin dependencias). */

/** Lo emite el indicador «En línea / Sin señal»; la pantalla que tiene el panel «Envíos» lo atiende con `preventDefault`. */
export const EVENTO_ABRIR_ENVIOS = 'campo:abrir-envios'

/** Lo emite `useCampo` cada vez que cambia la cola de envíos del teléfono (para que el número del indicador se actualice). */
export const EVENTO_COLA_CAMBIO = 'campo:cola'
