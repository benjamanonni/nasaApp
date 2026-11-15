# Publicar AgroDSS

Render ejecuta FastAPI y consulta NASA POWER. Cloudflare Pages publica el frontend estático de React y Vite, que llama a Render directamente por HTTPS. Ambos servicios toman el código del mismo repositorio en GitHub.

## 1. GitHub

Abrí [benjamanonni/nasaApp](https://github.com/benjamanonni/nasaApp) y seleccioná la rama `main`. Confirmá que contiene `frontend/`, `backend/` y esta guía. Usá ese repositorio al autorizar ambas integraciones.

## 2. Render · backend

1. Entrá al [panel de Render](https://dashboard.render.com/) con tu cuenta. Seleccioná **+ New → Web Service** y conectá GitHub cuando el panel lo solicite. Si ya existe un servicio para este backend, abrilo y revisá sus ajustes.
2. Seleccioná `benjamanonni/nasaApp` y hacé clic en **Connect**. Elegí un nombre disponible para el servicio y completá estos campos.

| Campo de Render | Valor |
| --- | --- |
| Language / Runtime | Python 3 |
| Branch | `main` |
| Root Directory | `backend` |
| Build Command | `pip install -r requirements.txt` |
| Start Command | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` |
| Health Check Path (Advanced o Settings) | `/api/v1/health` |
| Environment Variables | `PYTHON_VERSION=3.11.11` |
| Auto-Deploy | **On Commit**, para cambios en la raíz del servicio |

3. Revisá el **Instance Type** y el costo antes de seleccionar **Deploy Web Service**. Elegí **Free** si aceptás las limitaciones descritas abajo. Render asigna `PORT` durante la ejecución.
4. Esperá a que Render marque el despliegue como **Live**. Copiá la URL HTTPS que aparece en la página del servicio. Ese es el valor de **URL de Render** para esta guía.
5. Agregá `/api/v1/health` a esa URL y abrila. Debe responder HTTP 200 con `"status": "ok"`. Repetí con `/api/v1/catalog` para verificar el catálogo. La raíz del servicio puede devolver 404.

Configurá el servicio desde el panel para elegir el plan y registrar los dominios reales en su momento. El backend usa el catálogo incluido en el repositorio y los valores predeterminados de NASA POWER. [Crear un Web Service](https://render.com/docs/your-first-deploy) · [FastAPI en Render](https://render.com/docs/deploy-fastapi) · [Versión de Python](https://render.com/docs/python-version) · [Health checks](https://render.com/docs/health-checks)

## 3. Cloudflare Pages · frontend

1. Entrá al [panel de Cloudflare](https://dash.cloudflare.com/) con tu cuenta. En **Workers & Pages**, elegí **Create application → Pages → Connect to Git**.
2. Autorizá en GitHub la aplicación **Cloudflare Workers and Pages** para `benjamanonni/nasaApp`. Seleccioná el repositorio y avanzá a la configuración del build.
3. Elegí un nombre para el proyecto y completá los campos. La raíz se puede configurar en **Root directory** dentro de la sección avanzada.

| Campo de Pages | Valor |
| --- | --- |
| Production branch | `main` |
| Root directory | `frontend` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Variable de build | `NODE_VERSION=22.23.4` |
| Variable de build | `VITE_API_BASE_URL` = URL de Render seguida de `/api/v1` |

4. En **Environment variables**, ingresá ambas variables antes de seleccionar **Save and Deploy**. La URL de la API debe usar HTTPS, incluir `/api/v1` una sola vez y corresponder al servicio que pasó el control del paso 2.
5. Cuando termine, abrí **Deployments** y copiá el dominio de **producción** que aparece en el proyecto, normalmente bajo `pages.dev`. Usá ese dominio estable y reservá las URLs por commit para vistas previas.

Vite incorpora `VITE_API_BASE_URL` al JavaScript del build. Cambiar el valor en **Settings** requiere un nuevo despliegue. Las variables `VITE_*` son públicas. [Integración con GitHub](https://developers.cloudflare.com/pages/configuration/git-integration/github-integration/) · [Configuración del build](https://developers.cloudflare.com/pages/configuration/build-configuration/) · [Versión de Node](https://developers.cloudflare.com/pages/configuration/build-image/) · [Variables de Vite](https://vite.dev/guide/env-and-mode)

## 4. Render · autorizar el origen de Pages

1. Volvé al servicio en Render y abrí **Environment → Add Environment Variable**.
2. Creá `AGRODSS_CORS_ORIGINS` y pegá el origen HTTPS de producción de Pages que acabás de copiar. Incluí `https://` y el hostname. Quitá cualquier ruta, fragmento o barra final.
3. Guardá los cambios con la opción que vuelve a desplegar el servicio. Esperá el estado **Live**. Si sumás un dominio personalizado, agregá su origen exacto separado por comas y volvé a desplegar. Mantené la lista limitada a los orígenes que uses.

## 5. Prueba pública

- [ ] Abrí la URL de producción de Pages en una ventana privada. Revisá en **DevTools → Network** que carguen los recursos y que el catálogo y el estado se obtengan por HTTPS desde la URL de Render al pulsar **Explorar estrategias → Mesa comparativa → Estado de conexión → Comprobar servicio de cálculo**.
- [ ] En **Mesa comparativa**, pulsá **Probar con un caso de ejemplo** desde una sesión nueva para ejecutar las rotaciones A, B y C. Con datos completos, usá **Ejecutar simulación**. Confirmá que el `POST /api/v1/simulations` devuelve HTTP 200, aparecen resultados y la procedencia indica NASA POWER. Una ejecución controlada alcanza para esta comprobación.
- [ ] Inspeccioná el `OPTIONS` del POST si aparece en Network. Debe autorizar el origen exacto de Pages y el header `Content-Type`. Comprobá que no haya errores de CORS o de contenido mixto y que la respuesta exponga `X-Request-ID`.
- [ ] Revisá Economía e Informe con el resultado de la simulación. En **Informe → Gestión del análisis**, pulsá **Exportar datos de sesión (JSON)** y guardá el archivo antes de recargar.
- [ ] Recargá una ruta de la interfaz, por ejemplo el fragmento `#informe/resumen`. El navegador solicita la raíz del sitio y React interpreta el fragmento.

El control de salud verifica que FastAPI responde. La prueba pública termina al completar el flujo de simulación e informe desde Pages.

## Diagnóstico y actualizaciones

| Síntoma | Qué revisar |
| --- | --- |
| Render falla al construir o arrancar | En **Events** y **Logs**, verificá `Root Directory=backend`, `PYTHON_VERSION`, las dependencias, `app.main:app`, el puerto asignado y el health check. |
| Pages falla con un mensaje sobre `VITE_API_BASE_URL` | Revisá las variables del entorno **Production**. Usá el HTTPS real de Render seguido de `/api/v1` y repetí el despliegue. |
| La API devuelve HTML o 404 | Revisá el hostname y el prefijo en **Network**. Verificá que Pages haya recompilado después de guardar la variable. |
| Network muestra un error CORS | Compará el `Origin` del navegador con `AGRODSS_CORS_ORIGINS` y verificá el último despliegue de Render. Las URLs de vista previa tienen orígenes diferentes. |
| La simulación tarda o devuelve 502, 503 o 504 | Comprobá si Render se está reactivando. Revisá el mensaje y el `request_id` en la respuesta, junto con los logs del servicio. NASA POWER puede estar demorado o indisponible. |

Para actualizar, publicá el cambio en `main` de `benjamanonni/nasaApp`. Verificá el commit desplegado en **Deployments** de Pages y **Events** de Render. Render vuelve a desplegar los cambios bajo `backend/` con la configuración indicada. Tras cambiar la URL de Render, actualizá la variable de Pages y recompilá. Tras cambiar el dominio de Pages, actualizá CORS en Render.

## Cuentas, costos y límites

- **Cuentas.** Necesitás iniciar sesión en Render y Cloudflare, y autorizar ambas integraciones en el GitHub con acceso a `benjamanonni/nasaApp`. La gestión de planes y el acceso a repositorios requieren permisos en las cuentas correspondientes.
- **Render Free.** Puede suspender la instancia después de 15 minutos sin tráfico entrante y la reactivación tarda alrededor de un minuto. Tiene límites de CPU, memoria, horas, ancho de banda y minutos de build. Los reinicios, despliegues y suspensiones descartan cambios en el disco local. El tráfico saliente elevado puede causar la suspensión del servicio Free. Los planes pagos y algunos excesos de uso pueden generar cargos. Revisá **Billing** antes de elegir el plan. [Límites de Render Free](https://render.com/docs/free) · [Precios de Render](https://render.com/pricing)
- **Cloudflare Pages.** La publicación estática tiene cuotas de compilación y archivos según tu plan. Revisá el precio si elegís un plan pago o comprás un dominio. [Límites de Pages](https://developers.cloudflare.com/pages/platform/limits/)
- **NASA POWER.** La simulación espera la respuesta HTTPS del proveedor externo. Si la descarga falla, AgroDSS muestra un error y conserva la trazabilidad del fallo.
- **Sesión del frontend.** La opción **Guardar entradas básicas en este navegador** conserva coordenadas, superficie, suelo y períodos históricos por parcela en el dispositivo. Los archivos, las estrategias personalizadas y los resultados quedan en la sesión. Usá la exportación JSON de Informe para guardar el análisis completo.

## Qué revisar ante un fallo de conexión

- Al pulsar **Ejecutar simulación** o **Reintentar conexión**, AgroDSS verifica la salud de la API hasta cuatro veces con pausas progresivas. Durante el arranque de Render puede aparecer un aviso temporal. Una simulación se envía una sola vez después de que la API responde.
- El navegador limita la espera de cada consulta de salud a 15 segundos y la de la simulación a 90 segundos. El backend conserva los valores predeterminados de NASA POWER de 10 segundos para conexión y 60 segundos para lectura. Si un POST pierde la conexión, el cliente puede desconocer si el servidor terminó. Revisá el estado antes de enviarlo otra vez.
- Si el error incluye un `request_id`, buscalo en los logs de Render. El backend registra inicio, estado y duración de la simulación sin incluir coordenadas ni el cuerpo de la solicitud. Si el navegador bloquea la respuesta, revisá la consola y el `OPTIONS` en **Network** para distinguir CORS de un problema de red.
