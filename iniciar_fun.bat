@echo off
setlocal enabledelayedexpansion

:: ============================================================
::  iniciar_fun.bat - TooManyBots Fun (Bot WhatsApp)
::  Configura e inicializa o bot de entretenimento automaticamente.
::  Compativel com Windows 10/11 - cmd.exe
:: ============================================================

:: Configura pagina de codigo UTF-8 e tamanho seguro de janela para o QR Code
chcp 65001 >nul 2>&1
mode con: cols=120 lines=40 >nul 2>&1

set "PROJECT_DIR=%~dp0"
if "%PROJECT_DIR:~-1%"=="\" set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"

echo.
echo ============================================================
echo   🎮 TooManyBots Fun - Inicializacao Automatica (WhatsApp)
echo ============================================================
echo.

:: ============================================================
::  ETAPA 1 - Verificar Node.js
:: ============================================================
echo [1/5] Verificando Node.js...

where node >nul 2>&1
if %errorlevel% neq 0 goto :err_no_node

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
echo [2/5] Verificando npm...

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
echo [3/5] Verificando dependencias do bot...

if exist "%PROJECT_DIR%\node_modules" goto :check_native_deps

echo   node_modules nao encontrado. Executando npm install...
echo   Isso pode levar alguns minutos na primeira execucao.
echo.

pushd "%PROJECT_DIR%"
call npm install
set "INSTALL_RESULT=!errorlevel!"
popd

if !INSTALL_RESULT! equ 0 goto :check_native_deps

echo.
echo   ERRO: npm install falhou no diretorio raiz.
echo.
echo   Causas comuns:
echo     - Falta Visual Studio Build Tools (necessario para better-sqlite3)
echo     - Falta Python 3 (necessario para node-gyp)
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

:check_native_deps
echo   Validando driver nativo better-sqlite3...
node -e "try{require('better-sqlite3');process.exit(0)}catch(e){process.exit(1)}" >nul 2>&1
if %errorlevel% equ 0 (
  echo   OK: Dependencias e better-sqlite3 carregados com sucesso.
  goto :step4
)

echo   Aviso: better-sqlite3 precisa ser recompilado. Executando rebuild...
pushd "%PROJECT_DIR%"
call npm rebuild better-sqlite3
set "REBUILD_RES=!errorlevel!"
popd

if !REBUILD_RES! equ 0 (
  echo   OK: better-sqlite3 recompilado com sucesso.
  goto :step4
)

echo   ERRO: Falha ao reconstruir better-sqlite3.
goto :fatal

:: ============================================================
::  ETAPA 4 - Dependencias opcionais (ffmpeg)
:: ============================================================
:step4
echo.
echo [4/5] Verificando ferramentas de midia (ffmpeg)...

where ffmpeg >nul 2>&1
if %errorlevel% equ 0 (
  echo   OK: ffmpeg detectado no PATH (audios e stickers animados habilitados).
) else (
  echo   INFO: ffmpeg nao foi detectado no PATH.
  echo         O bot funcionara perfeitamente, mas comandos que geram audios Opus
  echo         ou figurinhas animadas requerem ffmpeg.
  echo         Instalacao opcional via winget: winget install Gyan.FFmpeg
)

:: ============================================================
::  ETAPA 5 - Configuracao inicial (Wizard)
:: ============================================================
:step5
echo.
echo [5/5] Verificando configuracao do Bot Fun...

if not exist "%PROJECT_DIR%\fun\config.user.json" (
  echo   Configuracao nao encontrada. Abrindo assistente inicial...
  echo.
  pushd "%PROJECT_DIR%"
  call node fun/scripts/setupWizard.js
  popd
) else (
  echo   OK: Arquivo fun/config.user.json presente.
)

:: ============================================================
::  MENU INTERATIVO
:: ============================================================
:menu
echo.
echo ============================================================
echo                      MENU PRINCIPAL
echo ============================================================
echo  [1] Iniciar Fun Bot (Terminal com QR Code)
echo  [2] Iniciar Fun Bot + Dashboard Web 3D (Next.js)
echo  [3] Reconfigurar Opcoes (Setup Wizard)
echo  [4] Sair
echo ============================================================
set /p "CHOICE=Escolha uma opcao (1-4) [padrao: 1]: "

if "%CHOICE%"=="" set "CHOICE=1"
if "%CHOICE%"=="1" goto :start_bot_only
if "%CHOICE%"=="2" goto :start_with_dashboard
if "%CHOICE%"=="3" goto :reconfig
if "%CHOICE%"=="4" goto :end_ok

echo Opcao invalida. Tente novamente.
goto :menu

:: ============================================================
::  ACAO: Reconfigurar
:: ============================================================
:reconfig
pushd "%PROJECT_DIR%"
call node fun/scripts/setupWizard.js --force
popd
goto :menu

:: ============================================================
::  ACAO: Iniciar com Dashboard Web 3D
:: ============================================================
:start_with_dashboard
set "DASH_DIR=%PROJECT_DIR%\fun_dashboard"
if not exist "%DASH_DIR%\node_modules" (
  echo.
  echo Instalando dependencias do Dashboard Web (fun_dashboard)...
  pushd "%DASH_DIR%"
  call npm install
  popd
)

echo.
echo Iniciando Dashboard Web em janela paralela (http://127.0.0.1:3001)...
start "TooManyBots - Fun Dashboard Web" cmd /c "cd /d "%DASH_DIR%" && npm run dev -- -p 3001"
timeout /t 2 >nul 2>&1

goto :start_bot_only

:: ============================================================
::  ACAO: Iniciar Bot no Terminal
:: ============================================================
:start_bot_only
echo.
echo ============================================================
echo   Iniciando TooManyBots Fun...
echo   Escaneie o QR Code abaixo com seu WhatsApp!
echo ============================================================
echo.

pushd "%PROJECT_DIR%"
call node fun/start.js
set "RUN_RESULT=!errorlevel!"
popd

if !RUN_RESULT! equ 0 goto :end_ok

echo.
echo O bot foi encerrado com codigo de erro: !RUN_RESULT!
goto :end

:end_ok
echo.
echo Bot Fun encerrado normalmente.
goto :end

:: ============================================================
::  Erro fatal
:: ============================================================
:fatal
echo.
echo ============================================================
echo  EXECUCAO INTERROMPIDA
echo  Corrija o problema acima e execute este arquivo novamente.
echo ============================================================

:end
echo.
pause
exit /b 0
