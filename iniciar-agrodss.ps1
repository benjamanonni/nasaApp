$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$frontend = Join-Path $root 'frontend'
$backend = Join-Path $root 'backend'
$frontendUrl = 'http://localhost:5173'
$backendUrl = 'http://localhost:8000'
$healthPath = '/api/v1/health'

function Get-DependencyHash($path) {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
        $bytes = [System.IO.File]::ReadAllBytes($path)
        return [System.BitConverter]::ToString($sha256.ComputeHash($bytes))
    } finally {
        $sha256.Dispose()
    }
}

function Wait-Http($url, $service) {
    $deadline = (Get-Date).AddSeconds(30)
    do {
        & curl.exe --noproxy '*' --fail --silent --max-time 2 --output NUL $url
        if ($LASTEXITCODE -eq 0) { return }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $deadline)
    throw "$service no responde en $url. Revisa la terminal del servicio."
}

function Start-Server($name, $directory, $executable, $arguments) {
    # /k keeps the server output visible if the command exits.
    Start-Process -FilePath $env:ComSpec -WorkingDirectory $directory -WindowStyle Normal `
        -ArgumentList ('/d /k "title AgroDSS - {0} & "{1}" {2}"' -f $name, $executable, $arguments)
}

function Find-Python {
    $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
    $python = Get-Command python.exe -ErrorAction SilentlyContinue
    $probe = 'import sys, venv; assert (3,11) <= sys.version_info[:2] < (3,14); print(sys.executable)'
    $paths = @()
    if ($launcher) {
        foreach ($version in '-3.11', '-3.12', '-3.13') {
            $path = & $launcher.Source $version -c $probe 2>$null
            if ($LASTEXITCODE -eq 0 -and $path) { return $path }
        }
    }
    if ($env:LOCALAPPDATA) {
        $paths += Join-Path $env:LOCALAPPDATA 'Programs\Python\Python311\python.exe'
    }
    if ($python -and $python.Source -notlike '*\Microsoft\WindowsApps\python.exe') {
        $paths += $python.Source
    }
    foreach ($path in $paths) {
        if (Test-Path -LiteralPath $path) {
            $resolved = & $path -c $probe 2>$null
            if ($LASTEXITCODE -eq 0 -and $resolved) { return $resolved }
        }
    }
    throw 'Instala Python 3.11 (recomendado), 3.12 o 3.13 con el lanzador py o python en PATH.'
}

$mutex = New-Object System.Threading.Mutex($false, 'Local\AgroDSS-5173-8000')
$locked = $false
try {
    try { $locked = $mutex.WaitOne(0) } catch [System.Threading.AbandonedMutexException] { $locked = $true }
    if (!$locked) { throw 'AgroDSS ya se esta iniciando.' }

    $requirements = Join-Path $backend 'requirements.txt'
    $packageLock = Join-Path $frontend 'package-lock.json'
    if (!(Test-Path -LiteralPath $requirements) -or !(Test-Path -LiteralPath $packageLock)) {
        throw 'Ejecuta INICIAR-AGRODSS.bat desde la raiz del proyecto completo.'
    }

    $ports = [System.Net.NetworkInformation.IPGlobalProperties]::GetIPGlobalProperties().GetActiveTcpListeners() |
        Where-Object { $_.Port -in 5173, 8000 } | Select-Object -ExpandProperty Port -Unique
    if ($ports) {
        throw "Puertos en uso ($($ports -join ', ')). Si AgroDSS ya esta abierto, usa $frontendUrl. Para volver a iniciarlo, detene los servicios que ocupan esos puertos."
    }

    $node = Get-Command node.exe -ErrorAction SilentlyContinue
    $npm = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (!$node -or !$npm) { throw 'Instala Node.js con npm y agrega ambos al PATH.' }
    $nodeVersion = [version]((& $node.Source --version).TrimStart('v'))
    if (!(($nodeVersion.Major -eq 22 -and $nodeVersion.Minor -ge 13) -or
          $nodeVersion.Major -eq 24 -or $nodeVersion.Major -ge 26)) {
        throw 'Instala Node.js 24 LTS, Node.js 22.13+ de la rama 22 o Node.js 26+.'
    }

    $venvPython = Join-Path $backend '.venv\Scripts\python.exe'
    if (!(Test-Path -LiteralPath $venvPython)) {
        $python = Find-Python
        & $python -m venv (Join-Path $backend '.venv')
        if ($LASTEXITCODE -ne 0) { throw 'No se pudo crear backend\.venv.' }
    }

    $pythonSupported = & $venvPython -c 'import sys; print((3,11) <= sys.version_info[:2] < (3,14))'
    if ($LASTEXITCODE -ne 0 -or $pythonSupported -ne 'True') {
        throw 'backend\.venv usa un Python incompatible. Mueve ese entorno fuera de backend y vuelve a iniciar.'
    }

    $dependenciesPresent = & $venvPython -c 'from importlib.util import find_spec; print(all(find_spec(name) for name in (''fastapi'', ''uvicorn'', ''httpx'', ''pytest'', ''ruff'')))'
    $pipStamp = Join-Path $backend '.venv\requirements.sha256'
    $requirementsHash = Get-DependencyHash $requirements
    if ($dependenciesPresent -ne 'True' -or !(Test-Path -LiteralPath $pipStamp) -or (Get-Content -LiteralPath $pipStamp) -ne $requirementsHash) {
        & $venvPython -m pip install -r $requirements
        if ($LASTEXITCODE -ne 0) { throw 'No se pudieron instalar las dependencias de FastAPI.' }
        Set-Content -LiteralPath $pipStamp -Value $requirementsHash
    }

    Push-Location -LiteralPath $frontend
    try {
        $npmStamp = 'node_modules\.agrodss-lock.sha256'
        $lockHash = Get-DependencyHash $packageLock
        if (!(Test-Path 'node_modules\.bin\vite.cmd') -or !(Test-Path -LiteralPath $npmStamp) -or
            (Get-Content -LiteralPath $npmStamp) -ne $lockHash) {
            & $npm.Source ci
            if ($LASTEXITCODE -ne 0) { throw 'npm ci fallo. Revisa la salida anterior.' }
            Set-Content -LiteralPath $npmStamp -Value $lockHash
        }
    } finally {
        Pop-Location
    }

    Start-Server 'FastAPI' $backend $venvPython '-m uvicorn app.main:app --host 127.0.0.1 --port 8000'
    Wait-Http "$backendUrl$healthPath" 'FastAPI'
    Start-Server 'Vite' $frontend $npm.Source 'run dev'
    Wait-Http "$frontendUrl/" 'Vite'
    Wait-Http "$frontendUrl$healthPath" 'El proxy de Vite'

    Write-Host "Frontend $frontendUrl"
    Write-Host "Backend $backendUrl (API $backendUrl/api/v1, documentacion $backendUrl/docs)"
    Start-Process $frontendUrl
} catch {
    Write-Host "Error al iniciar AgroDSS. $($_.Exception.Message)" -ForegroundColor Red
    exit 1
} finally {
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
