import typography from '@tailwindcss/typography';

const campusColors = {
    canvas: '#E0F7FA',
    ink: '#006064',
    inkDark: '#004d40',
    red: '#6A131C',
    redHover: '#8A1924',
    yellow: '#F6FE51',
    mint: '#F0FDFA',
    googleBlue: '#4285F4',
    googleBlueDark: '#3367D6',
};

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
                },
                campus: campusColors,
            },
            boxShadow: {
                'campus-offset': `4px 4px 0px 0px ${campusColors.ink}`,
                'campus-modal': `8px 8px 0px 0px ${campusColors.ink}`,
            },
        },
    },
    plugins: [
        typography,
    ],
}
