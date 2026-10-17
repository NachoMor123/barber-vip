# Barber VIP — referidos, trazabilidad e historial controlado

Aplicación web/PWA para barberías. Esta entrega parte de la versión que ya compila en Vercel e integra el flujo completo de invitaciones sin crear nuevas funciones serverless.

## Cambios funcionales

### 1. Invitación aislada para registrar clientes

- Cada cliente tiene un enlace personal con un token aleatorio de 36 caracteres hexadecimales, por ejemplo `https://barber-vip-three.vercel.app/invitacion.html?ref=…`.
- El enlace abre `invitacion.html`, una página independiente del panel SPA. Así, si se prueba todo desde un teléfono con otra sesión abierta, la invitación sigue mostrando el formulario de alta en lugar de recuperar la sesión anterior.
- La página consulta `POST /api/customer-login` con `action: "invite-info"` para mostrar al cliente que invita y el nombre profesional del barbero. El usuario no puede cambiar el referido ni el barbero.
- El nuevo cliente crea la cuenta con nombre, WhatsApp, frecuencia aproximada y contraseña. El servidor crea la cuenta en Firebase Authentication, los documentos de cliente/perfil y una invitación propia. Luego la página inicia sesión con la cuenta nueva y vuelve a `/`.
- El enlace invitado no incluye una opción «volver» ni una pantalla para elegir el rol. Si el registro ocurre en un navegador, puede mostrarse la guía para abrir la app instalada al volver a la raíz; el navegador controla si un enlace puede abrir una PWA instalada.
- La app continúa admitiendo alta normal mediante código de barbería. El camino sin invitación no otorga créditos por referido.

### 2. Recompensa progresiva por referidos

- En el administrador existe la sección **Referidos**, con la relación «quién invitó a quién», visitas reales del referido, hitos logrados y créditos acreditados.
- En el cliente hay una pestaña inferior **Afiliados** independiente de Inicio y Datos del barbero. Allí aparecen su enlace, personas invitadas, cortes reales, créditos recibidos por cada persona y su estado.
- El barbero puede configurar de 1 a 10 hitos de cortes reales (por defecto `1, 4, 6`). Cuando un cliente referido alcanza cada hito, su invitador recibe un crédito para avanzar su propio ciclo de fidelización. Cada hito por referido se acredita una sola vez.
- El crédito no crea una visita física ficticia ni aumenta los cortes del mes. El contador `actualCutsRegistered` separa las visitas reales de los créditos de fidelización.
- La invitación y el crédito se vinculan en el servidor y el guardado del hito se realiza en la transacción del registro del corte, para evitar que reintentos acrediten dos veces.
- El nombre que se muestra al invitado es el del profesional, no el nombre del local.

### 3. Recordatorios e historial

- Recordatorios tiene las pestañas **Por contactar**, **Seguimiento** y **Ocultos**. Ocultar no borra al cliente, su cuenta ni el historial. Puede reactivarse desde Ocultos; un nuevo corte también reinicia los recordatorios.
- Al abrir WhatsApp, el mensaje sugerido se prepara; es el barbero quien confirma el envío en la app. WhatsApp no informa a Barber VIP si el mensaje fue efectivamente entregado o leído.
- El historial permite filtrar por Desde/Hasta y borrar un rango, pero la API limita el borrado manual a la ventana conservada de 60 días. Solo se eliminan documentos de cortes, nunca las cuentas ni los premios. Si el rango contiene más de 2.000 registros por petición, la interfaz procesa lotes acotados y avisa si hay que continuar.
- La limpieza programada mantiene 60 días de cortes. Los documentos operativos del límite de alta se eliminan después de dos días.

## Estructura

- `index.html`: panel de administrador, panel de cliente y navegación.
- `invitacion.html`: página aislada de registro con invitación personal.
- `api/`: 10 funciones serverless. No agregues funciones `.js` antiguas a esta carpeta: Vercel Hobby admite hasta 12 funciones por despliegue.
- `lib/`: Firebase Admin, control de acceso, utilidades HTTP y funciones de invitación.
- `assets/`, `manifest.webmanifest`, `sw.js`: recursos e instalación PWA. El service worker está en `barber-vip-shell-v16` y guarda `invitacion.html` por separado, sin sobrescribir el caché de Inicio.
- `firestore.rules`: reglas de referencia. Las operaciones de alta, hitos y limpieza usan Firebase Admin en el servidor. No las reemplaces si las reglas equivalentes ya están funcionando.

## Variables de entorno

No se agregan variables nuevas para esta entrega. Conservá las existentes:

- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `APP_URL`
- `MP_ACCESS_TOKEN`
- `MP_WEBHOOK_SECRET`
- `SUBSCRIPTION_PRICE_ARS`
- `CRON_SECRET`

`RESEND_API_KEY` y `EMAIL_FROM` no se utilizan y se pueden quitar si solo se habían agregado para una versión anterior.

## Actualización de GitHub/Vercel

1. Guardá una copia de seguridad de la versión que ya funciona.
2. Descargá el ZIP y elegí **Extraer todo**. Subí el contenido extraído a la raíz del repositorio, no el ZIP como archivo.
3. `index.html`, `invitacion.html`, `vercel.json`, `package.json` y las carpetas `api/`, `lib/` y `assets/` tienen que quedar al mismo nivel.
4. Dentro de `api/` deben quedar exactamente las 10 funciones que vienen en este ZIP; quitá funciones obsoletas que hayan quedado de versiones anteriores.
5. Hacé un commit nuevo y comprobá que Vercel despliegue ese commit de `main`.

No hace falta crear colecciones manualmente. Se crean/actualizan mediante Firebase Admin (`customerInvites`, `customerSignupLimits` y campos de los documentos de cliente/barbero). Las reglas existentes pueden conservarse porque los navegadores no escriben directamente en esas colecciones protegidas.

## Pruebas antes de usarlo con todos los clientes

1. En un segundo navegador o celular, abrir un enlace de invitación y confirmar que el resumen diga «sumarte con [nombre del barbero]».
2. Crear el referido. Tiene que aparecer en Clientes del barbero; después probar iniciar sesión y abrir Inicio, Datos del barbero y Afiliados.
3. Registrar cortes reales al referido hasta los hitos configurados (por defecto 1, 4 y 6). Verificar que el invitador reciba un crédito por hito, pero que el historial y el contador mensual incluyan solamente cortes reales.
4. Verificar que la sección Referidos del administrador muestre la relación correcta, incluso si un perfil es dado de baja.
5. Probar que WhatsApp abre el texto preescrito y que el barbero debe confirmar manualmente el envío; ocultar y reactivar un recordatorio sin borrar al cliente.
6. Filtrar un período de historial y borrar solo un rango dentro de los últimos 60 días.
7. Probar Inicio, Clientes, Promociones, pago de suscripción y acceso como cliente.

## Límites y seguridad

La sintaxis JavaScript/JSON y estructura del ZIP se verifican localmente, pero eso no sustituye una prueba de extremo a extremo contra el Firebase y Mercado Pago reales.

Los enlaces usan tokens aleatorios no predecibles y el vínculo se establece del lado del servidor. El límite de registros por conexión y la detección de WhatsApp duplicado reducen el abuso, pero, sin verificar el teléfono o correo, no se puede probar la identidad humana al 100%. Si más adelante querés miles de clientes por barbería individual, el siguiente paso profesional sería paginar el listado del barbero y mover consultas largas del panel a páginas del servidor.
