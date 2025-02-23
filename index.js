/**
 * Launch cluster and workers.
 * React on SIGINT and SIGTERM.
 * restart worker if worker exit.
 */

'use strict';

// Load environment variables from .env file
import dotenv from 'dotenv';
dotenv.config();

import fs from 'fs';
import { spawn } from 'child_process';

if (!process.env.DEVEL && process.env.LOGFILE && !process.env.BACKGROUND) {
  var spawnArgvs = [];
  for (var i in process.argv) {
    if (i > 0) {
      spawnArgvs.push(process.argv[i]);
    }
  }
  var env = process.env;
  env.BACKGROUND = true;
  spawn(process.argv0, spawnArgvs, {
    stdio: 'ignore',
    detached: true,
    env: env,
  }).unref();
  process.exit();
}

if (process.env.DEVEL) {
  if (process.env.DEVEL_DEBUG) {
    process.env.DEBUG = process.env.DEVEL_DEBUG;
  } else {
    process.env.DEBUG = '*';
  }
}

if (process.env.BACKGROUND) {
  process.env.DEBUG_COLORS = false;
  var logFile = fs.createWriteStream(process.env.LOGFILE, { flags: 'a' });
  process.stdout.write = process.stderr.write = logFile.write.bind(logFile);
}

import { cpus } from 'node:os';
import cluster from 'node:cluster';
import debug from 'debug';
import WebHttp from './includes/web.js';

import { EventEmitter } from 'node:events';

export function Cluster(settings) {
  this.settings = settings;
  this.isShutdown = false;
  this.multipleInt = false;
  this.sharedData = {};
  EventEmitter.call(this); // Call EventEmitter constructor
  this.init();
}

// Inherit from EventEmitter
Object.setPrototypeOf(Cluster.prototype, EventEmitter.prototype);

Cluster.prototype.init = function () {
  let singletonProcess = false;
  if (this.settings.singleton) {
    singletonProcess = true;
  }
  if (cluster.isPrimary) {
    if (process.env.PIDFILE) {
      fs.writeFileSync(process.env.PIDFILE + '', process.pid + '\0');
    }
    let numCPUs = 1;
    if (process.env.WORKERS) {
      numCPUs = parseInt(process.env.WORKERS);
    } else {
      numCPUs = cpus().length;
    }

    if (numCPUs < 1) {
      numCPUs = 1;
    }

    // start separated process for singletone
    if (singletonProcess === true) {
      let worker = cluster.fork({ IS_SINGLETON: true });
      singletonProcess = worker.id;
    }

    this.debug.log('Starting up %s workers.', numCPUs);
    for (var i = 0; i < numCPUs; i++) {
      cluster.fork();
    }

    cluster.on('online', (worker) => {
      this.debug.log('Worker %s is online', worker.process.pid);
      this.emit('online', worker);
    });

    cluster.on('exit', (worker, code, signal) => {
      this.debug.log('Worker %s died. code %s signal %s', worker.process.pid, code, signal);
      if (this.isShutdown) {
        this.emit('exit', worker, code, signal);
        return;
      }
      this.debug.log('Starting a new worker');
      if (singletonProcess === worker.id) {
        let worker = cluster.fork({ IS_SINGLETON: true });
        singletonProcess = worker.id;
        return;
      }
      cluster.fork();
    });

    cluster.on('listening', (worker, address) => {
      this.emit('listening', worker, address);
    });

    process.on('SIGINT', () => {
      this.stopCluster('SIGINT');
    });

    process.on('SIGTERM', () => {
      this.stopCluster('SIGTERM');
    });

    cluster.on('message', (worker, message) => {
      // Broadcast message from worker to all workers as IPM handler
      this.debug.debug('Broadcast message to workers %s.', message.toString());
      for (var key in cluster.workers) {
        cluster.workers[key].send(message);
      }
    });
  } else {
    if (process.env.IS_SINGLETON) {
      process.title = 'singleton';
      if (this.settings.singleton) {
        this.debug.log('Starting singleton');
        this.settings.singleton(true, (variables) => {
          this.sharedData.singleton = variables;
        });
      } else {
        this.debug.log('No singleton defined');
      }
    } else {
      process.title = 'worker-' + cluster.worker.id;
      this.webServer = new WebHttp(this.settings);
      if (this.settings.init) {
        this.debug.log('Starting init');
        this.settings.init((variables) => {
          this.sharedData.init = variables;
        });
      }
    }

    process.on('message', (message) => {
      this.debug.debug('IPM Message received: %s', message.toString());
      let method = 'IPM';
      try {
        if (this.settings.methods[method]) {
          if (message.type && message.message) {
            this.settings.methods[method](message.type, message.message);
          } else {
            this.settings.methods[method](message);
          }
        } else {
          throw new Error(method + ' is not supported.');
        }
      } catch (e) {
        this.debug.debug('Error intercepted:\n %s', e.stack);
      }
    });

    process.on('SIGINT', () => {
      this.debug.worker('Caught interrupt signal');
      if (this.multipleInt) {
        // force termination on multiple SIGINT
        process.exit(0);
      }
      this.shutdownFunction();
      this.multipleInt = true;
    });

    process.on('SIGTERM', () => {
      this.debug.worker('Caught termination signal');
      this.shutdownFunction();
      // On terminate we force termination in 15 sec.
      let termIn = 15000;
      if (process.env.TERMINATE_IN && parseInt(process.env.TERMINATE_IN) > 0) {
        termIn = parseInt(process.env.TERMINATE_IN);
      }
      setTimeout(function () {
        process.exit(0);
      }, termIn);
    });
  }
  return this;
};

// Inherit from EventEmitter
Object.setPrototypeOf(Cluster.prototype, EventEmitter.prototype);

Cluster.prototype.stopCluster = function (signal) {
  this.isShutdown = true;
  this.debug.log('Caught interrupt signal');
  if (process.env.PIDFILE) {
    if (fs.existsSync(process.env.PIDFILE)) {
      fs.unlinkSync(process.env.PIDFILE);
    }
  }
  if (this.multipleInt) {
    // force termination on multiple SIGINT
    process.exit(0);
  }
  // send signal to all workers
  for (const id in cluster.workers) {
    process.kill(cluster.workers[id].process.pid, signal);
  }
  this.multipleInt = true;
};

Cluster.prototype.shutdownFunction = function () {
  this.debug.worker('shutdownFunction');
  if (this.webServer) {
    this.webServer.stop(() => {
      this.debug.worker('disconnect worker');
      cluster.worker.disconnect();
    });
  }

  // call singleton on stop if it is singleton process
  if (process.env.IS_SINGLETON) {
    if (this.settings.singleton) {
      this.settings.singleton(false, this.sharedData.singleton);
    }
  } else {
    if (this.settings.shutdown) {
      this.settings.shutdown(this.sharedData.init);
    }
  }
};

Cluster.prototype.debug = {
  log: debug('cluster:main'),
  debug: debug('cluster:debug'),
  worker: debug('cluster:worker'),
};

// Processed by tokens data structure
Cluster.prototype.settings = {};

export default Cluster;
