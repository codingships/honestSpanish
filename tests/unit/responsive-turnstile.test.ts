import { describe, expect, it } from 'vitest';
import {
    turnstileContainerClassName,
    turnstileSizeForWidth,
} from '../../src/components/ResponsiveTurnstile';

describe('responsive Turnstile sizing', () => {
    it('uses the compact widget when the containing form is narrower than 300px', () => {
        expect(turnstileSizeForWidth(0)).toBe('compact');
        expect(turnstileSizeForWidth(299)).toBe('compact');
        expect(turnstileSizeForWidth(299, 'flexible')).toBe('compact');
    });

    it('preserves the requested presentation when the widget fits', () => {
        expect(turnstileSizeForWidth(300)).toBe('normal');
        expect(turnstileSizeForWidth(420, 'flexible')).toBe('flexible');
        expect(turnstileSizeForWidth(120, 'invisible')).toBe('invisible');
    });

    it('reserves each widget size with CSP-safe classes', () => {
        expect(turnstileContainerClassName('normal')).toBe('h-[65px] w-[300px]');
        expect(turnstileContainerClassName('compact')).toBe('h-[140px] w-[150px]');
        expect(turnstileContainerClassName('flexible')).toBe('h-[65px] w-full min-w-[300px]');
        expect(turnstileContainerClassName('invisible')).toBe('h-0 w-0 overflow-hidden');
    });
});
