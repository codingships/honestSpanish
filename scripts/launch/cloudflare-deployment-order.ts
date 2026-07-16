export function newestWorkerDeployment<T extends Record<string, unknown>>(
    deployments: readonly T[],
): T | undefined {
    let newest = deployments[0];
    let newestTimestamp = deploymentTimestamp(newest);

    for (const deployment of deployments.slice(1)) {
        const timestamp = deploymentTimestamp(deployment);
        if (Number.isFinite(timestamp)
            && (!Number.isFinite(newestTimestamp) || timestamp > newestTimestamp)) {
            newest = deployment;
            newestTimestamp = timestamp;
        }
    }

    return newest;
}

export function newestWorkerDeploymentVersionId(value: unknown): string | null {
    if (!Array.isArray(value) || !value.every(isRecord)) return null;
    const timestamped = value.map((deployment) => ({
        deployment,
        timestamp: deploymentTimestamp(deployment),
    }));
    if (timestamped.length === 0 || timestamped.some(({ timestamp }) => !Number.isFinite(timestamp))) return null;
    const newestTimestamp = Math.max(...timestamped.map(({ timestamp }) => timestamp));
    const newestMatches = timestamped.filter(({ timestamp }) => timestamp === newestTimestamp);
    if (newestMatches.length !== 1) return null;

    const newest = newestMatches[0]?.deployment;
    if (!newest || !Array.isArray(newest.versions) || newest.versions.length !== 1) return null;

    const [version] = newest.versions;
    if (!isRecord(version) || typeof version.version_id !== 'string' || version.percentage !== 100) return null;

    return /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(version.version_id)
        ? version.version_id
        : null;
}

function deploymentTimestamp(deployment: Record<string, unknown> | undefined): number {
    const value = deployment?.created_on;
    return typeof value === 'string' ? Date.parse(value) : Number.NaN;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
