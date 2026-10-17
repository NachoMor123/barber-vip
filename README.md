# Barber VIP — referidos de clientes

Aplicación web/PWA de fidelización para barberías. Esta versión suma un programa de invitaciones de cliente a cliente y conserva Firebase Authentication/Firestore, Mercado Pago, recordatorios, promociones, historial y PWA.

## Novedad principal: referidos

- Cada cliente activo obtiene un enlace personal con un token aleatorio de 36 caracteres hexadecimales. El token identifica al cliente que invita y a su barbería; no contiene el nombre ni el UID.
- En el panel del cliente aparecen las personas registradas desde su invitación, créditos ganados y estados de seguimiento.
- La persona invitada abre el enlace, instala/abre la PWA y se registra con nombre y apellido, WhatsApp, frecuencia aproximada y contraseña. La barbería y el cliente que invita se fijan a partir de la invitación; el usuario no puede cambiarlos en el formulario.
- También puede registrarse sin referido usando el código general de la barbería. Ese camino no genera crédito de invitación.
- El nuevo cliente se crea en Firebase Authentication y Firestore, y aparece en el panel del barbero como los demás clientes.
- El primer corte que el barbero registre para el referido otorga al invitador un único crédito de corte para su ciclo. No crea una visita ficticia en el historial del local ni suma una visita física a las estadísticas mensuales. Los siguientes cortes del referido no vuelven a otorgar créditos.
- Un referido no recibe doble crédito por el mismo primer corte: la marca y el crédito se aplican en una transacción de Firestore.
- Para reducir abuso, el backend limita registros desde una misma conexión a 15 por hora por barbería y evita crear un nuevo referido si ya hay un perfil con el mismo WhatsApp normalizado en esa barbería. Sin verificación de correo o teléfono no se puede demostrar que una persona sea dueña del número o impedir por completo que alguien use datos ajenos; este límite solo reduce el abuso.
- Los códigos de invitación y límites se crean automáticamente mediante Firebase Admin. No tenés que crear manualmente colecciones ni modificar las reglas de Firestore para ello. Las reglas de cliente siguen bloqueando acceso directo a colecciones privadas.

## Estructura del proyecto

- `index.html`: interfaz del administrador y del cliente.
- `api/`: 10 funciones serverless. No dupliques ni agregues funciones antiguas: Vercel Hobby permite hasta 12 funciones por despliegue.
- `lib/`: Firebase Admin, autenticación, utilidades HTTP y lógica de invitaciones.
- `assets/`, `manifest.webmanifest`, `sw.js`: iconos e instalación PWA. El caché se actualizó a `barber-vip-shell-v15`.
- `firestore.rules`: reglas de referencia; no es necesario reemplazarlas si ya tenés las reglas equivalentes activas.

## Variables de entorno

No se agregan variables nuevas. Conservá las que ya usa la aplicación:

- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `APP_URL`
- `MP_ACCESS_TOKEN`
- `MP_WEBHOOK_SECRET`
- `SUBSCRIPTION_PRICE_ARS`
- `CRON_SECRET`

`RESEND_API_KEY` y `EMAIL_FROM` no se utilizan en esta versión y se pueden eliminar si solo se habían añadido para una versión antigua.

## Actualización segura en GitHub/Vercel

1. Descargá este ZIP y guardá una copia de seguridad del repositorio que funciona.
2. Descomprimí el ZIP en tu computadora. Subí el **contenido** extraído a la raíz del repositorio, no el ZIP como archivo.
3. `index.html`, `vercel.json`, `package.json`, `api/`, `lib/` y `assets/` deben quedar al mismo nivel.
4. Eliminá funciones `.js` antiguas que ya no correspondan dentro de `api/`. Deben quedar exactamente las 10 de este paquete.
5. Guardá un commit nuevo y confirmá que Vercel despliegue ese commit de la rama correcta.

## Pruebas recomendadas

1. Ingresá con un cliente ya existente, copiá su enlace personal y abrilo en una ventana privada o en otro dispositivo.
2. Completá el registro del referido. Debe aparecer en Clientes del barbero y la invitación debe quedar asociada al cliente que compartió el enlace.
3. Antes de sumar un corte, confirmá que el invitador todavía no recibió el crédito.
4. Desde el administrador, registrá el primer corte del referido. El ciclo del invitador debe avanzar un crédito, pero el historial físico y el contador de cortes del mes deben sumar solo el corte real del referido.
5. Registrá un segundo corte del referido: no debe volver a otorgarse crédito de invitación.
6. Probá copiar/compartir el enlace, un código general de barbería sin referido, un WhatsApp ya usado en la barbería y varios intentos de registro rápidos.
7. Verificá Inicio, Clientes, Recordatorios, Promociones, pago y limpieza del historial.

La sintaxis JavaScript/JSON y la estructura del paquete se verifican localmente; eso no sustituye una prueba de extremo a extremo con tu Firebase y Mercado Pago reales.
