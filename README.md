# Barber VIP — arquitectura híbrida gratuita

Barber VIP es una PWA de fidelización para profesionales independientes. La plataforma usa **Firebase Spark + Cloudflare Workers Free**, sin Firebase Blaze ni Cloud Functions.

## Proyecto y enlaces

- Firebase: `barbervip-309dc`
- Aplicación: `https://barbervip-309dc.web.app`
- Sitio comercial: `https://barber-vip-comercial-309dc.web.app`
- Backend auxiliar: `https://barber-vip.barbervip.workers.dev`

No crear otro proyecto Firebase ni otra base de datos. Las cuentas, perfiles, clientes, visitas y pagos existentes se conservan.

## Hosting separado

El proyecto usa dos sitios de Firebase Hosting dentro del mismo proyecto Firebase:

- `app`: sirve la PWA desde la raíz del repositorio.
- `comercial`: sirve únicamente `web-comercial/`.

Cada destino se despliega por separado. Publicar la página comercial no reemplaza ni modifica la app ni Firestore.

Si el sitio comercial todavía no existe en Firebase, crealo una sola vez desde la raíz del repositorio:

```bash
firebase hosting:sites:create barber-vip-comercial-309dc --project barbervip-309dc
```

Los destinos `app` y `comercial` ya están declarados en `.firebaserc`. Para publicar exclusivamente la página comercial:

```bash
firebase deploy --only hosting:comercial --project barbervip-309dc
```

Para publicar exclusivamente la aplicación:

```bash
firebase deploy --only hosting:app --project barbervip-309dc
```

No uses `firebase deploy --only hosting` si solo querés actualizar uno de los sitios: ese comando publica todos los sitios configurados.

## Responsabilidades

**Firebase Spark**
- Firebase Hosting para la PWA y el sitio comercial.
- Firebase Authentication para cuentas de profesionales y clientes.
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

Antes de difundir los enlaces, verificar ambos sitios, el ingreso de profesionales/clientes, el alta, las visitas, los beneficios y la separación entre dos cuentas de cliente en el mismo teléfono. El sitio comercial no debe usar dependencias ni endpoints de Vercel.

## Cuotas gratuitas

Los límites de Firebase Hosting son compartidos por todos los sitios del proyecto: 10 GB de almacenamiento y 10 GB/mes de transferencia sin costo. Las cuotas no se multiplican por tener dos sitios. Revisar Firebase Console → Hosting → Usage. Si se llega al límite mensual de transferencia en Spark, los sitios pueden deshabilitarse hasta el siguiente ciclo.

Firestore también tiene cuotas gratuitas compartidas del proyecto. Revisar Firebase Console → Firestore → Usage durante las pruebas y el uso inicial.

## Pruebas automáticas

GitHub Actions valida sintaxis de los módulos, flujo de pago, pruebas unitarias y compilación de Wrangler sin publicar el Worker. Las pruebas automáticas no reemplazan la verificación con credenciales reales de Firebase, Cloudflare y Mercado Pago.
