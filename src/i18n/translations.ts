export const languages = {
    es: 'Español',
    en: 'English',
    ru: 'Русский',
};

export const defaultLang = 'es';

export const ui = {
    es: {
        meta: {
            title: "Español Honesto | Aprende español para vivir en España",
            description: "8-10 meses de trabajo real para una fluidez conversacional auténtica. Sin atajos, solo resultados reales.",
        },
        nav: {
            brand: "ESPAÑOL HONESTO",
            established: "EST. 2025",
            login: "Login",
            start: "Empieza ahora",
            method: "Método",
            progress: "Progreso",
            plans: "Planes",
            team: "Equipo",
            faq: "FAQ",
            blog: "Blog",
        },
        common: {
            home: "Inicio",
            blog: "Blog",
            readMore: "Leer más",
            related: "Artículos relacionados",
            ctaReady: "¿Listo para empezar?",
            ctaContact: "HABLEMOS",
        },
        hero: {
            headline1: "VIVIR",
            headline2: "EN",
            headline3: "ESPAÑA",
            manifesto: "/ Manifiesto 001",
            subtitle: "Sin atajos. Sin trucos. 8-10 meses de trabajo real para una fluidez conversacional auténtica.",
            ready: "¿Estás listo?",
            cta: "HABLEMOS",
        },
        ticker: "Sin Atajos • Trabajo Real • Resultados Reales • ",
        problems: {
            headline: "DESPUÉS DE DOS AÑOS EN ESPAÑA",
            subtext: "Sigues sin entender.",
            statements: [
                "Llevas dos años diciendo 'vale' en reuniones sin enterarte de la mitad.",
                "El camarero te pregunta algo. Dices 'vale'. No sabes si has pedido la cuenta o más pan.",
                "Asientes en las conversaciones. Ríes cuando los demás ríen. No siempre sabes de qué.",
                "Tu casero te explica algo del contrato. Asientes. Firmas. Rezas."
            ]
        },
        method: {
            manifesto: "/ MANIFIESTO 002",
            headline: "CÓMO FUNCIONA",
            subtitle: "Trabajo real. Pero no sufrimiento.",
            // Columns and richer content might need different handling if passed as raw objects, 
            // but for now keeping structure similar to JSON.
            columns: [
                { number: "01", title: "CLASE INVERTIDA", description: "La teoría, en tu casa. La práctica, con nosotros. Así aprovechas cada minuto de clase para hablar." },
                { number: "02", title: "SPACING EFFECT", description: "Repasamos en el momento exacto antes de que lo olvides. Ciencia, no intuición." },
                { number: "03", title: "SITUACIONES REALES", description: "Médico, burocracia, trabajo, bares. Lo que necesitas para vivir aquí de verdad." }
            ],
            closing: "Tu tiempo con nosotros es demasiado valioso para leer PowerPoints. Revisa antes. Habla en clase. Así funciona."
        },
        progress: {
            manifesto: "/ MANIFIESTO 003",
            headline: "8-10 MESES",
            subheadline: "Para una fluidez conversacional real.",
            paragraph: "No prometemos magia. Prometemos un plan. Con práctica diaria, feedback honesto, y situaciones reales, llegarás a mantener conversaciones fluidas sobre cualquier tema cotidiano.",
            closing: "Hablar español es la puerta. Conocer España es lo que hay detrás.",
            milestones: [
                { months: "MES 1-2", description: "Entiendes las estructuras básicas. Empiezas a pensar en español." },
                { months: "MES 3-4", description: "Mantienes conversaciones simples. Pierdes el miedo." },
                { months: "MES 5-7", description: "Hablas de temas complejos. Entiendes el humor y las expresiones." },
                { months: "MES 8-10", description: "Fluidez conversacional. Vives en español sin traducir mentalmente." }
            ]
        },
        team: {
            manifesto: "/ MANIFIESTO 004",
            label: "/ SOBRE NOSOTROS",
            headline: "DOS LINGÜISTAS. UN OBJETIVO.",
            subtitle: "Nos conocimos en la Universidad Complutense de Madrid. Nos hicimos amigos. Ahora enseñamos español juntos.",
            closing: "Lingüistas cansados de cursos que no llevan a nada. Sabes qué funciona cuando lo has vivido.",
            members: [
                {
                    name: "ALEJANDRO",
                    role: "PROFESOR PRINCIPAL",
                    languages: ["ES", "AST", "EN", "IT", "PT", "FR", "RU", "CA"],
                    bio: "Lingüista UCM. Especialista en enseñanza de español. Si algo puede explicarse mejor, él encuentra la manera."
                },
                {
                    name: "ALIN",
                    role: "PROFESOR & DESARROLLO",
                    languages: ["ES", "RO", "EN", "IT", "RU"],
                    bio: "Lingüista UCM. Políglota autodidacta. Construye los sistemas que hacen que todo funcione."
                }
            ]
        },
        faq: {
            label: "/ FAQ",
            headline: "PREGUNTAS FRECUENTES",
            items: [
                { question: "¿Qué nivel necesito para empezar?", answer: "Recomendamos un nivel A2 mínimo. Si estás en cero absoluto, hay opciones mejores que nosotros para los primeros pasos. Nuestro fuerte es sacarte del atasco del B1-B2." },
                { question: "¿Cómo son las clases online?", answer: "Por videollamada, una hora. Tú ya has trabajado el material antes (clase invertida). La sesión es 100% conversación, corrección y práctica de situaciones reales." },
                { question: "¿Qué pasa si tengo que cancelar una clase?", answer: "Avisa con 24 horas de antelación y la reprogramamos sin problema. Menos de 24 horas, la clase se pierde. Somos flexibles, pero el compromiso es mutuo." },
                { question: "¿Puedo cambiar de plan?", answer: "Sí. Puedes subir o bajar de plan en cualquier momento. El cambio se aplica en el siguiente ciclo de facturación." },
                { question: "¿Ofrecéis clases para empresas?", answer: "Sí, pero es un servicio diferente. Escríbenos y hablamos de las necesidades específicas de tu equipo." },
                { question: "¿Puedo aprender español en 3 meses?", answer: "Técnicamente, algo aprenderás. Prácticamente, no lo suficiente. Honestamente, no. Por eso decimos 8-10 meses." }
            ]
        },
        pricing: {
            title: "PLANES",
            subtitle: "SELECCIONA TU NIVEL DE COMPROMISO",
            headers: {
                name: "Nombre",
                price: "Precio",
                includes: "Incluye",
                action: "Acción",
            },
            month: "/mes",
            select: "Seleccionar",
            recommended: "Recomendado",
            plans: {
                essential: {
                    name: "Esencial",
                    description: "Para el estudiante autónomo",
                    features: ["2 clases semanales", "Material incluido", "Acceso a comunidad"],
                },
                intensive: {
                    name: "Intensivo",
                    description: "Compromiso total",
                    features: ["4 clases semanales", "Tutoría personalizada", "Todo lo de Esencial"],
                },
                premium: {
                    name: "Premium",
                    description: "Atención exclusiva",
                    features: ["Clases 1 a 1 ilimitadas", "Horario flexible", "Preparación exámenes"],
                },
            },
        },
        footer: {
            cta1: "EMPIEZA",
            cta2: "AHORA",
            address: "Calle de la Verdad, 12",
            city: "Madrid, España",
            email: "hola@espanolhonesto.com",
            copyright: "Español Honesto. Todos los derechos reservados.",
        },
        styleSwitcher: {
            title: "Estilos Disponibles",
        },
        langSwitcher: {
            es: "ES",
            en: "EN",
            ru: "RU",
        },
    },
    en: {
        meta: {
            title: "Español Honesto | Learn Spanish to Live in Spain",
            description: "8-10 months of real work for authentic conversational fluency. No shortcuts, only real results.",
        },
        nav: {
            brand: "ESPAÑOL HONESTO",
            established: "EST. 2025",
            login: "Login",
            start: "Get Started",
            method: "Method",
            progress: "Progress",
            plans: "Plans",
            team: "Team",
            faq: "FAQ",
            blog: "Blog",
        },
        common: {
            home: "Home",
            blog: "Blog",
            readMore: "Read more",
            related: "Related articles",
            ctaReady: "Ready to start?",
            ctaContact: "LET'S TALK",
        },
        hero: {
            headline1: "LIVE",
            headline2: "IN",
            headline3: "SPAIN",
            manifesto: "/ Manifesto 001",
            subtitle: "No shortcuts. No tricks. 8-10 months of real work for authentic conversational fluency.",
            ready: "Are you ready?",
            cta: "LET'S TALK",
        },
        ticker: "No Shortcuts • Real Work • Real Results • ",
        problems: {
            headline: "AFTER TWO YEARS IN SPAIN",
            subtext: "You still don't understand.",
            statements: [
                "You've been saying 'vale' in meetings for two years without understanding half of it.",
                "The waiter asks you something. You say 'vale'. You don't know if you asked for the bill or more bread.",
                "You nod in conversations. You laugh when others laugh. You don't always know why.",
                "Your landlord explains something about the contract. You nod. You sign. You pray."
            ]
        },
        method: {
            manifesto: "/ MANIFESTO 002",
            headline: "HOW IT WORKS",
            subtitle: "Real work. But not suffering.",
            columns: [
                { number: "01", title: "FLIPPED CLASSROOM", description: "Theory at home. Practice with us. Every minute of class is for speaking." },
                { number: "02", title: "SPACING EFFECT", description: "We review at the exact moment before you forget it. Science, not intuition." },
                { number: "03", title: "REAL SITUATIONS", description: "Doctor, bureaucracy, work, bars. What you need to really live here." }
            ],
            closing: "Your time with us is too valuable to read PowerPoints. Review before. Speak in class. That's how it works."
        },
        progress: {
            manifesto: "/ MANIFESTO 003",
            headline: "8-10 MONTHS",
            subheadline: "For real conversational fluency.",
            paragraph: "We don't promise magic. We promise a plan. With daily practice, honest feedback, and real situations, you will reach a point where you can maintain fluid conversations on any everyday topic.",
            closing: "Speaking Spanish is the door. Knowing Spain is what's behind it.",
            milestones: [
                { months: "MONTH 1-2", description: "You understand basic structures. You start thinking in Spanish." },
                { months: "MONTH 3-4", description: "You maintain simple conversations. You lose the fear." },
                { months: "MONTH 5-7", description: "You talk about complex topics. You understand humor and expressions." },
                { months: "MONTH 8-10", description: "Conversational fluency. You live in Spanish without translating in your head." }
            ]
        },
        team: {
            manifesto: "/ MANIFESTO 004",
            label: "/ ABOUT US",
            headline: "TWO LINGUISTS. ONE GOAL.",
            subtitle: "We met at the Complutense University of Madrid. We became friends. Now we teach Spanish together.",
            closing: "Linguists tired of courses that lead nowhere. You know what works when you've lived it.",
            members: [
                {
                    name: "ALEJANDRO",
                    role: "HEAD TEACHER",
                    languages: ["ES", "AST", "EN", "IT", "PT", "FR", "RU", "CA"],
                    bio: "UCM Linguist. Specialist in Spanish teaching. If something can be explained better, he finds the way."
                },
                {
                    name: "ALIN",
                    role: "TEACHER & DEVELOPMENT",
                    languages: ["ES", "RO", "EN", "IT", "RU"],
                    bio: "UCM Linguist. Self-taught polyglot. Builds the systems that make everything work."
                }
            ]
        },
        faq: {
            label: "/ FAQ",
            headline: "FREQUENTLY ASKED QUESTIONS",
            items: [
                { question: "What level do I need to start?", answer: "We recommend a minimum A2 level. If you are starting from absolute zero, there are better options for the first steps. Our strength is getting you unstuck from B1-B2." },
                { question: "How are the online classes?", answer: "Video call, one hour. You have already worked on the material before (flipped classroom). The session is 100% conversation, correction, and practice of real situations." },
                { question: "What happens if I have to cancel a class?", answer: "Notify us 24 hours in advance and we reschedule without problem. Less than 24 hours, the class is lost. We are flexible, but the commitment is mutual." },
                { question: "Can I change plans?", answer: "Yes. You can upgrade or downgrade at any time. The change applies in the next billing cycle." },
                { question: "Do you offer classes for companies?", answer: "Yes, but it is a different service. Write to us and we can talk about the specific needs of your team." },
                { question: "Can I learn Spanish in 3 months?", answer: "Technically, you will learn something. Practically, not enough. Honestly, no. That's why we say 8-10 months." }
            ]
        },
        pricing: {
            title: "PLANS",
            subtitle: "SELECT YOUR LEVEL OF COMMITMENT",
            headers: {
                name: "Name",
                price: "Price",
                includes: "Includes",
                action: "Action",
            },
            month: "/month",
            select: "Select",
            recommended: "Recommended",
            plans: {
                essential: {
                    name: "Essential",
                    description: "For the autonomous learner",
                    features: ["2 weekly classes", "Materials included", "Community access"],
                },
                intensive: {
                    name: "Intensive",
                    description: "Total commitment",
                    features: ["4 weekly classes", "Personalized tutoring", "Everything in Essential"],
                },
                premium: {
                    name: "Premium",
                    description: "Exclusive attention",
                    features: ["Unlimited 1-on-1 classes", "Flexible schedule", "Exam preparation"],
                },
            },
        },
        footer: {
            cta1: "START",
            cta2: "NOW",
            address: "Calle de la Verdad, 12",
            city: "Madrid, Spain",
            email: "hola@espanolhonesto.com",
            copyright: "Español Honesto. All rights reserved.",
        },
        styleSwitcher: {
            title: "Available Styles",
        },
        langSwitcher: {
            es: "ES",
            en: "EN",
            ru: "RU",
        },
    },
    ru: {
        meta: {
            title: "Español Honesto | Изучай испанский, чтобы жить в Испании",
            description: "8-10 месяцев реальной работы для подлинной разговорной беглости. Без сокращений, только реальные результаты.",
        },
        nav: {
            brand: "ESPAÑOL HONESTO",
            established: "ОСН. 2025",
            login: "Войти",
            start: "Начать",
            method: "Метод",
            progress: "Прогресс",
            plans: "Планы",
            team: "Команда",
            faq: "FAQ",
            blog: "Блог",
        },
        common: {
            home: "Главная",
            blog: "Блог",
            readMore: "Читать далее",
            related: "Похожие статьи",
            ctaReady: "Готовы начать?",
            ctaContact: "ПОГОВОРИМ",
        },
        hero: {
            headline1: "ЖИТЬ",
            headline2: "В",
            headline3: "ИСПАНИИ",
            manifesto: "/ Манифест 001",
            subtitle: "Без сокращений. Без уловок. 8-10 месяцев реальной работы для подлинной разговорной беглости.",
            ready: "Вы готовы?",
            cta: "ПОГОВОРИМ",
        },
        ticker: "Без Сокращений • Реальная Работа • Реальные Результаты • ",
        problems: {
            headline: "ПОСЛЕ ДВУХ ЛЕТ В ИСПАНИИ",
            subtext: "Ты всё ещё не понимаешь.",
            statements: [
                "Ты два года говоришь 'vale' на встречах, не понимая и половины.",
                "Официант что-то спрашивает. Ты говоришь 'vale'. Не знаешь, попросил ли счет или еще хлеба.",
                "Ты киваешь в разговорах. Смеешься, когда смеются другие. Не всегда знаешь почему.",
                "Твой арендодатель объясняет что-то о контракте. Киваешь. Подписываешь. Молишься."
            ]
        },
        method: {
            manifesto: "/ МАНИФЕСТ 002",
            headline: "КАК ЭТО РАБОТАЕТ",
            subtitle: "Реальная работа. Но не страдания.",
            columns: [
                { number: "01", title: "ПЕРЕВЕРНУТЫЙ КЛАСС", description: "Теорию изучаешь дома. Практикуешь с нами. Каждая минута урока — для разговора." },
                { number: "02", title: "ИНТЕРВАЛЬНОЕ ПОВТОРЕНИЕ", description: "Повторяем в точный момент, прежде чем забудешь. Наука, а не интуиция." },
                { number: "03", title: "РЕАЛЬНЫЕ СИТУАЦИИ", description: "Врач, бюрократия, работа, бары. То, что вам нужно, чтобы по-настоящему жить здесь." }
            ],
            closing: "Ваше время с нами слишком ценно, чтобы читать презентации. Изучайте заранее. Говорите на уроке. Так это работает."
        },
        progress: {
            manifesto: "/ МАНИФЕСТ 003",
            headline: "8-10 МЕСЯЦЕВ",
            subheadline: "Для настоящей разговорной беглости.",
            paragraph: "Мы не обещаем магии. Мы обещаем план. С ежедневной практикой, честной обратной связью и реальными ситуациями вы сможете поддерживать беглые разговоры на любую повседневную тему.",
            closing: "Говорить по-испански — это дверь. Знать Испанию — вот что за ней.",
            milestones: [
                { months: "МЕСЯЦ 1-2", description: "Вы понимаете базовые структуры. Начинаете думать на испанском." },
                { months: "МЕСЯЦ 3-4", description: "Поддерживаете простые разговоры. Теряете страх." },
                { months: "МЕСЯЦ 5-7", description: "Говорите на сложные темы. Понимаете юмор и выражения." },
                { months: "МЕСЯЦ 8-10", description: "Разговорная беглость. Живете на испанском, не переводя в уме." }
            ]
        },
        team: {
            manifesto: "/ МАНИФЕСТ 004",
            label: "/ О НАС",
            headline: "ДВА ЛИНГВИСТА. ОДНА ЦЕЛЬ.",
            subtitle: "Мы встретились в Университете Комплутенсе в Мадриде. Стали друзьями. Теперь мы преподаем испанский вместе.",
            closing: "Лингвисты, уставшие от курсов, которые никуда не ведут. Ты знаешь, что работает, когда прожил это.",
            members: [
                {
                    name: "АЛЕХАНДРО",
                    role: "ГЛАВНЫЙ ПРЕПОДАВАТЕЛЬ",
                    languages: ["ES", "AST", "EN", "IT", "PT", "FR", "RU", "CA"],
                    bio: "Лингвист UCM. Специалист по преподаванию испанского. Если что-то можно объяснить лучше, он найдет способ."
                },
                {
                    name: "АЛИН",
                    role: "ПРЕПОДАВАТЕЛЬ И РАЗРАБОТКА",
                    languages: ["ES", "RO", "EN", "IT", "RU"],
                    bio: "Лингвист UCM. Полиглот-самоучка. Создает системы, благодаря которым всё работает."
                }
            ]
        },
        faq: {
            label: "/ FAQ",
            headline: "ЧАСТО ЗАДАВАЕМЫЕ ВОПРОСЫ",
            items: [
                { question: "Какой уровень мне нужен для начала?", answer: "Мы рекомендуем минимум уровень A2. Если вы начинаете с нуля, есть лучшие варианты для первых шагов. Наша сила — вытащить вас из застоя B1-B2." },
                { question: "Как проходят онлайн-уроки?", answer: "Видеозвонок, один час. Вы уже проработали материал заранее (перевернутый класс). Сессия — это 100% разговор, исправления и практика реальных ситуаций." },
                { question: "Что произойдет, если мне нужно отменить урок?", answer: "Сообщите нам за 24 часа, и мы перенесем урок без проблем. Менее чем за 24 часа урок сгорает. Мы гибки, но обязательства взаимны." },
                { question: "Могу ли я сменить план?", answer: "Да. Вы можете повысить или понизить план в любое время. Изменения вступают в силу в следующем расчетном цикле." },
                { question: "Предлагаете ли вы уроки для компаний?", answer: "Да, но это отдельная услуга. Напишите нам, и мы обсудим конкретные потребности вашей команды." },
                { question: "Могу ли я выучить испанский за 3 месяца?", answer: "Технически, вы чему-то научитесь. Практически, недостаточно. Честно говоря, нет. Поэтому мы говорим 8-10 месяцев." }
            ]
        },
        pricing: {
            title: "ПЛАНЫ",
            subtitle: "ВЫБЕРИТЕ ВАШ УРОВЕНЬ ОБЯЗАТЕЛЬСТВ",
            headers: {
                name: "Название",
                price: "Цена",
                includes: "Включает",
                action: "Действие",
                // Note: Pricing itself was not explicitly fully translated in the provided file beyond headers/constants
                // so we keep the structure generic. If values are hardcoded in React, we might need to adjust later.
            },
            month: "/месяц",
            select: "Выбрать",
            recommended: "Рекомендуемый",
            plans: {
                essential: {
                    name: "Базовый",
                    description: "Для самостоятельного ученика",
                    features: ["2 занятия в неделю", "Материалы включены", "Доступ к сообществу"],
                },
                intensive: {
                    name: "Интенсивный",
                    description: "Полная отдача",
                    features: ["4 занятия в неделю", "Персональное руководство", "Всё из Базового"],
                },
                premium: {
                    name: "Премиум",
                    description: "Эксклюзивное внимание",
                    features: ["Неограниченные индивидуальные занятия", "Гибкий график", "Подготовка к экзаменам"],
                },
            },
        },
        footer: {
            cta1: "НАЧНИ",
            cta2: "СЕЙЧАС",
            address: "Calle de la Verdad, 12",
            city: "Мадрид, Испания",
            email: "privet@espanolhonesto.com",
            copyright: "Español Honesto. Все права защищены.",
        },
        styleSwitcher: {
            title: "Доступные стили",
        },
        langSwitcher: {
            es: "ES",
            en: "EN",
            ru: "RU",
        },
    },
} as const;
