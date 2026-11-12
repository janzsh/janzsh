# Cómo replicar este perfil

El README de este perfil es una imagen SVG estilo *bento* con estadísticas de GitHub. Un script de Node la genera y GitHub Actions la actualiza sola todos los días. No necesita dependencias ni servicios externos: solo la API de GitHub y un token.

Hay dos versiones de la imagen, tema oscuro y claro, y el README muestra la que corresponde al tema de GitHub de quien lo ve.

> **Ojo con `<picture>`:** GitHub reescribe con su propio JavaScript las condiciones `prefers-color-scheme` para seguir el tema de GitHub, y no entiende condiciones combinadas como `(max-width: 600px) and (prefers-color-scheme: dark)`. Si intentas añadir una versión por ancho de pantalla, termina mostrándose donde no toca. Usa solo `prefers-color-scheme: dark` y `prefers-color-scheme: light`.

## Archivos

| Archivo | Para qué sirve |
| --- | --- |
| `profile.json` | Tus datos: nombre, frase, chips, "ahora mismo", destacados y reglas. |
| `scripts/build.mjs` | Consulta la API de GitHub y genera los SVG en `stats/`. |
| `.github/workflows/stats.yml` | Ejecuta el script cada día y hace commit de los SVG. |
| `README.md` | Muestra la imagen (con `<picture>`) y los enlaces. |
| `stats/` | Los SVG generados. No se editan a mano. |

## Pasos

1. **Crea tu repo de perfil.** Tiene que llamarse exactamente como tu usuario (`tu-usuario/tu-usuario`) y ser público. GitHub muestra su `README.md` en tu perfil.

2. **Copia los archivos** de la tabla de arriba (menos `stats/`, que se genera solo).

3. **Crea un token** en *Settings → Developer settings → Personal access tokens → Tokens (classic)*:
   - Permiso `repo` si quieres que los repos privados sumen a los números (nunca se muestran por nombre).
   - Solo `public_repo` si te basta con los públicos.
   - Ponle una expiración larga o recuerda renovarlo: si vence, el workflow falla y la imagen se queda con los datos del último día bueno.

4. **Guarda el token como secreto** del repo en *Settings → Secrets and variables → Actions → New repository secret*, con el nombre `GH_STATS_TOKEN`.

5. **Edita `profile.json`** con tus datos (ver la sección siguiente).

6. **Ejecuta el workflow por primera vez** en *Actions → Actualizar estadísticas → Run workflow*. Desde ahí corre solo cada día a las 06:00 UTC y cada vez que haces push de cambios en `profile.json` o `scripts/build.mjs`.

7. **Ajusta el README:** cambia los enlaces de abajo por los tuyos. El `alt` de la imagen no lo toques: el script lo reescribe en cada ejecución con un resumen de tus datos reales, que es lo que leen los lectores de pantalla.

## `profile.json`

| Campo | Qué es |
| --- | --- |
| `displayName` | Nombre grande de la cabecera. Su primera letra va en el avatar. |
| `tagline` | La frase debajo del nombre. |
| `location`, `website`, `languages` | Chips de la cabecera. Si alguno está vacío, no se muestra. |
| `timezone` | Se muestra en la tarjeta "Cuenta". |
| `available.show` / `available.text` | La píldora verde ("Disponible para proyectos"). |
| `now.building`, `now.learning`, `now.reading`, `now.askMe` | Tarjeta "Ahora mismo". Los vacíos no se muestran. |
| `stack` | Lista de tecnologías. Si está vacía, se usan tus lenguajes más comunes. |
| `featured` | Nombres de repos públicos para "Proyectos destacados", en ese orden. Si hay menos de 3, el resto se llena con tus repos con más estrellas. |
| `rules.excludeForks` | No contar forks. |
| `rules.excludeArchived` | No contar repos archivados. |
| `rules.excludeProfileRepo` | (Opcional) No contar el repo del perfil. |
| `rules.minLanguageShare` | Peso mínimo de un lenguaje dentro de un repo para que cuente (`0.1` = 10%). |

Las descripciones de los proyectos destacados salen de la descripción de cada repo en GitHub (el campo *About*), no de `profile.json`.

## Probar en local

Necesitas Node 22 o más reciente.

```sh
# Con datos de ejemplo, sin red ni token:
node scripts/build.mjs --sample --out /tmp/preview

# Con tus datos reales (usa GH_TOKEN o, si no existe, la sesión de `gh auth login`):
node scripts/build.mjs --out /tmp/preview
```

Con `--out` los SVG se escriben en otra carpeta y no se tocan ni `stats/` ni el `alt` del README. Ábrelos en el navegador para verlos.

## Cómo calcula las cosas

- **Lenguajes:** se cuenta en cuántos repos aparece cada lenguaje con al menos `minLanguageShare` del código del repo, no cuántos bytes tiene en total. Si hay empate, gana el que tiene más código.
- **Rachas y contribuciones:** salen del calendario de contribuciones de los últimos 12 meses. Si hoy todavía no hay contribuciones, la racha actual no se corta.
- **Actividad reciente:** son los últimos eventos públicos ordenados por fecha. Los iguales seguidos se agrupan (×N).
- **Repos privados:** solo suman a los totales y a los lenguajes; su nombre nunca aparece.
- **Todo o nada:** cada consulta tiene un tiempo límite y se reintenta hasta 3 veces si GitHub falla momentáneamente. Si aun así falla algo, el script termina con error, no escribe nada, la imagen anterior se mantiene y GitHub te avisa por correo.

## Personalizar el diseño

Los colores de ambos temas están en `THEMES`, dentro de `scripts/build.mjs`. El orden de las tarjetas está en `layout`, al final de la función `render`: cada fila es una lista de tarjetas con su ancho.
