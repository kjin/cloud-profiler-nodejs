/**
 * Copyright 2017 Google Inc. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import * as common from '@google-cloud/common';
import {GlobalConfig} from '@google-cloud/common/build/src/util';
import * as assert from 'assert';
import * as extend from 'extend';
import * as gcpMetadata from 'gcp-metadata';
import * as sinon from 'sinon';

import {createProfiler} from '../src/index';
import {Profiler} from '../src/profiler';
import * as heapProfiler from '../src/profilers/heap-profiler';

const v8HeapProfiler = require('bindings')('sampling_heap_profiler');

describe('createProfiler', () => {
  let savedEnv: NodeJS.ProcessEnv;
  let metadataStub: sinon.SinonStub|undefined;
  let startStub: sinon.SinonStub;

  const internalConfigParams = {
    timeIntervalMicros: 1000,
    heapIntervalBytes: 512 * 1024,
    heapMaxStackDepth: 64,
    initialBackoffMillis: 1000 * 60,
    backoffCapMillis: 60 * 60 * 1000,
    backoffMultiplier: 1.3,
    serverBackoffCapMillis: 2147483647,
    localProfilingPeriodMillis: 1000,
    localTimeDurationMillis: 1000,
    localLogPeriodMillis: 10000,
    baseApiUrl: 'https://cloudprofiler.googleapis.com/v2',
  };
  let defaultConfig: GlobalConfig;

  before(async () => {
    defaultConfig = await common.util.normalizeArguments(
        null, extend({}, internalConfigParams as GlobalConfig));
    startStub = sinon.stub(v8HeapProfiler, 'startSamplingHeapProfiler');
    savedEnv = process.env;
  });

  beforeEach(() => {
    process.env = {};
  });

  afterEach(() => {
    if (metadataStub) {
      metadataStub.restore();
    }
    heapProfiler.stop();
    startStub.reset();
  });

  after(() => {
    process.env = savedEnv;
    startStub.restore();
  });

  it('should not modify specified fields when not on GCE', async () => {
    metadataStub = sinon.stub(gcpMetadata, 'instance')
                       .throwsException('cannot access metadata');

    const config = {
      logLevel: 2,
      serviceContext: {version: 'fake-version', service: 'fake-service'},
      disableHeap: true,
      disableTime: true,
      instance: 'instance',
      zone: 'zone',
      projectId: 'fake-projectId'
    };
    const profiler: Profiler = await createProfiler(config);
    const expConfig = Object.assign({}, defaultConfig, config);
    assert.deepEqual(profiler.config, expConfig);
  });

  it('should not modify specified fields when on GCE', async () => {
    metadataStub = sinon.stub(gcpMetadata, 'instance');
    metadataStub.withArgs('name')
        .resolves({data: 'gce-instance'})
        .withArgs('zone')
        .resolves({data: 'projects/123456789012/zones/gce-zone'});

    const config = {
      logLevel: 2,
      serviceContext: {version: 'fake-version', service: 'fake-service'},
      disableHeap: true,
      disableTime: true,
      instance: 'instance',
      zone: 'zone',
      projectId: 'fake-projectId'
    };
    const profiler: Profiler = await createProfiler(config);
    const expConfig = Object.assign({}, defaultConfig, config);
    assert.deepEqual(profiler.config, expConfig);
  });

  it('should get zone and instance from GCE', async () => {
    metadataStub = sinon.stub(gcpMetadata, 'instance');
    metadataStub.withArgs('name')
        .resolves({data: 'gce-instance'})
        .withArgs('zone')
        .resolves({data: 'projects/123456789012/zones/gce-zone'});

    const config = {
      projectId: 'projectId',
      logLevel: 2,
      serviceContext: {version: '', service: 'fake-service'},
      disableHeap: true,
      disableTime: true,
    };
    const expConfigParams = {
      logLevel: 2,
      serviceContext: {version: '', service: 'fake-service'},
      disableHeap: true,
      disableTime: true,
      instance: 'gce-instance',
      zone: 'gce-zone',
      projectId: 'projectId'
    };
    const profiler: Profiler = await createProfiler(config);
    const expConfig = Object.assign({}, defaultConfig, expConfigParams);
    assert.deepEqual(profiler.config, expConfig);
  });

  it('should not reject when not on GCE and no zone and instance found',
     async () => {
       metadataStub = sinon.stub(gcpMetadata, 'instance');
       metadataStub.throwsException('cannot access metadata');
       const config = {
         projectId: 'fake-projectId',
         serviceContext: {service: 'fake-service'}
       };
       const expConfigParams = {
         logLevel: 2,
         serviceContext: {service: 'fake-service'},
         disableHeap: false,
         disableTime: false,
         projectId: 'fake-projectId',
       };
       const profiler: Profiler = await createProfiler(config);
       const expConfig = Object.assign({}, defaultConfig, expConfigParams);
       assert.deepEqual(profiler.config, expConfig);
     });

  it('should reject when no service specified', async () => {
    metadataStub = sinon.stub(gcpMetadata, 'instance');
    metadataStub.throwsException('cannot access metadata');
    const config = {
      logLevel: 2,
      serviceContext: {version: ''},
      disableHeap: true,
      disableTime: true,
    };
    createProfiler(config)
        .then(() => {
          assert.fail('expected error because no service in config');
        })
        .catch((e: Error) => {
          assert.equal(
              e.message,
              'Could not start profiler: Error: Service must be specified in the configuration');
        });
  });

  it('should get have no projectId when no projectId given', async () => {
    metadataStub = sinon.stub(gcpMetadata, 'instance');
    metadataStub.throwsException('cannot access metadata');

    const config = {
      logLevel: 2,
      serviceContext: {version: '', service: 'fake-service'},
      disableHeap: true,
      disableTime: true,
      instance: 'instance',
      zone: 'zone'
    };
    const profiler: Profiler = await createProfiler(config);
    const expConfig = Object.assign({}, defaultConfig, config);
    assert.deepEqual(profiler.config, expConfig);
  });

  it('should set baseApiUrl to non-default value', async () => {
    metadataStub = sinon.stub(gcpMetadata, 'instance');
    metadataStub.throwsException('cannot access metadata');

    const config = {
      serviceContext: {version: '', service: 'fake-service'},
      baseApiUrl: 'https://test-cloudprofiler.sandbox.googleapis.com/v2'
    };
    const expConfigParams = {
      serviceContext: {version: '', service: 'fake-service'},
      disableHeap: false,
      disableTime: false,
      logLevel: 2,
      baseApiUrl: 'https://test-cloudprofiler.sandbox.googleapis.com/v2'
    };
    const expConfig = Object.assign({}, defaultConfig, expConfigParams);
    const profiler: Profiler = await createProfiler(config);
    assert.deepEqual(profiler.config, expConfig);
  });

  it('should get values from from environment variable when not specified in config or environment variables',
     async () => {
       process.env.GCLOUD_PROJECT = 'process-projectId';
       process.env.GCLOUD_PROFILER_LOGLEVEL = '4';
       process.env.GAE_SERVICE = 'process-service';
       process.env.GAE_VERSION = 'process-version';
       process.env.GCLOUD_PROFILER_CONFIG =
           './ts/test/fixtures/test-config.json';
       metadataStub = sinon.stub(gcpMetadata, 'instance');
       metadataStub.withArgs('name')
           .resolves({data: 'gce-instance'})
           .withArgs('zone')
           .resolves({data: 'projects/123456789012/zones/gce-zone'});
       const config = {};
       const expConfigParams = {
         projectId: 'process-projectId',
         logLevel: 4,
         serviceContext:
             {version: 'process-version', service: 'process-service'},
         disableHeap: true,
         disableTime: true,
         instance: 'envConfig-instance',
         zone: 'envConfig-zone'
       };
       const profiler: Profiler = await createProfiler(config);
       const expConfig = Object.assign({}, defaultConfig, expConfigParams);
       assert.deepEqual(profiler.config, expConfig);
     });

  it('should not get values from from environment variable when values specified in config',
     async () => {
       process.env.GCLOUD_PROJECT = 'process-projectId';
       process.env.GCLOUD_PROFILER_LOGLEVEL = '4';
       process.env.GAE_SERVICE = 'process-service';
       process.env.GAE_VERSION = 'process-version';
       process.env.GCLOUD_PROFILER_CONFIG =
           './ts/test/fixtures/test-config.json';
       metadataStub = sinon.stub(gcpMetadata, 'instance');
       metadataStub.withArgs('name')
           .resolves({data: 'gce-instance'})
           .withArgs('zone')
           .resolves({data: 'projects/123456789012/zones/gce-zone'});

       const config = {
         projectId: 'config-projectId',
         logLevel: 1,
         serviceContext: {version: 'config-version', service: 'config-service'},
         disableHeap: false,
         disableTime: false,
         instance: 'instance',
         zone: 'zone'
       };
       const profiler: Profiler = await createProfiler(config);
       const expConfig = Object.assign({}, defaultConfig, config);
       assert.deepEqual(profiler.config, expConfig);
     });

  it('should get values from from environment config when not specified in config or other environment variables',
     async () => {
       metadataStub = sinon.stub(gcpMetadata, 'instance');
       metadataStub.throwsException('cannot access metadata');
       process.env.GCLOUD_PROFILER_CONFIG =
           './ts/test/fixtures/test-config.json';

       const expConfigParams = {
         logLevel: 3,
         serviceContext:
             {version: 'envConfig-version', service: 'envConfig-service'},
         disableHeap: true,
         disableTime: true,
         instance: 'envConfig-instance',
         zone: 'envConfig-zone',
         projectId: 'envConfig-fake-projectId'
       };

       const config = {};
       const profiler: Profiler = await createProfiler(config);
       const expConfig = Object.assign({}, defaultConfig, expConfigParams);
       assert.deepEqual(profiler.config, expConfig);
     });
  it('should start heap profiler when disableHeap is not set', async () => {
    const config = {
      projectId: 'config-projectId',
      serviceContext: {service: 'config-service'},
      instance: 'envConfig-instance',
      zone: 'envConfig-zone',
    };
    const profiler: Profiler = await createProfiler(config);
    assert.ok(
        startStub.calledWith(1024 * 512, 64),
        'expected heap profiler to be started');
  });
  it('should start not heap profiler when disableHeap is true', async () => {
    const config = {
      projectId: 'config-projectId',
      serviceContext: {service: 'config-service'},
      disableHeap: true,
      instance: 'envConfig-instance',
      zone: 'envConfig-zone',
    };
    const profiler: Profiler = await createProfiler(config);
    assert.ok(!startStub.called, 'expected heap profiler to not be started');
  });
});
