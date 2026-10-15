@echo off
setlocal enabledelayedexpansion

:: ============================================================
::  setup.bat - TooManyBots Fun (Onboarding Instantaneo Windows)
::  Prepara o ambiente, instala dependencias e abre o Setup Wizard.
::  Compativel com Windows 10/11 - cmd.exe
:: ============================================================

chcp 65001 >nul 2>&1
mode con: cols=120 lines=40 >nul 2>&1

set "PROJECT_DIR=%~dp0"
if "%PROJECT_DIR:~-1%"=="\" set "PROJECT_DIR=%PROJECT_DIR:~0,-1%"
cd /d "%PROJECT_DIR%"

echo.
echo ============================================================
echo      🎮 TooManyBots Fun - Configuracao Inicial (Setup)
echo ============================================================
echo.

:: ============================================================
::  1. Verificar Node.js
:: ============================================================
echo [1/4] Verificando Node.js...

where node >nul 2>&1
if %errorlevel% neq 0 (
  echo   ERRO: Node.js nao esta instalado ou nao esta no PATH.
  echo.
  echo   Instale o Node.js 18+ em:
  echo     https://nodejs.org/
  echo   Ou via winget:
  echo     winget install OpenJS.NodeJS.LTS
  goto :fatal
)

node -e "if((process.version.slice(1).split('.')[0]|0)<18)process.exit(1)" >nul 2>&1
if %errorlevel% neq 0 (
  echo   ERRO: Versao do Node.js incompativel. Requer 18+.
  echo   Atual:
  node -v
  echo   Atualize em: https://nodejs.org/
  goto :fatal
)

for /f "delims=" %%v in ('node -v') do echo   OK: Node.js %%v detectado.

:: ============================================================
::  2. Verificar npm e dependencias
:: ============================================================
echo.
echo [2/4] Verificando dependencias do projeto...

where npm >nul 2>&1
if %errorlevel% neq 0 (
  echo   ERRO: npm nao encontrado no PATH.
  goto :fatal
)

if not exist "%PROJECT_DIR%\node_modules" (
  echo   node_modules nao encontrado. Instalando pacotes com npm install...
  echo   (Isso pode levar alguns minutos na primeira execucao)
  echo.
  pushd "%PROJECT_DIR%"
  call npm install
  set "INST_RES=!errorlevel!"
  popd
  if !INST_RES! neq 0 (
    echo.
    echo   ERRO: npm install falhou. Verifique sua conexao e ferramentas C++.
    goto :fatal
  )
) else (
  echo   OK: node_modules presente.
)

:: ============================================================
::  3. Validar driver nativo better-sqlite3
:: ============================================================
echo.
echo [3/4] Validando driver nativo better-sqlite3...

node -e "try{require('better-sqlite3');process.exit(0)}catch(e){process.exit(1)}" >nul 2>&1
if %errorlevel% neq 0 (
  echo   Aviso: better-sqlite3 precisa ser reconstruido para sua versao do Node.
  pushd "%PROJECT_DIR%"
  call npm rebuild better-sqlite3
  set "REB_RES=!errorlevel!"
  popd
  if !REB_RES! neq 0 (
    echo   ERRO: Falha ao reconstruir better-sqlite3.
    goto :fatal
  )
  echo   OK: better-sqlite3 reconstruido com sucesso.
) else (
  echo   OK: better-sqlite3 operacional.
)

:: ============================================================
::  4. Assistente de Configuracao Interativo (Setup Wizard)
:: ============================================================
echo.
echo [4/4] Iniciando Assistente de Configuracao...
echo.

pushd "%PROJECT_DIR%"
call node fun/scripts/setupWizard.js
set "WIZARD_RES=!errorlevel!"
popd

echo.
echo ============================================================
echo                 PROXIMOS PASSOS
echo ============================================================
echo  [1] Iniciar o bot agora (iniciar_fun.bat)
echo  [2] Executar Diagnostico Completo (Doctor)
echo  [3] Sair
echo ============================================================
set /p "NEXT_CHOICE=Escolha uma opcao (1-3) [padrao: 1]: "

if "%NEXT_CHOICE%"=="" set "NEXT_CHOICE=1"
if "%NEXT_CHOICE%"=="1" goto :run_bot
if "%NEXT_CHOICE%"=="2" goto :run_doctor
if "%NEXT_CHOICE%"=="3" goto :done

:run_bot
call "%PROJECT_DIR%\iniciar_fun.bat"
goto :done

:run_doctor
pushd "%PROJECT_DIR%"
call node scripts/doctor.mjs
popd
pause
goto :done

:fatal
echo.
echo ============================================================
echo  CONFIGURACAO INTERROMPIDA
echo ============================================================
pause
exit /b 1

:done
exit /b 0
