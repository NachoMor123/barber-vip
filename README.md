# Barber VIP — entrega revisada

Proyecto web/PWA para fidelización de clientes de barberías. Incluye HTML principal, funciones de Vercel, Firebase Admin, registro por código de correo, programa global de fidelización, recordatorios y promociones.

## Estructura

- `index.html`: interfaz de administrador y cliente.
- `api/`: 10 funciones serverless JavaScript. Evitá agregar copias o funciones antiguas a esta carpeta. Vercel cuenta las funciones a partir de la estructura del deployment; consultá la [documentación oficial de runtimes y funciones](https://vercel.com/docs/functions/runtimes).
- `lib/`: helpers del servidor, inicialización segura de Firebase Admin y autenticación.
- `assets/`, `manifest.webmanifest`, `sw.js`: recursos PWA. El caché se cambió a `barber-vip-shell-v10` para forzar la descarga de esta interfaz.
- `firestore.rules`: reglas incluidas como referencia; conservá las reglas activas que ya verificaste salvo que se indique expresamente una migración.

## Cambios principales

- Cabeceras de las secciones reposicionadas arriba a la izquierda, alineadas visualmente con el botón Salir; en móvil se reserva espacio para evitar superposiciones.
- Tema azul eléctrico oscuro fijo. En Ajustes queda la densidad cómoda/compacta, no un selector de color.
- Registro de barbero por nombre, correo, contraseña y código de seis dígitos enviado por email en español; la cuenta nueva no se confirma mediante enlace.
- Prueba de 15 días iniciada al verificar el código e inicializar el perfil. Se guarda una reclamación por correo normalizado para reducir el uso repetido con el mismo email; no evita por completo el uso de direcciones distintas.
- Horarios editables por día: cerrado, jornada corrida o doble turno.
- Programa global único de fidelización para todos los clientes; sus etapas y porcentajes se pueden editar y no hay variantes por persona. Los premios ya ganados se mantienen por separado hasta canjearlos.
- Ajustes de recordatorio centralizados en Configuración: margen posterior a la frecuencia habitual, máximo de 1/2/3 intentos y plantilla opcional. No existe una duración automática del seguimiento.
- Recordatorios divididos en `Por contactar` y `Seguimiento`. Contactar abre WhatsApp con un mensaje preparado; el barbero vuelve a la aplicación y confirma manualmente que lo envió. WhatsApp no comunica a la app una confirmación fiable de entrega. El seguimiento permanece hasta registrar un nuevo corte; un corte restablece el contador.
- Promociones independientes del ciclo de premios: título/emojis, visibilidad, fecha/hora de inicio y fin y audiencia. El cronómetro se ejecuta localmente cada segundo, sin consultas continuas a Firestore.
- Agendar turno abre WhatsApp sin mensaje preescrito.
- El precio mostrado y usado en Checkout/webhook procede de `SUBSCRIPTION_PRICE_ARS`; si no está configurada, el servidor utiliza 2500 ARS de respaldo.

## Antes de desplegar

1. Guardá una copia o commit del repositorio que está funcionando.
2. Descomprimí el ZIP localmente y subí el **contenido extraído**, no el ZIP como un archivo. `index.html`, `vercel.json`, `package.json`, `api/`, `lib/` y `assets/` deben quedar juntos en la raíz del repositorio.
3. Reemplazá los archivos del proyecto de forma controlada y evitá dejar funciones `.js` antiguas duplicadas dentro de `api/`. Esta versión contiene 10 archivos `.js` directamente en `api/`.
4. Conservá las variables privadas existentes en Vercel. No incluyas credenciales del servidor ni tokens privados de Mercado Pago en el HTML o en GitHub.
5. Comprobá que `APP_URL` apunte a la URL HTTPS de producción: `https://barber-vip-three.vercel.app`.
6. Hacé commit y esperá que Vercel publique el commit nuevo.

## Variables de entorno de Vercel

Conservá las variables que ya usa el proyecto y revisá estas:

| Variable | Uso |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | JSON privado de la cuenta de servicio de Firebase Admin. |
| `APP_URL` | URL HTTPS publicada de la aplicación. |
| `MP_ACCESS_TOKEN` | Token privado de Mercado Pago. |
| `MP_WEBHOOK_SECRET` | Secreto para verificar notificaciones de Mercado Pago. |
| `SUBSCRIPTION_PRICE_ARS` | Importe mensual en pesos, por ejemplo `2500` o `5000`. |
| `CRON_SECRET` | Secreto largo para autenticar la limpieza del historial. |
| `RESEND_API_KEY` | API key privada de Resend, necesaria para mandar códigos OTP. |
| `EMAIL_FROM` | Remitente verificado, por ejemplo `Barber VIP <acceso@tu-dominio-verificado.com>`. |

### Configurar el email OTP

El código de seis dígitos se envía desde `api/profile.js` mediante Resend. Para que el registro funcione:

1. Crear una cuenta en [Resend](https://resend.com/).
2. Agregar un dominio de envío que controles y completar la verificación de DNS indicada por Resend.
3. Crear una API key y guardarla en Vercel como `RESEND_API_KEY`. Configurar también `EMAIL_FROM` con una dirección de ese dominio verificado.
4. Asignar ambas variables a Production (y Preview si se prueba allí) y volver a desplegar.

Consultá la documentación de Resend para la [verificación de dominios](https://resend.com/docs/dashboard/domains/introduction) y el [envío de emails](https://resend.com/docs/api-reference/emails/send-email). **Sin ambas variables, el registro por código fallará mostrando un mensaje de configuración**, aunque el acceso de cuentas existentes seguirá disponible.

## Firebase

- Habilitá `Authentication → Sign-in method → Email/Password`.
- En `Authentication → Settings → Authorized domains`, agregá el dominio de producción y los dominios de prueba que uses.
- El cliente web utiliza la configuración Firebase ya guardada en `index.html`; no hace falta crear otro proyecto.
- El servidor usa `FIREBASE_SERVICE_ACCOUNT_JSON` para operaciones administrativas. No compartas públicamente ese JSON.
- El administrador se crea después de verificar el código OTP. `api/profile.js` inicializa el perfil y la prueba de 15 días; los clientes siguen creándose desde el panel del barbero.

## Recordatorios

Un cliente pasa a `Por contactar` cuando los días desde el último corte superan su frecuencia habitual más el margen configurado. Contactar abre WhatsApp con el mensaje personalizado. El barbero vuelve a la app y pulsa `Confirmar envío` solo después de enviar el mensaje. Eso lo pasa a `Seguimiento`. El seguimiento permanece hasta el próximo corte. Al alcanzar el máximo configurado, no se ofrecen más intentos; solo un nuevo corte reinicia el estado y el contador.

## Instalación como PWA

La app presenta una invitación de instalación e instrucciones para Chrome/Android o Safari/iOS. Un sitio web no puede instalarse sin consentimiento: el navegador controla la confirmación. El usuario puede elegir continuar en el navegador.

## Pruebas recomendadas

- Registrar una dirección de prueba, recibir el código en español, ingresarlo y comprobar que la prueba inicie por 15 días.
- Iniciar y cerrar sesión como administrador y como cliente.
- Guardar datos profesionales, horarios y el programa general de fidelización.
- Registrar cortes hasta desbloquear premios y comprobar un canje.
- Contactar a un cliente desde Recordatorios, confirmar el envío y comprobar Seguimiento. Registrar un nuevo corte y comprobar que se reinicien los intentos.
- Activar una promoción con hora de fin y revisar el cronómetro desde ambos paneles.
- Cambiar `SUBSCRIPTION_PRICE_ARS`, volver a desplegar y verificar el importe mostrado y el utilizado por Checkout.

## Estado de las comprobaciones

Se revisan la sintaxis del JavaScript, los JSON y la estructura de archivos. Esto no sustituye una prueba real de extremo a extremo contra Firebase, Resend y Mercado Pago en producción; probá primero con una cuenta de prueba.
