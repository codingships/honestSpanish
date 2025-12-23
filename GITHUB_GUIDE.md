# Cómo subir el proyecto a GitHub

Sigue estos pasos para guardar tu código en un repositorio de GitHub.

## 1. Crear el repositorio en GitHub
1.  Entra a [GitHub.com](https://github.com) y loguéate.
2.  Haz clic en el botón **+** (arriba a la derecha) y selecciona **"New repository"**.
3.  Nombre del repositorio: `espanol-honesto-web` (o el que quieras).
4.  Público o Privado: A tu elección.
5.  **NO** marques "Add a README file" (ya tienes uno local).
6.  Haz clic en **"Create repository"**.

## 2. Inicializar Git localmente
Abre la terminal en la carpeta de tu proyecto (`c:\Users\Alin\Desktop\Academia\pruebas`) y ejecuta:

```bash
# 1. Iniciar git (si no lo has hecho ya)
git init

# 2. Añadir todos los archivos al área de preparación
git add .

# 3. Guardar el primer "commit" (versión)
git commit -m "Initial commit: Migración a Astro completa con Blog"

# 4. Cambiar el nombre de la rama principal a 'main'
git branch -M main
```

## 3. Conectar con GitHub
Copia la URL de tu repositorio (será algo como `https://github.com/tu-usuario/espanol-honesto-web.git`) y ejecuta:

```bash
# Sustituye la URL por la tuya:
git remote add origin https://github.com/TU_USUARIO/NOMBRE_DEL_REPO.git

# Verificar que se ha conectado
git remote -v
```

## 4. Subir el código (Push)
```bash
git push -u origin main
```

---

## Flujo de trabajo diario (Actualizaciones)
Cada vez que hagas cambios (ej. añadir un nuevo post al blog):

1.  **Ver qué ha cambiado**:
    ```bash
    git status
    ```
2.  **Añadir cambios**:
    ```bash
    git add .
    ```
3.  **Guardar versión con mensaje descriptivo**:
    ```bash
    git commit -m "Añadido nuevo artículo sobre B1"
    ```
4.  **Enviar a la nube**:
    ```bash
    git push
    ```
