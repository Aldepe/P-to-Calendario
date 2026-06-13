# Email gratis sin dominio

Esta opcion usa Google Apps Script como relay gratuito: Supabase llama a una URL privada y Gmail envia el correo desde tu cuenta. No necesitas comprar dominio ni configurar DNS.

## Pasos

1. Abre <https://script.google.com/>.
2. Crea un proyecto nuevo.
3. Pega el contenido de `mail-relay.gs`.
4. Cambia `CAMBIA_ESTE_SECRETO_LARGO` por una frase larga y privada.
5. Pulsa `Implementar > Nueva implementacion`.
6. Tipo: `Aplicacion web`.
7. Ejecutar como: `Yo`.
8. Quien tiene acceso: `Cualquier usuario`.
9. Autoriza con tu cuenta de Gmail.
10. Copia la URL de la aplicacion web.

## Secrets de Supabase

```powershell
npx supabase secrets set GOOGLE_MAIL_WEBHOOK_URL="https://script.google.com/macros/s/XXXXX/exec"
npx supabase secrets set GOOGLE_MAIL_WEBHOOK_SECRET="la_misma_frase_larga"
```

Despues despliega las funciones:

```powershell
npx supabase functions deploy email-reminders
npx supabase functions deploy email-session-confirmed
```

## Nota

Gmail tiene cuotas diarias. En cuentas personales, Google documenta 100 destinatarios al dia para MailApp. Para una mesa de rol pequena deberia sobrar, pero no lo uses para listas grandes.
