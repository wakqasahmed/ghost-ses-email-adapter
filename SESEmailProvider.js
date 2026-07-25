const EmailProviderBase = require('./EmailProviderBase');
const errors = require('@tryghost/errors');
const debug = require('@tryghost/debug')('email-service:ses-adapter');
const crypto = require('node:crypto');
const DirectSESSender = require('./DirectSESSender');
const LambdaSESSender = require('./LambdaSESSender');

// Keep retry recipient state short-lived in practice and bounded to 1,000 keys to limit memory and PII retention.
const MAX_RETRY_STATE_ENTRIES = 1000;

/**
 * Amazon SES Email Provider Adapter
 *
 * Sends emails through Amazon SES bulk email API.
 * Extends EmailProviderBase to work with Ghost's AdapterManager.
 */
class SESEmailProvider extends EmailProviderBase {
    #sender;
    #config;
    #sesConfig;
    #errorHandler;
    #successfulRecipients = new Map();
    #inFlightSends = new Map();

    /**
     * @param {Object} config - Adapter configuration
     * @param {Object} config.ses - SES client configuration
     * @param {string} config.ses.region - AWS region (e.g., 'us-west-1')
     * @param {string} [config.ses.accessKeyId] - AWS access key ID (optional if using IAM role)
     * @param {string} [config.ses.secretAccessKey] - AWS secret access key
     * @param {string} config.ses.fromEmail - Verified sender email address
     * @param {string} [config.ses.configurationSet] - SES configuration set name
     * @param {Function} [config.errorHandler] - Error handler for logging exceptions
     */
    constructor(config) {
        super(config);

        // Config can be passed in two ways:
        // 1. Direct config from adapter manager: { region, accessKeyId, ... }
        // 2. Wrapped config: { ses: { region, accessKeyId, ... } }
        const sesConfig = config.ses || config;

        // Validate required configuration
        if (!sesConfig.region) {
            throw new errors.IncorrectUsageError({
                message: 'SES adapter requires region in configuration'
            });
        }

        if (!sesConfig.fromEmail) {
            throw new errors.IncorrectUsageError({
                message: 'SES adapter requires fromEmail in configuration'
            });
        }

        // Store full config to preserve root-level fields
        this.#config = config;
        this.#sesConfig = sesConfig;
        this.#errorHandler = config.errorHandler;

        if (sesConfig.transport !== undefined && sesConfig.transport !== 'direct' && sesConfig.transport !== 'lambda') {
            throw new errors.IncorrectUsageError({
                message: `SES adapter transport must be 'direct' or 'lambda', got '${sesConfig.transport}'`
            });
        }

        if (sesConfig.transport === 'lambda') {
            if (!sesConfig.lambda?.functionName) {
                throw new errors.IncorrectUsageError({
                    message: 'SES Lambda transport requires functionName in configuration'
                });
            }

            this.#sender = new LambdaSESSender(sesConfig);
        } else {
            this.#sender = new DirectSESSender(sesConfig);
        }
    }

    /**
     * Sanitize email header value to prevent header injection attacks
     * @private
     * @param {string} value - Header value to sanitize
     * @returns {string} Sanitized header value
     */
    #sanitizeHeader(value) {
        if (!value) {
            return '';
        }
        // Remove all CR and LF characters to prevent header injection
        return String(value).replace(/[\r\n]/g, '');
    }

    #encodeHeaderValue(value, fold = true) {
        const sanitizedValue = this.#sanitizeHeader(value);

        if (!/[^\x20-\x7E]/.test(sanitizedValue)) {
            return sanitizedValue;
        }

        const maxEncodedTextLength = 48;
        const maxUtf8Bytes = maxEncodedTextLength / 4 * 3;
        const encodedWords = [];
        let word = '';
        let wordLength = 0;

        for (const character of sanitizedValue) {
            const characterLength = Buffer.byteLength(character, 'utf8');

            if (wordLength + characterLength > maxUtf8Bytes) {
                encodedWords.push(`=?UTF-8?B?${Buffer.from(word, 'utf8').toString('base64')}?=`);
                word = '';
                wordLength = 0;
            }

            word += character;
            wordLength += characterLength;
        }

        if (word) {
            encodedWords.push(`=?UTF-8?B?${Buffer.from(word, 'utf8').toString('base64')}?=`);
        }

        return encodedWords.join(fold ? '\r\n ' : ' ');
    }

    #encodeAddressHeader(value, headerName, fold = true) {
        const sanitizedValue = this.#sanitizeHeader(value);
        const addressMatch = sanitizedValue.match(/^(.*?)(\s*<[^<>]+>)$/);

        if (!addressMatch) {
            return this.#encodeHeaderValue(sanitizedValue, fold);
        }

        const displayName = addressMatch[1].trim();
        if (!displayName) {
            return addressMatch[2].trim();
        }

        const encodedDisplayName = this.#encodeHeaderValue(displayName, fold);
        const address = addressMatch[2].trim();

        if (fold && (encodedDisplayName.includes('\r\n') || `${headerName}: ${encodedDisplayName} ${address}`.length > 76)) {
            return `${encodedDisplayName}\r\n ${address}`;
        }

        return `${encodedDisplayName} ${address}`;
    }

    #getConfigurationSetName(options = {}) {
        const configurationSets = this.#sesConfig.configurationSets;
        const openTrackingEnabled = !!options.openTrackingEnabled;
        const clickTrackingEnabled = !!options.clickTrackingEnabled;

        if (configurationSets) {
            if (openTrackingEnabled && clickTrackingEnabled) {
                return configurationSets.openAndClick;
            }
            if (openTrackingEnabled) {
                return configurationSets.openOnly;
            }
            if (clickTrackingEnabled) {
                return configurationSets.clickOnly;
            }
            return configurationSets.disabled;
        }

        return openTrackingEnabled && clickTrackingEnabled ? this.#sesConfig.configurationSet : undefined;
    }

    #getListUnsubscribeUrl(replacements = []) {
        const replacement = replacements.find(item => item.id === 'list_unsubscribe');
        return replacement?.value ? this.#sanitizeHeader(replacement.value).trim() : '';
    }

    // Only applies PII redaction - callers that need a human-readable fallback for a
    // missing message (e.g. 'SES Error') must apply it themselves after calling this,
    // so the fallback text never leaks into non-message fields like name/code.
    #redactPII(value, recipients = []) {
        let redactedValue = String(value || '');

        for (const recipient of recipients) {
            redactedValue = redactedValue.split(String(recipient.email)).join('[redacted]');
        }

        return redactedValue.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[redacted]');
    }

    // Ghost sends one newsletter as multiple concurrent batches that all share the
    // same emailId (batch-sending-service.js runs up to 2 workers at once). Keying
    // retry/in-flight state on emailId alone made two different batches of the same
    // email collide - one batch's promise was silently returned to the other caller,
    // and its recipients were never sent. Folding a recipient-set digest into the key
    // keeps genuine retries of the same batch coalescing correctly while giving every
    // distinct batch its own key.
    #getRetryKey({emailId, idempotencyKey, subject, html, plaintext, from, replyTo, recipients, replacementDefinitions, options}) {
        const recipientDigest = crypto.createHash('sha256')
            .update(recipients.map(recipient => recipient.email).sort().join(','))
            .digest('hex');

        if (emailId) {
            return `email:${emailId}:${recipientDigest}`;
        }

        if (idempotencyKey) {
            return `idempotency:${idempotencyKey}:${recipientDigest}`;
        }

        const payload = JSON.stringify({
            subject,
            html,
            plaintext,
            from: from || this.#sesConfig.fromEmail,
            replyTo,
            recipients,
            replacementDefinitions,
            options
        });

        return `payload:${crypto.createHash('sha256').update(payload).digest('hex')}`;
    }

    #rememberSuccessfulRecipients(retryKey, successfulRecipients) {
        this.#successfulRecipients.delete(retryKey);
        this.#successfulRecipients.set(retryKey, successfulRecipients);

        if (this.#successfulRecipients.size > MAX_RETRY_STATE_ENTRIES) {
            this.#successfulRecipients.delete(this.#successfulRecipients.keys().next().value);
        }
    }

    /**
     * Chunk array into smaller arrays
     * @private
     * @param {Array} array - Array to chunk
     * @param {number} size - Chunk size
     * @returns {Array} Array of chunks
     */
    #chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    /**
     * Build MIME email content for a single recipient
     * @private
     * @param {Object} params - Email parameters
     * @param {string} params.from - From address
     * @param {string} params.to - To address (recipient email)
     * @param {string} params.subject - Email subject
     * @param {string} params.html - HTML content
     * @param {string} params.plaintext - Plain text content
     * @param {string} [params.replyTo] - Reply-to address
     * @returns {string} MIME formatted email
     */
    #buildMIMEEmail({from, to, subject, html, plaintext, replyTo, listUnsubscribe}) {
        const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substring(7)}`;

        // Sanitize all header values to prevent header injection attacks
        const sanitizedFrom = this.#sanitizeHeader(from);
        const sanitizedTo = this.#sanitizeHeader(to);
        const encodedFrom = this.#encodeAddressHeader(sanitizedFrom, 'From');
        const encodedSubject = this.#encodeHeaderValue(subject);
        const encodedReplyTo = this.#encodeAddressHeader(replyTo, 'Reply-To');

        // Extract domain from 'from' address for Message-ID
        const domain = sanitizedFrom.match(/@([^>]+)/)?.[1] || 'localhost';
        const messageId = `<${Date.now()}.${Math.random().toString(36).substring(2)}@${domain}>`;

        let mime = [
            `From: ${encodedFrom}`,
            `To: ${sanitizedTo}`,
            `Subject: ${encodedSubject}`,
            `Date: ${new Date().toUTCString()}`,
            `Message-ID: ${messageId}`
        ];

        if (encodedReplyTo) {
            mime.push(`Reply-To: ${encodedReplyTo}`);
        }

        if (listUnsubscribe) {
            mime.push(`List-Unsubscribe: <${listUnsubscribe}>`);
            if (listUnsubscribe.startsWith('https://')) {
                mime.push('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
            }
        }

        // Encode content as quoted-printable
        const encodedPlaintext = this.#encodeQuotedPrintable(plaintext || '');
        const encodedHtml = this.#encodeQuotedPrintable(html || '');

        mime = mime.concat([
            'MIME-Version: 1.0',
            `Content-Type: multipart/alternative; boundary="${boundary}"`,
            '',
            `--${boundary}`,
            'Content-Type: text/plain; charset=UTF-8',
            'Content-Transfer-Encoding: quoted-printable',
            '',
            encodedPlaintext,
            '',
            `--${boundary}`,
            'Content-Type: text/html; charset=UTF-8',
            'Content-Transfer-Encoding: quoted-printable',
            '',
            encodedHtml,
            '',
            `--${boundary}--`
        ]);

        return mime.join('\r\n');
    }

    /**
     * Escape HTML special characters to prevent XSS
     * @private
     * @param {string} str - String to escape
     * @returns {string} HTML-escaped string
     */
    #escapeHtml(str) {
        const htmlEscapes = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            '\'': '&#x27;',
            '/': '&#x2F;'
        };
        return String(str).replace(/[&<>"'/]/g, char => htmlEscapes[char]);
    }

    /**
     * Encode string as quoted-printable (RFC 2045)
     * Works on UTF-8 bytes, not UTF-16 code units
     * @private
     * @param {string} str - String to encode
     * @returns {string} Quoted-printable encoded string
     */
    #encodeQuotedPrintable(str) {
        if (!str) {
            return '';
        }

        // Convert string to UTF-8 bytes
        const utf8Bytes = Buffer.from(str, 'utf8');

        let encoded = '';
        let lineLength = 0;

        for (let i = 0; i < utf8Bytes.length; i++) {
            const byte = utf8Bytes[i];
            const nextByte = i + 1 < utf8Bytes.length ? utf8Bytes[i + 1] : null;

            // RFC 2045: Preserve CRLF sequences as literal \r\n (not encoded)
            if (byte === 0x0D && nextByte === 0x0A) {
                // Hard line break - preserve as-is
                encoded += '\r\n';
                lineLength = 0;
                i += 1; // Skip the LF byte (already processed)
                continue;
            }

            // Check if trailing space/tab before line break
            const isTrailingSpace = (byte === 0x20 || byte === 0x09) &&
                                   (nextByte === 0x0D || nextByte === 0x0A || nextByte === null);

            // RFC 2045: Must encode if:
            // - Outside printable ASCII range (33-126, excluding 61)
            // - Equals sign (61 = '=')
            // - Trailing space or tab before line break
            // - Standalone CR or LF (not part of CRLF)
            if (byte < 33 || byte > 126 || byte === 61 || isTrailingSpace) {
                // Encode as =XX
                const hex = byte.toString(16).toUpperCase().padStart(2, '0');
                encoded += '=' + hex;
                lineLength += 3;
            } else {
                // Safe printable character
                encoded += String.fromCharCode(byte);
                lineLength += 1;
            }

            // Soft line break at 75 chars (leave room for =\r\n)
            // Don't break if we're about to hit a hard line break
            if (lineLength >= 75 && i + 1 < utf8Bytes.length) {
                const next = utf8Bytes[i + 1];
                // Check if next is start of CRLF sequence
                const isNextCRLF = next === 0x0D && i + 2 < utf8Bytes.length && utf8Bytes[i + 2] === 0x0A;
                if (!isNextCRLF) {
                    encoded += '=\r\n';
                    lineLength = 0;
                }
            }
        }

        return encoded;
    }

    /**
     * Process replacement tokens in content
     * @private
     * @param {string} content - Content with %%{...}%% tokens
     * @param {Array} replacements - Array of {id, value} objects
     * @param {Array} replacementDefinitions - Array of {id, token} objects defining the tokens
     * @param {boolean} isHtml - Whether content is HTML (requires escaping)
     * @returns {string} Content with tokens replaced
     */
    #processReplacements(content, replacements, replacementDefinitions = [], isHtml = false) {
        if (!content || !replacements || replacements.length === 0) {
            return content;
        }

        let processedContent = content;

        for (const replacement of replacements) {
            // Find the token string from replacementDefinitions using the replacement id
            const token = replacement.token || replacementDefinitions.find(def => def.id === replacement.id)?.token;
            if (!token) {
                continue;
            }

            // Get value, defaulting to empty string if null/undefined
            let value = replacement.value !== null && replacement.value !== undefined
                ? String(replacement.value)
                : '';

            // Escape HTML entities in values when processing HTML content (XSS prevention)
            if (isHtml) {
                value = this.#escapeHtml(value);
            }

            // Replace all occurrences of this token (global replace)
            // Handle both string tokens and RegExp tokens
            let tokenRegex;
            if (token instanceof RegExp) {
                // If already a RegExp, ensure it has global flag
                const flags = token.flags.includes('g') ? token.flags : `${token.flags}g`;
                tokenRegex = new RegExp(token.source, flags);
            } else {
                // If string, escape special chars and create RegExp
                const escapedToken = String(token).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                tokenRegex = new RegExp(escapedToken, 'g');
            }
            processedContent = processedContent.replace(tokenRegex, () => value);
        }

        return processedContent;
    }

    /**
     * Create AWS SES error message for storing in the database
     * @private
     * @param {Object} error - AWS error object
     * @returns {string} Error message (max 2000 chars)
     */
    #createSESErrorMessage(error, recipients) {
        const message = (this.#redactPII(error?.message, recipients) || 'SES Error') + (error?.$metadata?.httpStatusCode ? ` (${error.$metadata.httpStatusCode})` : '');
        return message.slice(0, 2000);
    }

    /**
     * Send bulk email without personalization (efficient for large newsletters)
     * Sends ONE email with up to 50 recipients per batch, routed via the
     * SendRawEmailCommand `Destinations` field (no Bcc header is written -
     * SES documents no guarantee that a Bcc header is stripped before
     * delivery, and Destinations alone is sufficient for routing).
     * Note: Ghost's sending-service always attaches per-recipient
     * replacements (e.g. the unsubscribe token), so #hasPersonalization is
     * effectively always true in real Ghost sends and this path is not
     * currently reachable from Ghost - see issue #57.
     * @private
     */
    async #sendBulk({subject, html, plaintext, from, replyTo, emailId, recipients, retryKey, startTime, options}) {
        const BATCH_SIZE = 50;
        const successfulRecipients = this.#successfulRecipients.get(retryKey) || new Set();
        const pendingRecipients = recipients.filter(recipient => !successfulRecipients.has(recipient.email));
        const batches = this.#chunkArray(pendingRecipients, BATCH_SIZE);
        const results = [];

        debug(`sending bulk email to ${recipients.length} recipients in ${batches.length} batches`);

        for (const batch of batches) {
            const sanitizedFrom = this.#sanitizeHeader(from || this.#sesConfig.fromEmail);
            const encodedFrom = this.#encodeAddressHeader(sanitizedFrom, 'From');
            const source = this.#encodeAddressHeader(sanitizedFrom, undefined, false);
            const encodedSubject = this.#encodeHeaderValue(subject);
            const encodedReplyTo = this.#encodeAddressHeader(replyTo, 'Reply-To');

            const encodedPlaintext = this.#encodeQuotedPrintable(plaintext || '');
            const encodedHtml = this.#encodeQuotedPrintable(html || '');

            const boundary = `----=_Part_${Date.now()}_${Math.random().toString(36).substring(7)}`;
            const domain = sanitizedFrom.match(/@([^>]+)/)?.[1] || 'localhost';
            const messageId = `<${Date.now()}.${Math.random().toString(36).substring(2)}@${domain}>`;

            let mime = [
                `From: ${encodedFrom}`,
                `To: undisclosed-recipients:;`,
                `Subject: ${encodedSubject}`,
                `Date: ${new Date().toUTCString()}`,
                `Message-ID: ${messageId}`
            ];

            if (encodedReplyTo) {
                mime.push(`Reply-To: ${encodedReplyTo}`);
            }

            mime = mime.concat([
                'MIME-Version: 1.0',
                `Content-Type: multipart/alternative; boundary="${boundary}"`,
                '',
                `--${boundary}`,
                'Content-Type: text/plain; charset=UTF-8',
                'Content-Transfer-Encoding: quoted-printable',
                '',
                encodedPlaintext,
                '',
                `--${boundary}`,
                'Content-Type: text/html; charset=UTF-8',
                'Content-Transfer-Encoding: quoted-printable',
                '',
                encodedHtml,
                '',
                `--${boundary}--`
            ]);

            const rawMessage = mime.join('\r\n');

            const response = await this.#sender.sendRawEmail({
                source,
                destinations: batch.map(r => r.email),
                rawMessage: Buffer.from(rawMessage),
                configurationSetName: this.#getConfigurationSetName(options),
                tags: [{
                    Name: 'email-id',
                    Value: emailId || 'unknown'
                }]
            });
            results.push(response.messageId);
            batch.forEach(recipient => successfulRecipients.add(recipient.email));
            this.#rememberSuccessfulRecipients(retryKey, successfulRecipients);
        }

        this.#successfulRecipients.delete(retryKey);

        const duration = Date.now() - startTime;
        const throughput = recipients.length / (Math.max(duration, 1) / 1000);
        debug(`sent bulk email to ${recipients.length} recipients in ${duration}ms (${throughput.toFixed(2)} emails/sec)`);
        debug(`SES returned ${results.length} batch MessageId(s)`);

        // Return first MessageId (represents the bulk send). If every recipient was
        // already sent in a prior attempt, results is empty here - fall back to the
        // retry key (unique per batch) rather than a generic 'unknown' string, so the
        // stored provider_id still traces back to a real send operation.
        return {
            id: results[0] || retryKey
        };
    }

    /**
     * Send an email using the Amazon SES API
     * @param {Object} data - Email data
     * @param {string} data.subject - Email subject
     * @param {string} data.html - Email HTML content
     * @param {string} data.plaintext - Email plain text content
     * @param {string} data.from - From address
     * @param {string} data.replyTo - Reply-to address
     * @param {string} data.emailId - Email ID
     * @param {Array} data.recipients - Array of recipients with {email, replacements}
     * @param {Array} data.replacementDefinitions - Replacement definitions
     * @param {Object} options - Send options
     * @param {boolean} options.openTrackingEnabled - Enable open tracking
     * @param {boolean} options.clickTrackingEnabled - Enable click tracking
     * @returns {Promise<{id: string}>} Provider message ID
     */
    async send(data, options = {}) {
        const {
            subject,
            html,
            plaintext,
            from,
            replyTo,
            emailId,
            idempotencyKey,
            recipients = [],
            replacementDefinitions = []
        } = data;
        const retryKey = this.#getRetryKey({emailId, idempotencyKey, subject, html, plaintext, from, replyTo, recipients, replacementDefinitions, options});
        const inFlightSend = this.#inFlightSends.get(retryKey);

        if (inFlightSend) {
            return inFlightSend;
        }

        const sendPromise = this.#send(data, options, retryKey);
        this.#inFlightSends.set(retryKey, sendPromise);

        try {
            return await sendPromise;
        } finally {
            if (this.#inFlightSends.get(retryKey) === sendPromise) {
                this.#inFlightSends.delete(retryKey);
            }
        }
    }

    async #send(data, options, retryKey) {
        const {
            subject,
            html,
            plaintext,
            from,
            replyTo,
            emailId,
            recipients = [],
            replacementDefinitions = []
        } = data;

        const startTime = Date.now();
        debug(`sending message to ${recipients.length} recipients with ${replacementDefinitions.length} replacements`);

        try {
            const hasPersonalization = recipients.some(recipient => recipient.replacements?.length);
            if (!hasPersonalization) {
                return await this.#sendBulk({subject, html, plaintext, from, replyTo, emailId, recipients, retryKey, startTime, options});
            }

            const configurationSetName = this.#getConfigurationSetName(options);
            const encodedFrom = this.#encodeAddressHeader(from || this.#sesConfig.fromEmail, undefined, false);
            const successfulRecipients = this.#successfulRecipients.get(retryKey) || new Set();
            const pendingRecipients = recipients.filter(recipient => !successfulRecipients.has(recipient.email));
            const results = [];
            let failedResult;

            for (const batch of this.#chunkArray(pendingRecipients, 10)) {
                const sendResults = await Promise.allSettled(batch.map(async (recipient) => {
                    const personalizedHtml = this.#processReplacements(html, recipient.replacements, replacementDefinitions, true);
                    const personalizedPlaintext = this.#processReplacements(plaintext, recipient.replacements, replacementDefinitions, false);
                    const rawMessage = this.#buildMIMEEmail({
                        from: from || this.#sesConfig.fromEmail,
                        to: recipient.email,
                        subject,
                        html: personalizedHtml,
                        plaintext: personalizedPlaintext,
                        replyTo,
                        listUnsubscribe: this.#getListUnsubscribeUrl(recipient.replacements)
                    });
                    const response = await this.#sender.sendRawEmail({
                        source: encodedFrom,
                        destinations: [recipient.email],
                        rawMessage: Buffer.from(rawMessage),
                        configurationSetName,
                        tags: [{
                            Name: 'email-id',
                            Value: emailId || 'unknown'
                        }]
                    });
                    return {messageId: response.messageId, recipient: recipient.email};
                }));

                for (const result of sendResults) {
                    if (result.status === 'fulfilled') {
                        successfulRecipients.add(result.value.recipient);
                        results.push(result.value);
                    } else if (!failedResult) {
                        failedResult = result;
                    }
                }
            }

            if (failedResult) {
                this.#rememberSuccessfulRecipients(retryKey, successfulRecipients);
                throw failedResult.reason;
            }

            this.#successfulRecipients.delete(retryKey);

            const duration = Date.now() - startTime;
            const throughput = recipients.length / (Math.max(duration, 1) / 1000);
            debug(`sent ${recipients.length} personalized messages in ${duration}ms (${throughput.toFixed(2)} emails/sec)`);
            debug(`SES returned ${results.length} individual MessageIds`);

            // Return first MessageId as provider_id (fits in 255 char column)
            // Analytics reconciliation can use:
            // 1. Each SES event has its own real MessageId (in providerId field)
            // 2. All events grouped by email-id tag (set in SES Tags)
            // 3. Database provider_id is just a reference, not used for matching
            // If every recipient was already sent in a prior attempt, results is empty
            // here - fall back to the retry key (unique per batch) rather than a
            // generic 'unknown' string.
            return {
                id: results[0]?.messageId || retryKey
            };
        } catch (e) {
            let ghostError;

            const redactedError = {
                name: this.#redactPII(e.name, recipients),
                message: this.#redactPII(e.message, recipients) || 'SES Error',
                code: this.#redactPII(e.code, recipients),
                statusCode: e.$metadata?.httpStatusCode
            };

            const errorDetails = JSON.stringify({
                error: redactedError,
                recipientCount: recipients.length
            }).slice(0, 2000);

            const sanitizedError = new Error(this.#redactPII(e.message, recipients) || 'SES Error');
            sanitizedError.name = this.#redactPII(e.name, recipients);
            sanitizedError.code = this.#redactPII(e.code, recipients);
            sanitizedError.$metadata = {httpStatusCode: e.$metadata?.httpStatusCode};

            ghostError = new errors.EmailError({
                statusCode: e.$metadata?.httpStatusCode || 500,
                message: this.#createSESErrorMessage(e, recipients),
                errorDetails,
                context: `Amazon SES Error: ${this.#redactPII(e.message, recipients) || 'SES Error'}`,
                help: 'https://ghost.org/docs/newsletters/#bulk-email-configuration',
                code: 'BULK_EMAIL_SEND_FAILED',
                err: sanitizedError
            });

            // Log to Sentry if error handler provided
            if (this.#errorHandler) {
                try {
                    // Promise resolution is fire-and-forget, catch to prevent unhandled rejection
                    Promise.resolve(this.#errorHandler(ghostError)).catch(() => {});
                } catch (handlerError) {
                    // Ignore handler errors - we still want to throw the original error
                }
            }

            throw ghostError;
        }
    }

    /**
     * Get maximum recipients per batch
     * @returns {number} Maximum number of recipients
     */
    getMaximumRecipients() {
        return 1;
    }

    /**
     * Get target delivery window in milliseconds (Ghost's batch-sending-service adds
     * this directly to Date.getTime()). SES sends immediately and this adapter does
     * not read options.deliveryTime, so 0 tells Ghost to skip delivery-time spreading
     * rather than advertise a window (the previous 3600 was also off by 1000x - Ghost
     * expects milliseconds, not seconds).
     * @returns {number} Delivery window in milliseconds
     */
    getTargetDeliveryWindow() {
        return 0;
    }
}

module.exports = SESEmailProvider;
