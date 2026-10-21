# Barber VIP — fidelización para barberías

Aplicación web instalable (PWA) para barberos y sus clientes. Incluye panel profesional, visitas, ciclos de beneficios configurables, promociones, recordatorios, perfil profesional y suscripción mensual.

## Enlaces actuales

- Aplicación: https://barber-vip-three.vercel.app/
- Registro profesional: https://barber-vip-three.vercel.app/?signup=1
- La web comercial se entrega por separado y no se incluye en el ZIP de la aplicación.

## Funciones principales

- Perfil de cada barbero con horarios, WhatsApp, Instagram y ubicación.
- Clientes con cuenta individual, datos de contacto, frecuencia aproximada de visita, historial y seguimiento.
- Registro de visitas desde el panel profesional y acceso separado para cada cliente.
- Ciclo de fidelización con hitos y beneficios configurables.
- Promociones con vigencia y destinatarios.
- Recordatorios de seguimiento: la app prepara el contacto por WhatsApp y el profesional confirma su envío.
- Presencia aproximada: pulso cada 15 minutos solo mientras el cliente tiene la pestaña visible; el indicador considera en línea una actualización de los últimos 16 minutos.
- La instalación PWA es opcional: abrir `/?signup=1` muestra el registro si no hay sesión; si la sesión ya está iniciada, se entra directamente al panel. No se bloquea el uso por una pantalla de instalación.
- Suscripción mensual con Mercado Pago y webhook de confirmación.
- Historial de visitas retenido durante 60 días con limpieza programada.

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

Conservar los valores privados existentes. El nombre visible de la marca no obliga a crear otro proyecto Firebase ni a cambiar identificadores internos. `APP_URL` debe seguir apuntando a la URL de producción que utiliza el proceso de pago.

## Costos, límites y escalabilidad

El plan gratuito de Firestore tiene límites diarios/mensuales y no representa capacidad ilimitada. Las consultas, listeners en tiempo real, escrituras de presencia e índices consumen recursos. Revisar las métricas reales de Firestore y las invocaciones de funciones de Vercel antes de aumentar usuarios.

Vercel Hobby está destinado a usos personales/no comerciales según las condiciones vigentes. Si se vende el servicio, revisar el plan o proveedor de hosting permitido para uso comercial.

## Lista previa al lanzamiento

- Publicar en Firebase Console las reglas de `firestore.rules` incluidas en el paquete: los clientes ya no deben poder leer el documento privado del perfil profesional directamente.
- Confirmar que todas las variables privadas estén configuradas en producción.
- Probar acceso de barbero y cliente, altas/bajas, visitas, hitos, promociones, recordatorios y errores de red.
- Verificar el webhook de Mercado Pago con eventos de prueba y firma configurada.
- Probar múltiples visitas concurrentes para comprobar la consistencia de premios e historiales.
- Medir lecturas/escrituras reales durante jornadas de uso.
- Verificar el flujo de la web comercial: botón de registro, sesión ya iniciada, sesión cerrada y PWA instalada.

Este README describe el diseño observado en el repositorio. No sustituye una prueba de carga ni certifica una auditoría completa del proyecto desplegado.
