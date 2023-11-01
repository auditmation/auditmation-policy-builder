const core = require('@actions/core');
const exec = require('@actions/exec');
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

process
  .on('unhandledRejection', (reason, p) => {
    console.error(reason, 'Unhandled Rejection at Promise', p);
  })
  .on('uncaughtException', (err) => {
    console.error(err, 'Uncaught Exception thrown');
    process.exit(1);
  });


async function loadControls() {
	let boundary = await platform.getBoundaryApi();
	let results = await boundary.listBoundarySCFControls( args.boundaryId );
	console.log( JSON.stringify( results ) );
	for await ( const control of results ) {
		console.log( JSON.stringify( control ) );
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

    // Get or create boundary?
    if (!args.boundaryId) {
      const boundaries = await platform.getBoundaryApi().listBoundaries();
      args.boundaryId = boundaries.items[0].id;
    }
	 
	console.log(JSON.stringify( args, null, 3 ));
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
