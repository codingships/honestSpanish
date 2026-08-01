export class FulfillmentDependencyPendingError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'FulfillmentDependencyPendingError';
    }
}
