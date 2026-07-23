const errors = require('@tryghost/errors');

class EmailProviderBase {
    constructor(config) {
        Object.defineProperty(this, 'requiredFns', {
            value: ['send', 'getMaximumRecipients', 'getTargetDeliveryWindow'],
            writable: false
        });

        Object.defineProperty(this, 'config', {
            value: config || {},
            writable: true
        });
    }

    async send() {
        throw new errors.IncorrectUsageError({
            message: 'send() must be implemented by email provider adapter'
        });
    }
}

module.exports = EmailProviderBase;
