import type { Locator, Page } from 'playwright';
import type { DemoMode, SectionId, SensitiveGate, StepOutcome } from './shared';

export interface DemoRuntimeContext {
    page: Page;
    mode: DemoMode;
    goto(pathOrUrl: string): Promise<void>;
    refreshOverlay(status?: string): Promise<void>;
    loginAs(role: 'student' | 'teacher' | 'admin'): Promise<StepOutcome>;
    logout(): Promise<void>;
    visible(
        selectors: string[],
        okMessage: string,
        warningMessage?: string,
    ): Promise<StepOutcome>;
    optionalVisible(
        selectors: string[],
        okMessage: string,
        warningMessage: string,
    ): Promise<StepOutcome>;
    scrollTo(selector: string): Promise<void>;
    clickFirstVisible(selectors: string[]): Promise<boolean>;
    confirmSideEffect(gate: SensitiveGate, title: string, description: string): Promise<boolean>;
    screenshot(label: string): Promise<string | undefined>;
}

export interface DemoStep {
    id: string;
    section: SectionId;
    title: string;
    what: string;
    validate: string;
    risk: string;
    modes?: DemoMode[];
    sideEffect?: SensitiveGate;
    run(ctx: DemoRuntimeContext): Promise<StepOutcome | void>;
}

const allModes: DemoMode[] = ['safe', 'interactive', 'full', 'local'];
const realModes: DemoMode[] = ['interactive', 'full'];
const fullModes: DemoMode[] = ['full'];

export const DEMO_STEPS: DemoStep[] = [
    {
        id: 'public-home-es',
        section: 'public',
        title: 'Home en espanol',
        what: 'Abre la portada principal y presenta la propuesta comercial para estudiantes de espanol.',
        validate: 'La pagina carga, no redirige y hay un encabezado principal visible.',
        risk: 'Solo lectura.',
        modes: allModes,
        async run(ctx) {
            await ctx.goto('/es');
            return ctx.visible(['h1', 'main'], 'Portada ES cargada.');
        },
    },
    {
        id: 'public-home-en',
        section: 'public',
        title: 'Home en ingles',
        what: 'Muestra la version inglesa para validar el alcance internacional.',
        validate: 'La ruta /en carga con contenido publico visible.',
        risk: 'Solo lectura.',
        modes: allModes,
        async run(ctx) {
            await ctx.goto('/en');
            return ctx.visible(['h1', 'main'], 'Portada EN cargada.');
        },
    },
    {
        id: 'public-home-ru',
        section: 'public',
        title: 'Home en ruso',
        what: 'Muestra la version rusa y confirma que la localizacion esta publicada.',
        validate: 'La ruta /ru carga con contenido publico visible.',
        risk: 'Solo lectura.',
        modes: allModes,
        async run(ctx) {
            await ctx.goto('/ru');
            return ctx.visible(['h1', 'main'], 'Portada RU cargada.');
        },
    },
    {
        id: 'public-promise',
        section: 'public',
        title: 'Promesa comercial',
        what: 'Recorre el bloque hero y la promesa inicial antes de entrar en detalles.',
        validate: 'Hay un H1 y llamadas a accion visibles.',
        risk: 'Solo lectura.',
        modes: allModes,
        async run(ctx) {
            await ctx.goto('/es');
            return ctx.visible(
                ['a[href="#contacto"]', 'a[href*="#pricing"]', 'button:has-text("Seleccionar")', 'h1'],
                'La promesa y los CTAs publicos estan visibles.',
            );
        },
    },
    {
        id: 'public-method',
        section: 'public',
        title: 'Metodo',
        what: 'Explica la metodologia y los diferenciales de aprendizaje.',
        validate: 'El bloque #metodo existe y se puede enfocar durante la demo.',
        risk: 'Solo lectura.',
        modes: allModes,
        async run(ctx) {
            await ctx.goto('/es#metodo');
            await ctx.scrollTo('#metodo');
            return ctx.visible(['#metodo'], 'Seccion de metodo visible.');
        },
    },
    {
        id: 'public-pricing',
        section: 'public',
        title: 'Precios',
        what: 'Muestra paquetes, cuotas y disponibilidad de checkout.',
        validate: 'El bloque de precios y las tarjetas de plan estan visibles.',
        risk: 'Solo lectura; no se inicia pago en este paso.',
        modes: allModes,
        async run(ctx) {
            await ctx.goto('/es#pricing');
            await ctx.page.waitForTimeout(500);
            const pricingState = await ctx.page.evaluate(() => {
                const section = document.querySelector('#pricing, #planes');
                const card = document.querySelector('.pricing-plan-card, [data-testid^="select-plan-"]');
                const navLink = document.querySelector('a[href="#pricing"], a[href="#planes"]');

                if (section instanceof HTMLElement) {
                    section.scrollIntoView({ block: 'start' });
                } else if (card instanceof HTMLElement) {
                    card.scrollIntoView({ block: 'center' });
                }

                return {
                    hasSection: Boolean(section),
                    hasCard: Boolean(card),
                    hasNavLink: Boolean(navLink),
                    sectionText: section?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 120) || '',
                };
            });
            await ctx.refreshOverlay('Comprobacion de precios completada.');

            if (pricingState.hasSection || pricingState.hasCard) {
                return {
                    status: 'ok',
                    message: 'Precios visibles.',
                    details: [
                        pricingState.hasCard ? 'Hay tarjetas de plan.' : 'Hay seccion de precios.',
                        pricingState.sectionText,
                    ].filter(Boolean),
                };
            }

            return {
                status: 'warning',
                message: 'No se detecto bloque real de precios en esta ejecucion local.',
                details: [
                    pricingState.hasNavLink
                        ? 'Existe enlace de navegacion a planes, pero no la seccion de destino.'
                        : 'No existe enlace ni seccion de precios en el DOM renderizado.',
                    'Reinicia pnpm dev si el servidor local estaba levantado antes de los ultimos cambios.',
                ],
            };
        },
    },
    {
        id: 'public-faq',
        section: 'public',
        title: 'FAQ',
        what: 'Revisa preguntas frecuentes y objeciones habituales.',
        validate: 'El bloque FAQ esta visible y al menos una pregunta puede desplegarse.',
        risk: 'Solo lectura.',
        modes: allModes,
        async run(ctx) {
            await ctx.goto('/es#faq');
            await ctx.scrollTo('#faq');
            await ctx.clickFirstVisible(['#faq [data-faq-button]']);
            return ctx.visible(['#faq', '#faq [data-faq-button]'], 'FAQ visible.');
        },
    },
    {
        id: 'public-contact-lead',
        section: 'public',
        title: 'Contacto y lead',
        what: 'Muestra el formulario de captacion sin enviarlo en modo seguro.',
        validate: 'El bloque de contacto y el campo de email estan disponibles.',
        risk: 'No se envia el formulario automaticamente.',
        modes: allModes,
        async run(ctx) {
            await ctx.goto('/es#contacto');
            await ctx.scrollTo('#contacto');
            return ctx.visible(
                ['#contacto form input[type="email"]', '#contacto input[type="email"]', '#contacto form'],
                'Formulario de lead disponible.',
            );
        },
    },

    {
        id: 'student-login',
        section: 'student',
        title: 'Login alumno',
        what: 'Inicia sesion con el usuario alumno de .env.test.',
        validate: 'El login redirige al campus de alumno.',
        risk: 'Crea solo sesion de navegador.',
        modes: allModes,
        async run(ctx) {
            return ctx.loginAs('student');
        },
    },
    {
        id: 'student-dashboard',
        section: 'student',
        title: 'Dashboard alumno',
        what: 'Presenta el panel de control, estado del plan y accesos principales.',
        validate: 'La ruta /es/campus carga autenticada y muestra encabezado.',
        risk: 'Solo lectura.',
        modes: allModes,
        async run(ctx) {
            await ctx.goto('/es/campus');
            return ctx.visible(['h1:has-text("PANEL")', 'h1', 'main'], 'Dashboard de alumno visible.');
        },
    },
    {
        id: 'student-onboarding',
        section: 'student',
        title: 'Onboarding alumno',
        what: 'Explica los estados iniciales: plan, siguientes pasos y acceso a precios si falta suscripcion.',
        validate: 'El dashboard muestra informacion accionable para el alumno.',
        risk: 'Solo lectura.',
        modes: allModes,
        async run(ctx) {
            await ctx.goto('/es/campus');
            return ctx.optionalVisible(
                ['a[href*="#pricing"]', 'a[href*="/campus/classes"]', '#manage-sub-btn', 'text=/plan|clase|panel/i'],
                'Hay elementos de onboarding o plan visibles.',
                'No se detectaron elementos claros de onboarding; revisar contenido manualmente.',
            );
        },
    },
    {
        id: 'student-classes',
        section: 'student',
        title: 'Mis clases',
        what: 'Muestra proximas clases, historial y acciones seguras del alumno.',
        validate: 'La pagina de clases carga con pestanas o contenido de clase.',
        risk: 'No cancela ni modifica clases.',
        modes: allModes,
        async run(ctx) {
            await ctx.goto('/es/campus/classes');
            return ctx.visible(
                ['button:has-text("Proximas")', 'button:has-text("Pr")', '[role="tab"]', 'main'],
                'Vista de clases cargada.',
            );
        },
    },
    {
        id: 'student-next-class',
        section: 'student',
        title: 'Proxima clase',
        what: 'Busca la tarjeta o bloque de proxima clase para explicar Meet, Drive y cancelacion.',
        validate: 'Si hay clase futura, se ve la tarjeta; si no, queda registrado como warning.',
        risk: 'Solo lectura.',
        modes: allModes,
        async run(ctx) {
            await ctx.goto('/es/campus');
            return ctx.optionalVisible(
                ['.next-class-card', '[data-testid="next-class"]', 'text=/proxima clase|siguiente clase/i'],
                'Bloque de proxima clase visible.',
                'No hay proxima clase visible para el alumno de prueba.',
            );
        },
    },
    {
        id: 'student-drive',
        section: 'student',
        title: 'Drive alumno',
        what: 'Muestra como se informa el acceso a Google Drive y la vinculacion opcional de cuenta Google.',
        validate: 'El bloque de Google Drive esta disponible en Mi cuenta.',
        risk: 'No vincula cuenta Google ni cambia permisos.',
        modes: allModes,
        async run(ctx) {
            await ctx.goto('/es/campus/account');
            return ctx.visible(
                ['#link-drive-form', 'text=/Google Drive|Drive/i'],
                'Bloque de Drive disponible.',
            );
        },
    },
    {
        id: 'student-account',
        section: 'student',
        title: 'Cuenta alumno',
        what: 'Recorre datos personales, suscripcion y soporte operativo desde la cuenta.',
        validate: 'El formulario de perfil o datos de cuenta estan visibles.',
        risk: 'No guarda cambios.',
        modes: allModes,
        async run(ctx) {
            await ctx.goto('/es/campus/account');
            return ctx.visible(
                ['form input[type="email"]', '#change-password-btn', 'text=/Mi cuenta|Informacion personal|Google Drive/i'],
                'Cuenta de alumno visible.',
            );
        },
    },
    {
        id: 'student-support',
        section: 'student',
        title: 'Soporte alumno',
        what: 'Muestra como pedir ayuda ante problemas de clases, pagos o enlaces.',
        validate: 'La pagina de soporte carga y muestra informacion de contacto.',
        risk: 'Solo lectura.',
        modes: allModes,
        async run(ctx) {
            await ctx.goto('/es/campus/support');
            return ctx.visible(['a[href^="mailto:"]', 'main', 'text=/soporte|contact/i'], 'Soporte visible.');
        },
    },

    {
        id: 'teacher-login',
        section: 'teacher',
        title: 'Login profesor',
        what: 'Inicia sesion con el usuario profesor de .env.test.',
        validate: 'El login redirige al area de profesor.',
        risk: 'Crea solo sesion de navegador.',
        modes: allModes,
        async run(ctx) {
            return ctx.loginAs('teacher');
        },
    },
    {
        id: 'teacher-dashboard',
        section: 'teacher',
        title: 'Dashboard profesor',
        what: 'Muestra alumnos asignados, metricas y accesos de profesor.',
        validate: 'La ruta /es/campus/teacher carga autenticada.',
        risk: 'Solo lectura.',
        modes: allModes,
        async run(ctx) {
            await ctx.goto('/es/campus/teacher');
            return ctx.visible(['#students-container', '#student-search', 'h1', 'main'], 'Dashboard de profesor visible.');
        },
    },
    {
        id: 'teacher-students',
        section: 'teacher',
        title: 'Alumnos del profesor',
        what: 'Explica busqueda, estado de plan y acceso a ficha de alumno.',
        validate: 'Hay buscador y, si existen alumnos, tarjetas de alumno.',
        risk: 'Solo lectura.',
        modes: allModes,
        async run(ctx) {
            await ctx.goto('/es/campus/teacher');
            const search = ctx.page.locator('#student-search');
            if (await search.isVisible({ timeout: 5_000 }).catch(() => false)) {
                await search.fill('');
            }
            return ctx.optionalVisible(
                ['.student-card a[href*="/campus/teacher/student/"]', '.student-card', 'text=/No hay/i'],
                'Listado o estado vacio de alumnos visible.',
                'No se detecto listado ni estado vacio de alumnos.',
            );
        },
    },
    {
        id: 'teacher-student-detail',
        section: 'teacher',
        title: 'Ficha de alumno',
        what: 'Abre una ficha si hay alumno asignado para mostrar seguimiento y notas.',
        validate: 'La ficha carga o se registra ausencia de alumnos asignados.',
        risk: 'Solo lectura.',
        modes: allModes,
        async run(ctx) {
            await ctx.goto('/es/campus/teacher');
            const opened = await ctx.clickFirstVisible(['.student-card a[href*="/campus/teacher/student/"]']);
            if (!opened) {
                return {
                    status: 'warning',
                    message: 'No hay alumno asignado visible para abrir ficha.',
                };
            }
            await ctx.page.waitForLoadState('domcontentloaded');
            await ctx.refreshOverlay('Ficha abierta.');
            return ctx.visible(['h1', 'main', 'textarea', 'text=/Notas|Alumno|Drive/i'], 'Ficha de alumno cargada.');
        },
    },
    {
        id: 'teacher-drive',
        section: 'teacher',
        title: 'Drive profesor',
        what: 'Busca enlaces Drive asociados a alumnos para explicar el modelo de trabajo documental.',
        validate: 'Si hay Drive creado, se muestra enlace; si no, queda como warning operativo.',
        risk: 'No abre ni modifica documentos.',
        modes: allModes,
        async run(ctx) {
            await ctx.goto('/es/campus/teacher');
            return ctx.optionalVisible(
                ['a[href*="drive.google.com"]', 'text=/Drive/i'],
                'Enlace o referencia a Drive visible.',
                'No hay enlace Drive visible para los alumnos de prueba.',
            );
        },
    },
    {
        id: 'teacher-calendar',
        section: 'teacher',
        title: 'Calendario profesor',
        what: 'Muestra calendario semanal, clases y boton de programacion.',
        validate: 'La pagina de calendario carga y muestra controles.',
        risk: 'No crea clases.',
        modes: allModes,
        async run(ctx) {
            await ctx.goto('/es/campus/teacher/calendar');
            return ctx.visible(
                ['#tab-calendar', 'button:has-text("Programar")', 'main'],
                'Calendario de profesor visible.',
            );
        },
    },
    {
        id: 'teacher-availability',
        section: 'teacher',
        title: 'Disponibilidad',
        what: 'Muestra la pestana donde el profesor gestiona disponibilidad.',
        validate: 'La pestana de disponibilidad se puede abrir.',
        risk: 'No guarda cambios de disponibilidad.',
        modes: allModes,
        async run(ctx) {
            await ctx.goto('/es/campus/teacher/calendar');
            await ctx.clickFirstVisible(['#tab-availability', 'button:has-text("Disponibilidad")']);
            return ctx.visible(['#view-availability', 'text=/Disponibilidad/i'], 'Vista de disponibilidad accesible.');
        },
    },

    {
        id: 'admin-login',
        section: 'admin',
        title: 'Login admin',
        what: 'Inicia sesion con el usuario admin de .env.test.',
        validate: 'El login redirige al panel admin.',
        risk: 'Crea solo sesion de navegador.',
        modes: allModes,
        async run(ctx) {
            return ctx.loginAs('admin');
        },
    },
    {
        id: 'admin-dashboard',
        section: 'admin',
        title: 'Dashboard admin',
        what: 'Presenta la vista global de administracion.',
        validate: 'La ruta /es/campus/admin carga y muestra contenido.',
        risk: 'Solo lectura.',
        modes: allModes,
        async run(ctx) {
            await ctx.goto('/es/campus/admin');
            return ctx.visible(['h1', 'h2', 'main'], 'Dashboard admin visible.');
        },
    },
    {
        id: 'admin-leads',
        section: 'admin',
        title: 'Leads',
        what: 'Muestra captacion, estados y seguimiento comercial.',
        validate: 'La pagina de leads carga con tabla o estado vacio.',
        risk: 'No cambia estados.',
        modes: allModes,
        async run(ctx) {
            await ctx.goto('/es/campus/admin/leads');
            return ctx.visible(['table', 'text=/leads|No hay/i', 'main'], 'Leads visibles.');
        },
    },
    {
        id: 'admin-users',
        section: 'admin',
        title: 'Usuarios',
        what: 'Muestra gestion de usuarios y roles.',
        validate: 'La pagina de usuarios carga.',
        risk: 'No asigna ni modifica usuarios.',
        modes: allModes,
        async run(ctx) {
            await ctx.goto('/es/campus/admin/users');
            return ctx.visible(['table', 'select', 'main'], 'Usuarios visibles.');
        },
    },
    {
        id: 'admin-students',
        section: 'admin',
        title: 'Estudiantes',
        what: 'Muestra gestion academica de estudiantes.',
        validate: 'La pagina de estudiantes carga con tabla, tarjetas o estado vacio.',
        risk: 'Solo lectura.',
        modes: allModes,
        async run(ctx) {
            await ctx.goto('/es/campus/admin/students');
            return ctx.visible(['table', 'a[href*="/admin/student/"]', 'main'], 'Estudiantes visibles.');
        },
    },
    {
        id: 'admin-packages',
        section: 'admin',
        title: 'Paquetes y precios',
        what: 'Explica que el runtime de producto sale de Supabase y se sincroniza con Stripe.',
        validate: 'La pagina de paquetes carga.',
        risk: 'No edita precios ni Stripe IDs.',
        modes: allModes,
        async run(ctx) {
            await ctx.goto('/es/campus/admin/packages');
            return ctx.visible(['table', 'text=/Stripe|Precio|Paquete/i', 'main'], 'Paquetes visibles.');
        },
    },
    {
        id: 'admin-payments',
        section: 'admin',
        title: 'Pagos admin',
        what: 'Muestra pagos, filtros y seguimiento de suscripciones.',
        validate: 'La tabla o filtros de pagos estan disponibles.',
        risk: 'Solo lectura.',
        modes: allModes,
        async run(ctx) {
            await ctx.goto('/es/campus/admin/payments');
            return ctx.visible(['#payments-table', '#status-filter', 'table', 'main'], 'Pagos visibles.');
        },
    },

    {
        id: 'payments-modal-safe',
        section: 'payments',
        title: 'Modal de compra sin checkout',
        what: 'Abre el modal de duracion de un plan para explicar la eleccion sin entrar en Stripe.',
        validate: 'El modal aparece o se registra que los planes no tienen checkout activo.',
        risk: 'No pulsa continuar a Stripe.',
        modes: allModes,
        async run(ctx) {
            await ctx.goto('/es#pricing');
            await ctx.scrollTo('#pricing');
            const opened = await ctx.clickFirstVisible([
                '[data-testid^="select-plan-"]:not([disabled])',
                '#pricing button:has-text("Seleccionar")',
            ]);
            if (!opened) {
                return {
                    status: 'warning',
                    message: 'No hay boton de plan habilitado para abrir modal.',
                };
            }
            return ctx.visible(
                ['button:has-text("Continuar")', 'button:has-text("Inicia")', 'text=/Elige|compromiso|Total/i'],
                'Modal de compra visible sin iniciar pago.',
            );
        },
    },
    {
        id: 'payments-stripe-checkout',
        section: 'payments',
        title: 'Stripe Checkout test',
        what: 'Entra en Stripe Checkout test, usa tarjeta de prueba y vuelve al campus.',
        validate: 'Stripe Checkout abre y el flujo vuelve a la aplicacion, o se registra bloqueo externo.',
        risk: 'Crea pago y suscripcion de test en staging.',
        modes: realModes,
        sideEffect: 'stripe',
        async run(ctx) {
            const allowed = await ctx.confirmSideEffect(
                'stripe',
                'Confirmar Stripe Checkout test',
                'Este paso puede crear un pago y una suscripcion de prueba en Stripe/Supabase.',
            );
            if (!allowed) {
                return { status: 'skipped', message: 'Checkout omitido por compuerta o confirmacion.' };
            }

            await ctx.loginAs('student');
            await ctx.goto('/es#pricing');
            await ctx.scrollTo('#pricing');
            const opened = await ctx.clickFirstVisible([
                '[data-testid^="select-plan-"]:not([disabled])',
                '#pricing button:has-text("Seleccionar")',
            ]);
            if (!opened) return { status: 'warning', message: 'No hay plan con checkout habilitado.' };

            await ctx.visible(['button:has-text("Continuar")'], 'Modal de compra abierto.');
            const continued = await ctx.clickFirstVisible(['button:has-text("Continuar")']);
            if (!continued) return { status: 'warning', message: 'No se encontro boton Continuar.' };

            await ctx.page.waitForURL(/checkout\.stripe\.com|\/success|\/campus/, { timeout: 20_000 }).catch(() => undefined);
            await ctx.refreshOverlay('Checkout iniciado.');
            if (!ctx.page.url().includes('checkout.stripe.com')) {
                return {
                    status: 'warning',
                    message: 'No se llego a Stripe Checkout; revisar Price IDs o sesion.',
                    details: [ctx.page.url()],
                };
            }

            const filled = await fillStripeCheckout(ctx.page);
            if (!filled) {
                return {
                    status: 'warning',
                    message: 'Stripe Checkout abierto, pero no se pudieron completar todos los campos automaticamente.',
                    details: ['Usar tarjeta test 4242 4242 4242 4242 manualmente si procede.'],
                };
            }

            await ctx.page.waitForURL(/\/success|\/campus|espanol-honesto/i, { timeout: 45_000 }).catch(() => undefined);
            return {
                status: ctx.page.url().includes('checkout.stripe.com') ? 'warning' : 'ok',
                message: ctx.page.url().includes('checkout.stripe.com')
                    ? 'Stripe no devolvio a la aplicacion dentro del timeout.'
                    : 'Checkout test completado o retorno recibido.',
                details: [ctx.page.url()],
            };
        },
    },
    {
        id: 'payments-admin-verify',
        section: 'payments',
        title: 'Verificacion de pago en admin',
        what: 'Comprueba desde admin que pagos y suscripciones quedan observables.',
        validate: 'La pantalla de pagos carga despues del flujo.',
        risk: 'Solo lectura.',
        modes: allModes,
        async run(ctx) {
            await ctx.loginAs('admin');
            await ctx.goto('/es/campus/admin/payments');
            return ctx.visible(['#payments-table', 'table', '#status-filter'], 'Pantalla de pagos lista para verificacion.');
        },
    },

    {
        id: 'emails-preview',
        section: 'emails',
        title: 'Preview de emails',
        what: 'Muestra previsualizacion de plantillas desde Admin > Emails.',
        validate: 'La plantilla se carga en iframe o se muestra estado de carga/error.',
        risk: 'GET de preview, sin envio.',
        modes: allModes,
        async run(ctx) {
            await ctx.loginAs('admin');
            await ctx.goto('/es/campus/admin/emails');
            return ctx.visible(['iframe[title="Email preview"]', 'select', 'text=/Preview|Plantillas/i'], 'Preview de emails visible.');
        },
    },
    {
        id: 'emails-send-test',
        section: 'emails',
        title: 'Enviar email de prueba',
        what: 'Envia una plantilla real via Resend al email de prueba configurado.',
        validate: 'La UI informa envio correcto o bloqueo de configuracion.',
        risk: 'Envia un email real de prueba.',
        modes: realModes,
        sideEffect: 'email',
        async run(ctx) {
            const allowed = await ctx.confirmSideEffect(
                'email',
                'Confirmar envio Resend',
                'Este paso envia un email real al destinatario de prueba mostrado en la pantalla.',
            );
            if (!allowed) return { status: 'skipped', message: 'Envio de email omitido por compuerta o confirmacion.' };

            await ctx.loginAs('admin');
            await ctx.goto('/es/campus/admin/emails');
            const clicked = await ctx.clickFirstVisible(['button:has-text("Enviar prueba")']);
            if (!clicked) return { status: 'warning', message: 'No se encontro boton Enviar prueba.' };
            await ctx.page.waitForTimeout(1_500);
            return ctx.optionalVisible(
                ['text=/Email enviado|enviado|No se pudo|error/i'],
                'Resultado de envio visible.',
                'No aparecio mensaje de resultado tras el envio.',
            );
        },
    },

    {
        id: 'google-drive-state',
        section: 'google',
        title: 'Estado Drive alumno',
        what: 'Comprueba si el alumno de prueba tiene carpeta Drive preparada o pendiente.',
        validate: 'Mi cuenta muestra carpeta lista, pendiente o formulario de vinculacion.',
        risk: 'Solo lectura.',
        modes: allModes,
        async run(ctx) {
            await ctx.loginAs('student');
            await ctx.goto('/es/campus/account');
            return ctx.visible(['#link-drive-form', 'a[href*="drive.google.com"]', 'text=/Drive/i'], 'Estado Drive visible.');
        },
    },
    {
        id: 'google-meet-links',
        section: 'google',
        title: 'Enlaces Drive y Meet',
        what: 'Busca enlaces Drive, Docs o Meet en clases del alumno para confirmar entrega operativa.',
        validate: 'Si existen enlaces se muestran; si no, queda como warning.',
        risk: 'No abre servicios externos automaticamente.',
        modes: allModes,
        async run(ctx) {
            await ctx.loginAs('student');
            await ctx.goto('/es/campus/classes');
            return ctx.optionalVisible(
                ['a[href*="drive.google.com"]', 'a[href*="docs.google.com"]', 'a[href*="meet.google.com"]'],
                'Hay enlaces Google visibles en clases.',
                'No hay enlaces Google visibles en clases del alumno de prueba.',
            );
        },
    },
    {
        id: 'google-full-operational-check',
        section: 'google',
        title: 'Chequeo operativo Google',
        what: 'En modo full, revisa cola de jobs y procesa pendientes si staging esta operativo.',
        validate: 'La cola responde y muestra resultado de procesamiento o bloqueo externo.',
        risk: 'Puede procesar jobs con Drive, Calendar, Meet y emails.',
        modes: fullModes,
        sideEffect: 'google',
        async run(ctx) {
            const allowed = await ctx.confirmSideEffect(
                'google',
                'Confirmar procesamiento de jobs',
                'Este paso puede disparar Cloudflare Fulfillment Worker, Google Drive, Calendar, Meet y emails asociados.',
            );
            if (!allowed) return { status: 'skipped', message: 'Chequeo Google omitido por confirmacion.' };

            await ctx.loginAs('admin');
            await ctx.goto('/es/campus/admin/jobs');
            const clicked = await ctx.clickFirstVisible(['button:has-text("Procesar pendientes")']);
            if (!clicked) return { status: 'warning', message: 'No se encontro boton Procesar pendientes.' };
            await ctx.page.waitForTimeout(2_500);
            return ctx.optionalVisible(
                ['text=/Procesados|No se pudo|fallidos|correctos/i'],
                'Resultado de procesamiento visible.',
                'No aparecio resultado de procesamiento; revisar Cloudflare Fulfillment Worker/Google manualmente.',
            );
        },
    },

    {
        id: 'recovery-jobs',
        section: 'recovery',
        title: 'Admin Jobs',
        what: 'Muestra la consola de recuperacion operativa para fulfillment_jobs.',
        validate: 'La pantalla lista filtros, tabla y acciones de reintento/cancelacion.',
        risk: 'Solo lectura.',
        modes: allModes,
        async run(ctx) {
            await ctx.loginAs('admin');
            await ctx.goto('/es/campus/admin/jobs');
            return ctx.visible(['button:has-text("pending")', 'button:has-text("failed")', 'table', 'main'], 'Consola de jobs visible.');
        },
    },
    {
        id: 'recovery-retry-test-job',
        section: 'recovery',
        title: 'Reintentar job de prueba',
        what: 'En modo completo, reintenta un job pendiente/fallido si existe.',
        validate: 'La UI muestra resultado de reprogramacion o registra que no hay job candidato.',
        risk: 'Reprograma procesamiento operativo.',
        modes: realModes,
        sideEffect: 'jobs',
        async run(ctx) {
            const allowed = await ctx.confirmSideEffect(
                'jobs',
                'Confirmar reintento de job',
                'Este paso puede reprogramar un job real de staging.',
            );
            if (!allowed) return { status: 'skipped', message: 'Reintento de job omitido por compuerta o confirmacion.' };

            await ctx.loginAs('admin');
            await ctx.goto('/es/campus/admin/jobs');
            await ctx.clickFirstVisible(['button:has-text("failed")', 'button:has-text("pending")']);
            const clicked = await ctx.clickFirstVisible(['button:has-text("Reintentar")']);
            if (!clicked) return { status: 'warning', message: 'No hay job visible para reintentar.' };
            await ctx.page.waitForTimeout(1_500);
            return ctx.optionalVisible(
                ['text=/Job reprogramado|No se pudo|error/i'],
                'Resultado de reintento visible.',
                'No aparecio resultado de reintento.',
            );
        },
    },
];

async function fillStripeCheckout(page: Page): Promise<boolean> {
    await page.waitForLoadState('domcontentloaded').catch(() => undefined);

    const cardFields = [
        ['input[name="number"]', '4242424242424242'],
        ['input[name="expiry"]', '1234'],
        ['input[name="cvc"]', '123'],
        ['input[name="cardnumber"]', '4242424242424242'],
        ['input[name="exp-date"]', '1234'],
        ['input[name="cvc"]', '123'],
        ['input[name="billingName"]', 'Demo Test'],
        ['input[name="name"]', 'Demo Test'],
        ['input[name="email"]', 'demo@example.com'],
        ['input[name="postalCode"]', '28001'],
    ];

    let filledAny = false;
    for (const [selector, value] of cardFields) {
        const field = page.locator(selector).first();
        if (await safeVisible(field, 1_500)) {
            await field.fill(value).catch(() => undefined);
            filledAny = true;
        }
    }

    const payButton = page.locator('button[type="submit"], button:has-text("Pagar"), button:has-text("Pay"), button:has-text("Subscribe")').first();
    if (await safeVisible(payButton, 5_000)) {
        await payButton.click().catch(() => undefined);
        return filledAny;
    }

    return false;
}

async function safeVisible(locator: Locator, timeout: number): Promise<boolean> {
    return locator.waitFor({ state: 'visible', timeout }).then(() => true).catch(() => false);
}
