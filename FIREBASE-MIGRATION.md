# Migración de Barber VIP a Firebase

Esta rama prepara el traslado sin modificar `main` ni apagar Vercel.

## Arquitectura

- Se conserva el proyecto Firebase actual: `barbervip-309dc`.
- Firestore y Firebase Authentication permanecen intactos.
- La aplicación se publica en el sitio Hosting predeterminado: `https://barbervip-309dc.web.app`.
- Las 11 rutas API actuales se mantienen y pasan por una sola Cloud Function HTTP llamada `api`.
- La web comercial se publica como un segundo sitio Hosting: `barber-vip-web-309dc`.
- Vercel permanece activo hasta completar todas las pruebas.

## Confirmar región antes de desplegar

El código deja la función en `us-central1` como valor inicial. En Firebase Console > Firestore Database, buscá la ubicación de la base. La función debe estar en una región apropiada y cercana. Si Firestore no indica `us-central1`, hay que cambiar la región en `functions-entry.js` y en el rewrite de `firebase.json` antes del despliegue. No desplegar hasta confirmar este dato.

## Lo que tenés que hacer en Firebase

1. Abrí https://console.firebase.google.com/project/barbervip-309dc/overview y verificá que el proyecto sea `barbervip-309dc`. No crees otro proyecto.
2. En Uso y facturación, pasá el proyecto al plan Blaze y vinculá una cuenta de facturación de Google Cloud. Cloud Functions necesita Blaze. Configurá alertas de presupuesto: avisan, pero no bloquean automáticamente el gasto.
3. En Hosting, habilitá el sitio predeterminado. El ID esperado es `barbervip-309dc` y su dirección será `https://barbervip-309dc.web.app`.
4. Creá un segundo sitio Hosting con el ID exacto `barber-vip-web-309dc`. Su dirección será `https://barber-vip-web-309dc.web.app`.
5. Anotá la ubicación de Firestore para confirmar la región antes del despliegue.

## Variables y credenciales

En Vercel > proyecto `barber-vip` > Settings > Environment Variables, copiá los valores ya configurados. No los pegues en GitHub ni en el chat.

Desde la carpeta del repo principal, guardá estos cuatro valores como secretos. Cada comando pide el valor de manera interactiva:

```bash
firebase functions:secrets:set MP_ACCESS_TOKEN --project barbervip-309dc
firebase functions:secrets:set MP_WEBHOOK_SECRET --project barbervip-309dc
firebase functions:secrets:set VAPID_PRIVATE_KEY --project barbervip-309dc
firebase functions:secrets:set CRON_SECRET --project barbervip-309dc
```

Creá un archivo local `.env.barbervip-309dc` tomando como modelo `firebase.env.example`. Completá `VAPID_PUBLIC_KEY` con el valor público actual de Vercel. No subas el archivo local a GitHub.

No hace falta mover `FIREBASE_SERVICE_ACCOUNT_JSON`: dentro de Cloud Functions, Firebase Admin utiliza la cuenta de servicio administrada del proyecto.

## Desplegar aplicación y backend

Usá Google Cloud Shell o una computadora con Git, Node.js y Firebase CLI:

```bash
git clone https://github.com/NachoMor123/barber-vip.git
cd barber-vip
git checkout migration/firebase-hosting
npm install
npm install -g firebase-tools
firebase login --no-localhost
firebase use barbervip-309dc
firebase deploy --only functions:api,hosting:app --project barbervip-309dc
```

El repositorio ya vincula el target `app` con el sitio Hosting predeterminado. Si el despliegue pregunta si puede habilitar las APIs necesarias para Firebase Functions, Cloud Build, Artifact Registry o Secret Manager, aceptá.

## Desplegar la web comercial

En otra carpeta:

```bash
git clone https://github.com/NachoMor123/barber-vip-web.git
cd barber-vip-web
git checkout migration/firebase-hosting
firebase login --no-localhost
firebase deploy --only hosting:web --project barbervip-309dc
```

Los dos botones de la web comercial ya apuntan a `https://barbervip-309dc.web.app/`.

## Pruebas antes de cambiar el enlace público

Probar inicio de sesión de barbero y cliente, alta y edición de clientes, registro de visitas, hitos 2/4/6, promociones, datos del profesional, notificaciones, creación de preferencias de pago y confirmación del webhook. También verificar el bloqueo y renovación de suscripciones.

Las suscripciones push del dominio anterior pertenecen a ese origen. Los clientes deberán volver a activar notificaciones desde el nuevo enlace.

En Mercado Pago > Tus integraciones > Webhooks, actualizar la URL de notificación a:

`https://barbervip-309dc.web.app/api/mercadopago-webhook`

Conservar el secreto de firma que se está usando. Probar la confirmación del webhook antes de anunciar el enlace nuevo.

No borrar ni desconectar Vercel hasta terminar todas las pruebas. Los usuarios, las contraseñas y los datos continúan en el Firebase actual.
