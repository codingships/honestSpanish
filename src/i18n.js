import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import es from './locales/es';
import en from './locales/en';
import ru from './locales/ru';

i18n
    .use(initReactI18next)
    .init({
        resources: {
            es: { translation: es },
            en: { translation: en },
            ru: { translation: ru },
        },
        lng: 'es', // default language
        fallbackLng: 'es',
        interpolation: {
            escapeValue: false, // React already escapes values
        },
    });

export default i18n;
