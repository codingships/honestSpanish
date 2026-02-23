# Cómo subir el proyecto a GitHub (Entorno Protegido CI/CD)

Sigue estos pasos para guardar tu código. La rama `main` está bloqueada y requiere validación automatizada de los tests de Playwright y Vitest antes de actualizar producción.

## 1. Crear el repositorio (Solo la primera vez)
1.  Entra a GitHub.com y selecciona **"New repository"**.
2.  Nombre del repositorio: `espanol-honesto-web`
3.  **NO** marques "Add a README file".
4.  Haz clic en **"Create repository"**.

## 2. Inicializar Git y Conectar (Solo la primera vez)
```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin [https://github.com/TU_USUARIO/NOMBRE_DEL_REPO.git](https://github.com/TU_USUARIO/NOMBRE_DEL_REPO.git)
git push -u origin main

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
