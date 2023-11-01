const core = require('@actions/core');
const exec = require('@actions/exec');
const { newDana } = require('@auditmation/module-auditmation-auditmation-dana');
const { newFileService } = require('@auditmation/module-auditmation-auditmation-file-service');
const { newPlatform, PipelineAdminStatusEnum, PipelineFormatEnum, PipelineJobStatusEnum } = require('@auditmation/module-auditmation-auditmation-platform');
const { TimeZone, URL } = require('@auditmation/types-core-js');
const fs = require('fs');
const md5File = require('md5-file');
const path = require('path');
const https = require('node:https');
const args = {};
const fileService = newFileService();
const platform = newPlatform();
const dana = newDana();

process
  .on('unhandledRejection', (reason, p) => {
    console.error(reason, 'Unhandled Rejection at Promise', p);
  })
  .on('uncaughtException', (err) => {
    console.error(err, 'Uncaught Exception thrown');
    process.exit(1);
  });


async function loadControls() {
	let orgApi = dana.getOrgApi();
	let org = await orgApi.getOrg( args.orgId );
	console.log( JSON.stringify(org, null, 3 ));
	let ic = await platform.getInternalControlApi();
	let results = await ic.list( 1, 500, args.boundaryId );
	for await ( const control of results ) {
		console.log( control.scfControlCode );
	}
	console.log( "CWD:   " + process.cwd() );
	let files = await fs.promises.readdir('.');
	for ( const file of files ) {
		console.log( "   " + file );
	}
}

async function run() {

  try {
    args.operation = core.getInput('operation');
    args.apiKey = core.getInput('api-key');
    args.orgId = core.getInput('org-id');
    let url = await URL.parse(core.getInput('url'));
    const hostname = url.hostname.startsWith('api') ? url.hostname: `api.${url.hostname}`;
    args.url = await URL.parse(`${url.protocol}://${hostname}`);
    args.boundaryId = core.getInput('boundary-id');

    await fileService.connect({
		apiKey: args.apiKey,
		orgId: args.orgId,
        url: await URL.parse(`${url.toString()}file-service`),
    });

    await platform.connect({
		apiKey: args.apiKey,
        orgId: args.orgId,
        url: await URL.parse(`${url.toString()}platform`),
    });

    await dana.connect({
		apiKey: args.apiKey,
        orgId: args.orgId,
        url: await URL.parse(`${url.toString()}dana/api/v1`),
    });

	console.log(JSON.stringify( args, null, 3 ));

    // Get or create boundary?
    if (!args.boundaryId) {
      const boundaries = await platform.getBoundaryApi().listBoundaries();
      args.boundaryId = boundaries.items[0].id;
    }
	 
	if (args.operation === 'load-controls') {
		await loadControls();
	} else {
		throw new Error("unsupported operation: " + args.operation);
	}

  } catch (err) {

    console.log(err);
    console.log(err.stack);
    process.exit(1);

  }

}

run();
