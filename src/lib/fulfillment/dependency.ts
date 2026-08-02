export class FulfillmentDependencyPendingError extends Error {
    constructor(message: string, public readonly delaySeconds = 30) {
        super(message);
        this.name = 'FulfillmentDependencyPendingError';
    }
}
