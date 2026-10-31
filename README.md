# Barber VIP — arquitectura híbrida gratuita

Barber VIP se prepara para funcionar con **Firebase Spark + Cloudflare Workers Free**, sin Vercel Hobby, sin Firebase Blaze y sin Cloud Functions.

## Proyecto y enlaces

- Proyecto Firebase existente: `barbervip-309dc`
- Hosting de la aplicación previsto: `https://barbervip-309dc.web.app`
- Hosting comercial previsto: `https://barber-vip-comercial-309dc.web.app`
- Aplicación actual mientras se prueba la migración: `https://barber-vip-three.vercel.app/`

**Importante:** los enlaces Firebase son los destinos previstos. Esta rama todavía no está desplegada; mantener Vercel activo hasta terminar las pruebas.

No crear otra base de datos ni otro proyecto Firebase. Los usuarios y documentos actuales se deben conservar.

## Qué hace cada servicio

**Firebase Spark**
- Aloja la aplicación PWA y la web comercial.
- Firebase Authentication: cuentas de barberos y clientes.
- Firestore: perfiles, clientes, visitas, hitos fijos 2/4/6, servicios, horarios y promociones.

**Cloudflare Worker**
- Crea preferencias de Checkout de Mercado Pago y recibe el webhook firmado para activar automáticamente 30 días una vez aprobado el pago.
- Guarda suscripciones Web Push y envía avisos de visitas y promociones aunque la PWA esté cerrada.
- Restablece la contraseña de un cliente cuando lo solicita el barbero dueño de esa cuenta.

El Worker no aloja la aplicación ni reemplaza Firestore. Las claves privadas permanecen en Cloudflare Secrets, nunca en el navegador ni en GitHub.

## Funcionalidad que se conserva

- Registro e inicio de sesión de barberos y clientes.
- Alta de clientes desde el panel y autorregistro por código.
- Tarjetas de fidelización, visitas y premios en los hitos 2, 4 y 6.
- Servicios y precios, WhatsApp, Instagram, ubicación y horarios.
- Promociones por audiencia y actualización dentro de la aplicación.
- Notificaciones Push después de una visita y al publicar/activar una promoción.
- Checkout de Mercado Pago, confirmación de pago por webhook y renovación automática del período de acceso.
- Cambio de contraseña desde la edición del cliente.

Las notificaciones Push requieren que cada cliente conceda permiso en su dispositivo. Los avisos programados para promociones futuras no se envían antes de su fecha de inicio.

## Orden de despliegue

1. Preparar Cloudflare Worker y sus secretos siguiendo [worker/README.md](worker/README.md).
2. Ejecutar pruebas y una compilación sin publicar: `cd worker && npm install && npm test && npx wrangler deploy --dry-run`.
3. Desplegar el Worker, copiar su URL `workers.dev` en `worker-config.js`.
4. Crear/confirmar los dos sitios de Firebase Hosting en el proyecto existente.
5. Desplegar primero las reglas y la app de prueba; después desplegar la web comercial desde su repositorio.
6. Ejecutar las pruebas funcionales de la guía antes de reemplazar enlaces o invitar clientes.

Comandos para la app (sólo cuando la configuración anterior esté lista):

```bash
firebase login
firebase use barbervip-309dc
firebase deploy --only firestore:rules,hosting:app
```

La web comercial se despliega desde el repositorio independiente `barber-vip-web` con el target `commercial`.

## Lecturas y cuotas

La app evita listeners de presencia/última conexión y carga la lista de clientes al abrir la sección correspondiente. Las cuotas de Spark no son ilimitadas: revisar Firebase Console → Firestore → Usage durante las pruebas y el uso inicial.

No hay una garantía de capacidad para un número fijo de barberos sin medir lecturas, escrituras, almacenamiento y transferencia reales.

## Pagos manuales de contingencia

Se mantiene `/billing-admin.html` como herramienta de recuperación para el propietario del proyecto si fuera necesario registrar un pago verificado manualmente. El flujo habitual debe utilizar Checkout de Mercado Pago y el webhook del Worker.

## Estado de validación

- Pruebas unitarias y sintaxis del Worker: automatizadas en GitHub Actions.
- Compilación de Wrangler sin despliegue: automatizada.
- Sintaxis de `spark-api.js` y módulos de `index.html`: automatizada.
- Faltan pruebas de integración con las credenciales reales de Firebase, Cloudflare y Mercado Pago. No se ha desplegado en producción.
