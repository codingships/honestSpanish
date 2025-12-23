import React, { useState, useEffect } from 'react';
import { Routes, Route, Navigate, useParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Helmet } from 'react-helmet-async';
import heroImage from './assets/hero.png';
import madridAtmosphere from './assets/madrid_atmosphere.png';
import noiseTexture from './assets/noise_texture.png';
import avatarAlejandro from './assets/avatar_alejandro.png';
import avatarAlin from './assets/avatar_alin.png';
import iconEsencial from './assets/icon-esencial.png';
import iconIntensivo from './assets/icon-intensivo.png';
import iconPremium from './assets/icon-premium.png';

const s = {
    bg: 'bg-[#E0F7FA]',
    text: 'text-[#006064]',
    accent: 'bg-[#006064]',
    accentText: 'text-white',
    border: 'border-[#006064]',
    secondaryBg: 'bg-white',
    button: 'bg-[#006064] text-white hover:bg-[#004d40]',
};

const supportedLanguages = ['es', 'en', 'ru'];

function LandingPage() {
    const { lang } = useParams();
    const navigate = useNavigate();
    const { t, i18n } = useTranslation();
    const [openFaq, setOpenFaq] = useState(null);

    const toggleFaq = (index) => {
        setOpenFaq(openFaq === index ? null : index);
    };

    useEffect(() => {
        if (lang && supportedLanguages.includes(lang)) {
            i18n.changeLanguage(lang);
        }
    }, [lang, i18n]);

    const handleLanguageChange = (newLang) => {
        navigate(`/${newLang}`);
    };

    return (
        <div className={`min-h-screen ${s.bg} ${s.text} transition-colors duration-300 font-sans selection:bg-black selection:text-white`}>
            <Helmet>
                <html lang={lang} />
                <title>{t('meta.title')}</title>
                <meta name="description" content={t('meta.description')} />

                {/* Open Graph */}
                <meta property="og:title" content={t('meta.title')} />
                <meta property="og:description" content={t('meta.description')} />
                <meta property="og:url" content={`https://espanolhonesto.com/${lang}`} />
                <meta property="og:image" content="https://espanolhonesto.com/og-image.jpg" />
                <meta property="og:locale" content={lang === 'en' ? 'en_US' : lang === 'ru' ? 'ru_RU' : 'es_ES'} />

                {/* Twitter */}
                <meta name="twitter:card" content="summary_large_image" />
                <meta name="twitter:title" content={t('meta.title')} />
                <meta name="twitter:description" content={t('meta.description')} />

                {/* Canonical & Alternates */}
                <link rel="canonical" href={`https://espanolhonesto.com/${lang}`} />
                <link rel="alternate" hrefLang="es" href="https://espanolhonesto.com/es" />
                <link rel="alternate" hrefLang="en" href="https://espanolhonesto.com/en" />
                <link rel="alternate" hrefLang="ru" href="https://espanolhonesto.com/ru" />
                <link rel="alternate" hrefLang="x-default" href="https://espanolhonesto.com/es" />

                {/* Schema.org JSON-LD */}
                <script type="application/ld+json">
                    {JSON.stringify({
                        "@context": "https://schema.org",
                        "@graph": [
                            {
                                "@type": "EducationalOrganization",
                                "name": "Español Honesto",
                                "description": t('meta.description'),
                                "url": "https://espanolhonesto.com",
                                "address": {
                                    "@type": "PostalAddress",
                                    "addressLocality": "Madrid",
                                    "addressCountry": "ES"
                                },
                                "email": "hola@espanolhonesto.com"
                            },
                            {
                                "@type": "FAQPage",
                                "mainEntity": t('faq.items', { returnObjects: true }).map(item => ({
                                    "@type": "Question",
                                    "name": item.question,
                                    "acceptedAnswer": {
                                        "@type": "Answer",
                                        "text": item.answer
                                    }
                                }))
                            },
                            {
                                "@type": "Course",
                                "name": t('pricing.plans.essential.name'),
                                "description": t('pricing.plans.essential.description'),
                                "provider": { "@type": "EducationalOrganization", "name": "Español Honesto" },
                                "offers": { "@type": "Offer", "price": "160", "priceCurrency": "EUR" }
                            },
                            {
                                "@type": "Course",
                                "name": t('pricing.plans.intensive.name'),
                                "description": t('pricing.plans.intensive.description'),
                                "provider": { "@type": "EducationalOrganization", "name": "Español Honesto" },
                                "offers": { "@type": "Offer", "price": "280", "priceCurrency": "EUR" }
                            },
                            {
                                "@type": "Course",
                                "name": t('pricing.plans.premium.name'),
                                "description": t('pricing.plans.premium.description'),
                                "provider": { "@type": "EducationalOrganization", "name": "Español Honesto" },
                                "offers": { "@type": "Offer", "price": "300", "priceCurrency": "EUR" }
                            }
                        ]
                    })}
                </script>
            </Helmet>

            {/* Navbar */}
            <nav className={`h-16 border-b-2 ${s.border} flex justify-between items-center px-4 md:px-8 sticky top-0 z-50 ${s.bg}`}>
                <div className="font-display text-xl tracking-tighter">{t('nav.brand')}</div>

                {/* Navigation Links - Hidden on Mobile */}
                <div className="hidden md:flex gap-6 items-center">
                    <a href="#metodo" className="font-mono text-xs uppercase tracking-wide hover:opacity-70 transition-opacity">{t('nav.method')}</a>
                    <a href="#progreso" className="font-mono text-xs uppercase tracking-wide hover:opacity-70 transition-opacity">{t('nav.progress')}</a>
                    <a href="#planes" className="font-mono text-xs uppercase tracking-wide hover:opacity-70 transition-opacity">{t('nav.plans')}</a>
                    <a href="#equipo" className="font-mono text-xs uppercase tracking-wide hover:opacity-70 transition-opacity">{t('nav.team')}</a>
                    <a href="#faq" className="font-mono text-xs uppercase tracking-wide hover:opacity-70 transition-opacity">{t('nav.faq')}</a>
                </div>

                {/* Language Switcher */}
                <div className="flex items-center gap-1 font-mono text-xs font-bold">
                    {supportedLanguages.map((lng) => (
                        <button
                            key={lng}
                            onClick={() => handleLanguageChange(lng)}
                            className={`px-2 py-1 border ${s.border} uppercase transition-colors ${lang === lng ? `${s.accent} ${s.accentText}` : 'opacity-70 hover:opacity-100'}`}
                        >
                            {lng}
                        </button>
                    ))}
                </div>

                <button className={`px-4 py-1 text-xs font-bold uppercase border ${s.border} hover:opacity-50 transition-opacity hidden md:block`}>
                    {t('nav.login')}
                </button>
            </nav>

            {/* Hero */}
            <header className={`border-b-2 ${s.border} relative z-20 bg-[#E0F7FA]`}>
                <div className="grid grid-cols-1 lg:grid-cols-12 h-auto lg:h-[calc(100vh-112px)]">
                    <div className={`lg:col-span-7 p-6 md:p-12 flex flex-col justify-start border-b-2 lg:border-b-0 lg:border-r-2 ${s.border}`}>
                        <div>
                            <h1 className="font-display text-[12vw] md:text-[9vw] lg:text-[7.5vw] leading-[1.1] lg:leading-[1.1] tracking-tighter break-words">
                                {t('hero.headline1')} <br />
                                <span className="italic">{t('hero.headline2')}</span> <br />
                                {t('hero.headline3')}
                            </h1>
                        </div>
                        <div className="mt-20 max-w-md">
                            <p className="font-mono text-sm md:text-base uppercase tracking-wide mb-6">{t('hero.manifesto')}</p>
                            <p className="text-lg md:text-xl font-bold leading-tight">{t('hero.subtitle')}</p>
                        </div>
                    </div>
                    <div className="lg:col-span-5 flex flex-col h-auto lg:h-full overflow-hidden">
                        <div className={`h-80 lg:h-auto lg:flex-1 border-b-2 ${s.border} relative overflow-hidden group`}>
                            <img src={heroImage} alt="Estudiante practicando español en un café de Madrid" className="w-full h-full object-cover grayscale group-hover:grayscale-0 transition-all duration-700" />
                        </div>
                        <div className={`lg:flex-1 ${s.secondaryBg} p-8 flex flex-col justify-center items-center text-center`}>
                            <h2 className="font-display text-4xl mb-6">{t('hero.ready')}</h2>
                            <a
                                href="mailto:hola@espanolhonesto.com"
                                className={`inline-block ${s.button} px-8 py-4 text-lg font-bold border-2 ${s.border} shadow-[4px_4px_0px_0px_currentColor] hover:shadow-none hover:translate-x-[2px] hover:translate-y-[2px] transition-all uppercase tracking-wider`}
                            >
                                {t('hero.cta')}
                            </a>
                        </div>
                    </div>
                </div>
            </header>

            {/* Ticker - Full Width */}
            <div className={`relative z-10 w-full border-b-2 ${s.border} overflow-hidden py-3 ${s.accent} ${s.accentText}`}>
                <div className="animate-marquee whitespace-nowrap font-mono font-bold text-sm md:text-base uppercase tracking-widest">
                    {t('ticker').repeat(8)}
                </div>
            </div>

            {/* El Problema (No Manifesto Label) */}
            <section
                className="bg-white py-24 px-6 border-b-2 border-[#006064]"
                style={{ backgroundImage: `url(${noiseTexture})`, backgroundSize: '200px' }}
            >
                <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-5 gap-12">
                    {/* Left Column */}
                    <div className="lg:col-span-2">
                        <h2 className="font-display text-4xl lg:text-5xl text-[#006064] mb-4" style={{ lineHeight: '1.55' }}>{t('problems.headline')}</h2>
                        <p className="font-sans text-xl text-[#006064]/70 font-medium">{t('problems.subtext')}</p>
                    </div>

                    {/* Right Column (Pain Points) */}
                    <div className="lg:col-span-3 space-y-8">
                        {t('problems.statements', { returnObjects: true }).map((statement, index) => (
                            <div key={index} className="relative pl-2">
                                <span className="absolute -top-6 -left-4 font-display text-8xl text-[#006064]/10 select-none pointer-events-none">
                                    0{index + 1}
                                </span>
                                <p className="relative z-10 font-sans text-lg md:text-xl text-[#006064] font-medium leading-relaxed">
                                    {statement}
                                </p>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* El Método (Manifesto 003) */}
            <section id="metodo" className="bg-[#006064] py-24 px-6 border-b-2 border-[#006064]">
                <div className="max-w-6xl mx-auto">
                    {/* Header */}
                    <div className="mb-16">
                        <h2 className="font-display text-4xl lg:text-5xl text-white mb-6 leading-tight">{t('method.headline')}</h2>

                        {/* Manifesto Block (Hero Style) */}
                        <div className="max-w-md mb-12">
                            <p className="text-[#E0F7FA]/70 font-mono text-sm md:text-base uppercase tracking-wide mb-4">{t('method.manifesto')}</p>
                            <p className="font-sans text-lg md:text-xl text-white font-bold leading-tight">{t('method.closing')}</p>
                        </div>

                        <p className="font-sans text-xl text-[#E0F7FA] font-medium max-w-2xl">{t('method.subtitle')}</p>
                    </div>

                    {/* 3 Columns */}
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-12">
                        {t('method.columns', { returnObjects: true }).map((col, index) => (
                            <div key={index} className="relative">
                                <span className="font-display text-6xl text-white/20 mb-4 block select-none">
                                    {col.number}
                                </span>
                                <h3 className="font-display text-xl text-white mb-4 uppercase tracking-wide">{col.title}</h3>
                                <p className="font-sans text-base text-[#E0F7FA] leading-relaxed">
                                    {col.description}
                                </p>
                            </div>
                        ))}
                    </div>

                    {/* Closing Statement */}
                    <div className="mt-24 pt-12 border-t border-white/20">
                    </div>
                </div>
            </section>

            {/* Atmosphere Break */}
            <div className={`w-full h-64 md:h-96 overflow-hidden border-b-2 ${s.border} relative`}>
                <img src={madridAtmosphere} alt="Vista atmosférica del centro de Madrid" className="w-full h-full object-cover grayscale" />
                <div className="absolute inset-0 bg-[#006064]/20 mix-blend-multiply"></div>
            </div>

            {/* Tu Progreso (Manifesto 004) */}
            <section id="progreso" className="bg-[#E0F7FA] py-24 px-6 border-b-2 border-[#006064]">
                <div className="max-w-6xl mx-auto grid grid-cols-1 lg:grid-cols-5 gap-12">
                    {/* Left Column */}
                    <div className="lg:col-span-2">
                        <h2 className="font-display text-4xl lg:text-5xl text-[#006064] mb-4 leading-tight">{t('progress.headline')}</h2>

                        {/* Manifesto Block (Hero Style) */}
                        <div className="max-w-md mb-8">
                            <p className="text-[#006064]/70 font-mono text-sm md:text-base uppercase tracking-wide mb-4">{t('progress.manifesto')}</p>
                            <p className="font-sans text-lg md:text-xl text-[#006064] font-bold leading-tight">{t('progress.closing')}</p>
                        </div>

                        <h3 className="font-sans text-xl text-[#006064]/80 mb-6 font-medium">{t('progress.subheadline')}</h3>
                        <p className="font-sans text-base text-[#006064]/70 mb-12 leading-relaxed">
                            {t('progress.paragraph')}
                        </p>
                    </div>

                    {/* Right Column (Timeline) */}
                    <div className="lg:col-span-3 pl-4 md:pl-0">
                        <div className="space-y-12 border-l-2 border-[#006064]/30 pl-8 md:pl-12 relative">
                            {t('progress.milestones', { returnObjects: true }).map((milestone, index) => (
                                <div key={index} className="relative">
                                    <div className="absolute -left-[39px] md:-left-[55px] top-2 w-4 h-4 rounded-full bg-[#006064] border-2 border-[#E0F7FA]"></div>
                                    <h4 className="font-display text-xl text-[#006064] mb-2">{milestone.months}</h4>
                                    <p className="font-sans text-base text-[#006064]/70 leading-relaxed">
                                        {milestone.description}
                                    </p>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Closing Statement */}
                {/* Closing Statement Removed */}
            </section>

            {/* Pricing */}
            <section id="planes" className={`bg-white py-24 px-4 md:px-8 border-b-2 ${s.border}`}>
                <div className="max-w-7xl mx-auto">
                    <div className={`flex items-end justify-between mb-12 border-b-4 ${s.border} pb-4`}>
                        <h2 className="font-display text-6xl md:text-8xl tracking-tighter">{t('pricing.title')}</h2>
                        <span className="font-mono text-sm mb-2 hidden md:block">{t('pricing.subtitle')}</span>
                    </div>
                    <div className={`border-t-2 ${s.border}`}>
                        <div className="hidden md:grid grid-cols-12 gap-4 py-4 font-mono text-xs uppercase tracking-widest opacity-60">
                            <div className="col-span-3">{t('pricing.headers.name')}</div>
                            <div className="col-span-2">{t('pricing.headers.price')}</div>
                            <div className="col-span-5">{t('pricing.headers.includes')}</div>
                            <div className="col-span-2 text-center">{t('pricing.headers.action')}</div>
                        </div>

                        {/* Essential */}
                        <div className={`grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-4 py-8 border-t-2 ${s.border} items-center`}>
                            <div className="col-span-3"><h3 className="font-display text-3xl">{t('pricing.plans.essential.name')}</h3><p className="text-sm opacity-70 mt-1">{t('pricing.plans.essential.description')}</p></div>
                            <div className="col-span-2 font-mono text-2xl font-bold">€160<span className="text-sm font-normal">{t('pricing.month')}</span></div>
                            <div className="col-span-5 text-sm font-medium space-y-1">{t('pricing.plans.essential.features', { returnObjects: true }).map((f, i) => <p key={i}>• {f}</p>)}</div>
                            <div className="col-span-2 flex justify-center"><button className={`w-auto px-6 py-2 border ${s.border} font-bold text-xs uppercase hover:${s.accent} hover:${s.accentText} transition-colors`}>{t('pricing.select')}</button></div>
                        </div>

                        {/* Intensive */}
                        <div className={`grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-4 py-12 border-t-2 border-b-2 ${s.border} items-center relative ${s.secondaryBg}`}>
                            <div className={`absolute top-0 left-0 ${s.accent} ${s.accentText} px-2 py-1 text-[10px] font-bold uppercase tracking-widest`}>{t('pricing.recommended')}</div>
                            <div className="col-span-3"><h3 className="font-display text-4xl">{t('pricing.plans.intensive.name')}</h3><p className="text-sm opacity-70 mt-1">{t('pricing.plans.intensive.description')}</p></div>
                            <div className="col-span-2 font-mono text-3xl font-bold">€280<span className="text-sm font-normal">{t('pricing.month')}</span></div>
                            <div className="col-span-5 text-sm font-bold space-y-1">{t('pricing.plans.intensive.features', { returnObjects: true }).map((f, i) => <p key={i}>• {f}</p>)}</div>
                            <div className="col-span-2 flex justify-center"><button className={`w-auto px-6 py-4 ${s.accent} ${s.accentText} font-bold text-sm uppercase border ${s.border} shadow-[4px_4px_0px_0px_currentColor] hover:shadow-none hover:translate-x-[1px] hover:translate-y-[1px] transition-all`}>{t('pricing.select')}</button></div>
                        </div>

                        {/* Premium */}
                        <div className={`grid grid-cols-1 md:grid-cols-12 gap-6 md:gap-4 py-8 border-b-2 ${s.border} items-center`}>
                            <div className="col-span-3"><h3 className="font-display text-3xl">{t('pricing.plans.premium.name')}</h3><p className="text-sm opacity-70 mt-1">{t('pricing.plans.premium.description')}</p></div>
                            <div className="col-span-2 font-mono text-2xl font-bold">€300<span className="text-sm font-normal">{t('pricing.month')}</span></div>
                            <div className="col-span-5 text-sm font-medium space-y-1">{t('pricing.plans.premium.features', { returnObjects: true }).map((f, i) => <p key={i}>• {f}</p>)}</div>
                            <div className="col-span-2 flex justify-center"><button className={`w-auto px-6 py-2 border ${s.border} font-bold text-xs uppercase hover:${s.accent} hover:${s.accentText} transition-colors`}>{t('pricing.select')}</button></div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Quiénes Somos (Team) */}
            <section id="equipo" className="bg-white py-24 px-6 border-b-2 border-[#006064]">
                <div className="max-w-6xl mx-auto">
                    <div className="text-center mb-16">
                        <h2 className="font-display text-4xl lg:text-5xl text-[#006064] mb-8">{t('team.headline')}</h2>

                        {/* Manifesto Block (Hero Style - Centered) */}
                        <div className="max-w-md mx-auto mb-8">
                            <p className="text-[#006064]/70 font-mono text-sm md:text-base uppercase tracking-wide mb-4">{t('team.manifesto')}</p>
                            <p className="font-sans text-lg md:text-xl text-[#006064] font-bold leading-tight">{t('team.closing')}</p>
                        </div>

                        <p className="font-sans text-xl text-[#006064]/70 max-w-2xl mx-auto">{t('team.subtitle')}</p>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                        {t('team.members', { returnObjects: true }).map((member, index) => (
                            <div key={index} className="flex flex-col">
                                <div className="aspect-square bg-gray-200 rounded-lg mb-4 w-full overflow-hidden border-2 border-[#006064]">
                                    <img
                                        src={index === 0 ? avatarAlejandro : avatarAlin}
                                        alt={index === 0 ? "Alejandro - Profesor principal de Español Honesto" : "Alin - Profesor y desarrollador de Español Honesto"}
                                        className="w-full h-full object-cover grayscale hover:grayscale-0 transition-all duration-500"
                                    />
                                </div>
                                <h3 className="font-display text-2xl text-[#006064] mb-1">{member.name}</h3>
                                <p className="font-sans text-sm uppercase tracking-wide text-[#006064]/50 mb-4">{member.role}</p>
                                <div className="flex flex-wrap gap-2 mb-4">
                                    {member.languages.map((lang, i) => (
                                        <span key={i} className="bg-[#006064]/10 text-[#006064] text-xs px-2 py-1 rounded font-bold">
                                            {lang}
                                        </span>
                                    ))}
                                </div>
                                <p className="font-sans text-base text-[#006064]/70">
                                    {member.bio}
                                </p>
                            </div>
                        ))}
                    </div>

                    {/* Closing Statement */}
                    {/* Closing Statement Removed */}
                </div>
            </section>

            {/* FAQ */}
            <section id="faq" className="bg-[#E0F7FA] py-24 px-6 border-b-2 border-[#006064]">
                <div className="max-w-4xl mx-auto">
                    <div className="text-center mb-16">
                        <h2 className="font-display text-4xl lg:text-5xl text-[#006064]">{t('faq.headline')}</h2>
                    </div>

                    <div className="space-y-4">
                        {t('faq.items', { returnObjects: true }).map((item, index) => (
                            <div key={index} className="border-b border-[#006064]/20">
                                <button
                                    onClick={() => toggleFaq(index)}
                                    className="w-full flex justify-between items-center py-6 text-left focus:outline-none group"
                                >
                                    <span className="font-sans font-semibold text-lg text-[#006064] pr-8">{item.question}</span>
                                    <span className={`text-[#006064] text-2xl font-bold transition-transform duration-300 ${openFaq === index ? 'rotate-45' : 'rotate-0'}`}>
                                        +
                                    </span>
                                </button>
                                <div
                                    className={`overflow-hidden transition-all duration-300 ${openFaq === index ? 'max-h-96 opacity-100 pb-6' : 'max-h-0 opacity-0'}`}
                                >
                                    <p className="font-sans text-base text-[#006064]/80 leading-relaxed">
                                        {item.answer}
                                    </p>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </section>

            {/* Footer */}
            <footer className={`${s.accent} ${s.accentText} py-24 px-6 border-t-2 ${s.border}`}>
                <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-12">
                    <div>
                        <h2 className="font-display text-[12vw] md:text-[8vw] leading-[0.8] tracking-tighter">{t('footer.cta1')}</h2>
                        <h2 className="font-display text-[12vw] md:text-[8vw] leading-[0.8] tracking-tighter opacity-50">{t('footer.cta2')}</h2>
                    </div>
                    <div className="flex flex-col justify-end items-start md:items-end">
                        <div className="font-mono text-sm uppercase tracking-widest mb-8 text-left md:text-right">{t('footer.address')}<br />{t('footer.city')}<br />{t('footer.email')}</div>
                        <p className="font-sans text-xs opacity-60">&copy; {new Date().getFullYear()} {t('footer.copyright')}</p>
                    </div>
                </div>
            </footer>


        </div>
    );
}

function App() {
    return (
        <Routes>
            <Route path="/" element={<Navigate to="/es" replace />} />
            <Route path="/:lang" element={<LandingPage />} />
        </Routes>
    );
}

export default App;
