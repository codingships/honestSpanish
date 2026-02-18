export interface Env {
    APP_URL: string;
    CRON_SECRET: string;
}

export default {
    async scheduled(
        controller: ScheduledController,
        env: Env,
        _ctx: ExecutionContext
    ): Promise<void> {
        console.log('Cron trigger fired at:', new Date().toISOString());

        try {
            const response = await fetch(`${env.APP_URL}/api/cron/send-reminders`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${env.CRON_SECRET}`,
                    'Content-Type': 'application/json',
                },
            });

            const result = await response.json();
            console.log('Reminder cron result:', result);

            if (!response.ok) {
                console.error('Reminder cron failed:', response.status, result);
            }
        } catch (error) {
            console.error('Reminder cron error:', error);
        }
    },

    // Handler para testing manual via HTTP
    async fetch(request: Request, env: Env): Promise<Response> {
        const url = new URL(request.url);

        if (url.pathname === '/test') {
            // Ejecutar manualmente para testing
            await this.scheduled({} as ScheduledController, env, {} as ExecutionContext);
            return new Response('Cron executed manually', { status: 200 });
        }

        return new Response('Reminder Cron Worker. Use /test to trigger manually.', { status: 200 });
    },
};
