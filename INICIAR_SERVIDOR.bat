@echo off
chcp 65001 > nul
title TU TECHO IDEAL V5.0 - SERVIDOR LOCAL
color 0A

echo ==============================================================================
echo                 TU TECHO IDEAL V5.0 - ASISTENTE INMOBILIARIO
echo                 Iniciando Servidor Backend en Modo Local
echo ==============================================================================
echo.

if not exist .env (
    echo [ADVERTENCIA] No se encontro el archivo .env.
    echo Creando archivo .env a partir de .env.example...
    copy .env.example .env
    echo Por favor, edite el archivo .env con sus credenciales antes de continuar.
    pause
    exit /b 1
)

if not exist node_modules (
    echo [INFO] Carpeta node_modules no encontrada. Instalando dependencias...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Fallo la instalacion de dependencias npm.
        pause
        exit /b %errorlevel%
    )
)

echo [OK] Dependencias verificadas.
echo [OK] Variables de entorno cargadas.
echo [INFO] Iniciando servidor Express en Node.js...
echo Presione CTRL+C para detener el servidor en cualquier momento.
echo.

node server.js

pause
