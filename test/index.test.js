const exec = require('@actions/exec');
const { expect } = require('chai');
const path = require('path');

describe('Auditmation Policy Builder', function () {
  it('Should an artifact', async () => {
    const env = {
      'INPUT_API-KEY': process.env.API_KEY,
      'INPUT_ORG-ID': process.env.ORG_ID,
      'INPUT_BOUNDARY-ID': process.env.BOUNDARY_ID,
      'INPUT_URL': process.env.API_URL,
      'INPUT_OPERATION': 'load-controls',
      ...process.env,
    };
    const out = await exec.exec('node', [path.join(__dirname, '..', 'src', 'index.js')], { env });
    console.log('OUT', out);
    expect(out).to.equal(0);
  }).timeout(30000);
});
