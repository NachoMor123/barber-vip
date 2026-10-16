# Barber VIP — actualización de interfaz y recordatorios

Aplicación web/PWA de fidelización para barberías. Incluye el panel del administrador y el cliente, Firebase Authentication/Firestore, Mercado Pago y 10 funciones API para Vercel Hobby.

## Estructura

- `index.html`: interfaz y lógica del navegador.
- `api/`: 10 funciones serverless. No agregues copias de endpoints viejos.
- `lib/`: validación, acceso a Firebase Admin y helpers compartidos.
- `assets/`, `manifest.webmanifest`, `sw.js`: iconos e instalación PWA. El caché se versionó como `barber-vip-shell-v14` para distribuir esta actualización.
- `firestore.rules`: referencia de reglas. Conservá las reglas activas ya verificadas salvo que una migración concreta lo requiera.

## Cambios de esta entrega

- Los botones de acción principal de Inicio, Clientes, Recordatorios y Promociones van debajo del encabezado, centrados y a todo el ancho útil en escritorio y celular.
- Los paneles tienen fondos casi negros y bordes azul eléctrico algo más visibles. La navegación inferior sigue el tema oscuro. Se oculta la etiqueta pequeña de estado junto al nombre solo en la lista general de Clientes; los estados y etiquetas de Recordatorios se conservan.
- Los formularios para crear clientes usan nombres de campo no convencionales por instancia, señuelos fuera de pantalla, `autocomplete="off"`/`new-password` y campos de texto que se habilitan al enfocarlos para reducir sugerencias. Los navegadores, teclados y gestores de contraseñas externos pueden ignorar estas indicaciones, por lo que no es posible garantizar que nunca aparezca una sugerencia.
- La instalación PWA bloquea el acceso en una pestaña normal. Cuando la instalación termina, la pantalla instruye al usuario a cerrar la pestaña y abrir el ícono instalado. Una web no puede forzar que un enlace de la pestaña active la ventana PWA instalada en todos los navegadores; el modo app se reconoce al entrar desde el ícono (`display-mode: standalone`).
- El botón «Ver instrucciones de apertura» funciona también si el navegador no emite `appinstalled`. Mientras la puerta de instalación está activa, el contenido principal queda inerte, se bloquea el desplazamiento y se retiene el foco dentro del diálogo. La marca de instalación se conserva en `localStorage` para que, al volver a una pestaña normal, la pantalla siga explicando cómo abrir el ícono.
- Se agregó la opción de pausar/reactivar recordatorios. Pausar retira al cliente de las listas Por contactar/Seguimiento, pero el cliente permanece activo en Clientes y sus datos/historial no se borran. Un nuevo corte reactiva el ciclo de recordatorios.
- No se añadieron funciones API; el total sigue en 10, por debajo del límite de 12 funciones serverless del plan Hobby.

## Variables de entorno

Conservá las variables que ya funcionan en Vercel, por ejemplo:

- `FIREBASE_SERVICE_ACCOUNT_JSON`
- `APP_URL`
- `MP_ACCESS_TOKEN`
- `MP_WEBHOOK_SECRET`
- `SUBSCRIPTION_PRICE_ARS`
- `CRON_SECRET`

La aplicación no usa `RESEND_API_KEY` ni `EMAIL_FROM`; se pueden eliminar si se habían configurado para una versión anterior.

## Instalación y despliegue

1. Guardá una copia de seguridad del repositorio desplegado.
2. Descomprimí el ZIP y subí el contenido, no el ZIP, a la raíz del repositorio.
3. `index.html`, `vercel.json`, `package.json`, `api/`, `lib/` y `assets/` deben estar al mismo nivel.
4. No dejes funciones JavaScript duplicadas/obsoletas dentro de `api/`.
5. Hacé commit y comprobá que Vercel construya el nuevo commit de `main`.

## Pruebas recomendadas

- Probar ancho y centrado de las acciones principales en móvil y escritorio.
- En Clientes, confirmar que no aparezca la etiqueta de estado junto al nombre; en Recordatorios, verificar que siga apareciendo la información relevante.
- Crear un cliente en Android y comprobar si el teclado/gestor sigue sugiriendo datos (el HTML no puede controlar completamente el teclado del sistema).
- En navegador, validar que la app quede bloqueada hasta instalarla, que «Ver instrucciones de apertura» funcione y que abrir el ícono instalado entre en modo standalone.
- Pausar un cliente, verificar que siga visible en Clientes y que no figure en Recordatorios; después reactivarlo o registrar un nuevo corte.
- Probar con cuentas de prueba los cortes, promociones, suscripción y limpieza de historial.

La sintaxis local y la estructura se verifican por separado; eso no sustituye una prueba completa contra Firebase y Mercado Pago del usuario.
