# Barber VIP — actualización de interfaz y fidelización

Aplicación web/PWA para barberos. La interfaz vive en `index.html`; los cambios privilegiados se realizan en API de Vercel con Firebase Admin. Esta versión conserva los proyectos y credenciales que ya existen.

## Importante para GitHub y Vercel (corrección del error de build)

**No subas el archivo ZIP a GitHub esperando que GitHub lo descomprima.** GitHub guarda el ZIP como un archivo y Vercel no usa automáticamente su contenido. En tu computadora: (1) descargá este ZIP, (2) hacé clic derecho → Extraer todo, (3) entrá a la carpeta extraída y comprobá que `index.html`, `vercel.json`, `api/`, `lib/` y `assets/` estén juntos en el mismo nivel, y (4) subí esos contenidos al repositorio conservando las carpetas. Después verificá que aparezca un **commit nuevo** en `main` y que Vercel despliegue ese commit.

Esta versión simplifica `vercel.json` para aplicar `maxDuration` a `api/*.js` en conjunto, en lugar de declarar una regla individual para `api/cleanup-cuts.js`. Así, la configuración no falla solo porque una función específica no se encuentre en el snapshot desplegado. La limpieza sigue necesitando que `api/cleanup-cuts.js` esté presente para que `/api/cleanup-cuts` responda correctamente.

En Vercel, confirmá también que **Root Directory** sea la carpeta que contiene directamente `vercel.json`, `index.html` y `api/`. Si esos elementos están en la raíz del repositorio, no establezcas una subcarpeta como raíz.

## Cambios de esta versión

- Portada más limpia, sin la insignia superior de texto redundante.
- Perfil profesional del barbero con progreso de configuración, WhatsApp de contacto, Instagram, ubicación de Google Maps, horarios corridos o de doble turno y color/densidad de interfaz.
- Panel del cliente separado en **Inicio** y **Datos de tu barbero**, con identidad enlazada, vías de contacto y horario.
- Programas de fidelización configurables: un programa general y hasta nueve variantes para clientes elegidos. Cada programa admite entre 1 y 10 etapas de premio; cada etapa define número de corte (1–50) y descuento (1–100%). Se conservan independientes de las promociones comerciales. Los identificadores de clientes asignados se reconstruyen desde el servidor y no se guardan en el documento público del barbero.
- Asignación de programas por clientes y actualización de `loyaltyProgramId` en clientes existentes.
- Tarjetas de promociones más visibles, interruptor ON/OFF en cada tarjeta, vigencia con fecha y hora, condiciones y cuenta regresiva local en el panel del cliente. El contador actualiza el DOM; no consulta Firestore continuamente.
- Detalles de cliente en modalidad de solo lectura. La contraseña no se muestra: Firebase Authentication no permite recuperarla en texto plano; se puede cambiar desde Editar.
- Mejoras de borde, contraste, iconos, navegación y botones de salir/cerrar/cancelar, especialmente en móviles.
- Intentos de desactivar autocompletado de formularios y sugerencias de gestores de contraseñas. La decisión final de mostrar huella/biometría la controla Android o el navegador, y una página web no puede prohibirlo por completo.
- Se subió la versión del caché PWA a v8 para que el navegador descarte la interfaz anterior y pida la nueva.

## Archivos que cambian

- `index.html`: estilos, experiencia, edición del perfil, navegación de cliente, programas de premios y promociones.
- `api/profile.js`: valida y persiste WhatsApp, Instagram, Maps y horarios.
- `api/me.js`: migra asignaciones antiguas de fidelización al perfil individual del cliente y quita listas de UID del documento visible del barbero.
- `api/loyalty.js`: nuevo endpoint para validar, guardar y asignar programas de premios.
- `api/cuts.js`: registra cada corte usando la variante asignada y anota el premio alcanzado en el historial.
- `api/promotions.js`: conserva fecha/hora exactas y visibilidad de promociones.
- `api/cleanup-cuts.js` y `vercel.json`: limpieza diaria de historial con más de 60 días.
- `sw.js`: nueva versión del caché PWA.

## Despliegue seguro

1. Guardá una copia o commit de la versión de GitHub que está en producción. No crees un segundo proyecto Firebase ni borres clientes.
2. Copiá los archivos de este ZIP respetando las carpetas `api/`, `lib/` y `assets/`. Conservá todas las API actuales que no aparecen como modificadas.
3. Conservá en Vercel las variables privadas existentes. Verificá `FIREBASE_SERVICE_ACCOUNT_JSON`, `APP_URL`, `MP_ACCESS_TOKEN` y `MP_WEBHOOK_SECRET` según el flujo de pagos que ya tengas. **Nunca pongas un Access Token privado en el HTML ni en GitHub.**
4. Configurá `CRON_SECRET` en Vercel como cadena aleatoria fuerte. El cron diario lo usa como `Authorization: Bearer ...` para proteger el endpoint de limpieza.
5. Para cambiar el precio, modificá `SUBSCRIPTION_PRICE_ARS` en las variables de entorno de Vercel y hacé un nuevo deployment. La interfaz lo consulta al servidor; no hace falta cambiar el HTML. Si la variable no existe, el precio predeterminado es $2.500.
6. Hacé commit/deploy y probá primero en una cuenta de prueba. Si la PWA muestra la versión anterior, cerrá la app instalada y volvé a abrirla; si persiste, limpiá el caché/datos del sitio en el navegador.

## Firebase y datos

No hay que borrar campos antiguos de clientes. El perfil del barbero guarda `instagramUrl`, `mapsUrl`, `schedule`, `loyaltyPrograms` y `defaultLoyaltyProgramId` en `barbers/{barberUid}`. Los horarios se guardan como modo (`continuous` o `double`) y una fila por día. Los clientes reciben `loyaltyProgramId`; sus contadores y descuentos existentes permanecen en sus documentos.

El nuevo endpoint `/api/loyalty` guarda los programas mediante Firebase Admin y valida los clientes seleccionados en el servidor. Para proteger los datos, `barbers/{uid}.loyaltyPrograms` no contiene listas de UID; las asignaciones viven como `loyaltyProgramId` en cada cliente y el endpoint reconstruye las selecciones únicamente para el administrador. En el primer acceso luego del despliegue, `/api/me` migra los UID de variantes guardadas por versiones anteriores. No se requiere modificar `firestore.rules` para que el barbero guarde el programa, ya que el frontend no escribe directamente estos campos. No uses escritura directa del navegador para manipular descuentos.

## Cómo funciona la fidelización

- Existe un único programa general para los clientes sin variante asignada. No se puede eliminar desde la interfaz.
- Cada variante adicional se asigna a clientes específicos; un cliente no puede estar en dos variantes al mismo tiempo.
- Podés crear etapas personalizadas como cortes 3, 6 y 9, con sus porcentajes elegidos. El ciclo se reinicia al llegar al número de corte de la última etapa configurada.
- Los descuentos ya ganados quedan almacenados separadamente hasta que se canjean, incluso cuando el contador del ciclo vuelve a cero.
- Si cambiás los hitos de un programa existente, los nuevos números se aplican a los próximos cortes. Revisá los saldos de premios ya ganados antes de cambiar promociones de fidelización en una barbería que esté trabajando.

## Retención del historial

Los eventos se guardan en `barbers/{barberUid}/cuts`. La API limpia oportunistamente hasta 350 eventos vencidos en consultas; `api/cleanup-cuts.js` hace una limpieza global diaria con lotes de hasta 400 y límite de hasta 40 lotes por ejecución. En la práctica se detiene cuando no quedan registros de más de 60 días. Se usa la cuota normal de eliminaciones de Firestore, no TTL.

El historial de Inicio muestra como máximo 100 registros en el rango seleccionado, con nombre, fecha/hora y corte de ciclo; el contador mensual se calcula según el mes calendario de Argentina. El cliente de paso aparece en el historial pero no recibe cuenta ni modifica un ciclo.

## Pruebas recomendadas

- Entrar como administrador, salir y entrar como cliente para verificar que no se mezclen sesiones.
- Guardar los datos y horarios del barbero; abrir después el panel de cliente y usar WhatsApp, Instagram y Maps.
- Crear una variante personalizada (por ejemplo cortes 3/6/9), asignarla a un cliente de prueba y sumar cortes hasta observar cada premio y reinicio.
- Activar/desactivar una promoción, configurar una hora de fin y verla desde un cliente asignado.
- Verificar el checkout con el ambiente de prueba de Mercado Pago antes de cambiar al Access Token productivo.
- Revisar en Vercel los logs de `api/loyalty`, `api/cuts` y `api/cleanup-cuts`. Vercel Cron Hobby ejecuta como máximo una vez al día; la hora puede variar dentro de la hora programada.

**Nota:** el código se ha revisado estáticamente y sus archivos JavaScript se comprobaron con `node --check`; eso no sustituye una prueba real desplegada contra las cuentas Firebase y Mercado Pago.


## Funciones de esta entrega

- Confirmación de salida para administrador y cliente.
- Cabeceras de admin más altas y categorías más visibles; contrastes y bordes siguen el color configurado.
- Recordatorios configurables: días posteriores a la frecuencia habitual, duración de seguimiento y máximo de 1, 2 o 3 contactos. El servidor valida el máximo; registrar un contacto significa que se abrió el flujo de WhatsApp, no que WhatsApp confirme que el mensaje se envió.
- Al llegar al máximo, el cliente deja de aparecer entre los recordatorios hasta que se registre un nuevo corte; esto evita repetir avisos indefinidamente.
- Enlace de WhatsApp para agendar un turno sin mensaje preescrito. Los recordatorios sí preparan un texto personal con el progreso de fidelización; el barbero lo puede revisar antes de enviarlo.
- Promociones con cronómetro local en segundos. El cronómetro se actualiza en el dispositivo y no consulta Firestore cada segundo.
- Horarios por día de la semana, permitiendo cerrar días y elegir horario corrido o doble turno por separado.
- El precio de suscripción mostrado, cobrado y validado por el webhook procede de `SUBSCRIPTION_PRICE_ARS`, mediante la API de cuenta.
- Registro de barberos desde la aplicación con nombre, correo y contraseña, recuperación de contraseña y prueba de 15 días después de verificar el correo.
- El acceso nuevo reutiliza `api/profile.js` y `api/me.js`; no se agregó ninguna función serverless. El proyecto tiene 10 funciones API JavaScript.

## Alta de barberos y prueba gratuita

- En Firebase Console, habilitá **Authentication → Sign-in method → Email/Password**.
- Revisá en **Authentication → Settings → Authorized domains** que figure el dominio de producción de Vercel (`barber-vip-three.vercel.app`).
- El alta solicita nombre, correo y contraseña. La aplicación envía un correo de verificación y crea el perfil del barbero con una prueba de 15 días únicamente después de verificar el correo.
- No se agrega ninguna función serverless: se reutilizan `api/profile.js` y `api/me.js`, por lo que `api/` continúa con 10 funciones JavaScript (por debajo del límite de 12 del plan Hobby).
- `SUBSCRIPTION_PRICE_ARS` controla tanto el precio mostrado en la app como el importe de Checkout y el importe aceptado por el webhook. Si cambiás el precio en Vercel, hacé un nuevo deployment para que el frontend y el backend reciban el mismo valor.

La verificación de correo reduce altas falsas, pero no puede impedir por sí sola que alguien use varias direcciones de correo distintas. Para impedir por completo múltiples pruebas hace falta una verificación adicional de identidad o facturación.


### Control de prueba gratuita

El inicio de la prueba requiere verificar el correo. El servidor registra una reclamación privada por correo normalizado y no concede una segunda prueba al mismo correo. Esto reduce duplicaciones accidentales, pero no elimina por completo los abusos con distintos correos o proveedores temporales. No se añade una función serverless nueva.

### Recuperación de contraseña del administrador

En el acceso del administrador se puede solicitar un correo de recuperación de Firebase. Para que llegue, activá Email/Password y verificá el dominio desplegado en Authentication > Settings > Authorized domains.
