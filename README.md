# Vínculo VIP — fidelización para servicios recurrentes

Aplicación web instalable (PWA) con panel profesional y espacio individual para cada cliente. Incluye visitas, ciclos de beneficios, promociones, recordatorios, perfil profesional y suscripción mensual.

## Entornos y enlaces

- Aplicación: https://barber-vip-three.vercel.app/
- Inicio de registro profesional: https://barber-vip-three.vercel.app/?signup=1
- La web comercial se publica como un proyecto de Vercel independiente y no forma parte de este repositorio.

## Funciones principales

- Perfil profesional con actividad, horarios, WhatsApp, Instagram, ubicación y servicios opcionales para mostrar al cliente.
- Clientes con cuenta individual, datos de contacto, frecuencia aproximada de visita, historial y seguimiento.
- Registro de una visita desde el panel profesional; no hay selector de servicio obligatorio al registrar.
- Ciclo de fidelización con hitos configurables. El beneficio se aplica en la visita que alcanza el hito y el historial conserva el número real de esa visita.
- El hito final se muestra visualmente como ciclo completo; internamente el contador reinicia el siguiente ciclo.
- Promociones independientes de los premios, con vigencia y destinatarios.
- Recordatorios que se preparan para WhatsApp; la persona profesional decide el contacto y confirma su seguimiento.
- Suscripción mensual con Mercado Pago y webhook.
- Historial retenido durante 60 días; hay limpieza programada mediante `/api/cleanup-cuts`.

## Arquitectura actual

- `index.html`: aplicación frontend; contiene una parte importante de la interfaz y la lógica de presentación en un archivo único.
- `api/*.js`: endpoints serverless en Node.js.
- `lib/admin.js` y `lib/security.js`: Firebase Admin y comprobación de identidad/rol en servidor.
- `firestore.rules`: bloquea escrituras directas desde el navegador. Las acciones con privilegios pasan por la API.
- `manifest.webmanifest`, `sw.js` y `assets/`: instalación PWA, caché e iconos.
- Firebase Authentication: cuentas profesionales y clientes.
- Cloud Firestore: perfiles, clientes, visitas, promociones, configuración y pagos.
- Mercado Pago: preferencia de suscripción y webhook de confirmación.
- Vercel: hosting estático y ejecución de funciones `/api`.

## Variables de entorno

Configurar en Vercel, no en el frontend:

- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `APP_URL`
- `MP_ACCESS_TOKEN`
- `MP_WEBHOOK_SECRET`
- `SUBSCRIPTION_PRICE_ARS`
- `CRON_SECRET`

Tomar los valores reales desde el entorno privado del proyecto; no publicar credenciales en este archivo ni en Git.

## Costos y límites

Las cuotas gratuitas tienen límites diarios/mensuales y no implican capacidad ilimitada. Las escuchas en tiempo real generan lecturas cuando cambian documentos; las escrituras frecuentes de presencia también consumen cuota. Revisar métricas reales de Firestore y Function Invocations de Vercel antes de aumentar usuarios.

Importante: el plan Vercel Hobby está destinado a uso personal/no comercial. Para vender y operar este SaaS comercialmente, usar Vercel Pro u otro proveedor cuyo plan permita ese uso según sus condiciones vigentes.

## Seguridad y validación antes de lanzamiento

- Confirmar las reglas de Firestore desplegadas en el proyecto Firebase.
- Confirmar que las variables privadas estén configuradas en producción.
- Probar acceso como profesional y como cliente, alta/baja de clientes, visita rápida, hitos, promociones, recordatorios, pagos, vencimiento y recuperación de errores.
- Verificar el webhook de Mercado Pago con eventos de prueba y la firma configurada.
- Ejecutar pruebas concurrentes de registro de visitas para comprobar consistencia del ciclo.
- Medir lecturas/escrituras de Firestore con la aplicación funcionando durante jornadas reales.
- Confirmar despliegue y probar la app en Android/Chrome después de cada release.

Este README documenta el diseño observado en el repositorio. No sustituye una prueba de carga ni certifica una auditoría de seguridad sobre el proyecto desplegado.
