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
4. Usar el mismo par VAPID que tenía la versión original, si se conservaron, para no invalidar suscripciones existentes. Si no están disponibles, generar un par nuevo y pedir a los clientes que vuelvan a activar las notificaciones.
5. Tener el Access Token y el secreto de webhook de Mercado Pago.

## Secretos

wrangler.jsonc contiene sólo configuración no sensible. Cargar los siguientes secretos desde worker:

~~~bash
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON
npx wrangler secret put FIREBASE_WEB_API_KEY
npx wrangler secret put MP_ACCESS_TOKEN
npx wrangler secret put MP_WEBHOOK_SECRET
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT
~~~

FIREBASE_SERVICE_ACCOUNT_JSON es el contenido completo del JSON de la cuenta de servicio, no la ruta. FIREBASE_WEB_API_KEY es la clave pública de configuración web de Firebase.

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

Cloudflare asignará una URL con este formato:
https://barber-vip-api.<tu-subdominio>.workers.dev

Copiar esa URL en WORKER_API_BASE de spark-api.js y volver a publicar Firebase Hosting.

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

## Seguridad y alcance

Cada operación iniciada desde la app valida el Firebase ID token y comprueba rol y pertenencia del cliente en Firestore. El webhook valida la firma de Mercado Pago y consulta el pago en su API. Todas las claves privadas viven como secretos en Cloudflare.

Las notificaciones se disparan después de que la operación principal se guardó en Firestore; un fallo de Push nunca debe revertir una visita o una promoción.

La implementación inicial y las pruebas unitarias de lógica pura están en esta carpeta. La validación integral exige secretos reales y ejecutar el Worker en la cuenta Cloudflare del propietario. Todavía no se desplegó ningún Worker ni se modificó el Hosting de producción.
