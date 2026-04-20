@echo off
setlocal enabledelayedexpansion

:: ============================================================
::  iniciar.bat - TooManyBots Interpreter
::  Configura e inicializa o interpretador automaticamente.
::  Compativel com Windows 10/11 - cmd.exe
:: ============================================================

set "PROJECT_DIR=%~dp0"
if "%PROJECT_DIR:~-1%"=="\" set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"

echo.
echo ========================================
echo  TooManyBots - Inicializacao Automatica
echo ========================================
echo.

:: ============================================================
::  ETAPA 1 - Verificar Node.js
:: ============================================================
echo [1/6] Verificando Node.js...

where node >nul 2>&1
if %errorlevel% neq 0 goto :err_no_node

for /f "tokens=1 delims=." %%v in ('node -v 2^>nul') do set "NODE_VER=%%v"
set "NODE_VER_NUM=%NODE_VER:v=%"

node -e "if((process.version.slice(1).split('.')[0]|0)<18)process.exit(1)" >nul 2>&1
if %errorlevel% neq 0 goto :err_node_old

for /f "delims=" %%v in ('node -v') do echo   OK: Node.js %%v detectado.
goto :step2

:err_no_node
echo   ERRO: Node.js nao esta instalado ou nao esta no PATH.
echo.
echo   Instale o Node.js 18+ em:
echo     https://nodejs.org/
echo   Ou via winget:
echo     winget install OpenJS.NodeJS.LTS
goto :fatal

:err_node_old
echo   ERRO: Node.js detectado mas versao inferior a 18.
echo   Versao atual:
node -v
echo   Atualize em https://nodejs.org/
goto :fatal

:: ============================================================
::  ETAPA 2 - Verificar npm
:: ============================================================
:step2
echo.
echo [2/6] Verificando npm...

where npm >nul 2>&1
if %errorlevel% neq 0 goto :err_no_npm

echo   OK: npm detectado.
goto :step3

:err_no_npm
echo   ERRO: npm nao encontrado. Reinstale o Node.js LTS.
goto :fatal

:: ============================================================
::  ETAPA 3 - Instalar dependencias do projeto
:: ============================================================
:step3
echo.
echo [3/6] Verificando dependencias do interpretador...

if exist "%PROJECT_DIR%\node_modules" goto :deps_ok

echo   node_modules nao encontrado. Executando npm install...
echo   Isso pode levar alguns minutos na primeira execucao.
echo.

pushd "%PROJECT_DIR%"
call npm install
set "INSTALL_RESULT=!errorlevel!"
popd

if !INSTALL_RESULT! equ 0 goto :deps_ok

echo.
echo   ERRO: npm install falhou no diretorio raiz.
echo.
echo   Causas comuns:
echo     - Falta Visual Studio Build Tools ^(^necessario para better-sqlite3^)
echo     - Falta Python 3 ^(^necessario para node-gyp^)
echo.
echo   Solucao - Instale as ferramentas de build:
echo     npm install -g windows-build-tools
echo   Ou manualmente:
echo     https://visualstudio.microsoft.com/visual-cpp-build-tools/
echo     Selecione "Desktop development with C++"
echo.
echo   Python 3:
echo     winget install Python.Python.3.12
goto :fatal

:deps_ok
echo   OK: node_modules ja existe.
goto :step4

:: ============================================================
::  ETAPA 4 - Validar better-sqlite3
:: ============================================================
:step4
echo.
echo [4/6] Validando better-sqlite3 ^(^binding nativo^)...

node -e "try{require('better-sqlite3');process.exit(0)}catch(e){process.exit(1)}" >nul 2>&1
if %errorlevel% equ 0 goto :sqlite_ok

echo   ERRO: better-sqlite3 nao carrega corretamente.
echo.
echo   Isso geralmente significa que o binding C++ falhou ao compilar.
echo.
echo   Tente reconstruir:
echo     cd /d "%PROJECT_DIR%"
echo     npm rebuild better-sqlite3
echo.
echo   Se falhar, instale as ferramentas de build do Visual Studio:
echo     https://visualstudio.microsoft.com/visual-cpp-build-tools/
echo     Selecione "Desktop development with C++"
goto :fatal

:sqlite_ok
echo   OK: better-sqlite3 carregado com sucesso.
goto :step5

:: ============================================================
::  ETAPA 5 - Compilar dashboard (sempre)
:: ============================================================
:step5
echo.
echo [5/6] Compilando dashboard...

set "DASHBOARD_DIR=%PROJECT_DIR%\tmb_dashboard"
set "DASHBOARD_DIST=%DASHBOARD_DIR%\dist"

:: Instalar dependencias do dashboard se necessario
if exist "%DASHBOARD_DIR%\node_modules" goto :dash_build_run

echo   Instalando dependencias do dashboard...
pushd "%DASHBOARD_DIR%"
call npm install
set "DASH_INSTALL=!errorlevel!"
popd
if !DASH_INSTALL! neq 0 goto :err_dash_install
echo   Dependencias do dashboard instaladas.

:dash_build_run
echo   Executando build do dashboard ^(^vite build^)...
pushd "%DASHBOARD_DIR%"
call npm run build
set "DASH_BUILD=!errorlevel!"
popd

if !DASH_BUILD! equ 0 goto :dash_build_ok

echo   ERRO: Build do dashboard falhou.
echo   O interpretador pode funcionar sem a interface web.
echo   Tente manualmente: cd tmb_dashboard ^&^& npm run build
echo.
echo   Continuando sem dashboard compilado...
goto :step6

:dash_build_ok
echo   OK: Dashboard compilado com sucesso.
goto :step6

:err_dash_install
echo   ERRO: npm install falhou no dashboard.
goto :fatal

:: ============================================================
::  ETAPA 6 - Iniciar o interpretador
:: ============================================================
:step6
echo.
echo [6/6] Iniciando interpretador...
echo.
echo ========================================
echo  TooManyBots Interpreter - Pronto!
echo ========================================
echo.

pushd "%PROJECT_DIR%"
node index.js
set "RUN_RESULT=!errorlevel!"
popd

if !RUN_RESULT! equ 0 goto :end_ok

echo.
echo Interpretador encerrou com codigo de erro: !RUN_RESULT!
echo.
echo Verifique o log acima para detalhes.
echo Arquivo de log: %PROJECT_DIR%\fatal-error.log
goto :end

:end_ok
echo.
echo Interpretador encerrado normalmente.
goto :end

:: ============================================================
::  Erro fatal
:: ============================================================
:fatal
echo.
echo ========================================
echo  EXECUCAO INTERROMPIDA
echo  Corrija o problema acima e execute
echo  este arquivo novamente.
echo ========================================

:end
echo.
pause
exit /b 0
