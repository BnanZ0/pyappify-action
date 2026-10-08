const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

async function runAction({mode = 'frozen', reuse = false, failCommand = false, cached = false, buildOnly = false, profiles = ['default'], mirror = true} = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pyappify-action-frozen-'));
    const resolve = name => path.resolve(root, name);
    const write = (name, content) => {
        fs.mkdirSync(path.dirname(resolve(name)), {recursive: true});
        fs.writeFileSync(resolve(name), content);
    };
    const calls = [], outputs = {}, errors = [], bundles = [];
    const buildDir = path.join(root, 'p');
    const exe = path.join(buildDir, 'src-tauri/target/release/demo.exe');
    write('pyappify.yml', `name: demo\npackaging: packaging\n${mirror ? 'mirrorchyan:\n  resource_id: demo\n' : ''}profiles:\n${profiles.map(name => `  - name: ${name}`).join('\n')}\n`);
    const scaffold = () => {
        fs.mkdirSync(path.join(buildDir, 'src-tauri/assets'), {recursive: true});
        write(path.join(buildDir, 'src-tauri/tauri.conf.json'), JSON.stringify({productName: 'pyappify', version: '0.0.1'}));
        write(path.join(buildDir, 'src-tauri/Cargo.toml'), 'name = "pyappify"');
        write(path.join(buildDir, 'package.json'), '{}');
    };
    if (cached) {scaffold(); write(exe, 'signed launcher');}
    const fileSystem = {...fs};
    for (const method of ['existsSync', 'readFileSync', 'writeFileSync', 'mkdirSync', 'readdirSync', 'rmSync', 'chmodSync', 'createWriteStream']) {
        fileSystem[method] = (name, ...args) => fs[method](resolve(name), ...args);
    }
    fileSystem.copyFileSync = (from, to) => fs.copyFileSync(resolve(from), resolve(to));
    fileSystem.cpSync = (from, to, options) => fs.cpSync(resolve(from), resolve(to), options);
    const core = {
        getInput: name => ({package_mode: mode, version: 'v1.0.0', use_release: reuse ? 'https://api.github.com/repos/example/demo/releases/tags/v1.0.0' : ''})[name] ?? '',
        getBooleanInput: name => name === 'build_exe_only' && buildOnly,
        setOutput: (name, value) => {outputs[name] = value;},
        setFailed: error => errors.push(error),
        info() {}, startGroup() {}, endGroup() {}, addPath() {},
    };
    const exec = {async exec(command, args) {
        calls.push({command, args});
        if (command === 'git' && args[0] === 'clone') {
            scaffold();
        }
        if (command === 'pnpm' && args[0] === 'tauri' && args[1] === 'build') write(exe, 'compiled launcher');
        if (args[1] === 'frozen-zip') {
            if (failCommand) throw new Error('launcher frozen command failed');
            if (mirror) write(args[4], 'full zip');
            write(args[5], 'body zip');
        }
        if (args[1] === 'setup') write('pyappify_dist/demo/data/environment.txt', `profile:${args[3]}`);
        if (command === 'pnpm' && args[1] === 'bundle') {
            const data = path.join(buildDir, 'src-tauri/data/environment.txt');
            bundles.push(fs.existsSync(data) ? fs.readFileSync(data, 'utf8') : 'online');
            write(path.join(buildDir, 'src-tauri/target/release/bundle/nsis/demo-setup.exe'), 'installer');
        }
        return 0;
    }};
    const io = {
        which: async () => 'installed-tool',
        mkdirP: async name => fs.mkdirSync(resolve(name), {recursive: true}),
        rmRF: async name => fs.rmSync(resolve(name), {recursive: true, force: true, maxRetries: 3, retryDelay: 100}),
        cp: async (from, to) => fs.copyFileSync(resolve(from), resolve(to)),
        mv: async (from, to) => fs.renameSync(resolve(from), resolve(to)),
    };
    const toolCache = {
        downloadTool: async () => 'download.zip',
        extractZip: async (_, destination) => {
            write(path.join(destination, 'demo/demo.exe'), 'reused launcher');
            return resolve(destination);
        },
    };
    const mocks = {'@actions/core': core, '@actions/exec': exec, '@actions/io': io, '@actions/tool-cache': toolCache,
        fs: fileSystem, path: {...path, resolve: (...args) => path.resolve(root, ...args)},
        '@actions/http-client': {HttpClient: class {async getJson() {return {result: {assets: [{name: 'demo-win32.zip', browser_download_url: 'https://example.test/demo.zip'}]}};}}}};
    mocks.archiver = (...args) => {
        const archive = require('archiver')(...args), directory = archive.directory.bind(archive);
        archive.directory = (source, ...options) => directory(resolve(source), ...options);
        return archive;
    };
    const context = vm.createContext({require: name => mocks[name] ?? require(name), process: {platform: 'win32', arch: 'x64', env: {RUNNER_TEMP: root, GITHUB_REF_NAME: 'v2.0.0'}}});
    try {
        const source = fs.readFileSync(path.join(__dirname, 'index.js'), 'utf8').replace(/run\(\);\s*$/, 'globalThis.done = run();');
        vm.runInContext(source, context);
        await context.done;
        const assets = fs.existsSync(resolve('pyappify_dist')) ? fs.readdirSync(resolve('pyappify_dist')) : [];
        const zip = resolve('pyappify_dist/demo-win32.zip');
        return {calls: JSON.parse(JSON.stringify(calls)), outputs, errors, exe, bundles, assets,
            launcherZipContainsExecutable: fs.existsSync(zip) && fs.readFileSync(zip).includes(Buffer.from('demo/demo.exe')),
            launcher: fs.existsSync(exe) ? fs.readFileSync(exe, 'utf8') : null};
    } finally {
        fs.rmSync(root, {recursive: true, force: true, maxRetries: 3, retryDelay: 100});
    }
}

for (const mode of ['frozen', 'all']) test(`${mode} reuses a release and directly calls frozen-zip for the Mirror full package`, async () => {
    const result = await runAction({mode, reuse: true});
    assert.deepEqual(result.errors, []);
    assert.equal(result.launcher, 'reused launcher');
    assert.ok(!result.calls.some(call => call.command === 'pnpm' && call.args[1] === 'build'));
    const frozen = result.calls.find(call => call.args[1] === 'frozen-zip');
    assert.equal(frozen.command, result.exe);
    assert.equal(frozen.args.length, 6);
    assert.equal(frozen.args[3], 'v2.0.0');
    assert.equal(frozen.args[4], result.outputs['full-zip-path']);
    assert.equal(frozen.args[5], result.outputs['body-zip-path']);
    assert.match(result.outputs['full-zip-path'], /demo-win-x86_64-v2\.0\.0-full\.zip$/);
    assert.ok(!('mirror-zip-path' in result.outputs));
    assert.equal(result.calls.some(call => call.args[1] === 'setup'), mode === 'all');
});

test('fresh frozen mode builds the launcher without an installer before packaging', async () => {
    const result = await runAction();
    assert.deepEqual(result.errors, []);
    assert.equal(result.launcher, 'compiled launcher');
    assert.ok(result.calls.some(call => call.command === 'pnpm' && call.args.join(' ') === 'tauri build --no-bundle'));
    assert.ok(!result.calls.some(call => call.args[1] === 'setup'));
});

test('launcher command failure is surfaced directly', async () => {
    const result = await runAction({reuse: true, failCommand: true});
    assert.deepEqual(result.errors, ['launcher frozen command failed']);
    assert.ok(!('full-zip-path' in result.outputs));
});

for (const mode of ['mirror', 'body']) test(`the removed ${mode} mode is rejected`, async () => {
    const result = await runAction({mode});
    assert.deepEqual(result.errors, ['package_mode must be setup, frozen or all.']);
    assert.deepEqual(result.calls, []);
});

for (const mode of ['setup', 'all']) for (const reuse of [false, true]) test(`${mode} retains online and per-profile installers (${reuse ? 'reused' : 'compiled'} launcher)`, async () => {
    const result = await runAction({mode, reuse, profiles: ['default', 'alternate']});
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.bundles, ['online', 'profile:default', 'profile:alternate']);
    assert.deepEqual(result.calls.filter(call => call.args[1] === 'setup').map(call => call.args), [
        ['-c', 'setup', '-p', 'default'], ['-c', 'setup', '-p', 'alternate'],
    ]);
    assert.ok(result.launcherZipContainsExecutable);
    for (const file of ['demo-win32.zip', 'win32_sha256.txt', 'demo-win32-online-setup.exe', 'demo-win32-default-setup.exe', 'demo-win32-alternate-setup.exe']) assert.ok(result.assets.includes(file), file);
    assert.equal(result.assets.some(file => file.endsWith('-full.zip')), mode === 'all');
    assert.equal(result.assets.some(file => file.endsWith('-body.zip')), mode === 'all');
    assert.equal(result.outputs['pyappify-assets'].split('\n').length, mode === 'all' ? 7 : 5);
});

for (const mode of ['setup', 'frozen', 'all']) test(`${mode} preserves a cached signed launcher`, async () => {
    const result = await runAction({mode, cached: true});
    assert.deepEqual(result.errors, []);
    assert.equal(result.launcher, 'signed launcher');
    assert.ok(!result.calls.some(call => call.command === 'git' || (call.command === 'pnpm' && ['install', 'build'].includes(call.args[1]))));
    assert.equal(result.calls.some(call => call.args[1] === 'frozen-zip'), mode !== 'setup');
});

for (const mode of ['frozen', 'all']) test(`${mode} without Mirror exposes only the body ZIP from the direct command`, async () => {
    const result = await runAction({mode, reuse: true, mirror: false});
    assert.deepEqual(result.errors, []);
    const command = result.calls.find(call => call.args[1] === 'frozen-zip');
    assert.equal(command.args.length, 6);
    assert.equal(command.args[5], result.outputs['body-zip-path']);
    assert.ok(!('full-zip-path' in result.outputs));
    assert.ok(result.assets.some(file => file.endsWith('-body.zip')));
    assert.ok(!result.assets.some(file => file.endsWith('-full.zip')));
    assert.equal(result.calls.some(call => call.args[1] === 'setup'), mode === 'all');
});

test('build_exe_only returns the executable before packaging', async () => {
    const result = await runAction({mode: 'all', buildOnly: true});
    assert.deepEqual(result.errors, []);
    assert.equal(result.outputs['exe-path'], result.exe);
    assert.ok(!result.calls.some(call => ['setup', 'frozen-zip', 'bundle'].includes(call.args[1])));
});

test('the original use_release/build_exe_only conflict remains', async () => {
    const result = await runAction({reuse: true, buildOnly: true});
    assert.deepEqual(result.errors, ['use_release and build_exe_only cannot be used at the same time.']);
    assert.deepEqual(result.calls, []);
});
