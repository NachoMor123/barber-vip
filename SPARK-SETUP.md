# Puesta en marcha — Barber VIP (Firebase Spark + Cloudflare Workers)

Esta guía describe la arquitectura que se publica actualmente. La PWA y la web comercial están alojadas en Firebase Hosting; los datos continúan en el proyecto Firebase existente.

## 1. Conservar Firebase

- Proyecto: `barbervip-309dc`.
- Mantener Authentication y Firestore existentes.
- No crear otra base de datos ni importar usuarios a otro proyecto.
- No activar Blaze ni desplegar Cloud Functions.

Sitios de Firebase Hosting:
- Aplicación: `barbervip-309dc` → https://barbervip-309dc.web.app
- Web comercial: `barber-vip-comercial-309dc` → https://barber-vip-comercial-309dc.web.app

Ambos sitios pertenecen al mismo proyecto Firebase. La web comercial publica sólo `web-comercial/`; la app publica la raíz del repositorio y excluye esa carpeta.

## 2. Cloudflare Worker

Seguir [worker/README.md](worker/README.md). El Worker necesita:
- Cuenta de servicio de Firebase con los permisos mínimos descritos en esa guía.
- Secretos productivos de Mercado Pago: Access Token y secreto de firma del webhook.
- Firebase Web API Key pública en `wrangler.jsonc`.

No cargar claves VAPID; la aplicación no utiliza Push. El Worker atiende las operaciones protegidas de clientes, la creación de preferencias de pago y el webhook.

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

Webhook productivo: `https://barber-vip.barbervip.workers.dev/api/mercadopago-webhook`.

## 3. Firebase Hosting

El proyecto usa dos destinos configurados en `.firebaserc` y `firebase.json`.

Desde la raíz del repositorio, para publicar únicamente la aplicación:

```bash
firebase deploy --only hosting:app --project barbervip-309dc
```

Para publicar únicamente la web comercial:

```bash
firebase deploy --only hosting:comercial --project barbervip-309dc
```

Para comprobar los sitios creados:

```bash
firebase hosting:sites:list --project barbervip-309dc
```

No uses `firebase deploy --only hosting` cuando sólo quieras actualizar uno de los dos sitios, porque publicaría ambos.

## 4. Mercado Pago

- La pantalla de suscripción crea una preferencia autenticada de ARS 8.000 a través del Worker.
- El usuario es enviado al Checkout de Mercado Pago.
- El webhook del Worker valida la firma, consulta el pago en la API de Mercado Pago y exige estado `approved`, importe ARS 8.000 y moneda `ARS`.
- Se comprueba que el pago corresponda a una preferencia válida de esa cuenta y que su ID no se haya procesado anteriormente.
- Un pago aprobado agrega 30 días. Si la suscripción estaba vencida, los 30 días parten de la aprobación; si estaba vigente, se extienden desde el vencimiento.
- El período gratis es de 7 días sin gracia. Los 5 días de gracia se aplican sólo después de una suscripción paga.

Mantener `MP_ACCESS_TOKEN` y `MP_WEBHOOK_SECRET` exclusivamente como secretos de Cloudflare Worker. No sustituirlos por credenciales de prueba en producción.

## 5. Programa de visitas

- El panel crea clientes y registra sus visitas.
- Los hitos de beneficios son 2, 4 y 6; cada visita actualiza el registro del cliente correcto dentro de la barbería correspondiente.
- La tarjeta del cliente lee su propio perfil y los datos profesionales públicos.
- El selector del panel ordena clientes por total de visitas o por la fecha de su última visita.
- Las sesiones y cachés conservan separación por cliente y profesional incluso cuando varias cuentas se usan en un mismo teléfono.

La aplicación no incluye promociones comerciales ni notificaciones Push. El service worker permanece para instalación y caché/offline de la PWA.

## 6. Cambio de contraseña del cliente

Al guardar una nueva contraseña desde el panel:
1. La app envía el Firebase ID token del profesional.
2. El Worker comprueba que la sesión sea válida y tenga rol `barber`.
3. Comprueba que el cliente exista, esté activo y pertenezca a ese profesional.
4. Actualiza la contraseña mediante Firebase Authentication Admin.

La contraseña no se guarda en Firestore ni en logs.

## 7. Comprobaciones de producción

Después de publicar, comprobar:
1. La web comercial carga en `barber-vip-comercial-309dc.web.app`.
2. El botón de prueba gratuita abre `barbervip-309dc.web.app/?signup=1`.
3. El botón de acceso abre `barbervip-309dc.web.app`.
4. La aplicación permite entrar con cuentas existentes de profesionales y clientes.
5. Alta, búsqueda, visitas, hitos 2/4/6 y beneficios individuales funcionan.
6. Checkout y webhook se completan mediante Cloudflare Worker.
7. Un cliente no puede consultar la tarjeta de otro cliente.
8. Firebase Usage y Workers Analytics muestran actividad dentro de las cuotas.

## 8. Enlaces oficiales

- Aplicación: https://barbervip-309dc.web.app/
- Web comercial: https://barber-vip-comercial-309dc.web.app/
- Cloudflare Worker: https://barber-vip.barbervip.workers.dev/

La arquitectura productiva no requiere Vercel. Los proyectos antiguos de Vercel se pueden retirar una vez comprobados los enlaces, el alta, el acceso y el flujo de pagos en estos destinos.
