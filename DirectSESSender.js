class DirectSESSender {
    #sesClient;

    constructor(config) {
        const {SESClient} = require('@aws-sdk/client-ses');
        const clientConfig = {region: config.region};

        if (config.accessKeyId && config.secretAccessKey) {
            clientConfig.credentials = {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey
            };
        }

        this.#sesClient = new SESClient(clientConfig);
    }

    async sendRawEmail({source, destinations, rawMessage, configurationSetName, tags}) {
        const {SendRawEmailCommand} = require('@aws-sdk/client-ses');
        const response = await this.#sesClient.send(new SendRawEmailCommand({
            Source: source,
            Destinations: destinations,
            RawMessage: {Data: rawMessage},
            ConfigurationSetName: configurationSetName,
            Tags: tags
        }));

        return {messageId: response.MessageId};
    }
}

module.exports = DirectSESSender;
