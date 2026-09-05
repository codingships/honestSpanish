import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initializePhotoCarousel, PHOTO_ROTATION_DELAY, PHOTO_TRANSITION_DURATION } from '../../src/lib/photo-carousel';

const cities = ['Valencia', 'Bilbao', 'Sevilla', 'Oviedo'];
let reducedMotion = true;
let visibilityState: DocumentVisibilityState = 'visible';
let disconnect: (() => void) | undefined;
let intersections: Array<{ callback: IntersectionObserverCallback; observer: IntersectionObserver }>;
let observerDisconnects: Array<ReturnType<typeof vi.fn>>;

function makeCarousel({ firstComplete = true, firstFailed = false } = {}) {
    const root = document.createElement('section');
    root.dataset.currentPhoto = '0';
    root.dataset.errorMessage = 'The photo could not load. You can try again.';
    root.innerHTML = `
        <div data-photo-viewport>
            ${cities.map((city, index) => `
                <figure data-photo-slide data-city="${city}" aria-label="${index + 1} / 4 — ${city}"
                    aria-hidden="${index !== 0}" ${index !== 0 ? 'hidden' : ''}>
                    <img alt="${city}" ${index === 0
                        ? 'src="/valencia-768.webp" srcset="/valencia-480.webp 480w, /valencia-768.webp 768w"'
                        : `data-src="/${city.toLowerCase()}-768.webp" data-srcset="/${city.toLowerCase()}-480.webp 480w, /${city.toLowerCase()}-768.webp 768w"`}>
                </figure>
            `).join('')}
        </div>
        <div data-photo-controls hidden>
            ${cities.map((city, index) => `
                <button type="button" data-photo-indicator="${index}" aria-current="${index === 0}"
                    aria-label="Show ${city}"></button>
            `).join('')}
            <button type="button" data-photo-toggle data-play-label="Play photos" data-pause-label="Pause photos"
                aria-label="Pause photos"></button>
        </div>
        <p data-photo-error hidden>Try again</p>
        <p data-photo-status aria-live="polite"></p>
    `;
    document.body.appendChild(root);
    const slides = Array.from(root.querySelectorAll<HTMLElement>('[data-photo-slide]'));
    const images = Array.from(root.querySelectorAll('img'));
    const complete = images.map((_, index) => index === 0 && firstComplete);
    images.forEach((img, index) => {
        Object.defineProperties(img, {
            complete: { configurable: true, get: () => complete[index] },
            naturalWidth: { configurable: true, get: () => complete[index] && !(index === 0 && firstFailed) ? 768 : 0 },
            decode: { configurable: true, value: vi.fn().mockResolvedValue(undefined) },
        });
    });
    disconnect = initializePhotoCarousel(root);
    const intersection = intersections.at(-1);
    return {
        root,
        slides,
        images,
        complete,
        indicators: Array.from(root.querySelectorAll<HTMLButtonElement>('[data-photo-indicator]')),
        toggle: root.querySelector<HTMLButtonElement>('[data-photo-toggle]')!,
        controls: root.querySelector<HTMLElement>('[data-photo-controls]')!,
        viewport: root.querySelector<HTMLElement>('[data-photo-viewport]')!,
        status: root.querySelector<HTMLElement>('[data-photo-status]')!,
        error: root.querySelector<HTMLElement>('[data-photo-error]')!,
        visible(ratio = 1) {
            intersection?.callback([
                {
                    target: root,
                    isIntersecting: ratio > 0,
                    intersectionRatio: ratio,
                    boundingClientRect: root.getBoundingClientRect(),
                    intersectionRect: root.getBoundingClientRect(),
                    rootBounds: null,
                    time: performance.now(),
                },
            ], intersection.observer);
        },
        async loaded(index: number) {
            complete[index] = true;
            images[index].dispatchEvent(new Event('load'));
            await vi.advanceTimersByTimeAsync(0);
        },
    };
}

function key(target: HTMLElement, name: string, options: KeyboardEventInit = {}) {
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...options });
    target.dispatchEvent(event);
    return event;
}

function pointer(target: HTMLElement, type: string, x: number, y: number, options: Record<string, unknown> = {}) {
    // PointerEvent is not implemented in every jsdom version. Supply only the
    // pointer data used by the controller while retaining real DOM events.
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.assign(event, { clientX: x, clientY: y, pointerId: 1, pointerType: 'touch', isPrimary: true, button: 0, ...options });
    target.dispatchEvent(event);
    return event;
}

function visibility(value: DocumentVisibilityState) {
    visibilityState = value;
    document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
    vi.useFakeTimers();
    reducedMotion = true;
    visibilityState = 'visible';
    intersections = [];
    observerDisconnects = [];
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibilityState);
    vi.spyOn(document, 'hidden', 'get').mockImplementation(() => visibilityState === 'hidden');
    vi.stubGlobal('matchMedia', vi.fn((query: string) => ({
        get matches() { return reducedMotion; },
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })));
    vi.stubGlobal('IntersectionObserver', class {
        observe = vi.fn();
        unobserve = vi.fn();
        disconnect = vi.fn();
        constructor(callback: IntersectionObserverCallback) {
            intersections.push({ callback, observer: this as unknown as IntersectionObserver });
            observerDisconnects.push(this.disconnect);
        }
    });
});

afterEach(async () => {
    disconnect?.();
    disconnect = undefined;
    await vi.advanceTimersByTimeAsync(0);
    document.body.replaceChildren();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('progressively enhanced photo carousel', () => {
    it('reveals dot controls without assigning deferred URLs and starts paused for reduced motion', async () => {
        const carousel = makeCarousel();
        carousel.visible();
        expect(carousel.controls.hidden).toBe(false);
        expect(carousel.toggle).toHaveAttribute('aria-label', 'Play photos');
        expect(carousel.images.filter((img) => img.hasAttribute('src'))).toHaveLength(1);
        expect(carousel.images.filter((img) => img.hasAttribute('srcset'))).toHaveLength(1);
        expect(carousel.slides.map((slide) => slide.hidden)).toEqual([false, true, true, true]);
        expect(carousel.indicators.map((button) => button.getAttribute('aria-current'))).toEqual(['true', 'false', 'false', 'false']);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(carousel.root.dataset.currentPhoto).toBe('0');
        expect(carousel.images.filter((img) => img.hasAttribute('src'))).toHaveLength(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('leaves incomplete markup inert and returns a safe cleanup function', () => {
        const root = document.createElement('section');
        root.innerHTML = '<div data-photo-controls hidden></div><figure data-photo-slide></figure>';
        const cleanup = initializePhotoCarousel(root);
        expect(root.querySelector<HTMLElement>('[data-photo-controls]')!.hidden).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
        expect(cleanup).not.toThrow();
    });

    it('requests only the exact selected photo and updates its accessible dot after loading', async () => {
        const carousel = makeCarousel();
        carousel.indicators[2].focus();
        carousel.indicators[2].click();
        expect(carousel.images[2]).toHaveAttribute('src', '/sevilla-768.webp');
        expect(carousel.images[2]).toHaveAttribute('srcset', '/sevilla-480.webp 480w, /sevilla-768.webp 768w');
        expect(carousel.images[1]).not.toHaveAttribute('src');
        expect(carousel.images[3]).not.toHaveAttribute('src');
        await carousel.loaded(2);
        expect(carousel.root.dataset.currentPhoto).toBe('2');
        expect(carousel.status.textContent).toBe('3 / 4 — Sevilla');
        expect(carousel.indicators.map((button) => button.getAttribute('aria-current'))).toEqual(['false', 'false', 'true', 'false']);
        expect(carousel.slides[0]).toHaveAttribute('aria-hidden', 'true');
        expect(carousel.slides[2]).toHaveAttribute('aria-hidden', 'false');
        expect(carousel.slides.map((slide) => slide.hidden)).toEqual([true, true, false, true]);
        expect(document.activeElement).toBe(carousel.indicators[2]);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('does not reload the current photo when its dot is selected', async () => {
        const carousel = makeCarousel();
        carousel.indicators[0].click();
        await vi.advanceTimersByTimeAsync(0);
        expect(carousel.images[0].decode).not.toHaveBeenCalled();
        expect(carousel.images.filter((img) => img.hasAttribute('src'))).toHaveLength(1);
        expect(carousel.root.dataset.currentPhoto).toBe('0');
    });

    it('supports local arrows, Home and End without intercepting modifiers or page keys', async () => {
        const carousel = makeCarousel();
        expect(key(document.body, 'ArrowRight').defaultPrevented).toBe(false);
        expect(key(carousel.indicators[0], 'ArrowRight', { ctrlKey: true }).defaultPrevented).toBe(false);
        expect(key(carousel.indicators[0], 'Tab').defaultPrevented).toBe(false);
        expect(carousel.images[1]).not.toHaveAttribute('src');
        expect(key(carousel.indicators[0], 'ArrowLeft').defaultPrevented).toBe(true);
        await carousel.loaded(3);
        expect(carousel.root.dataset.currentPhoto).toBe('3');
        key(carousel.indicators[0], 'ArrowRight');
        await vi.advanceTimersByTimeAsync(0);
        expect(carousel.root.dataset.currentPhoto).toBe('0');
        key(carousel.indicators[0], 'ArrowRight');
        await carousel.loaded(1);
        expect(carousel.root.dataset.currentPhoto).toBe('1');
        key(carousel.indicators[0], 'End');
        await vi.advanceTimersByTimeAsync(0);
        expect(carousel.root.dataset.currentPhoto).toBe('3');
        key(carousel.indicators[0], 'Home');
        await vi.advanceTimersByTimeAsync(0);
        expect(carousel.root.dataset.currentPhoto).toBe('0');
    });

    it('keeps the current photo visible and dots focusable while loading, ignoring competing requests', async () => {
        const carousel = makeCarousel();
        carousel.indicators[1].focus();
        carousel.indicators[1].click();
        expect(carousel.root).toHaveAttribute('aria-busy', 'true');
        carousel.indicators.forEach((button) => {
            expect(button).toHaveAttribute('aria-disabled', 'true');
            expect(button.disabled).toBe(false);
        });
        expect(carousel.toggle.disabled).toBe(false);
        expect(carousel.toggle).not.toHaveAttribute('aria-disabled', 'true');
        expect(document.activeElement).toBe(carousel.indicators[1]);
        expect(carousel.root.dataset.currentPhoto).toBe('0');
        expect(carousel.slides.map((slide) => slide.hidden)).toEqual([false, true, true, true]);
        key(carousel.root, 'End');
        carousel.indicators[3].click();
        expect(carousel.images[3]).not.toHaveAttribute('src');
        await carousel.loaded(1);
        expect(carousel.root).toHaveAttribute('aria-busy', 'false');
        carousel.indicators.forEach((button) => expect(button).toHaveAttribute('aria-disabled', 'false'));
    });

    it('waits for decode before revealing the requested photo', async () => {
        const carousel = makeCarousel();
        let resolveDecode!: () => void;
        vi.mocked(carousel.images[1].decode).mockReturnValue(new Promise<void>((resolve) => { resolveDecode = resolve; }));
        carousel.indicators[1].click();
        await carousel.loaded(1);
        expect(carousel.slides[0].hidden).toBe(false);
        expect(carousel.slides[1].hidden).toBe(true);
        expect(carousel.root.dataset.currentPhoto).toBe('0');
        resolveDecode();
        await vi.advanceTimersByTimeAsync(0);
        expect(carousel.slides[1].hidden).toBe(false);
        expect(carousel.root.dataset.currentPhoto).toBe('1');
    });

    it('preserves the current image on error and lets the same photo be retried', async () => {
        const carousel = makeCarousel();
        carousel.indicators[1].click();
        carousel.images[1].dispatchEvent(new Event('error'));
        await vi.advanceTimersByTimeAsync(0);
        expect(carousel.root.dataset.currentPhoto).toBe('0');
        expect(carousel.slides[0].hidden).toBe(false);
        expect(carousel.error.hidden).toBe(false);
        expect(carousel.status.textContent).toBe(carousel.root.dataset.errorMessage);
        expect(carousel.images[1].dataset.src).toBe('/bilbao-768.webp');
        expect(carousel.indicators[1]).toHaveAttribute('aria-disabled', 'false');
        expect(vi.getTimerCount()).toBe(0);
        carousel.indicators[1].click();
        expect(carousel.error.hidden).toBe(true);
        expect(carousel.status.textContent).toBe('');
        await carousel.loaded(1);
        expect(carousel.root.dataset.currentPhoto).toBe('1');
        expect(carousel.error.hidden).toBe(true);
    });

    it('recovers from decode errors without clearing the visible photo', async () => {
        const carousel = makeCarousel();
        vi.mocked(carousel.images[1].decode).mockRejectedValue(new Error('Invalid image'));
        carousel.indicators[1].click();
        await carousel.loaded(1);
        expect(carousel.root.dataset.currentPhoto).toBe('0');
        expect(carousel.slides[0].hidden).toBe(false);
        expect(carousel.error.hidden).toBe(false);
        expect(carousel.indicators[1]).toHaveAttribute('aria-disabled', 'false');
    });

    it('bounds a hung decoder and ignores a late decode result after timing out', async () => {
        const carousel = makeCarousel();
        let resolveDecode!: () => void;
        vi.mocked(carousel.images[1].decode).mockReturnValue(new Promise<void>((resolve) => { resolveDecode = resolve; }));
        carousel.indicators[1].click();
        await carousel.loaded(1);
        await vi.advanceTimersByTimeAsync(11_999);
        expect(carousel.error.hidden).toBe(true);
        expect(carousel.indicators[1]).toHaveAttribute('aria-disabled', 'true');
        await vi.advanceTimersByTimeAsync(1);
        expect(carousel.root.dataset.currentPhoto).toBe('0');
        expect(carousel.slides[0].hidden).toBe(false);
        expect(carousel.error.hidden).toBe(false);
        expect(carousel.indicators[1]).toHaveAttribute('aria-disabled', 'false');
        expect(vi.getTimerCount()).toBe(0);
        resolveDecode();
        await vi.advanceTimersByTimeAsync(0);
        expect(carousel.root.dataset.currentPhoto).toBe('0');
        vi.mocked(carousel.images[1].decode).mockResolvedValue(undefined);
        carousel.indicators[1].click();
        await vi.advanceTimersByTimeAsync(0);
        expect(carousel.root.dataset.currentPhoto).toBe('1');
        expect(carousel.error.hidden).toBe(true);
    });

    it('times out a missing image, ignores its late load and permits retry', async () => {
        const carousel = makeCarousel();
        carousel.indicators[1].click();
        await vi.advanceTimersByTimeAsync(11_999);
        expect(carousel.error.hidden).toBe(true);
        expect(carousel.indicators[1]).toHaveAttribute('aria-disabled', 'true');
        await vi.advanceTimersByTimeAsync(1);
        expect(carousel.error.hidden).toBe(false);
        expect(carousel.indicators[1]).toHaveAttribute('aria-disabled', 'false');
        await carousel.loaded(1);
        expect(carousel.root.dataset.currentPhoto).toBe('0');
        carousel.indicators[1].click();
        await vi.advanceTimersByTimeAsync(0);
        expect(carousel.root.dataset.currentPhoto).toBe('1');
    });

    it('finishes immediately with reduced motion and never starts an animation timer', async () => {
        const carousel = makeCarousel();
        carousel.indicators[1].click();
        await carousel.loaded(1);
        expect(window.matchMedia).toHaveBeenCalledWith('(prefers-reduced-motion: reduce)');
        expect(carousel.slides[0].hidden).toBe(true);
        expect(carousel.slides[1].classList.contains('is-entering')).toBe(false);
        expect(carousel.indicators[1]).toHaveAttribute('aria-disabled', 'false');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('keeps the outgoing photo painted until the gentle fade completes', async () => {
        reducedMotion = false;
        const carousel = makeCarousel();
        carousel.indicators[1].click();
        await carousel.loaded(1);
        expect(PHOTO_TRANSITION_DURATION).toBe(600);
        expect(carousel.slides[0].hidden).toBe(false);
        expect(carousel.slides[0]).toHaveAttribute('aria-hidden', 'true');
        expect(carousel.slides[1].classList.contains('is-entering')).toBe(true);
        expect(carousel.indicators[1]).toHaveAttribute('aria-disabled', 'true');
        await vi.advanceTimersByTimeAsync(PHOTO_TRANSITION_DURATION - 1);
        expect(carousel.slides[0].hidden).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(carousel.slides[0].hidden).toBe(true);
        expect(carousel.slides[1].classList.contains('is-entering')).toBe(false);
        expect(carousel.indicators[1]).toHaveAttribute('aria-disabled', 'false');
        await vi.advanceTimersByTimeAsync(60_000);
        expect(carousel.root.dataset.currentPhoto).toBe('1');
        expect(vi.getTimerCount()).toBe(0);
    });

    it('cleans up pending decoding without exposing a late image or leaving timers behind', async () => {
        const carousel = makeCarousel();
        let resolveDecode!: () => void;
        vi.mocked(carousel.images[1].decode).mockReturnValue(new Promise<void>((resolve) => { resolveDecode = resolve; }));
        carousel.indicators[1].click();
        await carousel.loaded(1);
        disconnect?.();
        await vi.advanceTimersByTimeAsync(0);
        expect(vi.getTimerCount()).toBe(0);
        expect(carousel.controls.hidden).toBe(true);
        resolveDecode();
        await vi.advanceTimersByTimeAsync(0);
        expect(carousel.root.dataset.currentPhoto).toBe('0');
        expect(carousel.slides[0].hidden).toBe(false);
        expect(carousel.slides[1].hidden).toBe(true);
        expect(carousel.error.hidden).toBe(true);
    });

    it('cleans up requests, observation and all interaction listeners', async () => {
        const carousel = makeCarousel();
        carousel.indicators[1].click();
        disconnect?.();
        await vi.advanceTimersByTimeAsync(0);
        expect(carousel.controls.hidden).toBe(true);
        expect(carousel.root).toHaveAttribute('aria-busy', 'false');
        expect(vi.getTimerCount()).toBe(0);
        expect(observerDisconnects.every((spy) => spy.mock.calls.length > 0)).toBe(true);
        await carousel.loaded(1);
        carousel.indicators[3].click();
        carousel.toggle.click();
        key(carousel.root, 'End');
        pointer(carousel.viewport, 'pointerdown', 100, 100);
        pointer(carousel.viewport, 'pointerup', 10, 100);
        carousel.visible();
        visibility('hidden');
        visibility('visible');
        await vi.advanceTimersByTimeAsync(60_000);
        expect(carousel.root.dataset.currentPhoto).toBe('0');
        expect(carousel.images[3]).not.toHaveAttribute('src');
        expect(carousel.status.textContent).toBe('');
        expect(carousel.error.hidden).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
    });

    it('normalizes an interrupted fade and can be reinitialized without duplicate handlers', async () => {
        reducedMotion = false;
        const carousel = makeCarousel();
        carousel.indicators[1].click();
        await carousel.loaded(1);
        disconnect?.();
        expect(carousel.slides.map((slide) => slide.hidden)).toEqual([true, false, true, true]);
        expect(carousel.slides[1].classList.contains('is-entering')).toBe(false);
        expect(vi.getTimerCount()).toBe(0);
        reducedMotion = true;
        disconnect = initializePhotoCarousel(carousel.root);
        expect(carousel.controls.hidden).toBe(false);
        carousel.indicators[2].click();
        await carousel.loaded(2);
        expect(carousel.root.dataset.currentPhoto).toBe('2');
        expect(carousel.images[3]).not.toHaveAttribute('src');
    });

    it('navigates deliberate horizontal touch gestures in both directions', async () => {
        const carousel = makeCarousel();
        pointer(carousel.viewport, 'pointerdown', 150, 100);
        const horizontal = pointer(carousel.viewport, 'pointerup', 70, 108);
        expect(horizontal.defaultPrevented).toBe(false);
        expect(carousel.images[1]).toHaveAttribute('src', '/bilbao-768.webp');
        await carousel.loaded(1);
        pointer(carousel.viewport, 'pointerdown', 70, 100);
        pointer(carousel.viewport, 'pointerup', 150, 108);
        await vi.advanceTimersByTimeAsync(0);
        expect(carousel.root.dataset.currentPhoto).toBe('0');
    });

    it.each([
        { name: 'vertical scrolling', endX: 70, endY: 200, options: {} },
        { name: 'diagonal scrolling', endX: 90, endY: 155, options: {} },
        { name: 'small movements', endX: 115, endY: 100, options: {} },
        { name: 'mouse drags', endX: 70, endY: 100, options: { pointerType: 'mouse' } },
        { name: 'secondary pointers', endX: 70, endY: 100, options: { isPrimary: false } },
    ])('does not intercept $name', async ({ endX, endY, options }) => {
        const carousel = makeCarousel();
        const down = pointer(carousel.viewport, 'pointerdown', 150, 100, options);
        const up = pointer(carousel.viewport, 'pointerup', endX, endY, options);
        await vi.advanceTimersByTimeAsync(0);
        expect(down.defaultPrevented).toBe(false);
        expect(up.defaultPrevented).toBe(false);
        expect(carousel.images[1]).not.toHaveAttribute('src');
        expect(carousel.root.dataset.currentPhoto).toBe('0');
    });

    it('ignores a canceled gesture and does not combine different pointer identities', () => {
        const carousel = makeCarousel();
        pointer(carousel.viewport, 'pointerdown', 150, 100);
        pointer(carousel.viewport, 'pointerup', 70, 100, { pointerId: 2 });
        expect(carousel.images[1]).not.toHaveAttribute('src');
        pointer(carousel.viewport, 'pointercancel', 100, 100);
        pointer(carousel.viewport, 'pointerup', 70, 100);
        expect(carousel.images[1]).not.toHaveAttribute('src');
        expect(carousel.root.dataset.currentPhoto).toBe('0');
    });
});

describe('automatic photo rotation', () => {
    beforeEach(() => { reducedMotion = false; });

    it('can recover by rotating when the first image failed before initialization', async () => {
        const carousel = makeCarousel({ firstFailed: true });
        expect(carousel.images[0].complete).toBe(true);
        expect(carousel.images[0].naturalWidth).toBe(0);
        carousel.visible();
        await vi.advanceTimersByTimeAsync(PHOTO_ROTATION_DELAY);
        expect(carousel.images[1]).toHaveAttribute('src', '/bilbao-768.webp');
        await carousel.loaded(1);
        await vi.advanceTimersByTimeAsync(PHOTO_TRANSITION_DURATION);
        expect(carousel.root.dataset.currentPhoto).toBe('1');
        expect(carousel.slides[1].hidden).toBe(false);
    });

    it('waits for the first photo and at least one quarter of the frame to be visible', async () => {
        const carousel = makeCarousel({ firstComplete: false });
        expect(PHOTO_ROTATION_DELAY).toBe(5_000);
        expect(carousel.toggle).toHaveAttribute('aria-label', 'Pause photos');
        carousel.visible();
        await vi.advanceTimersByTimeAsync(20_000);
        expect(carousel.images[1]).not.toHaveAttribute('src');
        carousel.visible(0.24);
        await carousel.loaded(0);
        await vi.advanceTimersByTimeAsync(20_000);
        expect(carousel.images[1]).not.toHaveAttribute('src');
        carousel.visible(0.25);
        await vi.advanceTimersByTimeAsync(PHOTO_ROTATION_DELAY - 1);
        expect(carousel.images[1]).not.toHaveAttribute('src');
        await vi.advanceTimersByTimeAsync(1);
        expect(carousel.images[1]).toHaveAttribute('src', '/bilbao-768.webp');
        expect(carousel.images[2]).not.toHaveAttribute('src');
        expect(carousel.images[3]).not.toHaveAttribute('src');
    });

    it('advances through one requested photo at a time and waits until the fade completes', async () => {
        const carousel = makeCarousel();
        carousel.visible();
        await vi.advanceTimersByTimeAsync(PHOTO_ROTATION_DELAY);
        expect(carousel.root.dataset.currentPhoto).toBe('0');
        expect(carousel.images[1]).toHaveAttribute('src');
        await carousel.loaded(1);
        expect(carousel.root.dataset.currentPhoto).toBe('1');
        expect(carousel.status.textContent).toBe('');
        await vi.advanceTimersByTimeAsync(PHOTO_TRANSITION_DURATION + PHOTO_ROTATION_DELAY - 1);
        expect(carousel.images[2]).not.toHaveAttribute('src');
        await vi.advanceTimersByTimeAsync(1);
        expect(carousel.images[2]).toHaveAttribute('src', '/sevilla-768.webp');
        expect(carousel.images[3]).not.toHaveAttribute('src');
        await carousel.loaded(2);
        await vi.advanceTimersByTimeAsync(PHOTO_TRANSITION_DURATION + PHOTO_ROTATION_DELAY);
        await carousel.loaded(3);
        expect(carousel.root.dataset.currentPhoto).toBe('3');
        await vi.advanceTimersByTimeAsync(PHOTO_TRANSITION_DURATION + PHOTO_ROTATION_DELAY);
        expect(carousel.root.dataset.currentPhoto).toBe('0');
    });

    it('suspends while outside the viewport and restarts the delay after returning', async () => {
        const carousel = makeCarousel();
        carousel.visible();
        await vi.advanceTimersByTimeAsync(4_000);
        carousel.visible(0);
        await vi.advanceTimersByTimeAsync(20_000);
        expect(carousel.images[1]).not.toHaveAttribute('src');
        carousel.visible();
        await vi.advanceTimersByTimeAsync(PHOTO_ROTATION_DELAY - 1);
        expect(carousel.images[1]).not.toHaveAttribute('src');
        await vi.advanceTimersByTimeAsync(1);
        expect(carousel.images[1]).toHaveAttribute('src');
    });

    it('suspends in a hidden document and resumes only after the page becomes visible', async () => {
        const carousel = makeCarousel();
        carousel.visible();
        visibility('hidden');
        await vi.advanceTimersByTimeAsync(20_000);
        expect(carousel.images[1]).not.toHaveAttribute('src');
        visibility('visible');
        await vi.advanceTimersByTimeAsync(PHOTO_ROTATION_DELAY);
        expect(carousel.images[1]).toHaveAttribute('src');
    });

    it('temporarily suspends while a mouse pointer is over the frame', async () => {
        const carousel = makeCarousel();
        carousel.visible();
        pointer(carousel.root, 'pointerenter', 100, 100, { pointerType: 'mouse' });
        await vi.advanceTimersByTimeAsync(20_000);
        expect(carousel.images[1]).not.toHaveAttribute('src');
        pointer(carousel.root, 'pointerleave', 100, 100, { pointerType: 'mouse' });
        await vi.advanceTimersByTimeAsync(PHOTO_ROTATION_DELAY);
        expect(carousel.images[1]).toHaveAttribute('src');
    });

    it('does not permanently suspend rotation after a touch pointer enters', async () => {
        const carousel = makeCarousel();
        carousel.visible();
        pointer(carousel.root, 'pointerenter', 100, 100);
        await vi.advanceTimersByTimeAsync(PHOTO_ROTATION_DELAY);
        expect(carousel.images[1]).toHaveAttribute('src');
    });

    it('pauses when focus enters and does not restart on blur without explicit resume', async () => {
        const carousel = makeCarousel();
        carousel.visible();
        carousel.indicators[0].focus();
        carousel.indicators[0].blur();
        expect(carousel.toggle).toHaveAttribute('aria-label', 'Play photos');
        await vi.advanceTimersByTimeAsync(20_000);
        expect(carousel.images[1]).not.toHaveAttribute('src');
        carousel.toggle.click();
        expect(carousel.toggle).toHaveAttribute('aria-label', 'Pause photos');
        await vi.advanceTimersByTimeAsync(PHOTO_ROTATION_DELAY);
        expect(carousel.images[1]).toHaveAttribute('src');
    });

    it('preserves a pointer pause intention when focus enters before the click', async () => {
        const carousel = makeCarousel();
        carousel.visible();
        expect(carousel.toggle).toHaveAttribute('aria-label', 'Pause photos');
        pointer(carousel.toggle, 'pointerdown', 100, 100, { pointerType: 'mouse' });
        carousel.toggle.focus();
        carousel.toggle.dispatchEvent(new MouseEvent('click', { detail: 1, bubbles: true }));
        expect(carousel.toggle).toHaveAttribute('aria-label', 'Play photos');
        expect(carousel.toggle.dataset.paused).toBe('true');
        await vi.advanceTimersByTimeAsync(20_000);
        expect(carousel.images[1]).not.toHaveAttribute('src');
    });

    it('lets keyboard activation explicitly resume while focus remains within the controls', async () => {
        const carousel = makeCarousel();
        carousel.visible();
        carousel.toggle.focus();
        expect(carousel.toggle).toHaveAttribute('aria-label', 'Play photos');
        // Native Enter activation produces a click with detail 0.
        carousel.toggle.dispatchEvent(new MouseEvent('click', { detail: 0, bubbles: true }));
        expect(carousel.toggle).toHaveAttribute('aria-label', 'Pause photos');
        carousel.indicators[0].focus();
        await vi.advanceTimersByTimeAsync(PHOTO_ROTATION_DELAY);
        expect(carousel.images[1]).toHaveAttribute('src');
    });

    it.each(['dot', 'key', 'swipe'] as const)('pauses on a manual %s change until explicit resume', async (interaction) => {
        const carousel = makeCarousel();
        carousel.visible();
        if (interaction === 'dot') carousel.indicators[1].click();
        else if (interaction === 'key') key(carousel.root, 'ArrowRight');
        else {
            pointer(carousel.viewport, 'pointerdown', 150, 100);
            pointer(carousel.viewport, 'pointerup', 70, 108);
        }
        await carousel.loaded(1);
        await vi.advanceTimersByTimeAsync(PHOTO_TRANSITION_DURATION + 20_000);
        expect(carousel.toggle).toHaveAttribute('aria-label', 'Play photos');
        expect(carousel.root.dataset.currentPhoto).toBe('1');
        expect(carousel.images[2]).not.toHaveAttribute('src');
        carousel.toggle.click();
        await vi.advanceTimersByTimeAsync(PHOTO_ROTATION_DELAY);
        expect(carousel.images[2]).toHaveAttribute('src');
    });

    it('keeps pause available during an auto load and never reveals its late result after pausing', async () => {
        const carousel = makeCarousel();
        carousel.visible();
        await vi.advanceTimersByTimeAsync(PHOTO_ROTATION_DELAY);
        expect(carousel.root).toHaveAttribute('aria-busy', 'true');
        expect(carousel.toggle.disabled).toBe(false);
        expect(carousel.toggle).not.toHaveAttribute('aria-disabled', 'true');
        carousel.toggle.click();
        expect(carousel.toggle).toHaveAttribute('aria-label', 'Play photos');
        await carousel.loaded(1);
        await vi.advanceTimersByTimeAsync(PHOTO_TRANSITION_DURATION + 20_000);
        expect(carousel.root.dataset.currentPhoto).toBe('0');
        expect(carousel.slides[0].hidden).toBe(false);
        expect(carousel.slides[1].hidden).toBe(true);
        expect(carousel.root).toHaveAttribute('aria-busy', 'false');
        expect(vi.getTimerCount()).toBe(0);
        carousel.toggle.click();
        await vi.advanceTimersByTimeAsync(PHOTO_ROTATION_DELAY);
        expect(carousel.root.dataset.currentPhoto).toBe('1');
    });

    it('does not reveal an in-flight auto photo after the frame scrolls out of view', async () => {
        const carousel = makeCarousel();
        carousel.visible();
        await vi.advanceTimersByTimeAsync(PHOTO_ROTATION_DELAY);
        carousel.visible(0);
        await carousel.loaded(1);
        await vi.advanceTimersByTimeAsync(PHOTO_TRANSITION_DURATION);
        expect(carousel.root.dataset.currentPhoto).toBe('0');
        expect(carousel.slides[1].hidden).toBe(true);
        carousel.visible();
        await vi.advanceTimersByTimeAsync(PHOTO_ROTATION_DELAY);
        expect(carousel.root.dataset.currentPhoto).toBe('1');
    });

    it('allows deliberate resume with reduced motion but never fades between photos', async () => {
        reducedMotion = true;
        const carousel = makeCarousel();
        carousel.visible();
        carousel.toggle.click();
        await vi.advanceTimersByTimeAsync(PHOTO_ROTATION_DELAY);
        await carousel.loaded(1);
        expect(carousel.root.dataset.currentPhoto).toBe('1');
        expect(carousel.slides[0].hidden).toBe(true);
        expect(carousel.slides[1].classList.contains('is-entering')).toBe(false);
        expect(carousel.root).toHaveAttribute('aria-busy', 'false');
    });
});
