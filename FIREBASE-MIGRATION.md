# Migración de Barber VIP a Firebase

Estos cambios están aislados en la rama `firebase-migration`. No se modifica `main`, no se borra Vercel ni se cambia el sitio activo durante la preparación.

## Qué se conserva

- Proyecto Firebase actual: `barbervip-309dc`. No crear otro proyecto.
- Firebase Authentication y Firestore actuales: no se crean ni copian cuentas o datos.
- Los 11 endpoints actuales se conservan y pasan a una única función HTTP de Firebase.
- Se mantienen los módulos existentes de validación, clientes, visitas, hitos, promociones, notificaciones y Mercado Pago.
- Los endpoints Vercel quedan como wrappers de compatibilidad para permitir volver atrás durante las pruebas.

## Pasos en Firebase Console

1. Abrir el proyecto existente `barbervip-309dc`. No crear un proyecto nuevo.
2. La función y el rewrite de Hosting están configurados en `us-central1`, tal como se decidió para esta migración. Esta elección no confirma que Firestore esté en la misma región: si la base estuviera en otra ubicación, podría existir latencia y tráfico entre regiones. Se mantiene `us-central1` por instrucción del propietario del proyecto.
3. Abrir Hosting y habilitar Firebase Hosting. El sitio principal usa el sitio predeterminado del proyecto: `barbervip-309dc.web.app`.
4. En Hosting, agregar un segundo sitio con el ID exacto `barber-vip-comercial-309dc`. Su URL será `https://barber-vip-comercial-309dc.web.app`.
5. Cloud Functions necesita el plan Blaze y una cuenta de facturación vinculada. Se requiere un medio de pago. Configurar alertas de presupuesto y revisar el consumo; las alertas no son un tope duro de gasto.

## Secretos del backend

Antes del primer despliegue de Functions, guardar estos valores en Secret Manager con Firebase CLI. Cada comando solicita el valor de forma segura:

```bash
firebase functions:secrets:set APP_URL
firebase functions:secrets:set SUBSCRIPTION_PRICE_ARS
firebase functions:secrets:set MP_ACCESS_TOKEN
firebase functions:secrets:set MP_WEBHOOK_SECRET
firebase functions:secrets:set CRON_SECRET
firebase functions:secrets:set VAPID_PUBLIC_KEY
firebase functions:secrets:set VAPID_PRIVATE_KEY
firebase functions:secrets:set VAPID_SUBJECT
```

Valores de referencia:
- `APP_URL`: `https://barbervip-309dc.web.app`
- `SUBSCRIPTION_PRICE_ARS`: `5000` (confirmar que coincida con el precio vigente en Mercado Pago).
- `MP_ACCESS_TOKEN`: copiar el valor privado de producción desde Vercel.
- `MP_WEBHOOK_SECRET`: copiar la clave de firma de Webhooks de Mercado Pago.
- `CRON_SECRET`: conservar el actual de Vercel; si no existe, generar uno aleatorio largo.
- `VAPID_PUBLIC_KEY` y `VAPID_PRIVATE_KEY`: copiar los valores actuales de Vercel, sin regenerarlos.
- `VAPID_SUBJECT`: `https://barbervip-309dc.web.app`.

No configurar `FIREBASE_SERVICE_ACCOUNT_JSON` en Firebase Functions: allí el SDK usa la identidad de servicio de Google. Esa variable sigue siendo útil para la ruta de compatibilidad Vercel.

## Despliegue desde una computadora

Instalar Node.js 22 y Firebase CLI. Desde la carpeta local del repositorio de la aplicación:

```bash
npm install -g firebase-tools
firebase login
firebase use barbervip-309dc
firebase deploy --only functions:default,hosting:app
```

Después, desde la carpeta local del repositorio de la web comercial:

```bash
firebase use barbervip-309dc
firebase deploy --only hosting:commercial
```

Los destinos están declarados en los archivos `.firebaserc`; el sitio comercial debe estar creado en Firebase Hosting antes de desplegarlo.

## Mercado Pago y cambio final

Las nuevas preferencias de pago toman el webhook desde `APP_URL`, por lo que usarán `https://barbervip-309dc.web.app/api/mercadopago-webhook`. Si también hay una URL fija configurada en el panel de Webhooks de Mercado Pago, actualizarla a esa dirección después de desplegar y probar la función.

No quitar Vercel ni desactivar su despliegue hasta probar en Firebase: acceso barber/cliente, altas y bajas, registro de visitas, hitos 2/4/6, promociones, Push, creación de pago, webhook y bloqueo/renovación de suscripción.

## Cambio de dominio y PWA

Al pasar de `barber-vip-three.vercel.app` a `barbervip-309dc.web.app`, el navegador lo considera otro origen. Las cuentas y datos quedan intactos en Firebase, pero cada usuario tendrá que abrir el nuevo enlace, iniciar sesión nuevamente y volver a instalar la PWA en el dominio nuevo.
