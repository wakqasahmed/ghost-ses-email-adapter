'use strict';

const packageJson = require('../package.json');
require('should');

describe('package scaffold', function () {
    it('declares the Ghost SES adapter package contract', function () {
        packageJson.name.should.equal('ghost-ses-email-adapter');
        packageJson.main.should.equal('index.js');
        packageJson.license.should.equal('MIT');
        packageJson.engines.node.should.equal('>=20');
        packageJson.dependencies.should.have.property('@aws-sdk/client-ses');
        packageJson.contributors.should.containEql('Daniel Raffel (@danielraffel) <https://github.com/danielraffel>');
    });
});
