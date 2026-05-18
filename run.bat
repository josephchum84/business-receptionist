@echo off
setlocal

title Business Receptionist Agent
color 0a

echo ========================================
echo  Business Receptionist Agent (24/7)
echo ========================================
echo.

:start
echo [%date% %time%] Starting agent...
python "%~dp0runner.py"
echo [%date% %time%] Process exited with code %errorlevel%

if %errorlevel% neq 0 (
    echo [%date% %time%] Restarting in 5 seconds...
    timeout /t 5 /nobreak
    goto start
) else (
    echo [%date% %time%] Normal exit
)

endlocal
