# Barber VIP — Cloudflare Worker auxiliar

El Worker ejecuta las operaciones que Firebase Spark no aloja directamente:
- Crear preferencias de Checkout de Mercado Pago y recibir el webhook firmado.
- Dar de alta cuentas de clientes.
- Cambiar la contraseña de un cliente cuando lo solicita su profesional.

Firebase Hosting, Authentication y Firestore siguen siendo la plataforma principal. El Worker no aloja la aplicación ni la web comercial.

## Preparación

1. Usar una cuenta Cloudflare en el plan Free y abrir esta carpeta.
2. Mantener el proyecto Firebase existente: `barbervip-309dc`.
3. Crear una cuenta de servicio dedicada para Barber VIP en Google Cloud IAM. Concederle solamente los roles necesarios sobre este proyecto: **Cloud Datastore User** (`roles/datastore.user`) para Firestore y **Firebase Authentication Admin** (`roles/firebaseauth.admin`) para cambio de contraseñas. La clave de esta cuenta es sensible: descargar el JSON y guardarlo como secreto de Cloudflare. Nunca subirlo a GitHub ni pegarlo en un chat.
4. Tener el Access Token productivo y el secreto de firma del webhook de Mercado Pago. No usar credenciales de prueba en el Worker productivo.

## Secretos de Cloudflare

Desde `worker/`, cargar los secretos privados:

```bash
npx wrangler secret put FIREBASE_SERVICE_ACCOUNT_JSON
npx wrangler secret put MP_ACCESS_TOKEN
npx wrangler secret put MP_WEBHOOK_SECRET
```

`FIREBASE_SERVICE_ACCOUNT_JSON` es el contenido completo del JSON de la cuenta de servicio, no una ruta. `FIREBASE_WEB_API_KEY` es la clave pública de configuración web de Firebase y está declarada en `wrangler.jsonc`.

Las claves VAPID ya no se utilizan. Después de publicar la versión visits-only, retirar el secreto antiguo con `npx wrangler secret delete VAPID_PRIVATE_KEY` (o desde Cloudflare Dashboard → Worker → Settings → Variables and Secrets). No borrar ni rotar los secretos de Firebase o Mercado Pago.

## Orígenes y pagos

- `APP_ORIGIN` define el origen HTTPS de retorno por defecto.
- `COMMERCIAL_ORIGIN` identifica la web comercial.
- El Worker sólo autoriza Firebase Hosting, el dominio comercial y localhost para desarrollo.
- `worker-config.js` apunta a `https://barber-vip.barbervip.workers.dev`.
- Checkout vuelve al origen HTTPS autorizado que inició la solicitud; el webhook usa el propio Worker.
- El retorno de Checkout usa únicamente un origen autorizado; si no hay origen de navegador, vuelve a Firebase Hosting.
- Para probar cobros, utilizar un Worker separado con Access Token y secreto de webhook de prueba.

## Pruebas y despliegue

```bash
npm install
npm test
npx wrangler deploy --dry-run
```

El Worker expone `GET /health`; la respuesta informa si Firebase y Mercado Pago están configurados. El despliegue real se realiza sólo después de que las pruebas pasen:

```bash
npx wrangler deploy
```

Worker productivo configurado: `https://barber-vip.barbervip.workers.dev`.

Webhook de Mercado Pago: `https://barber-vip.barbervip.workers.dev/api/mercadopago-webhook`.

## Pruebas funcionales obligatorias

1. GET `/health` informa Firebase y Mercado Pago como configurados.
2. Iniciar sesión como profesional y como cliente con cuentas existentes.
3. Crear un cliente y completar un autorregistro con código.
4. Registrar visitas y verificar hitos 2/4/6, tanto en el panel como en la tarjeta del cliente.
5. Probar dos cuentas de cliente distintas en el mismo teléfono y verificar que nunca compartan tarjeta ni visitas.
6. Crear una preferencia de pago y comprobar que abre Checkout de Mercado Pago.
7. Enviar un webhook de pago aprobado de prueba y verificar que agrega 30 días.
8. Reenviar el mismo webhook y comprobar que no extiende el período por segunda vez.
9. Cambiar la contraseña de un cliente y comprobar que puede ingresar con la nueva.
10. Verificar que un profesional no pueda cambiar la contraseña de un cliente de otro profesional.
11. Revisar Cloudflare Workers Analytics y Firebase Usage.

## Migración de alarmas retiradas

La migración Wrangler v2 elimina el Durable Object usado exclusivamente para alarmas de promociones. Eso retira sus programaciones antiguas de Cloudflare. No borra documentos de perfiles, clientes, visitas o pagos de Firestore.

## Seguridad

Cada operación protegida valida el Firebase ID token y comprueba rol y pertenencia del cliente en Firestore. El webhook valida la firma de Mercado Pago y consulta el pago en su API. Las claves privadas permanecen en Cloudflare Secrets. Un fallo del Worker no debe convertir en exitoso un pago no aprobado ni alterar un registro de visita.
