import type { FC } from 'react';
// import { useTranslations } from '../../i18n/utils';

// 1. CONTRACT (Define this first!)
export interface __ComponentName__Props {
    title: string;
    // Add strict types here
}

// 2. COMPONENT (Implement second)
export const __ComponentName__: FC<__ComponentName__Props> = ({ title }) => {
    // const t = useTranslations('es'); 

    return (
        <div className="p-4">
            {/* 3. CONTENT (Use keys, not strings) */}
            <h1>{title}</h1>
        </div>
    );
};
