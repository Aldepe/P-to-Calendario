# Discord gratis para P*to Calendario

La integracion usa un webhook de Discord. Es gratis y no necesita bot, dominio ni servidor extra. El webhook publica mensajes en un canal concreto, no envia DMs privados.

Nota: las Edge Functions conservan sus nombres historicos (`email-reminders` y `email-session-confirmed`) para no romper URLs ni cron existentes, pero ya solo publican en Discord.

## Pasos

1. En Discord, abre el canal donde quieres recibir avisos.
2. Entra en `Editar canal` -> `Integraciones` -> `Webhooks`.
3. Crea un webhook nuevo y copia su URL.
4. En el proyecto local ejecuta:

```powershell
cd C:\Users\a2959\OneDrive\Documentos\GitHub\P-to-Calendario
$env:PATH = "C:\Users\a2959\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;$env:PATH"
.\node_modules\.bin\supabase.cmd secrets set DISCORD_WEBHOOK_URL="https://discord.com/api/webhooks/..."
.\node_modules\.bin\supabase.cmd functions deploy email-reminders
.\node_modules\.bin\supabase.cmd functions deploy email-session-confirmed
```

Opcional:

```powershell
.\node_modules\.bin\supabase.cmd secrets set DISCORD_WEBHOOK_NAME="P*to Calendario"
```

## Que manda

- Recordatorio: un mensaje con semana, pendientes y estado de la mesa.
- Sesion confirmada: campana, dia, franja, DMs, asistencia, ausentes y modalidad.
- Sesion cancelada: lo mismo, marcado como cancelacion.

Los botones de prueba del DM sirven para comprobar recordatorio, confirmacion y cancelacion.
