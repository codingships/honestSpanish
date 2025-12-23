Prompt 1: Mejorar index.html base
Actualiza el archivo index.html con lo siguiente:

1. Cambia lang="en" a lang="es"
2. Añade estas meta tags en el <head>:
   - Una meta description de fallback: "Español Honesto - Academia de español para expatriados en España. 8-10 meses de trabajo real para fluidez conversacional auténtica."
   - Meta robots: index, follow
   - Meta author: Español Honesto
   - Theme-color: #006064
   
3. Añade Open Graph tags:
   - og:type: website
   - og:site_name: Español Honesto
   - og:locale: es_ES
   - og:image: (deja un placeholder /og-image.jpg)
   
4. Añade Twitter Card tags:
   - twitter:card: summary_large_image
   
5. Cambia el title a: "Español Honesto | Academia de español para expatriados en España"

6. Cambia el favicon de vite.svg a /favicon.svg (lo crearemos después)

Prompt 2: Añadir Open Graph dinámico en Helmet
En el componente LandingPage dentro de App.jsx, actualiza el <Helmet> para incluir Open Graph y Twitter Cards dinámicos según el idioma:

Añade dentro de <Helmet>:
- og:title usando t('meta.title')
- og:description usando t('meta.description')
- og:url con la URL canónica /{lang}
- og:image: https://espanolhonesto.com/og-image.jpg
- og:locale: es_ES para español, en_US para inglés, ru_RU para ruso
- twitter:card: summary_large_image
- twitter:title y twitter:description usando las mismas traducciones
- link rel="canonical" apuntando a la URL actual con el idioma

Prompt 3: Añadir Schema JSON-LD
En el componente LandingPage de App.jsx, añade Schema JSON-LD para SEO estructurado. Añádelo dentro del <Helmet> como un <script type="application/ld+json">.

Incluye tres schemas:

1. EducationalOrganization:
   - name: "Español Honesto"
   - description: usar t('meta.description')
   - url: "https://espanolhonesto.com"
   - address: Madrid, España
   - email: hola@espanolhonesto.com

2. FAQPage:
   - Mapea los items de t('faq.items') al formato Question/Answer de schema.org

3. Course (uno por cada plan de pricing):
   - name: nombre del plan
   - description: descripción del plan
   - provider: referencia al EducationalOrganization
   - offers: con el precio en EUR

El JSON-LD debe ser dinámico según el idioma actual.

Prompt 4: Crear robots.txt y sitemap.xml
Crea dos archivos en la carpeta public/:

1. robots.txt:
User-agent: *
Allow: /
Sitemap: https://espanolhonesto.com/sitemap.xml

2. sitemap.xml con las URLs:
- https://espanolhonesto.com/es (prioridad 1.0)
- https://espanolhonesto.com/en (prioridad 0.8)
- https://espanolhonesto.com/ru (prioridad 0.8)

Usa el formato estándar de sitemap con lastmod de hoy.

Prompt 5: Mejorar alt texts de imágenes
En App.jsx, mejora los alt texts de las imágenes para SEO:

1. heroImage: cambiar de "Lifestyle" a algo descriptivo como "Estudiante practicando español en un café de Madrid"
2. madridAtmosphere: cambiar a "Vista atmosférica del centro de Madrid"
3. avatarAlejandro: cambiar a "Alejandro - Profesor principal de Español Honesto"
4. avatarAlin: cambiar a "Alin - Profesor y desarrollador de Español Honesto"