/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
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
