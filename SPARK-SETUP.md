# Puesta en marcha — Barber VIP híbrido (Firebase Spark + Cloudflare Workers)

Esta guía conserva el proyecto existente y publica la versión centrada en visitas y beneficios. La rama de integración debe superar las pruebas automáticas antes de fusionarse o desplegarse. No desactivar el frontend anterior hasta completar la validación funcional.

## 1. Conservar Firebase

- Proyecto: `barbervip-309dc`.
- Mantener Authentication y Firestore existentes.
- No crear otra base de datos ni importar usuarios a otro proyecto.
- No activar Blaze ni desplegar Cloud Functions.

Hosting previsto para la app: `https://barbervip-309dc.web.app`. Confirmar que ese Site ID existe antes de publicar.

## 2. Cloudflare Worker

Seguir [worker/README.md](worker/README.md). El Worker necesita:
- Cuenta de servicio de Firebase con los permisos mínimos descritos en esa guía.
- Secretos productivos de Mercado Pago: Access Token y secreto de firma del webhook.
- Firebase Web API Key pública en `wrangler.jsonc`.

No cargar claves VAPID; la aplicación ya no utiliza Push. El Worker puede seguir atendiendo los cobros y el cambio de contraseña sin VAPID.

Desde `worker/`:

```bash
npm install
npm test
npx wrangler deploy --dry-run
```

Desplegar sólo cuando las validaciones estén aprobadas:

```bash
npx wrangler deploy
```

Worker configurado: `https://barber-vip.barbervip.workers.dev`.

## 3. Firebase Hosting

En Firebase Console, proyecto `barbervip-309dc`:
1. Abrir Hosting y confirmar el Site ID `barbervip-309dc`.
2. En Authentication → Settings → Authorized domains, confirmar `barbervip-309dc.web.app`.
3. No crear una nueva app Firebase ni una nueva base de Firestore.

Desde la raíz del repositorio:

```bash
firebase login
firebase use barbervip-309dc
firebase deploy --only firestore:rules,hosting:app
```

El sitio comercial se publica desde el repositorio separado `NachoMor123/barber-vip-web`.

## 4. Mercado Pago

- La pantalla de suscripción crea una preferencia autenticada de ARS 8.000.
- El usuario es enviado al Checkout de Mercado Pago.
- El webhook valida la firma, consulta el pago en la API de Mercado Pago y exige estado `approved`, importe ARS 8.000 y moneda `ARS`.
- Se comprueba que el pago corresponda a una preferencia válida de esa cuenta y que su ID no se haya procesado anteriormente.
- Un pago aprobado agrega 30 días. Si la suscripción estaba vencida, los 30 días parten de la aprobación; si estaba vigente, se extienden desde el vencimiento.
- El período gratis es de 7 días sin gracia. Los 5 días de gracia se aplican sólo después de una suscripción paga.

Mantener `MP_ACCESS_TOKEN` y `MP_WEBHOOK_SECRET` exclusivamente como secretos del Worker. No sustituirlos por credenciales de prueba en el Worker productivo.

## 5. Programa de visitas

- El panel crea clientes y registra sus visitas.
- Los hitos de beneficios son 2, 4 y 6; cada visita queda vinculada al UID del cliente dentro de la barbería correspondiente.
- La tarjeta del cliente lee su propio perfil y los datos profesionales públicos.
- El selector del panel ordena clientes por total de visitas o por la fecha de su última visita.
- Las sesiones y cachés deben conservar separación por cliente y profesional incluso cuando varias cuentas se usen en un mismo teléfono.

No hay sistema de promociones comerciales ni notificaciones Push. El service worker permanece para instalación y caché/offline de la PWA.

## 6. Cambio de contraseña del cliente

Al guardar una nueva contraseña desde el panel:
1. La app envía el Firebase ID token del profesional.
2. El Worker comprueba que la sesión sea válida y tenga rol `barber`.
3. Comprueba que el cliente exista, esté activo y pertenezca a ese profesional.
4. Actualiza la contraseña mediante Firebase Authentication Admin.

La contraseña no se guarda en Firestore ni en logs.

## 7. Pruebas antes de reemplazar enlaces

Usar un profesional de prueba y dos cuentas distintas de clientes:
1. Login de profesional y clientes con credenciales existentes.
2. Alta de cliente, autorregistro por código y edición.
3. Registro de visitas y premios en hitos 2/4/6.
4. Dos cuentas de cliente en el mismo navegador/teléfono sin mezcla de tarjetas o sesiones.
5. Checkout de prueba, pago aprobado, webhook y 30 días añadidos.
6. Reenvío del mismo webhook sin duplicar renovación.
7. Cambio de contraseña y acceso con la nueva.
8. Rechazo de un intento de cambiar la contraseña de un cliente de otro profesional.
9. Revisión de Workers Analytics y Firebase Usage.

## 8. Enlaces

- Frontend Vercel anterior: `https://barber-vip-three.vercel.app/`.
- App Firebase prevista: `https://barbervip-309dc.web.app/`.
- Web comercial: `https://barber-vip-comercial-309dc.web.app/`.

Mantener el frontend anterior disponible hasta que todas las pruebas funcionales estén aprobadas. Cambiar QR, enlaces de invitación y difusión sólo al final.
