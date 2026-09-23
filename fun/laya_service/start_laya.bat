@echo off
setlocal

echo ===================================================
echo   Iniciando Laya Decision Service (TooManyBots)
echo   Porta: 127.0.0.1:20129
echo ===================================================

cd /d "%~dp0..\.."

if exist ".venv\Scripts\python.exe" (
    set "PYTHON_EXE=.venv\Scripts\python.exe"
) else (
    echo [ERRO] Ambiente virtual .venv nao encontrado na raiz do projeto!
    pause
    exit /b 1
)

echo Usando Python: %PYTHON_EXE%
echo Iniciando Uvicorn na porta 20129...

"%PYTHON_EXE%" -m uvicorn fun.laya_service.app:app --host 127.0.0.1 --port 20129

endlocal
