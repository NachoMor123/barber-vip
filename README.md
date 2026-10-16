# Barber VIP — versión sin verificación por correo

App web/PWA para fidelización de barberías. Incluye cliente y administrador, 10 funciones serverless en Vercel, Firebase Authentication/Firestore, Mercado Pago, promociones, historial con retención y ayuda interactiva local.

## Estructura

- `index.html`: interfaz de administrador y cliente.
- `api/`: exactamente 10 funciones JavaScript; mantené esta carpeta sin copias antiguas para respetar el plan Vercel Hobby.
- `lib/`: inicialización segura de Firebase Admin, helpers y validación de sesión.
- `assets/`, `manifest.webmanifest`, `sw.js`: recursos y caché PWA. El caché usa `barber-vip-shell-v11`.
- `firestore.rules`: referencia de reglas; conservá las reglas activas ya probadas salvo que una migración específica lo requiera.

## Registro de barberos (sin email de verificación)

El formulario crea la cuenta directamente con Firebase Authentication usando correo y contraseña. Firebase verifica que el correo tenga un formato válido y que no exista ya otra cuenta con él, pero **no confirma que la persona controle esa dirección**. No se envían correos, códigos, enlaces de verificación ni recuperación de contraseña desde Barber VIP.

Después de crear la cuenta, el navegador llama a `POST /api/profile` con `action: "ensure"`. El servidor crea el perfil del barbero y asigna 15 días de prueba. La fecha se guarda como `subscriptionExpiresAt` en Firestore y el reclamo de prueba se registra en `trialClaims`.

### Implicaciones de seguridad

- Como no verificamos la dirección, alguien puede registrarse con un correo escrito incorrectamente o que no controla. Esa persona tampoco podrá recuperar la contraseña mediante un flujo de correo que la app no ofrece.
- La protección de prueba gratuita solo vincula el reclamo a la cadena de correo escrita. Sin verificar propiedad, no se puede impedir que alguien use otras direcciones.
- Las contraseñas nunca se guardan en Firestore ni se muestran después de crear la cuenta. Se puede usar `Ver/Ocultar` al escribirlas; Firebase guarda una forma no recuperable de la contraseña.
- Si se olvida una contraseña, esta versión no tiene recuperación por correo; hace falta un proceso administrativo/manual o volver a añadir un mecanismo de recuperación seguro en otra versión.

## Variables de entorno en Vercel

Configurá en Vercel → Settings → Environment Variables y conservá las que ya usa tu proyecto:

| Variable | Uso |
|---|---|
| `FIREBASE_SERVICE_ACCOUNT_JSON` | JSON privado de Firebase Admin. |
| `APP_URL` | URL HTTPS de producción. |
| `MP_ACCESS_TOKEN` | Token privado de Mercado Pago. |
| `MP_WEBHOOK_SECRET` | Secreto para verificar firmas del webhook. |
| `SUBSCRIPTION_PRICE_ARS` | Precio mensual, por ejemplo `2500` o `5000`. |
| `CRON_SECRET` | Secreto largo para la limpieza diaria de historial. |

`RESEND_API_KEY` y `EMAIL_FROM` ya no se usan. Podés eliminarlas de Vercel si las habías creado. Hacé un nuevo despliegue después de retirar variables o cambiar código.

## Firebase

- Habilitá `Authentication → Sign-in method → Email/Password`.
- Agregá `barber-vip-three.vercel.app` a `Authentication → Settings → Authorized domains`.
- No hace falta cambiar el Firebase existente ni las reglas de Firestore solo para este cambio.
- Las cuentas nuevas deben llamar a `api/profile` para inicializar el perfil; el alta no confía en datos escritos directamente en el cliente.

## Retención de datos

La tarea programada de `api/cleanup-cuts.js` elimina registros de cortes con más de 60 días en lotes. Los totales y los ciclos del cliente quedan guardados en su documento. Los perfiles, suscripciones, promociones y reclamos de prueba no se borran por antigüedad porque son datos operativos necesarios. La ayuda Pip usa respuestas predefinidas locales y no almacena un chat, por lo que no genera escrituras extra en Firestore.

## Experiencia y ayuda

- Tema fijo negro/azul eléctrico, sin selector de color; se conserva densidad cómoda/compacta.
- Botones principales más anchos y centrados; navegación inferior oscura con borde azul.
- Pip ofrece temas predefinidos, no acepta texto libre ni usa una IA externa.
- El recorrido guiado de administrador aparece la primera vez y se puede repetir desde Pip. Se puede saltar en cualquier paso.
- La instalación PWA se ofrece mediante el mecanismo del navegador; por seguridad, la web no puede obligar a instalar sin una confirmación del usuario.

## Despliegue

1. Hacé una copia del repositorio que funciona.
2. Descomprimí el ZIP y subí el **contenido** desde su raíz; `index.html`, `vercel.json`, `package.json`, `api/`, `lib/` y `assets/` deben quedar al mismo nivel.
3. No subas el ZIP como un archivo y no dejes funciones antiguas duplicadas dentro de `api/`.
4. Conservá las variables privadas de Firebase/Mercado Pago. No las pegues en el HTML ni en GitHub.
5. Commit a `main` y comprobá que el deployment nuevo compile.

## Pruebas recomendadas

- Crear una cuenta con correo bien formado no usado y contraseña de 8+ caracteres; debe ingresar sin email/código.
- Cerrar y abrir la PWA; debe restaurar la sesión y mantener el perfil.
- Confirmar que se aplique una sola prueba de 15 días por dirección escrita.
- Crear cliente y verificar que los campos no sugieran usuarios/contraseñas guardados (los gestores externos pueden ignorar atributos HTML).
- Recorrer el tour, saltarlo y volver a iniciarlo desde Pip.
- Consultar cada tema de Pip en administrador y cliente.
- Probar cortes, recordatorios, promos, suscripción y limpieza con cuentas de prueba.

La sintaxis del código y la estructura se validan localmente, pero eso no sustituye una prueba real contra tu Firebase y Mercado Pago de producción.


## Ajustes de esta entrega

- Se quitó el recorrido tipo spotlight que estaba fallando. Pip queda como guía contextual y muestra temas distintos según sea administrador o cliente, con una explicación inicial orientada al valor del producto y los siguientes pasos recomendados.
- Los botones principales de Inicio, Clientes, Recordatorios y Promociones son de ancho completo. Se ajustaron los fondos a azul casi negro, bordes azul eléctrico y contraste de texto. Se desactivó la animación de entrada de paneles completos para reducir el efecto de salto cuando Firestore actualiza datos.
- Si la suscripción está activa, “Ver plan” muestra estado y vencimiento sin abrir Mercado Pago. Solo el período de gracia o la cuenta vencida permite iniciar un pago. La API también rechaza preferencias si la cuenta está activa.
- Una cuenta vencida no puede registrar cortes (incluidos cortes rápidos) y tampoco crear promociones nuevas. Se mantienen disponibles las demás secciones y las acciones de administrar promociones existentes.
- Al confirmar la instalación se muestra una opción “Abrir app”. El navegador controla si el enlace abre la PWA instalada o permanece en el navegador; ninguna página web puede forzar ese comportamiento en todos los dispositivos.
- El proyecto mantiene 10 funciones API, por debajo del límite de 12 del plan Vercel Hobby. No se agregaron endpoints.

## Pruebas recomendadas después del despliegue

1. Iniciar sesión con una cuenta activa y pulsar “Ver plan”: debe mostrar información, no crear un pago.
2. Probar una cuenta vencida: registrar corte y crear promoción deben devolver un mensaje de renovación; el resto de las secciones debe seguir visible.
3. Abrir Pip como administrador y como cliente: no debe aparecer un tour ni contenido específico del rol contrario.
4. Revisar los botones principales en celular y escritorio.
5. Probar el flujo de instalación en el dispositivo objetivo; el botón “Abrir app” depende del comportamiento del navegador/OS.
