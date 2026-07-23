const errors = require('@tryghost/errors');
const debug = require('@tryghost/debug')('email-suppression:ses-adapter');

/**
 * Amazon SES account-level suppression list adapter.
 *
 * This follows Ghost's proposed email-suppression adapter contract without
 * importing Ghost runtime classes, so it can be installed as a standalone
 * package.
 */
class SESSuppressionProvider {
    #sesClient;

    constructor(config = {}) {
        const sesConfig = config.ses || config;

        if (!sesConfig.region) {
            throw new errors.IncorrectUsageError({
                message: 'SES suppression adapter requires region in configuration'
            });
        }

        const {SESv2Client} = require('@aws-sdk/client-sesv2');
        const clientConfig = {region: sesConfig.region};

        if (sesConfig.accessKeyId && sesConfig.secretAccessKey) {
            clientConfig.credentials = {
                accessKeyId: sesConfig.accessKeyId,
                secretAccessKey: sesConfig.secretAccessKey
            };
        }

        Object.defineProperty(this, 'requiredFns', {
            value: ['getSuppressionData', 'getBulkSuppressionData', 'removeEmail'],
            writable: false
        });

        this.#sesClient = new SESv2Client(clientConfig);
    }

    async getSuppressionData(email) {
        const {GetSuppressedDestinationCommand} = require('@aws-sdk/client-sesv2');

        try {
            const response = await this.#sesClient.send(new GetSuppressedDestinationCommand({EmailAddress: email}));
            const destination = response.SuppressedDestination;

            if (!destination) {
                return {suppressed: false, info: null};
            }

            return {
                suppressed: true,
                info: {
                    reason: destination.Reason === 'COMPLAINT' ? 'spam' : 'fail',
                    timestamp: destination.LastUpdateTime
                }
            };
        } catch (err) {
            if (err.name === 'NotFoundException') {
                return {suppressed: false, info: null};
            }

            debug(`Unable to get SES suppression data: ${err.message}`);
            throw err;
        }
    }

    async getBulkSuppressionData(emails) {
        return Promise.all(emails.map(email => this.getSuppressionData(email)));
    }

    async removeEmail(email) {
        const {DeleteSuppressedDestinationCommand} = require('@aws-sdk/client-sesv2');

        try {
            await this.#sesClient.send(new DeleteSuppressedDestinationCommand({EmailAddress: email}));
            return true;
        } catch (err) {
            if (err.name !== 'NotFoundException') {
                debug(`Unable to remove SES suppressed destination: ${err.message}`);
            }
            return false;
        }
    }
}

module.exports = SESSuppressionProvider;
