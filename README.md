# Barber VIP — revisión profesional

Aplicación web instalable para barberos independientes. Incluye panel de administración, tarjeta de cliente, promociones, recordatorios, invitaciones personales y página comercial.

## Enlaces de producción

- **Página comercial para prospectar barberos:** `https://barber-vip-three.vercel.app/comercial.html`
- **Aplicación:** `https://barber-vip-three.vercel.app/`
- **Registro directo de administrador (CTA de prueba gratuita):** `https://barber-vip-three.vercel.app/?signup=1`
- **Invitación de cliente:** se genera de forma individual como `/invitacion.html?ref=<token>`; no se debe compartir un enlace de invitación genérico.

## Cambios de esta revisión

- **Inicio:** cuatro accesos rápidos: Crear cliente, Sumar corte, Promociones y Programa de referidos. Configuración se mantiene en la navegación principal, no como acceso rápido duplicado.
- **Filtro de Sumar corte:** búsqueda normalizada sin distinguir mayúsculas ni tildes y ocultación real de filas que no coinciden. Se agregó bloqueo local para evitar registrar dos veces por doble toque accidental.
- **Ciclo principal fijo:** cortes 2, 4 y 6. Los porcentajes iniciales son 10%, 20% y 30%; el barbero puede modificarlos entre 1% y 50%, pero no cambiar ni agregar etapas. Si la configuración del programa tenía exactamente los valores predeterminados antiguos (30%, 50%, 70%), se normaliza a 10%, 20% y 30%. Otros porcentajes válidos guardados se conservan cuando corresponden a las etapas 2, 4 y 6. Los beneficios que ya estaban desbloqueados antes de esta revisión no se reescriben retroactivamente.
- **Un único beneficio activo:** al llegar al corte 2 se habilita el primer beneficio; en el corte 4 se reemplaza por el beneficio mejorado, si el anterior no se canjeó; en el corte 6 se habilita el beneficio máximo y el ciclo queda pausado. No se generan descuentos acumulados. Al canjear el beneficio de corte 6, el ciclo vuelve a cero. Si se canjea un beneficio de corte 2 o 4, el ciclo continúa desde el número de corte alcanzado.
- **Referidos por visita real:** cada corte registrado a un cliente invitado intenta acreditar un corte al ciclo de quien lo invitó. Si el ciclo del invitador está pausado en el corte 6, el crédito no se aplica ni queda guardado para más adelante; se registra un contador de créditos omitidos para poder explicarlo en la trazabilidad. El corte real del invitado sí se registra normalmente. Los créditos de referidos no crean visitas ficticias ni incrementan las estadísticas mensuales del local.
- **Trazabilidad simplificada:** el panel de administración muestra quién invitó a quién, cortes reales, créditos entregados y créditos no aplicados por pausa. Se retiró la lista visual de hitos configurables.
- **Panel de cliente:** Afiliados explica el mismo funcionamiento, muestra el ciclo actual y la lista de personas invitadas. Se conserva un solo botón para compartir la invitación.
- **Flujo comercial:** la página `comercial.html` explica el producto y envía el CTA a `/?signup=1`. Si el navegador ya tenía una sesión abierta, el parámetro de alta muestra primero el registro de administrador en esa navegación inicial, sin restaurar por encima la sesión existente. La invitación de cliente sigue en `invitacion.html`, separada de la SPA, para no mezclar sesiones ni formularios.
- **Invitación:** se aclara que la cuenta se vincula con un barbero profesional y con la persona que invitó. La frecuencia inicial de la invitación es de 15 días.
- **Instalación/PWA:** se incrementó la versión de caché del service worker para que los dispositivos reciban esta revisión en vez de mantener archivos anteriores.

## Despliegue en Vercel

1. Guardá una copia del repositorio que está funcionando.
2. Extraé este ZIP y copiá **todo su contenido** a la raíz del repositorio `NachoMor123/barber-vip`, reemplazando los archivos correspondientes. No subas el ZIP como archivo dentro del repositorio.
3. Confirmá que `index.html`, `comercial.html`, `invitacion.html`, `sw.js`, `vercel.json`, `package.json`, `firestore.rules`, y las carpetas `api/`, `lib/`, `assets/` estén en la raíz.
4. Mantené las diez funciones de `api/` incluidas en este ZIP; no dejes funciones viejas duplicadas con el mismo nombre.
5. Hacé commit y verificá en Vercel que se haya desplegado el commit correcto.

## Variables de Vercel

Esta revisión no necesita variables nuevas. Se mantienen las existentes:

- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `APP_URL`
- `MP_ACCESS_TOKEN`
- `MP_WEBHOOK_SECRET`
- `SUBSCRIPTION_PRICE_ARS`
- `CRON_SECRET`

Confirmá que `APP_URL` sea la URL de producción y que `MP_WEBHOOK_SECRET` coincida con la configuración del webhook de Mercado Pago.

## Firebase y datos

No hace falta crear colecciones manualmente. El proyecto utiliza las colecciones y documentos que ya crean las funciones del servidor, incluidos `customerInvites`, `customerSignupLimits`, `trialClaims` y `payments`. Las operaciones protegidas de administración usan Firebase Admin.

El historial de cortes conserva los últimos 60 días. La limpieza programada está configurada en `vercel.json`; además, la API intenta eliminar registros vencidos en lotes acotados. Eliminar el historial de un rango no elimina clientes, cuentas ni premios. Ocultar un recordatorio tampoco elimina al cliente.

Para escalar a miles de clientes por barbero, el siguiente paso de infraestructura sería paginar clientes y referidos. Esta revisión no agrega lecturas en tiempo real nuevas ni una colección extra por cada crédito; los cambios de afiliación se guardan dentro de la transacción que registra el corte.

## Prueba de aceptación antes de prospectar

Probá con dos clientes de prueba y, de ser posible, dos dispositivos o perfiles de navegador separados:

1. Abrí `/comercial.html` y usá el CTA de prueba gratuita. Verificá que lleve al registro de administrador.
2. Creá un administrador de prueba y revisá el perfil, la configuración de premios y la sección de clientes.
3. Configurá porcentajes de prueba, por ejemplo 10%, 20% y 30%. Verificá que solo se puedan editar los porcentajes y que las etapas sigan fijas en 2, 4 y 6.
4. Creá el cliente A, compartí su invitación y registrá el cliente B desde `invitacion.html`.
5. Sumá cortes al cliente B. En cada corte, el ciclo del cliente B debe avanzar normalmente y el de A debe avanzar un corte si no está pausado.
6. Llevá A al corte 6. El ciclo debe quedar en 6/6 y las nuevas visitas de B no deben acumular créditos mientras A no canjee el beneficio máximo.
7. Canjeá el beneficio máximo de A. Su ciclo debe reiniciarse a 0/6 y las visitas posteriores de B pueden volver a acreditarse.
8. Probá el filtro de Sumar corte escribiendo un nombre parcial, incluso con mayúsculas o sin tildes.
9. Instalá y desinstalá la PWA; verificá que el navegador vuelva a mostrar la opción de instalación cuando corresponda.
10. Probá el período de prueba y los pagos de Mercado Pago en condiciones controladas; confirmá la activación mediante el webhook.

## Notificaciones y límites de verificación

Los recordatorios actuales son internos y abren WhatsApp para que el barbero confirme manualmente el envío. No se presentan como notificaciones push reales. Las notificaciones push con la aplicación cerrada requieren implementar Web Push con permiso explícito, claves VAPID, almacenamiento de suscripciones y una tarea programada.

Se comprobaron sintácticamente los archivos JavaScript y la estructura del paquete. Desde este entorno no es posible certificar la ejecución real contra Firebase, Mercado Pago, Android/iOS o el despliegue de Vercel. La prueba de aceptación anterior es necesaria antes de ofrecerlo públicamente.
