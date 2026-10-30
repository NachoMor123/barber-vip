# Barber VIP — fidelización para barberías

Aplicación web instalable (PWA) para barber y sus clientes. Incluye panel profesional, visitas, ciclos de beneficios configurables, promociones, recordatorios, perfil profesional y suscripción mensual.

## Enlaces actuales

- Aplicación: https://barber-vip-three.vercel.app/
- Registro profesional: https://barber-vip-three.vercel.app/?signup=1
- La web comercial se entrega por separado y no se incluye en el ZIP de la aplicación.

## Funciones principales

- Perfil de cada barber con horarios, WhatsApp, Instagram y ubicación.
- Clientes con cuenta individual, datos de contacto, visitas totales acumuladas, ciclo de beneficios y fecha de última visita.
- Registro de visitas desde el panel profesional y acceso separado para cada cliente.
- Ciclo de fidelización con hitos y beneficios configurables.
- Promociones con vigencia y destinatarios.
- Recordatorios de seguimiento: WhatsApp se abre sin texto preescrito; la app muestra una sugerencia opcional y el profesional confirma que intentó contactar manualmente. Esto no verifica la entrega del mensaje.
- La instalación PWA es obligatoria cuando el navegador no detecta una instalación previa: `/?signup=1` conserva la intención de registro durante la instalación; si la cuenta ya tiene sesión, se abre directamente el panel. En navegadores compatibles se consulta `getInstalledRelatedApps()`; en los que no exponen esta API, la detección externa tiene limitaciones.
- Las visitas se acumulan en la ficha individual de cada cliente (`totalCuts`, `actualCutsRegistered` y `lastCutAt`). No hay un historial de visitas visible ni una política de eliminación por antigüedad: los totales no se reinician ni se borran por tiempo.
- Suscripción mensual con Mercado Pago y webhook de confirmación.

## Arquitectura

- `index.html`: interfaz de la PWA.
- `api/*.js`: endpoints serverless Node.js.
- `lib/admin.js` y `lib/security.js`: Firebase Admin y validaciones de identidad/rol en servidor.
- `firestore.rules`: bloquea escrituras directas desde el navegador; las operaciones privilegiadas pasan por la API.
- `manifest.webmanifest`, `sw.js` y `assets/`: instalación PWA, caché e iconos.
- Firebase Authentication: cuentas profesionales y clientes.
- Cloud Firestore: perfiles, clientes, visitas, promociones, configuración y pagos.
- Mercado Pago: preferencia de suscripción y webhook.
- Vercel: hosting estático y ejecución de funciones `/api`.

## Variables de entorno

Configurar en Vercel, no en el frontend:

- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `APP_URL`
- `MP_ACCESS_TOKEN`
- `MP_WEBHOOK_SECRET`
- `SUBSCRIPTION_PRICE_ARS`
- `CRON_SECRET`
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY` (secreta; nunca se commitea)
- `VAPID_SUBJECT` (URL HTTPS de producción)

Conservar los valores privados existentes. El nombre visible de la marca no obliga a crear otro proyecto Firebase ni a cambiar identificadores internos. `APP_URL` debe seguir apuntando a la URL de producción que utiliza el proceso de pago.

Las notificaciones utilizan Web Push con permiso explícito por dispositivo. Se envían al registrar visitas/hitos y al activar promociones vigentes; no usan sondeos periódicos. El servidor elimina suscripciones expiradas, y el navegador recibe solo la clave VAPID pública.

## Costos, límites y escalabilidad

El nivel gratuito de Firestore Standard ofrece 50.000 lecturas de documentos al día (20.000 corresponde a escrituras) y 20.000 escrituras al día. Barber VIP carga la lista de clientes una sola vez por sesión y solo cuando se abre la sección correspondiente. La tarjeta del cliente y los metadatos de perfil/promociones mantienen listeners de documentos puntuales para reflejar cambios sin consultar repetidamente colecciones completas. Medir Usage en Firebase después de desplegar las reglas; el código no puede atribuir retroactivamente las lecturas que ya figuran en el panel.

Vercel Hobby está destinado a usos personales/no comerciales según las condiciones vigentes. Si se vende el servicio, revisar el plan o proveedor de hosting permitido para uso comercial.

## Lista previa al lanzamiento

- Publicar en Firebase Console las reglas de `firestore.rules` incluidas en el paquete: los clientes ya no deben poder leer el documento privado del perfil profesional directamente.
- Confirmar que todas las variables privadas estén configuradas en producción, incluidas las tres VAPID para Web Push.
- Probar acceso de barber y cliente, altas/bajas, visitas, hitos, promociones, recordatorios y errores de red.
- Verificar el webhook de Mercado Pago con eventos de prueba y firma configurada.
- Probar múltiples visitas concurrentes para comprobar la consistencia de premios e historiales.
- Medir lecturas/escrituras reales durante jornadas de uso.
- Verificar el flujo de la web comercial: botón de registro, sesión ya iniciada, sesión cerrada y PWA instalada.

Este README describe el diseño observado en el repositorio. No sustituye una prueba de carga ni certifica una auditoría completa del proyecto desplegado.
