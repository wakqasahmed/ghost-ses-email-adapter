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
        error.statusCode = error.$metadata?.httpStatusCode;
        throw error;
    }
};
