'use strict';

const fs = require('fs');
const program = require('commander');
const resolver = new(require('./resolutions/resolvers/SSGResolver'))();

program
.usage('<path-to-playbook>')
.parse(process.argv);

if (program.args.length !== 1) {
    return program.help();
}

const file = fs.readFileSync(program.args[0], 'utf-8');

try {
    resolver.parseResolution(file);
} catch (e) {
    console.log(`Template validation failed: ${e.message}: ${program.args[0]}`);
    process.exit(1);
}
