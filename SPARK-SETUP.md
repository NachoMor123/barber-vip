# Puesta en marcha — Barber VIP híbrido (Firebase Spark + Cloudflare Workers)

Esta guía describe el orden seguro de configuración. El Worker existente responde en https://barber-vip.barbervip.workers.dev; los cambios nuevos de integración siguen en revisión y no deben fusionarse ni promoverse hasta completar las pruebas. No desactivar Vercel ni reemplazar enlaces.

## 1. Conservar el proyecto actual

- Firebase project: `barbervip-309dc`.
- Mantener Firebase Authentication y Firestore existentes.
- No crear otra base de datos ni importar usuarios a otro proyecto.
- No activar Blaze ni desplegar Cloud Functions.

Dirección prevista de la app: `https://barbervip-309dc.web.app`. Sólo estará activa después de crear/confirmar el sitio de Hosting y publicar el código.

## 2. Preparar Cloudflare Worker

Seguir los pasos detallados en [worker/README.md](worker/README.md).

El Worker necesita:
- Cuenta de servicio dedicada en Google Cloud IAM, con `roles/datastore.user` y `roles/firebaseauth.admin` sobre el proyecto Firebase.
- Secretos de Mercado Pago: Access Token y secreto de firma del webhook.
- Clave pública VAPID y `VAPID_SUBJECT` ya están configurados en `worker/wrangler.jsonc`. La clave privada nueva fue entregada al propietario por separado y debe guardarse en Cloudflare como `VAPID_PRIVATE_KEY`; nunca subirla a GitHub ni pegarla en el chat.
- Firebase Web API Key.

No pegar credenciales en GitHub, en el código, ni en este chat. Guardarlas solamente con `wrangler secret put` dentro de Cloudflare.

Desde `worker/`:
```bash
npm install
npm test
npx wrangler deploy --dry-run
```

Una vez configurados los secretos, desplegar:
```bash
npx wrangler deploy
```

La dirección existente del Worker es `https://barber-vip.barbervip.workers.dev`. La rama de integración configura esa dirección en `worker-config.js`; no usar el nombre anterior `barber-vip-api.<tu-subdominio>.workers.dev`.

## 3. Hosting de Firebase

En Firebase Console, proyecto `barbervip-309dc`:
1. Abrir **Hosting** y crear/confirmar el sitio cuyo Site ID sea `barbervip-309dc`.
2. En **Authentication → Settings → Authorized domains**, comprobar que `barbervip-309dc.web.app` esté autorizado.
3. Crear un segundo sitio de Hosting con Site ID `barber-vip-comercial-309dc`.
4. No hace falta una nueva app Firebase ni una nueva base de Firestore.

Desde la raíz del repositorio, después de confirmar que el sitio de Hosting `barbervip-309dc` existe:
```bash
firebase login
firebase use barbervip-309dc
firebase deploy --only hosting:app
```

Las reglas actuales ya se publicaron desde Firebase Console y el archivo `firestore.rules` de esta rama mantiene la misma versión. No hace falta volver a publicar reglas para actualizar solamente la aplicación.

La web comercial está en el repositorio separado `NachoMor123/barber-vip-web`. Se publica desde su propia carpeta con `firebase deploy --only hosting:commercial`.

## 4. Mercado Pago en producción

- Desde la pantalla **Tu suscripción**, un barbero con plan vencido, en gracia o en prueba puede iniciar Checkout desde el botón **Pagar $8.000 · activar 30 días**.
- La aplicación solicita al Worker autenticado una preferencia por ARS 8.000 y redirige al `init_point` seguro de Mercado Pago.
- Cada preferencia envía las notificaciones a `/api/mercadopago-webhook` del Worker.
- El webhook valida la firma, consulta el pago directamente en la API de Mercado Pago y exige estado `approved`, importe ARS 8.000 y moneda `ARS`.
- También comprueba que exista una preferencia de esa cuenta y que el ID de pago no se haya procesado anteriormente.
- Al confirmarse el pago, Firestore recibe una extensión de 30 días. Si la suscripción venció, los 30 días empiezan en la fecha de aprobación; si aún estaba vigente, se extienden desde su vencimiento.
- La renovación es manual por Checkout. No hay débitos automáticos ni cobros recurrentes.
- Los pagos iniciados desde Vercel Preview permanecen bloqueados para impedir cobros reales accidentales. El dominio de producción de Firebase Hosting y el dominio productivo de Vercel están permitidos.

Las credenciales productivas `MP_ACCESS_TOKEN` y `MP_WEBHOOK_SECRET` permanecen exclusivamente como secretos del Worker. No reemplazarlas por credenciales de prueba en el Worker productivo.

## 5. Notificaciones Push

- Los clientes activan las notificaciones desde la pantalla de su tarjeta.
- El Worker conserva las suscripciones en `pushSubscriptions`.
- Después de guardar una visita, la app solicita al Worker enviar la notificación al cliente correspondiente.
- Al crear o activar una promoción actualmente vigente, el Worker notifica a los destinatarios incluidos.
- Al dar de baja un cliente, se eliminan sus suscripciones Push.
- Si el proveedor responde 404/410, la suscripción se elimina.

Esta migración utiliza un par VAPID nuevo preparado para Firebase Hosting. Al cambiar desde el dominio Vercel al dominio Firebase, cada cliente tendrá que activar las notificaciones en la nueva dirección; la autorización y la suscripción Push pertenecen al origen del sitio.

## 6. Cambio de contraseña de cliente

Al guardar una nueva contraseña desde la edición de cliente:
1. La app envía el Firebase ID token del barbero.
2. El Worker comprueba que la sesión sea válida y que el usuario tenga rol `barber`.
3. Comprueba que el cliente exista, esté activo y pertenezca a ese barbero.
4. Actualiza la contraseña usando el permiso de Firebase Authentication Admin.

No se guarda la contraseña en Firestore ni en logs.

## 7. Pruebas obligatorias antes de reemplazar el enlace

Usar un barbero de prueba y dos cuentas de cliente:
1. Login de barbero y clientes con credenciales existentes.
2. Alta de cliente, autorregistro por código y edición de datos.
3. Visitas, hitos 2/4/6 y actualizaciones de la tarjeta.
4. Crear promoción activa para todos, seleccionados y excluidos.
5. Activar notificaciones en un cliente y recibir una visita con la app cerrada.
6. Desactivar cliente y comprobar que ya no reciba promociones.
7. Cambiar contraseña desde el panel del barbero y entrar con la contraseña nueva.
8. Intentar que un barbero cambie la contraseña de un cliente perteneciente a otro barbero; debe rechazarse.
9. Mercado Pago en modo de prueba: crear Checkout, aprobar el pago, recibir el webhook y comprobar 30 días añadidos.
10. Reenviar el mismo webhook: no debe extender el período otra vez.
11. Revisar Workers Analytics y Firebase Usage.

## 8. Enlaces

- App actual, mientras migramos: `https://barber-vip-three.vercel.app/`.
- App Firebase prevista (todavía no publicada): `https://barbervip-309dc.web.app/`.
- Web comercial prevista: `https://barber-vip-comercial-309dc.web.app/`.

Mantener Vercel disponible hasta que todas las pruebas estén aprobadas. Cambiar QR, enlaces de invitación y difusión sólo al final.
