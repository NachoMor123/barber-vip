# Barber VIP — revisión de producto y referidos continuos

Entrega basada en `BarberVIP-Referidos-Profesional.zip`. Incluye la aplicación, la página comercial, el registro aislado por invitación y las 10 funciones API previstas para Vercel Hobby.

## Cambios de esta revisión

- **Inicio:** accesos rápidos reducidos a Crear cliente, Sumar corte, Promociones y Programa de referidos. Se quitó Configuración de ese bloque para priorizar las tareas diarias.
- **Clientes:** filtro de origen para distinguir altas creadas por el barbero, registro directo, registro por referido y perfiles antiguos cuyo origen no quedó guardado. Las altas nuevas guardan `signupSource`; los perfiles antiguos no se etiquetan falsamente.
- **Interfaz:** se unificó el lenguaje visual en negro azulado, superficies casi negras, bordes azul eléctrico más visibles y botones primarios luminosos. El bloque general de accesos rápidos ya no es otra tarjeta detrás de las cuatro acciones.
- **Recordatorios:** se quitó la fila duplicada de contadores. Las pestañas muestran las cantidades; la explicación queda una sola vez.
- **Referidos continuos:** los hitos se repiten por ciclo. Con `[1, 4, 6]`, los créditos corresponden a los cortes reales 1, 4, 6, 7, 10, 12, 13, 16, 18… Cada crédito avanza el ciclo de premios del invitador sin sumar un corte ficticio a las estadísticas mensuales ni al historial. La operación se registra dentro de la transacción del corte para evitar duplicados por reintentos.
- **Perfil de Instagram:** en Ajustes se escribe solamente el usuario; el servidor lo valida y guarda una URL canónica de Instagram. Se aceptan URLs antiguas para mantener compatibilidad con perfiles ya guardados.
- **Plan:** «Ver plan» no inicia pagos para cuentas activas. Durante la prueba gratuita aparece una opción separada para pagar antes; si Mercado Pago aprueba ese pago con la acción correspondiente, los 30 días se cuentan desde la aprobación y sustituyen el tiempo de prueba restante. Los pagos normales extienden el vencimiento como antes.
- **Instalación PWA:** el estado «instalada» ya no se conserva en `localStorage`, porque eso quedaba desactualizado si se desinstalaba después. Si el navegador no está en modo app, vuelve a ofrecer instalación; tras aceptar, la espera pasa a instrucciones si el navegador no confirma la instalación en 25 segundos.
- **Página comercial:** nuevo `comercial.html`, con explicación del producto, beneficios, referidos, preguntas frecuentes y CTA a `/?signup=1`, que abre el formulario de administrador si no hay una sesión activa.
- **Pip:** se actualizó la explicación del pago anticipado y de los hitos de afiliación repetidos.

## Despliegue

1. Guardá una copia del repositorio que está funcionando.
2. Extraé este ZIP y copiá **todo su contenido** a la raíz del repositorio `NachoMor123/barber-vip`, reemplazando los archivos correspondientes. No subas el ZIP como archivo dentro del repositorio.
3. Verificá que `index.html`, `comercial.html`, `invitacion.html`, `vercel.json`, `package.json`, `firestore.rules`, y las carpetas `api/`, `lib/`, `assets/` estén en la raíz.
4. Dentro de `api/` dejá las 10 funciones de este ZIP. No conserves funciones viejas duplicadas.
5. Hacé commit y comprobá que Vercel haya desplegado el commit correcto.

## Variables de Vercel

No se agregan variables nuevas. Se mantienen las existentes: `FIREBASE_SERVICE_ACCOUNT_JSON`, `APP_URL`, `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET`, `SUBSCRIPTION_PRICE_ARS` y `CRON_SECRET`.

Para Mercado Pago, confirmá que `APP_URL` sea la URL de producción y que `MP_WEBHOOK_SECRET` corresponda al webhook configurado. El webhook debe recibir notificaciones reales para activar la suscripción.

## Firebase / escalabilidad

No hace falta crear colecciones manualmente. Las colecciones `customerInvites`, `customerSignupLimits`, `trialClaims` y `payments` se usan/actualizan desde el servidor. Las operaciones protegidas usan Firebase Admin.

El historial conserva 60 días de cortes y la limpieza programada está configurada en `vercel.json`. Ocultar un recordatorio no borra el cliente ni su historial. El historial manual se puede eliminar por rango dentro de la ventana conservada.

La lista de clientes y el panel de referidos siguen siendo apropiados para el lanzamiento inicial, pero el siguiente paso para volúmenes altos es agregar paginación de clientes y paginación de referidos; no conviene cargar miles de documentos en una sola vista.

## Notificaciones

La aplicación mantiene recordatorios dentro del panel y abre WhatsApp con un mensaje preparado; el barbero confirma manualmente el envío. **No se simulan notificaciones push**: para enviar avisos aun con la app cerrada hace falta implementar Web Push real, permiso explícito, claves VAPID, almacenamiento de suscripciones y un proceso programado. No se activó esa infraestructura en esta entrega para no presentar una notificación local como si fuera una push fiable.

## Verificaciones realizadas y límites

- Sintaxis de los archivos API JavaScript comprobada localmente con `node --check`.
- Estructura del ZIP y rutas revisadas.
- La integración real con Firebase, Mercado Pago, los dispositivos Android/iOS y el despliegue Vercel no puede certificarse desde este entorno. Antes de abrirlo a muchos usuarios, probá con dos cuentas y dos dispositivos: registro, hitos de referidos, pago de prueba, vencimiento, instalación/desinstalación y reintentos de red.
