const exec = require('@actions/exec');
const { expect } = require('chai');
const path = require('path');

describe('Auditmation SBOM Recorder Test', function () {
  it('Should upload an sbom from an artifact', async () => {
    const env = {
      'INPUT_API-KEY': process.env.API_KEY,
      'INPUT_ORG-ID': process.env.ORG_ID,
      'INPUT_BOUNDARY-ID': '4bfa191b-b40f-4c3e-8a3b-a15bb4f6448d',
      INPUT_URL: process.env.URL,
      'INPUT_PACKAGE': '@auditmation/file-service-app@latest',
      'INPUT_FILE-PATH': 'bom.json',
      'INPUT_PRODUCT-ID': '23cf2909-5c5e-5546-be5f-7f167d1f1c16',
      ...process.env,
    };

    const out = await exec.exec('node', [path.join(__dirname, '..', 'src', 'index.js')], { env });
    console.log('OUT', out);
    expect(out).to.equal(0);
  }).timeout(30000);
});
