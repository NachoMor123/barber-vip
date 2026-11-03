# Barber VIP — Cloudflare Worker auxiliar

Este Worker ejecuta las operaciones que Firebase Spark no puede alojar:
- Crear preferencias y recibir webhooks de Mercado Pago.
- Guardar suscripciones y enviar notificaciones Web Push después de visitas y promociones.
- Cambiar la contraseña de un cliente cuando lo solicita su barbero.

Firebase Hosting, Authentication y Firestore siguen siendo la plataforma principal. El Worker no aloja la aplicación ni la web comercial.

## Preparación

1. Necesitás una cuenta Cloudflare en el plan Free y entrar desde la carpeta worker.
2. Mantener el proyecto Firebase existente: barbervip-309dc.
3. Crear una cuenta de servicio dedicada para Barber VIP en Google Cloud IAM. Concederle solamente estos roles sobre el proyecto `barbervip-309dc`: **Cloud Datastore User** (`roles/datastore.user`) para leer/escribir Firestore y **Firebase Authentication Admin** (`roles/firebaseauth.admin`) para actualizar contraseñas. Esta cuenta tiene acceso administrativo a Authentication, por lo que su clave es muy sensible. Descargar el JSON y guardarlo como secreto de Cloudflare; nunca subirlo a GitHub ni pegarlo en un chat. La API `projects.accounts:update` exige el permiso `firebaseauth.users.update` y un OAuth de Google con alcance `identitytoolkit`.
4. Esta migración usa un par VAPID nuevo: la clave pública y el identificador de contacto ya están en `wrangler.jsonc`; la clave privada se entregó al propietario en un archivo separado y debe cargarse como secreto `VAPID_PRIVATE_KEY`. No subirla al repositorio ni compartirla por chat. Al cambiar del origen Vercel a Firebase Hosting, los clientes deberán activar las notificaciones en el nuevo dominio.
5. Tener el Access Token y el secreto de webhook de Mercado Pago.

## Secretos

wrangler.jsonc contiene la configuración pública de Firebase y VAPID (incluidas VAPID_PUBLIC_KEY y VAPID_SUBJECT). Cargar solamente los siguientes valores privados como secretos desde worker:

~~~bash
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON
npx wrangler secret put MP_ACCESS_TOKEN
npx wrangler secret put MP_WEBHOOK_SECRET
npx wrangler secret put VAPID_PRIVATE_KEY
~~~

FIREBASE_SERVICE_ACCOUNT_JSON es el contenido completo del JSON de la cuenta de servicio, no la ruta. FIREBASE_WEB_API_KEY es la clave pública de configuración web de Firebase.


## Frontend Vercel y seguridad de pagos

- El Worker mantiene Firebase Hosting como origen de retorno predeterminado mediante APP_ORIGIN.
- Se permiten el dominio Vercel de producción y los previews del proyecto Barber VIP. El patrón de previews está limitado al nombre del proyecto y al identificador de equipo Vercel configurado.
- worker-config.js apunta al Worker existente: https://barber-vip.barbervip.workers.dev.
- Checkout vuelve al origen HTTPS autorizado que inició la solicitud; el webhook usa el endpoint del propio Worker.
- Las solicitudes de creación de pagos originadas desde Vercel Preview se bloquean por defecto con VERCEL_PREVIEW_PAYMENTS_ENABLED=false. Esto evita crear checkouts con credenciales productivas durante pruebas de interfaz.
- Para probar cobros, se debe usar un Worker de pruebas separado con Access Token y secreto de webhook de prueba. No reemplazar los secretos productivos por credenciales de prueba.
- FIREBASE_WEB_API_KEY es una configuración pública ya declarada en wrangler.jsonc; no se carga como secreto.

## Pruebas y despliegue

~~~bash
npm install
npm test
npm run dev
~~~

El Worker expone GET /health. Antes de publicar, configurar APP_ORIGIN y COMMERCIAL_ORIGIN con los dominios definitivos de Firebase Hosting.

~~~bash
npm run deploy
~~~

El Worker que ya está activo para Barber VIP responde en:
https://barber-vip.barbervip.workers.dev

La aplicación utiliza esa dirección en worker-config.js. La ruta de webhook que debe utilizarse es:
https://barber-vip.barbervip.workers.dev/api/mercadopago-webhook.

## Pruebas funcionales obligatorias

1. GET /health informa Firebase, Mercado Pago y Push como configurados.
2. Crear un pago desde una cuenta de prueba y comprobar que abre Checkout de Mercado Pago.
3. Enviar un webhook de pago aprobado de prueba y comprobar que agrega 30 días.
4. Reenviar el mismo webhook: sólo debe extender una vez.
5. Suscribir un cliente a Push; comprobar el documento pushSubscriptions.
6. Registrar una visita y recibir el aviso con la PWA cerrada.
7. Activar promociones para todos, seleccionados y excluidos; comprobar los destinatarios.
8. Cambiar contraseña de un cliente desde el panel del barbero y probar su nuevo acceso.
9. Verificar que un barbero no pueda notificar ni cambiar la contraseña de clientes de otro barbero.
10. Revisar Cloudflare Workers Analytics y Firebase Usage. También probar la baja de un cliente: el Worker debe eliminar sus suscripciones Push para que no reciba promociones futuras.

El envío Push usa `@block65/webcrypto-web-push`, una implementación basada en Web Crypto y `fetch` compatible con Cloudflare Workers, en lugar de la biblioteca Node.js `web-push`.

## Seguridad y alcance

Cada operación iniciada desde la app valida el Firebase ID token y comprueba rol y pertenencia del cliente en Firestore. El webhook valida la firma de Mercado Pago y consulta el pago en su API. Todas las claves privadas viven como secretos en Cloudflare.

Las notificaciones se disparan después de que la operación principal se guardó en Firestore; un fallo de Push nunca debe revertir una visita o una promoción.

El Worker productivo existente responde en https://barber-vip.barbervip.workers.dev según la comprobación de salud comunicada por el propietario. Los cambios de integración de esta rama todavía requieren revisión y no deben promoverse a producción hasta aprobar las pruebas. Firebase Hosting no reemplaza todavía al frontend activo de Vercel.


## Validación de compilación en Cloudflare

El despliegue de prueba debe usar `npx wrangler deploy --dry-run` desde esta carpeta (`worker`). Este comando valida el paquete sin publicar una versión del Worker.
