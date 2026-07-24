const errors = require('@tryghost/errors');
const debug = require('@tryghost/debug')('email-analytics:ses-adapter');

const MAX_MESSAGES_PER_POLL = 10;
const LONG_POLL_SECONDS = 20;

class SESAnalyticsProvider {
    #config;
    #sqsClient;

    constructor(config = {}) {
        const sesConfig = config.ses || config;

        if (!sesConfig.queueUrl) {
            throw new errors.IncorrectUsageError({
                message: 'SES analytics adapter requires queueUrl in configuration'
            });
        }

        if (!sesConfig.region) {
            throw new errors.IncorrectUsageError({
                message: 'SES analytics adapter requires region in configuration'
            });
        }

        const {SQSClient} = require('@aws-sdk/client-sqs');
        const clientConfig = {region: sesConfig.region};

        if (sesConfig.accessKeyId && sesConfig.secretAccessKey) {
            clientConfig.credentials = {
                accessKeyId: sesConfig.accessKeyId,
                secretAccessKey: sesConfig.secretAccessKey
            };
        }

        Object.defineProperty(this, 'requiredFns', {
            value: ['fetchLatest'],
            writable: false
        });

        this.#config = sesConfig;
        this.#sqsClient = new SQSClient(clientConfig);
    }

    async fetchLatest(batchHandler, options = {}) {
        const {DeleteMessageCommand, ReceiveMessageCommand} = require('@aws-sdk/client-sqs');
        const maxEvents = options.maxEvents ?? Infinity;
        let eventCount = 0;

        while (eventCount < maxEvents) {
            const response = await this.#sqsClient.send(new ReceiveMessageCommand({
                QueueUrl: this.#config.queueUrl,
                MaxNumberOfMessages: Math.min(MAX_MESSAGES_PER_POLL, maxEvents - eventCount),
                WaitTimeSeconds: LONG_POLL_SECONDS,
                VisibilityTimeout: 60
            }));
            const messages = response.Messages || [];

            if (messages.length === 0) {
                return;
            }

            for (const message of messages) {
                const events = this.#parseMessage(message);

                if (events.length > 0) {
                    await batchHandler(events);
                    eventCount += events.length;
                }

                await this.#sqsClient.send(new DeleteMessageCommand({
                    QueueUrl: this.#config.queueUrl,
                    ReceiptHandle: message.ReceiptHandle
                }));
            }
        }
    }

    #parseMessage(message) {
        let event;

        try {
            event = JSON.parse(message.Body);
            if (event.Type === 'Notification' && typeof event.Message === 'string') {
                event = JSON.parse(event.Message);
            }
        } catch (err) {
            debug(`Skipping malformed SES SQS message ${message.MessageId || 'unknown'}: ${err.message}`);
            return [];
        }

        const eventType = event.eventType || event.notificationType;
        const mail = event.mail;
        const emailId = mail?.tags?.['email-id']?.[0];
        const providerId = mail?.messageId;

        if (!eventType || !emailId || !providerId) {
            debug(`Skipping SES event ${message.MessageId || 'unknown'} without event type, email-id tag, or message ID`);
            return [];
        }

        if (eventType === 'Delivery') {
            return this.#mapRecipients({
                messageId: message.MessageId,
                recipients: event.delivery?.recipients || mail.destination,
                timestamp: event.delivery?.timestamp,
                type: 'delivered',
                emailId,
                providerId
            });
        }

        if (eventType === 'Bounce') {
            return (event.bounce?.bouncedRecipients || []).flatMap(recipient => this.#mapRecipients({
                messageId: event.bounce?.feedbackId || message.MessageId || 'bounce',
                recipients: [recipient.emailAddress],
                timestamp: event.bounce?.timestamp,
                type: 'failed',
                severity: event.bounce?.bounceType === 'Permanent' ? 'permanent' : 'temporary',
                error: {
                    code: recipient.status || event.bounce?.bounceType || 'Bounce',
                    message: recipient.diagnosticCode || `SES ${event.bounce?.bounceType || 'Unknown'} bounce`,
                    enhancedCode: recipient.status || null
                },
                emailId,
                providerId
            }));
        }

        if (eventType === 'Complaint') {
            return (event.complaint?.complainedRecipients || []).flatMap(recipient => this.#mapRecipients({
                messageId: event.complaint?.feedbackId || message.MessageId || 'complaint',
                recipients: [recipient.emailAddress],
                timestamp: event.complaint?.timestamp,
                type: 'complained',
                emailId,
                providerId
            }));
        }

        if (eventType === 'Open') {
            const recipients = mail.destination || [];
            if (recipients.length !== 1) {
                debug(`Skipping SES Open event ${message.MessageId || 'unknown'} with ${recipients.length} recipients`);
                return [];
            }

            return this.#mapRecipients({
                messageId: message.MessageId,
                recipients,
                timestamp: event.open?.timestamp,
                type: 'opened',
                emailId,
                providerId
            });
        }

        if (eventType === 'Click') {
            // Ghost's /r/ redirect tracks clicks independently; SES Click data has no Ghost analytics event type.
            debug(`Skipping supplementary SES Click event ${message.MessageId || 'unknown'}`);
            return [];
        }

        debug(`Skipping unsupported SES event type ${eventType}`);
        return [];
    }

    #mapRecipients({messageId, recipients, timestamp, type, severity, error, emailId, providerId}) {
        const eventTimestamp = new Date(timestamp);

        if (!timestamp || Number.isNaN(eventTimestamp.getTime()) || !Array.isArray(recipients)) {
            debug(`Skipping malformed SES ${type} event`);
            return [];
        }

        return recipients.filter(Boolean).map((recipientEmail, index) => ({
            id: `${messageId || providerId}:${index}`,
            type,
            ...(severity ? {severity} : {}),
            ...(error ? {error} : {}),
            emailId,
            providerId,
            recipientEmail,
            timestamp: eventTimestamp
        }));
    }
}

module.exports = SESAnalyticsProvider;
