import { defineMiddleware } from "astro:middleware";
import { isAuthApiError, isAuthSessionMissingError } from '@supabase/supabase-js';
import { createSupabaseServerClient } from "./lib/supabase-server";
import { ADULT_ATTESTATION_REQUIRED_QUERY, hasVerifiedAdultAccount } from "./lib/adult-account";
import { appendAuthReturnTo, sanitizeAuthReturnTo } from "./lib/auth-return-to";
import { ui } from './i18n/translations';
import { getLangFromParam } from './i18n/utils';
import { reportCampusReadError } from './lib/campus-load-state';
import { readRuntimeEnv } from "./lib/runtime-env";
import { applyHostedSecurityHeaders, normalizeRoutePathname } from "./lib/security-headers";

const BOOTSTRAP_DIAGNOSTIC_PATHS = new Set([
    '/health',
    '/api/internal/runtime-attestation',
]);
const LOCAL_APP_ENVIRONMENTS = new Set(['dev', 'development', 'local', 'test']);
const HOSTED_APP_ENVIRONMENTS = new Set(['staging', 'production']);
const CAMPUS_ROLES = new Set(['student', 'teacher', 'admin']);
const UNAUTHENTICATED_AUTH_CODES = new Set([
    'bad_jwt',
    'no_authorization',
    'refresh_token_already_used',
    'refresh_token_not_found',
    'session_expired',
    'session_not_found',
    'unexpected_audience',
    'user_banned',
    'user_not_found',
]);

function normalizedAppEnvironment(context: Parameters<typeof readRuntimeEnv>[1]): string | undefined {
    return readRuntimeEnv('PUBLIC_APP_ENV', context)?.trim().toLowerCase() || undefined;
}

function isAllowedLocalEnvironment(appEnvironment: string | undefined, requestUrl: URL): boolean {
    return Boolean(
        appEnvironment &&
        LOCAL_APP_ENVIRONMENTS.has(appEnvironment) &&
        (!import.meta.env.PROD || ['localhost', '127.0.0.1', '[::1]'].includes(requestUrl.hostname)),
    );
}

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

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (character) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    })[character] ?? character);
}

function campusUnavailableResponse(langParam: string, requestUrl: URL): Response {
    const lang = getLangFromParam(langParam);
    const copy = ui[lang].campus.loadError;
    const title = escapeHtml(copy.title);
    const message = escapeHtml(copy.message);
    const retry = escapeHtml(copy.retry);
    const retryHref = escapeHtml(`${requestUrl.pathname}${requestUrl.search}`);

    return new Response(`<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive">
<title>${title}</title>
</head>
<body>
<main>
<section role="alert" aria-atomic="true">
<h1>${title}</h1>
<p>${message}</p>
<a href="${retryHref}">${retry}</a>
</section>
</main>
</body>
</html>`, {
        status: 503,
        headers: {
            'Cache-Control': 'private, no-store',
            'Content-Type': 'text/html; charset=utf-8',
            'Retry-After': '30',
            'X-Robots-Tag': 'noindex, nofollow, noarchive',
        },
    });
}

function isUnauthenticatedAuthError(error: unknown): boolean {
    return isAuthSessionMissingError(error)
        || (
            isAuthApiError(error)
            && (error.status === 401 || error.status === 403)
            && typeof error.code === 'string'
            && UNAUTHENTICATED_AUTH_CODES.has(error.code)
        );
}

const handleApplicationRequest = defineMiddleware(async (context, next) => {
    const url = new URL(context.request.url);
    const path = normalizeRoutePathname(url.pathname);
    const returnTo = sanitizeAuthReturnTo(url.searchParams.get('returnTo'));

    const appEnvironment = normalizedAppEnvironment(context);
    const localEnvironmentIsAllowed = isAllowedLocalEnvironment(appEnvironment, url);
    if (!appEnvironment || (
        !localEnvironmentIsAllowed &&
        !HOSTED_APP_ENVIRONMENTS.has(appEnvironment)
    )) {
        return inertProductionResponse('PUBLIC_APP_ENV_INVALID');
    }

    if (appEnvironment === 'production') {
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
    const isLoginRoute = routeSection === 'login' && pathSegments.length === 2;

    // Public localized pages should not trigger auth lookups or cookie parsing.
    if (!isCampusRoute && !isLoginRoute) {
        return next();
    }

    const supabase = createSupabaseServerClient(context);

    // We use getUser() to validate the session on the server side securely
    const { data: { user: resolvedUser }, error: authError } = await supabase.auth.getUser();
    const authMeansUnauthenticated = authError !== null && isUnauthenticatedAuthError(authError);

    if (authError && !authMeansUnauthenticated) {
        reportCampusReadError('middleware.auth', authError);
        return campusUnavailableResponse(lang, url);
    }
    const user = authMeansUnauthenticated ? null : resolvedUser;

    // Get user profile with role if logged in
    let userRole = 'student';
    let adultAccountVerified = false;
    let profileFound = false;
    if (user) {
        const { data: profile, error: profileError } = await supabase
            .from('profiles')
            .select('role, adult_confirmed, adult_confirmed_at, age_policy_version')
            .eq('id', user.id)
            .maybeSingle();
        if (profileError) {
            reportCampusReadError('middleware.profile', profileError);
            return campusUnavailableResponse(lang, url);
        }
        if (profile && !CAMPUS_ROLES.has(profile.role ?? '')) {
            reportCampusReadError('middleware.profile', { code: 'PROFILE_ROLE_INVALID' });
            return campusUnavailableResponse(lang, url);
        }
        if (!profile) {
            reportCampusReadError('middleware.profile', { code: 'PROFILE_MISSING' });
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
                return context.redirect(appendAuthReturnTo(`/${lang}/adult-confirmation`, returnTo));
            }
            if (userRole === 'student' && returnTo) return context.redirect(returnTo);
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
    const appEnvironment = normalizedAppEnvironment(context);
    const requestUrl = new URL(context.request.url);
    const localEnvironmentIsAllowed = isAllowedLocalEnvironment(appEnvironment, requestUrl);

    // Unknown or missing environments fail closed above and receive the same
    // defensive headers as a hosted deployment. Only explicit local/test
    // environments may omit them.
    if (!localEnvironmentIsAllowed) {
        applyHostedSecurityHeaders(response, {
            pathname: requestUrl.pathname,
            secureTransport: requestUrl.protocol === 'https:',
        });
    }

    if (appEnvironment === 'staging') {
        response.headers.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    }

    return response;
});
