const astroEnvServerUrl = new URL('./astro-env-server-node.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
    if (specifier === 'astro:env/server') {
        return {
            url: astroEnvServerUrl,
            shortCircuit: true,
        };
    }

    return nextResolve(specifier, context);
}
