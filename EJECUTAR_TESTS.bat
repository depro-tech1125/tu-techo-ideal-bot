@echo off
chcp 65001 > nul
title TU TECHO IDEAL V5.0 - SUITE DE PRUEBAS INTEGRAL
color 0B

echo ==============================================================================
echo                 TU TECHO IDEAL V5.0 - VALIDACION DEL SISTEMA
echo             Ejecucion de las Suites de Prueba Automatizadas (153 Tests)
echo ==============================================================================
echo.

if not exist node_modules (
    echo [INFO] Instalando dependencias necesarias...
    call npm install
)

echo [1/8] Ejecutando: Suite de Alertas de Cierre a Robert (Fase 1 Deliverable D)...
node scripts/test_alertas_robert_fase1.js
if %errorlevel% neq 0 goto :error

echo.
echo [2/8] Ejecutando: Suite de Resiliencia y Atencion a Solicitudes Repetidas (Caso 08:24)...
node scripts/test_reproducir_caso_0824.js
if %errorlevel% neq 0 goto :error

echo.
echo [3/8] Ejecutando: Suite de Enlace Directo Rexup LINK_FOTOS (Sin kommo.cc)...
node scripts/test_link_fotos_directo_sin_kommo_cc.js
if %errorlevel% neq 0 goto :error

echo.
echo [4/8] Ejecutando: Suite Maestra de Aceptacion Comercial (50 Escenarios)...
node scripts/test_master_50_acceptance_scenarios.js
if %errorlevel% neq 0 goto :error

echo.
echo [5/8] Ejecutando: Suite de Reconocimiento Multiportal y Fotos...
node scripts/test_multiportal_and_photos.js
if %errorlevel% neq 0 goto :error

echo.
echo [6/8] Ejecutando: Suite de Idempotencia y Despacho Unico...
node scripts/test_idempotency_and_single_dispatch.js
if %errorlevel% neq 0 goto :error

echo.
echo [7/8] Ejecutando: Suite de Nueva Logica Inmobiliaria V5.0 (44 Escenarios)...
node test_suite_nueva_logica.js
if %errorlevel% neq 0 goto :error

echo.
echo [8/8] Ejecutando: Verificacion de Bloqueo Humano 12h y Reactivacion...
node scripts/verify_lock_and_reactivation.js
if %errorlevel% neq 0 goto :error

echo.
echo ==============================================================================
echo       TODAS LAS PRUEBAS (153/153) FUERON SUPERADAS CON EXITO (100%%)
echo ==============================================================================
echo El sistema cumple al 100%% con los requisitos contractuales de la Fase 1.
pause
exit /b 0

:error
echo.
echo [ERROR CRITICO] Una de las suites de prueba reporto fallas.
echo Revise los logs anteriores para mas detalle.
pause
exit /b 1
