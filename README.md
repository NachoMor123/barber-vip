# Barber VIP — versión simplificada 2–4–6

PWA para barberos independientes. Esta versión elimina el programa de afiliación/referidos y mantiene un único motor de fidelización, promociones, recordatorios y registro de cortes.

## Enlaces
- Página comercial para promocionar Barber VIP: `https://barber-vip-three.vercel.app/comercial.html`
- Entrada normal de la aplicación: `https://barber-vip-three.vercel.app/`
- Inicio de registro del administrador desde la página comercial: `https://barber-vip-three.vercel.app/?signup=1`
- Los clientes entran por la app normal y usan el código de su barbero.

## Fidelización
- Un único ciclo para todos los clientes: corte 2, corte 4 y corte 6.
- Los porcentajes se editan desde Configuración; las etapas no se pueden agregar ni eliminar.
- Al alcanzar un hito, queda un solo premio preparado. Al registrar la visita siguiente, el servidor aplica automáticamente ese premio; no hay botón de canje manual.
- El premio del corte 6 se aplica en la siguiente visita y esa misma visita inicia el nuevo ciclo en corte 1.
- Los valores por defecto son 10%, 20% y 30%, configurables entre 1% y 100%. El 100% equivale a un servicio sin cargo; el barbero debe considerar el impacto económico.
- Las promociones comerciales son independientes de estos premios.

## Clientes, borrados e historial
- Dar de baja desactiva el acceso, quita el nombre normalizado y WhatsApp de la comprobación de duplicados, y permite reutilizar esos datos en un nuevo perfil. Los registros históricos mantienen la instantánea del nombre anterior.
- Los cortes se retienen durante 60 días. La limpieza oportunista y la tarea programada eliminan registros antiguos. El historial manual solo permite eliminar rangos dentro del período conservado.
- Los clientes de paso generan una visita de historial, pero no reciben cuenta ni avanzan un ciclo de fidelización.
- El filtro de «Sumar corte» filtra en vivo por nombre (sin depender de mayúsculas o tildes) y WhatsApp.
- En Clientes existe un filtro de «Premios listos».
- Recordatorios conserva el flujo normal de Por contactar, Seguimiento y Ocultos; no incluye simulador de prueba.
- El estado «Estoy atendiendo / No estoy atendiendo» se calcula con los horarios semanales y la hora local del dispositivo, y solo se muestra en la experiencia del cliente; no aparece en el panel del administrador.
- Las promociones de cliente se vuelven a consultar al volver a la pestaña y cada 60 segundos mientras la sesión está visible; los cambios no requieren actualizar manualmente, aunque no son instantáneos al segundo.
- En Configuración se puede ocultar o volver a mostrar el botón de ayuda Pip.
- El cronómetro de promociones del cliente se muestra sin el recuadro interior pesado.

## Vercel Hobby y estructura
- Se incluyen 10 funciones API en `api/`, por debajo del límite de 12 funciones serverless del plan Hobby.
- No se agregan endpoints nuevos ni variables de entorno en esta versión. Conservá las variables de Firebase Admin, Mercado Pago, `APP_URL`, `SUBSCRIPTION_PRICE_ARS` y `CRON_SECRET` que ya usás.
- No hace falta crear colecciones nuevas ni cambiar las reglas de Firestore para estas modificaciones.

## Actualización
1. Guardá una copia de tu repositorio actual.
2. Descargá y descomprimí el ZIP.
3. Subí el contenido extraído a la raíz de GitHub (no subas el ZIP como un solo archivo) y reemplazá los archivos existentes.
4. Verificá que `index.html`, `comercial.html`, `vercel.json`, `package.json` y las carpetas `api/`, `lib/`, `assets/` estén al mismo nivel.
5. Comprobá que `api/` contenga los 10 `.js` incluidos en este ZIP y que no queden funciones antiguas adicionales.
6. Hacé un commit nuevo y comprobá que Vercel despliegue ese commit.

## Validación y limitaciones
Se valida sintaxis JavaScript de los módulos y endpoints, JSON y estructura del ZIP. No se afirma haber probado transacciones con tu Firebase o Mercado Pago reales; antes del uso real, probá sumar cortes 1–7, aplicar premios, dar de baja un cliente y reusar nombre/WhatsApp, buscar en «Sumar corte» y confirmar que el historial conserva solo 60 días.

Nota de compatibilidad: un campo histórico antiguo puede permanecer en documentos existentes para preservar el cálculo de visitas reales, pero no existe interfaz ni operación activa de referidos en esta versión.
