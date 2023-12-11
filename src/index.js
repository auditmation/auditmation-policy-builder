const core = require('@actions/core');
const exec = require('@actions/exec');
const { newDana } = require('@auditmation/module-auditmation-auditmation-dana');
const { newFileService } = require('@auditmation/module-auditmation-auditmation-file-service');
const { newPlatform, PipelineAdminStatusEnum, PipelineFormatEnum, PipelineJobStatusEnum } = require('@auditmation/module-auditmation-auditmation-platform');
const { TimeZone, URL } = require('@auditmation/types-core-js');
const fs = require('fs');
const readline = require('readline');
const md5File = require('md5-file');
const path = require('path');
const https = require('node:https');
const args = {};
const fileService = newFileService();
const platform = newPlatform();
const dana = newDana();
const productId = "23cf2909-5c5e-5546-be5f-7f167d1f1c16"
const domains = {};
const fileMap = {};
const edMap = {};

// shared runtime refs
let pipeline = {
	name: "Auditmation Policy Builder",
	description: "Policy As Code data sync"
};
let folderId;
let batch;

process
  .on('unhandledRejection', (reason, p) => {
    console.error(reason, 'Unhandled Rejection at Promise', p);
  })
  .on('uncaughtException', (err) => {
    console.error(err, 'Uncaught Exception thrown');
    process.exit(1);
  });


function getPolicyRoot() {
	return '/home/kevin/code/policy/generated';
}

async function ensurePipeline() {
    const pipelines = await platform.getPipelineApi().list(
      1,
      50,
      pipeline.name,
      args.boundaryId,
      productId
    );
    if (pipelines.items.length === 0) {
      pipeline = await platform.getPipelineApi().create({
        name: pipeline.name,
        productId: productId,
        boundaryId: args.boundaryId,
        description: pipeline.description,
        timezone: TimeZone.Utc,
        targets: {},
        moduleName: 'Auditmation',
        format: PipelineFormatEnum.File,
      });
    } else {
      pipeline = pipelines.items[0];
    }
	if ( pipeline.adminStatus !== PipelineAdminStatusEnum.On ) {
		pipeline.adminStatus = PipelineAdminStatusEnum.On;
		pipeline = await platform.getPipelineApi().update(pipeline.id, pipeline);
	}
    console.log('Pipeline', pipeline);
	return;
}

async function ensureFolder() {

    const uploadPath = `/pipeline/${pipeline.id}`;

    let pipelineFolderId;

    let folders = await fileService.getResourceApi().searchResources(
      undefined,
      undefined,
      ['pipeline'],
      undefined,
      ['folder'],
    );

    await folders.forEach((folder) => {
      if (folder.name === 'pipeline') {
        pipelineFolderId = folder.id;
      }
    });

    if (!pipelineFolderId) {
      const folder = await fileService.getFolderApi().create({
        name: 'pipeline',
      });
      pipelineFolderId = folder.id;
    }

    folders = await fileService.getResourceApi().searchResources(
      undefined,
      undefined,
      [pipeline.id.toString()],
      undefined,
      ['folder'],
    );

    await folders.forEach((folder) => {
      if (folder.name === pipeline.id.toString()) {
        folderId = folder.id;
      }
    });

    const folderApi = await fileService.getFolderApi();
    if (!folderId) {
      const folder = await folderApi.create({
        name: pipeline.id.toString(),
        folderId: pipelineFolderId.toString(),
      });
      folderId = folder.id;
    }
	console.log( "Folder ID: " + folderId );

	// get list of files already present in the folder
	let results = await folderApi.listChildren( folderId );
	for await ( const child of results ) {
		console.log(JSON.stringify(child, null, 3));
		fileMap[child.name] = child;
	}

}

async function loadPolicy( domainCode ) {

	if ( domains[domainCode] ) {
		return;
	}
	domains[domainCode] = true;

	// get file content from disk
	const fileName = domainCode + "-policy.pdf";
	const policyFilePath = getPolicyRoot() + "/pdf/" + fileName;
	const fileStream = fs.createReadStream(policyFilePath);
    const stat = fs.statSync(policyFilePath);
    const checksum = md5File.sync(policyFilePath);
	console.log( "> " + policyFilePath + " [" + checksum + "]" );

	// get file metadata from fileservice
	let file = fileMap[fileName];
	if ( file ) {
		if ( true || file.checksum === checksum ) {
			console.log( "   > No changes since last run" );
		}
	} else {
		file = await fileService.getFileApi().create({
			name: fileName,
			description: domainCode.toUpperCase() + " Policy",
			folderId,
			retentionPolicy: {},
			syncPolicy: {},
		});

		// use node https since file upload is not in openapi (hack)
		const opts = {
			hostname: args.url.hostname,
			port: args.url.port,
			path: `/file-service/files/${file.id}/upload?checksum=${checksum}`,
			method: 'POST',
			protocol: 'https:',
			headers: {
			  'content-length': stat.size,
			  'content-type': 'application/pdf',
			  Authorization: `APIKey ${args.apiKey}`,
			  'dana-org-id': args.orgId.toString(),
			},
		};
		console.log( JSON.stringify( opts, null, 3 ) );

		const data = await new Promise((resolve, reject) => {
			let data = '';
			const req = https.request(opts, (res) => {
			  res.on('data', (chunk) => {
				console.log('chunk:', chunk.toString());
				data += chunk.toString();
			  });
			  res.on('end', () => {
				console.log('File uploaded');
				data = JSON.parse(data);
				resolve(data);
				req.end();
			  });
			});
			req.on('error', (err) => {
			  console.error(`Error uploading file: ${err.message}`);
			  console.error(err);
			});
			fileStream.pipe(req);
		});
		console.log('Upload', data);
		file.versionId = data.fileVersionId;
	}

	console.log( JSON.stringify(file, null, 3) );

	let fileVersionId = file.fileVersionId;

    console.log('File version id:', fileVersionId);

    // add a batch item
	const evidenceDefinitionId = edMap[domainCode];
	if ( ! evidenceDefinitionId ) {
		throw new Error( "Can't find evidence definition ID for " + domainCode );
	}

    const batchItem = await platform.getBatchApi().addBatchItem( batch.Id, {
      payload: {
        id: file.id,
        name: file.name,
        fileVersionId,
        size: stat.size,
        mimeType: 'application/pdf',
        evidenceDefinition: evidenceDefinitionId,
		pipelineId: pipeline.id
      },
      rawData: {},
    });
    console.log('Batch item:', batchItem.id);
}

async function loadEvidenceDefs() {
	let rApi = await platform.getResourceApi();
	let filter = {
		"types": ["evidence_definition"],
		"inflate": true,
		"conditions": [
			{
				"operation": "equals",
				"property": "category",
				"value": "policy"
			}
		]
	};
	let results = await rApi.resourceSearch(1,500,filter);
	for await ( const ed of results ) {
		if ( ed.object.domain ) { 
			edMap[ed.object.domain] = ed.id;
		}
	}
	console.log( JSON.stringify( edMap, null, 3 ));
}

function toScf( c ) {
	let scf = c.toUpperCase();
	let parts = scf.split(".");
	if ( parts.length == 1 ) {
		return scf;
	}
	let base = "a".charCodeAt(0)-1;
	let value = parseInt(parts[1]) + base;
	return scf + "(" + String.fromCharCode(value) + ")";
}

async function loadControl( c ) {

	// load domain policy as needed
	let domainCode = c.code.split("-")[0];
	await loadPolicy( domainCode );
	return;

	let scfCode = toScf(c.code);

	// update internal control standards and guidelines
	const filePath = getPolicyRoot() + "/md/" + domainCode + "-policy.md";
	const fileStream = fs.createReadStream(filePath);
	const rl = readline.createInterface({
		input: fileStream,
		crlfDelay: Infinity
	});

	let startControl = "### " + scfCode + ":";
	let startStandard = "#### Standard";
	let startGuidelines = "#### Guidelines";
	let stop = "###";

	let inControl = false;
	let inStandard = false;
	let inGuidelines = false;

	let standardMd = "";
	let guidelinesMd = "";

	for await (const line of rl) {
		if ( line.startsWith(startControl) ) {
			inControl = true;
			continue;
		} else if ( line.startsWith(startStandard) ) {
			if ( inControl ) {
				inStandard = true;
			}
			inGuidelines = false;
			continue;
		}  else if ( line.startsWith(startGuidelines) ) {
			if ( inControl ) {
				inGuidelines = true;
			}
			inStandards = false;
			continue;
		}  else if ( line.startsWith(stop) ) {
			if ( standardMd.length > 0 && guidelinesMd.length > 0 ) {
				break;
			}
			inStandard = false;
			inGuidelines = false;
			continue;
		}
		if ( inStandard ) {
			if ( line.startsWith("[") || line.startsWith("<span") ) {
				inStandard = false;
				continue;
			}
			if ( line.trim().length > 0 ) {
				standardMd += line + "\n";
			}
		}
		if ( inGuidelines ) {
			if ( line.startsWith("[") || line.startsWith("<span") ) {
				inGuidelines = false;
				continue;
			}
			if ( line.trim().length > 0 ) {
				guidelinesMd += line + "\n";
			}
		}
	}
	console.log("SCF Control: " + scfCode );
	console.log("Standard:\n" + standardMd );
	console.log("Guidelines:\n" + guidelinesMd );

	let ic = await platform.getInternalControlApi();
	await ic.updateInternalControl( c.id, {
		"standard": standardMd,
		"guideline": guidelinesMd
	});
	console.log( "Updated " + c.id );

}

async function loadControls() {
	let orgApi = dana.getOrgApi();
	let org = await orgApi.getOrg( args.orgId );
	console.log( JSON.stringify(org, null, 3 ));
	let ic = await platform.getInternalControlApi();
	let results = await ic.slimList( args.boundaryId );
	for await ( const control of results ) {
		await loadControl( control );
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
	console.log(JSON.stringify( args, null, 3 ));

    // pre-reqs for controls and policies
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

    await loadEvidenceDefs();

    await dana.connect({
		apiKey: args.apiKey,
        orgId: args.orgId,
        url: await URL.parse(`${url.toString()}dana/api/v1`),
    });

	console.log( "Connected to Auditmation platform services" );

    // Get or create boundary?
    if (!args.boundaryId) {
      const boundaries = await platform.getBoundaryApi().listBoundaries();
      args.boundaryId = boundaries.items[0].id;
    }
	 
    // make sure a pipeline exists
	await ensurePipeline();

    // create pipeline job
    const job = await platform.getPipelineJobApi().createPipelineJob({
	  pipelineId: pipeline.id,
      previewMode: false,
    });
    const jobId = job.id;
    console.log('Created job:', jobId);

    // create a batch
	  batch = await platform.getBatchApi().createBatch({
      className: 'EvidenceFile',
      jobId,
      groupId: pipeline.id,
    });
    const batchId = batch.id;
    console.log('Created batch:', batchId);

	// make sure folder exists
	await ensureFolder();

	if (args.operation === 'load-controls') {
		await loadControls();
	} else {
		throw new Error("unsupported operation: " + args.operation);
	}

    // load control standards & guidlines, and lazily upload policies
	await loadControls();

	// end batch
	await platform.getBatchApi().endBatch(batchId);

	// end job
    await platform.getPipelineJobApi().updatePipelineJob(jobId, {
      status: PipelineJobStatusEnum.Completed,
    });

  } catch (err) {

    console.log(err);
    console.log(err.stack);
    process.exit(1);

  }

}

run();
