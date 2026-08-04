# UCC Mis Descuentos

Agenda de códigos de descuento para Unión Cine Ciudad (Metromar). Requiere Google; los cupones viven en Firestore y se comparten entre la extensión Firefox y la web.

## Extensión Firefox

[Firefox Add-ons](https://addons.mozilla.org/es-ES/firefox/addon/ucc-descuentos/).

1. **Entrar con Google**
2. Gestiona códigos (con validación remota contra compraentradas)
3. **Salir** borra la cache local (siguen en la nube)

## Web (iOS / cualquier móvil)

URL: [https://ucc-discount.web.app](https://ucc-discount.web.app)

Misma cuenta y mismos códigos que la extensión. En la web **no** hay validación remota (CORS; requiere Blaze + Cloud Function en el futuro).

### Deploy Hosting (Spark, sin Blaze)

1. Firebase Console → Hosting activado; Auth → Authorized domains con `ucc-discount.web.app`.
2. Google Cloud → OAuth **Web client (auto created by Google Service)**:
   - Orígenes JS: `https://ucc-discount.web.app` y `https://ucc-discount.firebaseapp.com`
   - URIs de redirección: añade **`https://ucc-discount.web.app/__/auth/handler`** (necesario en Safari/iOS)
3. En el PC:

```bash
npm i -g firebase-tools
firebase login
cd c:\Users\Misco\Documents\Github\ucc-discount
firebase use ucc-discount
firebase deploy --only hosting
```

## Desarrollo extensión

```bash
node selfcheck.js
```

Carga temporal: `about:debugging` → Cargar complemento temporal → `manifest.json`.
