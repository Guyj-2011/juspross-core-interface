# Plan: agente local seguro para abrir Spotify en Windows

## Estado actual (verificado)
- HEAD `5774641`. Las herramientas de Spotify (`spotifyTools.server.ts`) se ejecutan **en el servidor** (Worker) dentro de `/api/agent-delegate`. Solo controlan la reproducción por la API web.
- La voz en vivo (`useGeminiLive.ts`) ejecuta sus herramientas **en el navegador** (`handleToolCalls`). Hoy solo admite `delegate_to_nemotron`, declarada en `/api/gemini-live-token`.
- Consecuencia clave: el servidor publicado no puede llegar al `127.0.0.1` del usuario. La orden «abrir Spotify» tiene que ejecutarla **el navegador**, que llama al agente local. Nunca el servidor.

## Arquitectura

```text
Navegador (juspross.lovable.app)
  ├─ "abre Spotify" ──> fetch https? no: http://127.0.0.1:47821/v1/open-spotify
  │                      cabeceras: Authorization: Bearer <token de sesión emparejado>
  │                      Origin: https://juspross.lovable.app (validado)
  └─ "pausa / siguiente" ──> /api/agent-delegate (sin cambios, API Spotify)

Agente local (Node, solo 127.0.0.1)
  └─ lista permitida: open_spotify  ->  spawn("explorer.exe", ["spotify:"])  (sin shell)
```

## 1. Agente local (`local-agent/`, carpeta nueva, fuera de `src/`)
- `local-agent/juspross-agent.mjs`: un solo archivo, sin dependencias (solo `node:http`, `node:crypto`, `node:child_process`, `node:fs`). Requiere Node 18 o superior.
- Escucha **solo** en `127.0.0.1:47821`. Si el puerto está ocupado, se niega a arrancar.
- **Rutas:**
  - `GET /v1/health`: devuelve `{name, version, paired}`. No revela secretos.
  - `POST /v1/pair`: emparejamiento (ver sección 2).
  - `POST /v1/tools/open_spotify`: la única herramienta.
  - `POST /v1/unpair`: revoca el token.
  - Cualquier otra ruta devuelve 404.
- **Controles en cada solicitud:**
  - `Host` debe ser `127.0.0.1:47821` o `localhost:47821`. Esto protege contra DNS rebinding.
  - `Origin` debe estar en la lista permitida: `https://juspross.lovable.app` y, de forma opcional con `--allow-preview`, el dominio de vista previa. Cualquier otro origen recibe 403 sin cabeceras CORS.
  - Solo se acepta `Content-Type: application/json` y cuerpos de 4 KB como máximo.
  - Límite de 10 solicitudes por minuto.
  - Las respuestas de verificación previa (preflight) incluyen `Access-Control-Allow-Origin: <origen exacto>`, `Access-Control-Allow-Headers: authorization, content-type` y `Access-Control-Allow-Private-Network: true`.
- **open_spotify:**
  - Ejecuta `spawn("explorer.exe", ["spotify:"], { shell: false, windowsHide: true })` con argumentos fijos. El navegador no envía ningún parámetro.
  - Antes, detecta si Spotify está instalado: busca la clave de registro `HKCU\Software\Classes\spotify` mediante `reg.exe query` con argumentos fijos. Si no la encuentra, busca `%APPDATA%\Spotify\Spotify.exe` o el paquete de la Microsoft Store.
  - Si no hay instalación, responde `{ok:false, reason:"not_installed"}`.
  - No hay shell, ni rutas recibidas del cliente, ni lectura de archivos expuesta.
- Guarda su estado en `%LOCALAPPDATA%\Juspross\agent.json`: el hash del token y la fecha de emparejamiento. No hay autoarranque ni instalador.

## 2. Emparejamiento y autenticación (sin clave fija en el frontend)
1. El usuario ejecuta el agente. La consola muestra un **código de 6 dígitos** de un solo uso, válido 5 minutos.
2. En Juspross, en Configuración → «Equipo local», el usuario escribe el código. El navegador hace `POST /v1/pair {code}`.
3. Si el código es válido, el agente genera un token aleatorio de 32 bytes, guarda solo su hash SHA-256 y lo devuelve una única vez.
4. El navegador guarda el token en `localStorage`, solo en el origen de Juspross.
5. Las solicitudes siguientes envían `Authorization: Bearer <token>`. El agente lo compara con `timingSafeEqual`.
- Defensas: tras 5 códigos fallidos, el emparejamiento se bloquea hasta reiniciar el agente. Un sitio malicioso no puede emparejarse: lo bloquea la comprobación del origen y, además, desconoce el código. Tampoco puede usar el token: está aislado en el almacenamiento de Juspross.
- **Desconectar:** botón en la interfaz (`/v1/unpair` y borrado local) o `node juspross-agent.mjs --reset`.

## 3. Integración en Juspross (cambios mínimos)
- **Nuevo** `src/lib/juspross/localAgent.ts` (solo navegador):
  - Funciones `getStatus()`, `pair(code)`, `openSpotify()` y `unpair()`.
  - Tiempo de espera de 3 s y errores tipados: `not_running`, `not_paired`, `blocked_by_browser`, `not_installed`.
- **Nuevo** `src/lib/juspross/localIntent.ts`: detector simple de «abre/abrir/inicia/lanza Spotify» que **no** captura «reproduce/pausa/siguiente». Lleva sus pruebas en `localIntent.test.ts`.
- **Editar** `useV2Chat.ts`, solo en el envío:
  - Si el mensaje es una intención de abrir Spotify, llama a `openSpotify()` en el navegador y escribe el resultado real en el chat.
  - Si no hay agente, el mensaje es: «El agente local no está conectado; no pude abrir Spotify. Ejecútalo y emparéjalo en Configuración».
  - El resto de mensajes sigue igual hacia `/api/agent-delegate`.
- **Editar** `useGeminiLive.ts` (`handleToolCalls`): añadir el caso `open_spotify_desktop`, que llama a `localAgent.openSpotify()` y devuelve al modelo `{ok, reason}`.
- **Editar** `gemini-live-token.ts`: añadir la declaración `open_spotify_desktop`, sin parámetros, y una frase en las instrucciones: «para abrir la app usa open_spotify_desktop; para reproducir usa Nemotron/Spotify».
- **Editar** `agent-delegate.ts`: una sola línea en las instrucciones, para que Nemotron nunca diga que abrió la aplicación. No se le añade la herramienta, porque se ejecuta en el servidor.
- **Editar** `SettingsPanel.tsx`: nueva sección «Equipo local» con el estado (conectado / sin emparejar / no detectado), un campo para el código, y los botones Probar (health) y Desconectar. Usa el estilo de panel existente.
- No se cambia nada de `spotify.server.ts`, `spotifyTools.server.ts` (salvo nada), `/api/speech`, la escena ni los demás agentes.

## 4. Instrucciones para Windows (`local-agent/README.md` + texto en la interfaz)
1. Descargar `juspross-agent.mjs` en una carpeta.
2. `node --version` debe ser 18 o superior.
3. `node juspross-agent.mjs` muestra el código.
4. En Juspross: Configuración → Equipo local → introducir el código → Probar.
5. Decir «abre Spotify».
6. Para detenerlo, Ctrl+C. Para desconectarlo, usar el botón o `--reset`.
- El autoarranque solo se documenta como paso manual opcional (acceso directo en `shell:startup`). No se hace nada automáticamente.

## Riesgos de compatibilidad del navegador
- **HTTPS → `http://127.0.0.1`:** Chrome, Edge y Firefox tratan `127.0.0.1` como contexto seguro, así que no hay bloqueo por contenido mixto. Safari no aplica en Windows. Se usa `127.0.0.1`, no `localhost`, para evitar resoluciones raras.
- **Private Network Access / Local Network Access (Chrome 142+):** Chrome pide al usuario un permiso de «acceso a la red local» la primera vez. Hay que contar con ese aviso y documentarlo. Si se deniega, el error se muestra como `blocked_by_browser` con instrucciones. El agente responde `Access-Control-Allow-Private-Network` para las versiones antiguas de PNA.
- **Brave y extensiones de privacidad** pueden bloquear peticiones a localhost. Se detecta y se explica.
- **Firewall de Windows:** al escuchar solo en loopback no debería aparecer su aviso. Si aparece, se puede denegar sin problema.
- **Spotify de la Microsoft Store:** el protocolo `spotify:` funciona igual. La detección por registro cubre los dos tipos de instalación.
- **Vista previa frente a publicada:** son orígenes distintos. La vista previa solo funciona con `--allow-preview`.

## Pruebas
- **Unitarias (bun test):**
  - `localIntent.test.ts`: «abre Spotify» se detecta; «pon música en Spotify» y «pausa Spotify» no.
  - `local-agent/agent.test.mjs`:
    - un origen ajeno devuelve 403;
    - un `Host` distinto devuelve 403;
    - sin token devuelve 401;
    - un token incorrecto devuelve 401;
    - un código caducado o usado se rechaza;
    - 5 fallos bloquean el emparejamiento;
    - una ruta desconocida devuelve 404;
    - `open_spotify` llama a un `spawn` simulado con `explorer.exe ["spotify:"]` exactos.
- **Integración local en la sandbox (Linux):** el agente se arranca en modo `--dry-run` (no ejecuta nada) y Playwright comprueba emparejamiento, estado y el mensaje del chat con el agente arrancado y sin arrancar.
- **Manual por el usuario en Windows 11:** apertura real de Spotify y aviso de red local de Chrome. No puedo probarlo desde aquí.
- Comprobación de tipos, build y tests existentes en verde. No se publica.

## Fuera de alcance
Cualquier otra herramienta local, instalador, servicio de Windows, autoarranque o control de Spotify por el agente local (la reproducción sigue en la API web).
