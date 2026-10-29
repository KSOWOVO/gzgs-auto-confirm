@echo off
chcp 65001 >nul 2>&1
title 网校自动确认 · 安装程序
setlocal enabledelayedexpansion

set "SRC=%~dp0extension"
set "DEST=%LOCALAPPDATA%\GzgsAutoConfirm\extension"

echo.
echo   ==================================================
echo      网校自动确认  ·  安装程序  v1.0.0
echo   ==================================================
echo.
echo   这个脚本只做三件事：
echo     1. 把扩展文件复制到固定位置（不动你其他任何文件）
echo     2. 把该路径复制到剪贴板
echo     3. 帮你打开浏览器的扩展管理页
echo.

if not exist "%SRC%\manifest.json" (
    echo   [X] 没找到 extension 文件夹。
    echo       请确认「install.bat」和「extension」文件夹
    echo       在同一个目录里（解压后就是这样，别单独拖出来）。
    echo.
    pause
    exit /b 1
)

echo   正在复制文件 ...
if not exist "%LOCALAPPDATA%\GzgsAutoConfirm" mkdir "%LOCALAPPDATA%\GzgsAutoConfirm" >nul 2>&1
if not exist "%DEST%" mkdir "%DEST%" >nul 2>&1

xcopy "%SRC%\*" "%DEST%\" /E /I /Y /Q >nul 2>&1

if not exist "%DEST%\manifest.json" (
    echo.
    echo   [X] 复制失败。常见原因：
    echo       - 浏览器正占用着旧版文件，请先完全关闭浏览器再试
    echo       - 安全软件拦截，请允许后重试
    echo.
    pause
    exit /b 1
)

echo   [OK] 文件已就位
echo        %DEST%
echo.

> "%TEMP%\gzgs_path.txt" echo %DEST%
clip < "%TEMP%\gzgs_path.txt" >nul 2>&1
del "%TEMP%\gzgs_path.txt" >nul 2>&1
echo   [OK] 路径已复制到剪贴板
echo.

echo   ==================================================
echo     下面只剩 3 步，浏览器马上会自动打开
echo   ==================================================
echo.
echo     1) 打开页面【左下角】的「开发人员模式」开关
echo.
echo     2) 点【左上角】的「加载解压缩的扩展」
echo.
echo     3) 在弹出的地址栏按 Ctrl + V 粘贴，回车，
echo        然后点「选择文件夹」
echo.
echo   装好之后回到网校页面按 F5 刷新。
echo   页面右下角出现绿色「自动确认」标记 = 成功。
echo.
echo   ------------------------------------------------
pause
echo.

start "" msedge "edge://extensions/" >nul 2>&1
if errorlevel 1 start "" chrome "chrome://extensions/" >nul 2>&1

exit /b 0
