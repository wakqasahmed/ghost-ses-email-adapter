export default [
    {
        ignores: ['node_modules/', 'coverage/', 'reference/']
    },
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'commonjs',
            globals: {
                afterEach: 'readonly',
                beforeEach: 'readonly',
                Buffer: 'readonly',
                console: 'readonly',
                describe: 'readonly',
                it: 'readonly',
                module: 'readonly',
                process: 'readonly',
                require: 'readonly'
            }
        },
        rules: {
            'no-undef': 'error',
            'no-unreachable': 'error',
            'no-unused-vars': [
                'error',
                {
                    argsIgnorePattern: '^(err|handlerError|parent)$',
                    caughtErrors: 'none'
                }
            ]
        }
    }
];
