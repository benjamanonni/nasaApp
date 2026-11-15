# AgroDSS

AgroDSS compara rotaciones de cultivos de secano en San Luis, Argentina, sobre ventanas históricas de dos años. Usa NASA POWER para el clima, FAO-56 para el balance hídrico y FAO-33 para estimar la respuesta del rendimiento al déficit de agua. También permite comparar costos y precios y preparar un informe.

La interfaz usa React y Vite. El servidor usa Python, FastAPI y Uvicorn. Las simulaciones con datos reales necesitan acceso a internet.

## Inicio en Windows

1. Instalá [Node.js](https://nodejs.org/en/download) con npm. Se recomienda Node.js 24 LTS. También funcionan Node.js 22 desde 22.13 y Node.js 26 o posterior.
2. Instalá [Python para Windows](https://www.python.org/downloads/windows/), preferentemente [Python 3.11](https://www.python.org/downloads/release/python-3119/). También podés usar Python 3.12 o 3.13. Habilitá el lanzador `py` o agregá Python al PATH durante la instalación.
3. Abrí la raíz del proyecto y hacé doble clic en **INICIAR-AGRODSS.bat**. En el primer arranque, esperá a que se instalen las dependencias.
4. El iniciador abre dos terminales y, cuando Vite y FastAPI responden, abre <http://localhost:5173>. FastAPI escucha en <http://localhost:8000>.

Para detener los servicios, presioná **Ctrl+C** en cada terminal o cerrá ambas ventanas. Si el iniciador informa que un puerto está ocupado, usá la instancia ya abierta si corresponde a esta copia, o detené el proceso que ocupa el puerto antes de reintentar.

## Inicio manual en Windows

En PowerShell, desde la raíz del repositorio, iniciá el backend:

```powershell
cd backend
py -3.11 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Si instalaste Python con el alias `python`, usá `python -m venv .venv` en el primer paso de creación del entorno.

En otra terminal, desde la raíz:

```powershell
cd frontend
npm.cmd ci
npm.cmd run dev
```

Abrí <http://localhost:5173>. Vite envía las solicitudes a `/api/v1` al backend local.

## Comprobar la API

- Estado de FastAPI en <http://localhost:8000/api/v1/health>. Debe devolver `"status": "ok"`.
- Catálogo de cultivos a través del proxy en <http://localhost:5173/api/v1/catalog>.
- Documentación interactiva y prueba de `POST /api/v1/simulations` en <http://localhost:8000/docs>. El cuerpo de ejemplo está en [simulation_request.json](backend/app/data/examples/simulation_request.json).

## Variables de entorno

En local se usan los valores predeterminados. Para cambiar la URL de la API en Vite, copiá [frontend/.env.example](frontend/.env.example) a `frontend/.env.local`, editá `VITE_API_BASE_URL` y reiniciá Vite. Las variables `VITE_*` quedan visibles en el código compilado.

| Variable | Valor predeterminado |
| --- | --- |
| `VITE_API_BASE_URL` | `/api/v1` |
| `AGRODSS_CORS_ORIGINS` | `http://localhost:5173`. Acepta orígenes separados por comas. |
| `AGRODSS_POWER_BASE_URL` | `https://power.larc.nasa.gov` |
| `AGRODSS_POWER_CONNECT_TIMEOUT_S` | `10` |
| `AGRODSS_POWER_READ_TIMEOUT_S` | `60` |

Para personalizar el backend en PowerShell, definí la variable antes de ejecutar Uvicorn, por ejemplo `$env:AGRODSS_POWER_READ_TIMEOUT_S = '90'`.

## Preparar un despliegue futuro

1. En Render, configurá un Web Service Python con raíz `backend`, instalación `pip install -r requirements.txt`, inicio `uvicorn app.main:app --host 0.0.0.0 --port $PORT` y ruta de salud `/api/v1/health`. [Guía de FastAPI en Render](https://render.com/docs/deploy-fastapi)
2. En Cloudflare Pages, configurá la raíz `frontend`, el comando `npm run build`, el directorio de salida `dist` y Node.js 24 para la compilación. Definí `VITE_API_BASE_URL` con la URL pública de Render seguida de `/api/v1`. [Configuración de compilación de Cloudflare Pages](https://developers.cloudflare.com/pages/configuration/build-configuration/)
3. En Render, agregá el origen HTTPS de Pages a `AGRODSS_CORS_ORIGINS` y comprobá una simulación desde la URL pública.
