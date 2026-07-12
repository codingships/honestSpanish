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

function deploymentTimestamp(deployment: Record<string, unknown> | undefined): number {
    const value = deployment?.created_on;
    return typeof value === 'string' ? Date.parse(value) : Number.NaN;
}
