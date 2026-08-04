import { forwardRef, useEffect, useRef, useState } from 'react';
import {
    Turnstile,
    type TurnstileInstance,
    type TurnstileProps,
    type WidgetSize,
} from '@marsidev/react-turnstile';

const NORMAL_TURNSTILE_MIN_WIDTH = 300;

const CspTurnstileContainer = forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
    function CspTurnstileContainer({ style: _inlineStyle, ...props }, ref) {
        return <div {...props} ref={ref} />;
    },
);

export function turnstileContainerClassName(size: WidgetSize): string {
    switch (size) {
        case 'compact':
            return 'h-[140px] w-[150px]';
        case 'flexible':
            return 'h-[65px] w-full min-w-[300px]';
        case 'invisible':
            return 'h-0 w-0 overflow-hidden';
        default:
            return 'h-[65px] w-[300px]';
    }
}

export function turnstileSizeForWidth(
    width: number,
    requestedSize: WidgetSize = 'normal',
): WidgetSize {
    if (requestedSize === 'compact' || requestedSize === 'invisible') return requestedSize;
    return width >= NORMAL_TURNSTILE_MIN_WIDTH ? requestedSize : 'compact';
}

const ResponsiveTurnstile = forwardRef<TurnstileInstance, TurnstileProps>(function ResponsiveTurnstile(
    { options, className, ...props },
    ref,
) {
    const containerRef = useRef<HTMLDivElement>(null);
    const requestedSize = options?.size ?? 'normal';
    const [size, setSize] = useState<WidgetSize>(() => turnstileSizeForWidth(0, requestedSize));

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const update = (width: number) => {
            setSize(turnstileSizeForWidth(width, requestedSize));
        };
        const measure = () => update(container.getBoundingClientRect().width);

        measure();
        if (typeof ResizeObserver === 'undefined') {
            window.addEventListener('resize', measure);
            return () => window.removeEventListener('resize', measure);
        }

        const observer = new ResizeObserver((entries) => {
            update(entries[0]?.contentRect.width ?? container.getBoundingClientRect().width);
        });
        observer.observe(container);
        return () => observer.disconnect();
    }, [requestedSize]);

    return (
        <div ref={containerRef} className="flex w-full min-w-0 max-w-full justify-center" data-responsive-turnstile-container>
            <Turnstile
                ref={ref}
                {...props}
                as={CspTurnstileContainer}
                className={`${turnstileContainerClassName(size)} ${className ?? ''}`.trim()}
                options={{ ...options, size }}
            />
        </div>
    );
});

export default ResponsiveTurnstile;
