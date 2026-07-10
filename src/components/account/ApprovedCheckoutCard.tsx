import { useState, type ComponentProps } from 'react';
import PricingModal from '../PricingModal';
import type { PackageDuration } from '../../lib/package-pricing';

interface ApprovedCheckoutCardProps {
    plan: {
        name: string;
        displayName: string;
        priceMonthlyCents: number;
        sessionsPerMonth: number;
        priceTotalsCents: Record<PackageDuration, number>;
        stripe_price_1m: string | null;
        stripe_price_3m: string | null;
        stripe_price_6m: string | null;
    };
    lang: 'es' | 'en' | 'ru';
    translations: ComponentProps<typeof PricingModal>['translations'];
}

const copy = {
    es: {
        approved: 'Tu plaza está aprobada',
        detail: 'Puedes contratar únicamente el plan revisado contigo. Stripe no realizará ningún cobro hasta que elijas el periodo y confirmes las condiciones.',
        action: 'Contratar plan aprobado',
    },
    en: {
        approved: 'Your place is approved',
        detail: 'You can purchase only the plan reviewed with you. Stripe will not charge anything until you choose the period and confirm the terms.',
        action: 'Purchase approved plan',
    },
    ru: {
        approved: 'Ваше место подтверждено',
        detail: 'Вы можете оформить только согласованный с вами план. Stripe ничего не спишет, пока вы не выберете срок и не подтвердите условия.',
        action: 'Оформить одобренный план',
    },
} as const;

export default function ApprovedCheckoutCard({ plan, lang, translations }: ApprovedCheckoutCardProps) {
    const [isOpen, setIsOpen] = useState(false);
    const t = copy[lang];

    return (
        <div className="space-y-4">
            <div>
                <p className="font-bold text-[#006064] text-lg">{t.approved}</p>
                <p className="mt-1 font-display text-2xl uppercase text-[#006064]">{plan.displayName}</p>
                <p className="mt-3 text-sm leading-6 text-[#006064]/70">{t.detail}</p>
            </div>
            <button
                type="button"
                onClick={() => setIsOpen(true)}
                className="w-full px-4 py-3 bg-[#006064] text-white font-bold uppercase text-sm border-2 border-[#006064] hover:bg-[#004d40] transition-colors"
            >
                {t.action}
            </button>
            <PricingModal
                isOpen={isOpen}
                onClose={() => setIsOpen(false)}
                plan={plan}
                lang={lang}
                isLoggedIn
                translations={translations}
            />
        </div>
    );
}
