/**
 * Arranque del servidor: dejar el proceso en hora de Honduras.
 *
 * Vercel levanta sus funciones en UTC. La aplicación no depende de eso
 * —`lib/fechas/zona` pide la zona de forma explícita en cada cuenta—,
 * pero sí dependen de ella las cosas que no pasan por ahí: los mensajes
 * de registro, cualquier `toLocaleString` sin opciones y las librerías de
 * terceros. Fijar `TZ` una vez al arrancar hace que el servidor cuente
 * los días igual que la finca, y que un `console.log` con hora se pueda
 * comparar con lo que dice el operador por teléfono.
 *
 * `register` corre una sola vez por instancia, antes de atender la
 * primera petición.
 */

export function register() {
  process.env.TZ = 'America/Tegucigalpa'
}
