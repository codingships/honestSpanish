/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}",
    ],
    theme: {
        extend: {
            fontFamily: {
                display: ['Boldonse', 'Unbounded', 'cursive'],
                sans: ['Pretendard', 'sans-serif'],
            },
            colors: {
                brand: {
                    red: '#6A131C',
                    yellow: '#F6FE51',
                }
            }
        },
    },
    plugins: [],
}
