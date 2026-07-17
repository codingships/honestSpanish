import { describe, expect, it } from 'vitest';
import { normalizeManualMeetingLink } from '../../src/lib/calendar/meeting-link';

describe('normalizeManualMeetingLink', () => {
    it('accepts blank values as null and normalizes HTTPS Google Meet links', () => {
        expect(normalizeManualMeetingLink('')).toEqual({ ok: true, value: null });
        expect(normalizeManualMeetingLink('  https://meet.google.com/abc-defg-hij  ')).toEqual({
            ok: true,
            value: 'https://meet.google.com/abc-defg-hij',
        });
    });

    it('rejects unsafe schemes, credentials and non-Google-Meet hosts', () => {
        expect(normalizeManualMeetingLink('javascript:alert(1)').ok).toBe(false);
        expect(normalizeManualMeetingLink('https://evil.example/class').ok).toBe(false);
        expect(normalizeManualMeetingLink('https://user:pass@meet.google.com/abc-defg-hij').ok).toBe(false);
    });
});
