/**
 * Central Startup file.
 * Launch cluster and workers.
 * React on SIGINT and SIGTERM.
 * restart worker if worker exit.
 */
'use strict';

import Cluster from '../index.js';

var ms = new Cluster({
  loader: function (request, callback) {
    console.log('loader', request.url);
    request.test = true;
    callback(null);
  },
  singleton: function (isStart, variables) {
    console.log('singleton', isStart, variables);
    if (isStart) {
      variables({ test: 1 });
    } else {
      process.exit(0);
    }
  },
  init: function (callback) {
    callback({ test: 1 });
    console.log('init');
  },
  shutdown: function (init) {
    console.log('shutdown', init);
    process.exit(0);
  },
  /*responseHandler: function(error, handlerResponse, response, request) {
    console.log('responseHandler', error, handlerResponse);
    if(error) {
      if (!err.code) {
        err.code = 503;
      }
      response.writeHead(e.code, () => {
        return this.validateHeaders({});
      });
      response.write(JSON.stringify({ error: e.message }, null, 2));
      response.end('\n');
      return
    }

    response.writeHead(handlerResponse.code, {'content-type': 'application/json'});
    response.write(JSON.stringify(handlerResponse.answer));
    response.end('\n');
  },*/
  methods: {
    POST: function (data, request, callback) {
      console.log('post %O %O', data, request);
      callback(null, {
        code: 200,
        answer: { test: 1, data: data },
        headers: { test: 100 },
      });
    },
    GET: function (data, request, callback) {
      console.log('post %O %O', data, request);
      callback(null, {
        code: 200,
        answer: { test: 1, data: data },
        headers: { test: 100 },
      });
    },
    PUT: function (data, request, callback) {
      console.log('post %O %O', data, request);
      callback(null, {
        code: 200,
        answer: { test: 1, data: data },
        headers: { test: 100 },
      });
    },
    DELETE: function (data, request, callback) {
      //console.log('post %O %O', data, request);
      return callback(new Error('test'));
      callback(null, {
        code: 200,
        answer: { test: 1, data: data },
        headers: { test: 100 },
      });
    },
    SEARCH: function (data, request, callback) {
      console.log('post %O %O', data, request);
      callback(null, {
        code: 200,
        answer: { test: 1, data: data },
        headers: { test: 100 },
      });
    },
  },
});

ms.on('online', function (worker) {
  console.log('Worker %s is online', worker.process.pid);
});

ms.on('exit', function (worker, code, signal) {
  console.log('Worker %s died. code %s signal %s', worker.process.pid, code, signal);
});
