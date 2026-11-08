# Agente local de Juspross (Windows 11)

Pequeño programa que permite a Juspross **abrir Spotify** en tu PC. No hace nada más: no ejecuta comandos ni otros programas y no lee archivos.

- Escucha solo en `127.0.0.1:47821`, así que no es accesible desde la red.
- Solo acepta peticiones de `https://juspross.lovable.app`.
- Necesita un código de un solo uso para emparejarse.
- No se instala ni arranca solo.

## Requisitos
- Windows 11 con Spotify instalado (instalador oficial o Microsoft Store).
- Node.js 18 o superior. Para comprobarlo, ejecuta `node --version` en PowerShell.
- Chrome o Edge. Brave y algunos bloqueadores pueden impedir la conexión.

## Ejecutar
1. Descarga `juspross-agent.mjs` en una carpeta, por ejemplo `C:\Juspross`.
2. Abre PowerShell en esa carpeta y ejecuta:
   ```powershell
   node juspross-agent.mjs
   ```
3. La ventana muestra un **código de 6 dígitos**. Es válido durante 5 minutos y sirve una sola vez.
4. En https://juspross.lovable.app ve a **Configuración → Equipo local** y pulsa **Comprobar**. Escribe el código y pulsa **Emparejar**.
5. Si el navegador pregunta si el sitio puede acceder a dispositivos de tu **red local**, pulsa **Permitir**.
6. Pulsa **Abrir Spotify** o di o escribe «abre Spotify».

Deja la ventana de PowerShell abierta mientras uses la función.

## Desconectar
- **Detener el agente:** pulsa `Ctrl+C` en PowerShell.
- **Quitar el emparejamiento:** pulsa **Desconectar** en Juspross o ejecuta `node juspross-agent.mjs --reset`.
- **Borrarlo del todo:** elimina el archivo y la carpeta `%LOCALAPPDATA%\Juspross`.

## Problemas
- **«Agente no detectado»:** comprueba que PowerShell siga abierto. Revisa también que el navegador no haya bloqueado el «acceso a la red local» (icono del candado → Configuración del sitio).
- **«El puerto 47821 ya está en uso»:** ya hay otro agente abierto.
- **Código caducado:** cierra el agente con `Ctrl+C` y vuelve a ejecutarlo para obtener otro.
- **Usarlo en la vista previa de Lovable:** ejecuta `node juspross-agent.mjs --allow-preview`.

## Inicio automático (opcional, manual)
El agente nunca se configura solo para arrancar con Windows. Si quieres que lo haga, crea tú mismo un acceso directo en `shell:startup` que ejecute `node C:\Juspross\juspross-agent.mjs`.
