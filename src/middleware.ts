import { defineMiddleware } from "astro:middleware";
import { createSupabaseServerClient } from "./lib/supabase-server";
import { ADULT_ATTESTATION_REQUIRED_QUERY, hasVerifiedAdultAccount } from "./lib/adult-account";
import { readRuntimeEnv } from "./lib/runtime-env";

const BOOTSTRAP_DIAGNOSTIC_PATHS = new Set([
    '/health',
    '/api/internal/runtime-attestation',
]);

function inertProductionResponse(errorCode: string): Response {
    return new Response(JSON.stringify({ errorCode }), {
        status: 503,
        headers: {
            'Cache-Control': 'no-store',
            'Content-Type': 'application/json; charset=utf-8',
            'Retry-After': '300',
            'X-Content-Type-Options': 'nosniff',
            'X-Robots-Tag': 'noindex, nofollow, noarchive',
        },
    });
}

const handleApplicationRequest = defineMiddleware(async (context, next) => {
    const url = new URL(context.request.url);
    const path = url.pathname;

    if (readRuntimeEnv('PUBLIC_APP_ENV', context) === 'production') {
        const runtimeMode = readRuntimeEnv('WEB_RUNTIME_MODE', context);
        if (runtimeMode !== 'active') {
            if (BOOTSTRAP_DIAGNOSTIC_PATHS.has(path)) return next();
            return inertProductionResponse(
                runtimeMode === 'bootstrap' ? 'WEB_RUNTIME_BOOTSTRAP' : 'WEB_RUNTIME_INVALID',
            );
        }
    }

    // Extract language and path segments
    const pathSegments = path.split('/').filter(Boolean);
    const lang = pathSegments[0];

    if (!['es', 'en', 'ru'].includes(lang)) {
        // If not a localized path (e.g. assets, api, or root), just continue
        return next();
    }

    const routeSection = pathSegments[1];
    const isCampusRoute = routeSection === 'campus';
    const isLoginRoute = routeSection === 'login';

    // Public localized pages should not trigger auth lookups or cookie parsing.
    if (!isCampusRoute && !isLoginRoute) {
        return next();
    }

    const supabase = createSupabaseServerClient(context);

    // We use getUser() to validate the session on the server side securely
    const { data: { user } } = await supabase.auth.getUser();

    // Get user profile with role if logged in
    let userRole = 'student';
    let adultAccountVerified = false;
    let profileFound = false;
    if (user) {
        const { data: profile } = await supabase
            .from('profiles')
            .select('role, adult_confirmed, adult_confirmed_at, age_policy_version')
            .eq('id', user.id)
            .single();
        if (!profile) {
            console.error(`[Middleware] No profile found for authenticated user ${user.id}`);
        }
        profileFound = Boolean(profile);
        userRole = profile?.role || 'student';
        adultAccountVerified = userRole !== 'student' || hasVerifiedAdultAccount(profile);
    }

    // Helper to get redirect URL based on role
    const getRoleBasedRedirect = (role: string, langCode: string) => {
        switch (role) {
            case 'admin':
                return `/${langCode}/campus/admin`;
            case 'teacher':
                return `/${langCode}/campus/teacher`;
            default:
                return `/${langCode}/campus`;
        }
    };

    // Protected routes - require authentication
    if (isCampusRoute) {
        if (!user) {
            return context.redirect(`/${lang}/login`);
        }

        if (!profileFound) {
            await supabase.auth.signOut({ scope: 'local' });
            return context.redirect(`/${lang}/login?error=${ADULT_ATTESTATION_REQUIRED_QUERY}`);
        }

        if (!adultAccountVerified) {
            return context.redirect(`/${lang}/adult-confirmation`);
        }

        // Role-based access control
        const campusSubPath = pathSegments[2]; // e.g., "teacher", "admin", undefined

        // Teacher routes - only accessible by teacher or admin
        if (campusSubPath === 'teacher') {
            if (userRole !== 'teacher' && userRole !== 'admin') {
                return context.redirect(`/${lang}/campus`);
            }
        }

        // Admin routes - only accessible by admin
        if (campusSubPath === 'admin') {
            if (userRole !== 'admin') {
                return context.redirect(getRoleBasedRedirect(userRole, lang));
            }
        }
    }

    // Login route - redirect logged-in users to their area
    if (isLoginRoute) {
        if (user) {
            if (!profileFound) {
                await supabase.auth.signOut({ scope: 'local' });
                return next();
            }
            if (!adultAccountVerified) {
                return context.redirect(`/${lang}/adult-confirmation`);
            }
            return context.redirect(getRoleBasedRedirect(userRole, lang));
        }
    }

    return next();
});

export const onRequest = defineMiddleware(async (context, next) => {
    const response = await handleApplicationRequest(context, next);
    if (!response) {
        throw new Error('Application middleware returned no response');
    }
    const appEnvironment = readRuntimeEnv('PUBLIC_APP_ENV', context)?.trim().toLowerCase();

    if (appEnvironment === 'staging') {
        response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    }

    return response;
});
