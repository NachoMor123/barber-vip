# Barber VIP — edición Firebase Spark

Esta rama prepara una edición de Barber VIP que funciona con Firebase Spark (sin facturación ni Cloud Functions).

## Proyecto que se conserva

- Firebase: `barbervip-309dc`
- Firebase Authentication: se conservan las cuentas actuales.
- Cloud Firestore: se conservan todos los perfiles, clientes, visitas y promociones.
- Sitio de aplicación: `https://barbervip-309dc.web.app`
- Web comercial: sitio separado `barber-vip-comercial-309dc` dentro del mismo proyecto.

**No crear otro proyecto ni otra base de datos.** El cambio de dominio requiere que cada usuario abra el nuevo enlace, inicie sesión nuevamente y vuelva a instalar la PWA en el nuevo dominio.

## Qué funciona en Spark

- Alta e inicio de sesión de barberos y clientes con Firebase Authentication.
- Clientes creados por el barbero o autorregistro por código.
- Tarjetas de cliente y datos del profesional.
- Registro de visitas y premios en hitos 2, 4 y 6.
- Promociones y sincronización mientras la app está abierta.
- PWA y Hosting estático.
- Precio de referencia del servicio: ARS 8.000 por mes.

La lista de clientes se carga una vez al abrir Clientes. Al primer ingreso de cada barbero se hace una migración única de sus índices de acceso para conservar el login de clientes por código y nombre. Esa primera carga consume lecturas y escrituras proporcionales a sus clientes; después no se repite gracias a una marca guardada en el perfil.

## Límites que impone Spark

Spark no ejecuta código de servidor ni permite Cloud Functions. Por eso:

- Mercado Pago no puede confirmar pagos automáticamente mediante un webhook seguro. La renovación de los barberos debe verificarse manualmente y activarse desde Firebase Console.
- No se pueden enviar notificaciones Push cuando el navegador está cerrado. Las visitas y promociones se actualizan dentro de la app mientras está abierta.
- El barbero no puede cambiar desde su panel la contraseña de otra cuenta de cliente. El cliente conserva su acceso y contraseña actuales.

No hay claves privadas de Mercado Pago ni VAPID que configurar en el navegador. Nunca pegar un Access Token privado dentro de `index.html` o `spark-api.js`.

## Publicar la app en Firebase Hosting

1. Entrar al proyecto existente `barbervip-309dc` en Firebase Console y comprobar que esté en Spark.
2. En Hosting, mantener o crear el sitio predeterminado `barbervip-309dc`.
3. Publicar las reglas de Firestore incluidas en `firestore.rules`.
4. Instalar Node.js y Firebase CLI en la computadora.
5. Desde la carpeta del repositorio:

```bash
npm install -g firebase-tools
firebase login
firebase use barbervip-309dc
firebase deploy --only firestore:rules,hosting:app
```

No se despliegan funciones ni se habilita Blaze.

## Publicar la web comercial

En Hosting, agregar un segundo sitio con este ID exacto:

`barber-vip-comercial-309dc`

Luego, desde la carpeta del repositorio `barber-vip-web`:

```bash
firebase use barbervip-309dc
firebase deploy --only hosting:commercial
```

La web comercial enlaza a `https://barbervip-309dc.web.app`.

## Cobro manual de ARS 8.000

Crear en la cuenta de Mercado Pago un Link de Pago por ARS 8.000 (no un débito automático). Compartir ese enlace con el barbero cuando corresponda renovar. Una vez acreditado el pago, abrir Firestore Console y actualizar el documento:

`barbers/{UID_DEL_BARBER}`

Campos:
- `hasPaidSubscription`: `true`
- `subscriptionExpiresAt`: fecha/hora Timestamp que corresponda (30 días desde la acreditación, o desde el vencimiento vigente si se renueva antes).
- `lastPaymentAt`: fecha/hora Timestamp del pago.

La consola de Firebase administra esos campos directamente; las reglas de la app impiden que el propio barbero extienda su vencimiento. No registrar pagos pendientes como acreditados.

## Tu acceso de administrador y cobro de los barberos

El panel de activación de pagos está en:

`https://barbervip-309dc.web.app/billing-admin.html`

Antes de usarlo, autorizá tu cuenta una sola vez desde Firebase Console:

1. Abrí **Authentication → Users** en el proyecto `barbervip-309dc`.
2. Buscá tu propia cuenta de barbero por correo y copiá su **UID**.
3. Abrí **Firestore Database → Data → userProfiles**.
4. Entrá al documento cuyo ID coincide exactamente con tu UID.
5. Agregá un campo nuevo: nombre `platformAdmin`, tipo **boolean**, valor **true**.

Ese permiso no se puede activar desde la aplicación. Sólo alguien con acceso de propietario al proyecto Firebase puede asignarlo desde la consola. No se lo asignes a ningún barbero cliente.

### Flujo de renovación por ARS 8.000

1. En Mercado Pago, creá un **Link de Pago** de un solo pago por ARS 8.000. No configures una suscripción ni débito automático.
2. Compartí ese enlace con el barbero que necesita renovar.
3. Esperá a que el pago figure como **acreditado/aprobado** en tu cuenta de Mercado Pago. Un comprobante enviado por el cliente no alcanza por sí solo.
4. Abrí el panel de administración, buscá al barbero y pulsá **Registrar pago**.
5. Pegá el ID de la operación o una referencia del pago y confirmá.

El panel registra la operación, guarda el pago en `barbers/{UID}/payments` y habilita 30 días. Si la cuenta ya tenía un período pago vigente, suma los 30 días desde su vencimiento actual; si estaba en prueba, vencida o en gracia, comienza desde la fecha en que registrás el pago.

La referencia del comprobante se utiliza como identificador único para evitar que se registre dos veces el mismo pago para el mismo barbero. Si te equivocás o el pago fue revertido, no edites la base para simular un cobro; revisá el caso antes de hacer otra activación.

**Importante:** Mercado Pago no envía una confirmación automática a Firebase en Spark. Vos verificás la acreditación y la activación se hace manualmente desde ese panel. No se guarda el Access Token ni ninguna clave privada de Mercado Pago en el navegador.

## Cuotas gratuitas de Firestore

La cuota gratuita actual de Firestore Standard es 50.000 lecturas de documentos por día, 20.000 escrituras por día, 20.000 eliminaciones por día, 1 GiB almacenado y 10 GiB de transferencia saliente mensual. Las cuotas diarias se reinician aproximadamente a medianoche del Pacífico. Si se supera la cuota de un producto en Spark, ese producto puede quedar bloqueado hasta que se restablezca la cuota o se cambie a Blaze.

Para controlar lecturas:
- No hay listeners de presencia en línea ni última conexión.
- La colección de clientes no queda escuchándose permanentemente; se lee al entrar a Clientes.
- La migración de login por nombre se ejecuta una sola vez por barbero.
- La sincronización en tiempo real se limita a documentos puntuales y promociones del profesional asociado.

No se promete que 50 barberos estén siempre por debajo de las cuotas: depende de cuántos clientes, pantallas abiertas, actualizaciones y promociones tenga cada uno. Revisar Firebase Console → Firestore → Usage durante las pruebas y las primeras semanas.

## Pruebas antes de reemplazar el enlace actual

Probar con una cuenta de barbero y dos clientes:
1. Inicio de sesión de barbero y cliente.
2. Autorregistro de un cliente nuevo por código.
3. Login de un cliente existente por código, nombre y contraseña.
4. Alta, edición y baja de clientes.
5. Registro de visitas y aplicación de descuentos en 2, 4 y 6.
6. Creación, edición, activación y baja de promociones.
7. Lectura de servicios, horarios, WhatsApp, Instagram y ubicación desde la tarjeta cliente.
8. Vencimiento de prueba, suspensión y activación manual de una suscripción paga.

Mantener el sitio de Vercel actual disponible hasta completar todas estas pruebas en el nuevo dominio.
