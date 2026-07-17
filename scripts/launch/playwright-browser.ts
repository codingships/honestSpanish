import { chromium, type Browser } from 'playwright';

export interface LaunchBrowserResult {
    browser: Browser;
    label: string;
}

export async function launchChromiumForLaunch(): Promise<LaunchBrowserResult> {
    const errors: string[] = [];

    try {
        return {
            browser: await chromium.launch({ headless: true }),
            label: 'playwright chromium',
        };
    } catch (error) {
        errors.push(`playwright chromium: ${safeBrowserError(error)}`);
    }

    for (const channel of ['msedge', 'chrome'] as const) {
        try {
            return {
                browser: await chromium.launch({ channel, headless: true }),
                label: `system ${channel}`,
            };
        } catch (error) {
            errors.push(`${channel}: ${safeBrowserError(error)}`);
        }
    }

    throw new Error([
        'No Chromium-compatible browser was available for launch smoke checks.',
        'Install Playwright browsers with `pnpm exec playwright install chromium` or make Microsoft Edge/Chrome available on this machine.',
        `Attempts: ${errors.join(' | ')}`,
    ].join(' '));
}

function safeBrowserError(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.split('\n')[0] || 'unknown error';
}
