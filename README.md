# Barber VIP — arquitectura híbrida gratuita

Barber VIP es una PWA de fidelización para profesionales independientes. La plataforma usa **Firebase Spark + Cloudflare Workers Free**, sin Firebase Blaze ni Cloud Functions.

## Proyecto y enlaces

- Firebase: `barbervip-309dc`
- Hosting previsto para la app: `https://barbervip-309dc.web.app`
- Hosting comercial: `https://barber-vip-comercial-309dc.web.app`
- Frontend Vercel anterior: `https://barber-vip-three.vercel.app/`

No crear otro proyecto Firebase ni otra base de datos. Las cuentas, perfiles, clientes, visitas y pagos existentes se conservan.

## Responsabilidades

**Firebase Spark**
- Firebase Hosting para la PWA.
- Authentication para cuentas de profesionales y clientes.
- Firestore para perfiles, clientes, visitas, ciclos e hitos de beneficios, servicios y horarios.

**Cloudflare Worker**
- Crea preferencias de Checkout de Mercado Pago y recibe el webhook firmado.
- Atiende operaciones protegidas de alta de clientes y cambio de contraseña.
- Verifica identidad, rol y pertenencia antes de actuar sobre datos.

El Worker no aloja la PWA ni reemplaza Firestore. Las claves privadas permanecen en Cloudflare Secrets.

## Funciones del producto

- Registro e inicio de sesión de profesionales y clientes.
- Alta de clientes desde el panel y autorregistro mediante código y QR.
- Tarjeta de fidelización y registro de visitas.
- Beneficios en hitos 2, 4 y 6, con configuración editable.
- Perfil profesional, servicios, WhatsApp, Instagram, ubicación y horarios.
- Checkout de Mercado Pago y confirmación de pago mediante webhook firmado.
- Ciclo de suscripción de ARS 8.000 por 30 días; prueba gratuita de 7 días sin gracia y 5 días de gracia únicamente después de una suscripción paga.

La aplicación no incluye promociones comerciales ni notificaciones Push. El service worker se mantiene para instalación PWA y caché/offline.

## Validación y despliegue

Desde la carpeta `worker/`:

```bash
npm install
npm test
npx wrangler deploy --dry-run
```

Desde la raíz, para publicar reglas y Hosting en el proyecto existente:

```bash
firebase login
firebase use barbervip-309dc
firebase deploy --only firestore:rules,hosting:app
```

Antes de reemplazar el enlace de acceso, verificar el webhook de Mercado Pago, el ingreso de profesionales/clientes, el alta, las visitas, los beneficios y la separación entre dos cuentas de cliente en el mismo teléfono. Mantener el frontend anterior disponible hasta validar el nuevo Hosting.

## Lecturas y cuotas

La app evita listeners de presencia/última conexión y carga los clientes bajo demanda al abrir la sección correspondiente. Firestore Spark tiene cuotas limitadas: revisar Firebase Console → Firestore → Usage durante las pruebas y el uso inicial. No se promete una capacidad fija de cuentas sin medir lecturas, escrituras, almacenamiento y transferencia reales.

## Pruebas automáticas

GitHub Actions valida sintaxis de los módulos, flujo de pago, pruebas unitarias y compilación de Wrangler sin publicar el Worker. Las pruebas automáticas no reemplazan la verificación con credenciales reales de Firebase, Cloudflare y Mercado Pago.
