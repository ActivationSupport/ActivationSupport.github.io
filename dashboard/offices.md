# Office Dashboard URLs

Base URL: `https://ActivationSupport.github.io/dashboard/index.html`

## Midspire (Jami) — midspire
```
https://ActivationSupport.github.io/dashboard/index.html?office=midspire
```

## Viridian (Stefan) — viridian
```
https://ActivationSupport.github.io/dashboard/index.html?office=viridian
```

## Elevate (Jackie) — elevate
```
https://ActivationSupport.github.io/dashboard/index.html?office=elevate
```

## Ignite (Jacob) — ignite
```
https://ActivationSupport.github.io/dashboard/index.html?office=ignite
```

---
Keep these URLs private — share only with the designated owner/admin for each office.

---
## Migration (run once after deploying updated Code.gs)
POST to the Apps Script URL with body:
```json
{ "action": "migrateOfficeIds", "key": "activation-dash-2026-secret" }
```
This renames all sheet tabs from `_Roster_off_001` format to `_Roster_midspire` format.
