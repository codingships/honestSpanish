export const PHOTO_ROTATION_DELAY = 5000;
export const PHOTO_TRANSITION_DURATION = 600;

/** Progressive photo rotation inside the original image frame. */
export function initializePhotoCarousel(root: HTMLElement): () => void {
    const slides = Array.from(root.querySelectorAll<HTMLElement>('[data-photo-slide]'));
    const controls = root.querySelector<HTMLElement>('[data-photo-controls]');
    const indicators = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-photo-indicator]'));
    const toggle = root.querySelector<HTMLButtonElement>('[data-photo-toggle]');
    const status = root.querySelector<HTMLElement>('[data-photo-status]');
    const error = root.querySelector<HTMLElement>('[data-photo-error]');
    const viewport = root.querySelector<HTMLElement>('[data-photo-viewport]');
    if (slides.length < 2 || !controls || indicators.length !== slides.length || !toggle || !viewport) {
        return () => {};
    }

    const lifecycle = new AbortController();
    const { signal } = lifecycle;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const firstImage = slides[0].querySelector('img');
    let current = Math.max(0, slides.findIndex((slide) => !slide.hidden));
    let busy = false;
    let userPaused = motion.matches;
    let hovered = root.matches(':hover') && window.matchMedia('(hover: hover)').matches;
    let inView = !('IntersectionObserver' in window);
    // A completed failure also releases rotation, just like the error listener below.
    let firstReady = Boolean(firstImage?.complete);
    let rotationTimer: ReturnType<typeof setTimeout> | undefined;
    let transitionTimer: ReturnType<typeof setTimeout> | undefined;
    let touchStart: { x: number; y: number; id: number } | undefined;
    let pointerToggleIntent: boolean | undefined;
    controls.hidden = false;

    const canRotate = () => !signal.aborted && !userPaused && !hovered && inView && firstReady && !document.hidden;
    const stopTimer = () => {
        clearTimeout(rotationTimer);
        rotationTimer = undefined;
    };
    const schedule = () => {
        stopTimer();
        const rotating = canRotate();
        root.dataset.rotation = userPaused ? 'paused' : rotating ? 'playing' : 'suspended';
        toggle.dataset.paused = String(userPaused);
        toggle.setAttribute('aria-label', (userPaused ? toggle.dataset.playLabel : toggle.dataset.pauseLabel) ?? '');
        status?.setAttribute('aria-live', rotating ? 'off' : 'polite');
        if (rotating && !busy) {
            rotationTimer = setTimeout(() => { void show(current + 1, false); }, PHOTO_ROTATION_DELAY);
        }
    };
    const pauseByUser = () => {
        userPaused = true;
        schedule();
    };

    const setBusy = (value: boolean) => {
        busy = value;
        indicators.forEach((indicator) => indicator.setAttribute('aria-disabled', String(value)));
        root.setAttribute('aria-busy', String(value));
    };

    const loadPhoto = (img: HTMLImageElement): Promise<void> => new Promise((resolve, reject) => {
        let settled = false;
        let decoding = false;
        const cleanup = () => {
            clearTimeout(timeout);
            img.removeEventListener('load', loaded);
            img.removeEventListener('error', failed);
            signal.removeEventListener('abort', aborted);
        };
        const complete = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve();
        };
        const failed = () => {
            if (settled) return;
            settled = true;
            cleanup();
            reject(new Error('Photo unavailable'));
        };
        const loaded = () => {
            if (decoding || settled) return;
            decoding = true;
            // The same timeout/abort covers both network and decoding.
            if (typeof img.decode === 'function') void img.decode().then(complete, failed);
            else complete();
        };
        const aborted = failed;
        const timeout = setTimeout(failed, 12000);
        img.addEventListener('load', loaded, { once: true });
        img.addEventListener('error', failed, { once: true });
        signal.addEventListener('abort', aborted, { once: true });
        if (img.hasAttribute('src') && img.complete && img.naturalWidth > 0) {
            loaded();
            return;
        }
        // Only request the exact destination, after a click or its rotation delay.
        // Keep data attributes so a failed request can be retried.
        if (img.dataset.srcset) img.srcset = img.dataset.srcset;
        if (img.dataset.src) img.src = img.dataset.src;
    });

    const show = async (requestedIndex: number, manual: boolean) => {
        if (busy || signal.aborted) return;
        const target = (requestedIndex + slides.length) % slides.length;
        if (target === current) return;
        const incoming = slides[target];
        const img = incoming.querySelector('img');
        if (!img) return;
        stopTimer();
        setBusy(true);
        if (error) error.hidden = true;
        if (status) status.textContent = '';
        try {
            await loadPhoto(img);
            if (signal.aborted) return;
            // A late automatic download must not change a photo the user paused.
            if (!manual && !canRotate()) {
                setBusy(false);
                schedule();
                return;
            }
            const outgoing = slides[current];
            incoming.hidden = false;
            incoming.setAttribute('aria-hidden', 'false');
            outgoing.setAttribute('aria-hidden', 'true');
            current = target;
            root.dataset.currentPhoto = String(current);
            indicators.forEach((indicator, index) => indicator.setAttribute('aria-current', String(index === current)));
            const finish = () => {
                outgoing.hidden = true;
                incoming.classList.remove('is-entering');
                setBusy(false);
                if (status && manual) status.textContent = incoming.getAttribute('aria-label') ?? '';
                schedule();
            };
            if (motion.matches) {
                finish();
            } else {
                incoming.classList.add('is-entering');
                transitionTimer = setTimeout(finish, PHOTO_TRANSITION_DURATION);
            }
        } catch {
            if (signal.aborted) return;
            if (error) error.hidden = false;
            setBusy(false);
            pauseByUser();
            if (status) status.textContent = root.dataset.errorMessage ?? '';
        }
    };

    indicators.forEach((indicator, index) => {
        indicator.addEventListener('click', () => {
            pauseByUser();
            void show(index, true);
        }, { signal });
    });
    toggle.addEventListener('pointerdown', (event) => {
        if (event.button === 0) pointerToggleIntent = !userPaused;
    }, { signal });
    toggle.addEventListener('pointercancel', () => { pointerToggleIntent = undefined; }, { signal });
    toggle.addEventListener('click', (event) => {
        // Pointer focus pauses first; preserve the intent of the label clicked.
        userPaused = event.detail > 0 && pointerToggleIntent !== undefined ? pointerToggleIntent : !userPaused;
        pointerToggleIntent = undefined;
        schedule();
    }, { signal });
    root.addEventListener('focusin', (event) => {
        if (!(event.relatedTarget instanceof Node) || !root.contains(event.relatedTarget)) pauseByUser();
    }, { signal });
    root.addEventListener('pointerenter', (event) => {
        if (event.pointerType !== 'mouse') return;
        hovered = true;
        schedule();
    }, { signal });
    root.addEventListener('pointerleave', (event) => {
        if (event.pointerType !== 'mouse') return;
        hovered = false;
        schedule();
    }, { signal });
    root.addEventListener('keydown', (event) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        const targets: Record<string, number> = {
            ArrowLeft: current - 1, ArrowRight: current + 1, Home: 0, End: slides.length - 1,
        };
        if (!(event.key in targets)) return;
        event.preventDefault();
        pauseByUser();
        void show(targets[event.key], true);
    }, { signal });
    viewport.addEventListener('pointerdown', (event) => {
        if (event.pointerType === 'mouse' || !event.isPrimary) return;
        touchStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
    }, { signal });
    viewport.addEventListener('pointerup', (event) => {
        if (!touchStart || event.pointerId !== touchStart.id) return;
        const dx = event.clientX - touchStart.x;
        const dy = event.clientY - touchStart.y;
        touchStart = undefined;
        if (Math.abs(dx) >= 48 && Math.abs(dx) > Math.abs(dy) * 1.3) {
            pauseByUser();
            void show(current + (dx < 0 ? 1 : -1), true);
        }
    }, { signal });
    viewport.addEventListener('pointercancel', () => { touchStart = undefined; }, { signal });

    document.addEventListener('visibilitychange', schedule, { signal });
    const motionChanged = () => {
        if (motion.matches) userPaused = true;
        schedule();
    };
    motion.addEventListener('change', motionChanged);
    const observer = 'IntersectionObserver' in window ? new IntersectionObserver((entries) => {
        const entry = entries.find((entry) => entry.target === root);
        if (!entry) return;
        inView = entry.isIntersecting && entry.intersectionRatio >= .25;
        schedule();
    }, { threshold: [0, .25] }) : undefined;
    observer?.observe(root);
    const firstLoaded = () => { firstReady = true; schedule(); };
    if (!firstReady) {
        firstImage?.addEventListener('load', firstLoaded, { once: true, signal });
        firstImage?.addEventListener('error', firstLoaded, { once: true, signal });
    }
    schedule();

    return () => {
        lifecycle.abort();
        stopTimer();
        observer?.disconnect();
        motion.removeEventListener('change', motionChanged);
        clearTimeout(transitionTimer);
        slides.forEach((slide, index) => {
            slide.hidden = index !== current;
            slide.setAttribute('aria-hidden', String(index !== current));
            slide.classList.remove('is-entering');
        });
        setBusy(false);
        controls.hidden = true;
    };
}
