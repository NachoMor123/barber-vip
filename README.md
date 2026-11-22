# Barber VIP — arquitectura híbrida gratuita

Barber VIP es una PWA de fidelización para profesionales independientes. La plataforma usa **Firebase Spark + Cloudflare Workers Free**, sin Firebase Blaze ni Cloud Functions.

## Proyecto y enlaces

- Firebase: `barbervip-309dc`
- Aplicación: `https://barbervip-309dc.web.app`
- Sitio comercial: `https://barber-vip-comercial-309dc.web.app`
- Backend auxiliar: `https://barber-vip.barbervip.workers.dev`

No crear otro proyecto Firebase ni otra base de datos. Las cuentas, perfiles, clientes, visitas y pagos existentes se conservan.

## Hosting separado y única fuente comercial

El proyecto usa dos sitios de Firebase Hosting dentro del mismo proyecto Firebase:

- `app`: sirve la PWA desde la raíz del repositorio.
- `comercial`: sirve exclusivamente `web-comercial/`. **Esta carpeta es la única fuente de producción de la web comercial.** Mantiene el diseño azul aprobado, las dos capturas locales `vista-barbero.webp` y `vista-cliente.webp`, y el acceso desde Instagram a la PWA.

El repositorio independiente `barber-vip-web` queda como copia histórica de diseño y recursos; **no se debe desplegar Firebase desde ese repositorio**. Ambos proyectos apuntaban al mismo Hosting Site y un deploy desde el repositorio equivocado podía reemplazar la landing publicada.

Despliegue desde la raíz de este repositorio:

```bash
npx --yes firebase-tools@15.37.0 deploy --only hosting:app,hosting:comercial --project barbervip-309dc
```

Ese comando publica la PWA desde la raíz y la web comercial desde `web-comercial/`. Para publicar únicamente uno, usar `--only hosting:app` o `--only hosting:comercial`. No usar `firebase deploy --only hosting` sin targets porque publica todos los sitios configurados.


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

## Publicación de producción

No alcanza con desplegar Firebase: el backend también se publica en Cloudflare. El orden de release es:

**1. Validar la aplicación y el Worker.** Desde la raíz del repositorio:

```bash
npm install
npm test
npm run test:rules
cd worker
npm install
npm test
npx wrangler deploy --dry-run
npx wrangler whoami
```

`wrangler whoami` debe mostrar la cuenta Cloudflare donde existe el Worker `barber-vip`. Si Wrangler pide iniciar sesión, ejecutar `npx wrangler login` y repetirlo. No pegar secretos en GitHub, el repositorio ni un chat.

**2. Publicar el Worker.** Con las pruebas en verde y la cuenta correcta:

```bash
npx wrangler deploy
```

El despliegue conserva los Cloudflare Secrets existentes. Comprobar después `https://barber-vip.barbervip.workers.dev/health`: Firebase, Mercado Pago y Telegram deben informar `true` en `configured`. Si alguno figura `false`, cargar ese secreto desde la terminal con `npx wrangler secret put NOMBRE_DEL_SECRETO`; nunca compartir su valor.

**3. Publicar los dos sitios Firebase.** Volver a la raíz del repositorio:

```bash
cd ..
npx --yes firebase-tools@15.37.0 deploy --only hosting:app,hosting:comercial --project barbervip-309dc
```

La app se publica desde la raíz y el sitio comercial desde `web-comercial/`, incluyendo sus dos imágenes WebP.

**4. Comprobación funcional antes de difundir el enlace.** Abrir ambos dominios en una ventana privada y probar inicio de sesión de barbero y cliente, alta de cliente, suma de visitas, hitos 2/4/6, cierre y nueva apertura de sesión, y dos cuentas de cliente diferentes en un mismo teléfono. Desde un enlace de Instagram, probar Android y iPhone: Android debe abrir la PWA si está instalada o caer al sitio web; iPhone debe indicar abrir en Safari. Hacer también una prueba controlada de Checkout y webhook de Mercado Pago antes de aceptar pagos reales.

GitHub Actions valida los cambios y empaqueta el sitio comercial, pero no publica por sí solo el Worker ni Firebase Hosting. El sitio comercial no debe usar dependencias ni endpoints de Vercel.

## Cuotas gratuitas

Los límites de Firebase Hosting son compartidos por todos los sitios del proyecto: 10 GB de almacenamiento y 10 GB/mes de transferencia sin costo. Las cuotas no se multiplican por tener dos sitios. Revisar Firebase Console → Hosting → Usage. Si se llega al límite mensual de transferencia en Spark, los sitios pueden deshabilitarse hasta el siguiente ciclo.

Firestore también tiene cuotas gratuitas compartidas del proyecto. Revisar Firebase Console → Firestore → Usage durante las pruebas y el uso inicial.

## Pruebas automáticas

GitHub Actions valida sintaxis de los módulos, flujo de pago, pruebas unitarias y compilación de Wrangler sin publicar el Worker. Las pruebas automáticas no reemplazan la verificación con credenciales reales de Firebase, Cloudflare y Mercado Pago.
