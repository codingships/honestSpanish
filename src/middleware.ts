import { defineMiddleware } from "astro:middleware";
import { createSupabaseServerClient } from "./lib/supabase-server";

export const onRequest = defineMiddleware(async (context, next) => {
    const supabase = createSupabaseServerClient(context);

    // We use getUser() to validate the session on the server side securely
    const { data: { user } } = await supabase.auth.getUser();

    const url = new URL(context.request.url);
    const path = url.pathname;

    // Extract language and path segments
    const pathSegments = path.split('/').filter(Boolean);
    const lang = pathSegments[0];

    if (!['es', 'en', 'ru'].includes(lang)) {
        // If not a localized path (e.g. assets, api, or root), just continue
        return next();
    }

    // Get user profile with role if logged in
    let userRole = 'student';
    if (user) {
        const { data: profile } = await supabase
            .from('profiles')
            .select('role')
            .eq('id', user.id)
            .single();
        userRole = profile?.role || 'student';
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
    if (pathSegments[1] === 'campus') {
        if (!user) {
            return context.redirect(`/${lang}/login`);
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
    if (pathSegments[1] === 'login') {
        if (user) {
            return context.redirect(getRoleBasedRedirect(userRole, lang));
        }
    }

    return next();
});
