const {SESClient, SendRawEmailCommand} = require('@aws-sdk/client-ses');

const sesClient = new SESClient({});

exports.handler = async function (event) {
    try {
        if (process.env.CONFIGURATION_SET && event.configurationSetName !== process.env.CONFIGURATION_SET) {
            throw new Error('Unexpected SES configuration set');
        }

        const response = await sesClient.send(new SendRawEmailCommand({
            Source: event.source,
            Destinations: event.destinations,
            RawMessage: {Data: Buffer.from(event.rawMessage, 'base64')},
            ConfigurationSetName: event.configurationSetName,
            Tags: event.tags
        }));

        return {messageId: response.MessageId};
    } catch (error) {
        // The Lambda runtime only serializes errorType/errorMessage; append code and status
        // so the adapter's LambdaSESSender can restore them (it parses this exact suffix).
        const rethrown = new Error(`${error.message} [ses code=${error.code || error.name || 'Error'} status=${error.$metadata?.httpStatusCode || ''}]`);
        rethrown.name = error.name || 'Error';
        throw rethrown;
    }
};
