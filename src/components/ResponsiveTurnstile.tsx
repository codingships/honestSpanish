import { forwardRef, useEffect, useRef, useState } from 'react';
import {
    Turnstile,
    type TurnstileInstance,
    type TurnstileProps,
    type WidgetSize,
} from '@marsidev/react-turnstile';

const NORMAL_TURNSTILE_MIN_WIDTH = 300;

export function turnstileSizeForWidth(
    width: number,
    requestedSize: WidgetSize = 'normal',
): WidgetSize {
    if (requestedSize === 'compact' || requestedSize === 'invisible') return requestedSize;
    return width >= NORMAL_TURNSTILE_MIN_WIDTH ? requestedSize : 'compact';
}

const ResponsiveTurnstile = forwardRef<TurnstileInstance, TurnstileProps>(function ResponsiveTurnstile(
    { options, ...props },
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
        <div ref={containerRef} className="flex w-full justify-center" data-responsive-turnstile-container>
            <Turnstile ref={ref} {...props} options={{ ...options, size }} />
        </div>
    );
});

export default ResponsiveTurnstile;
