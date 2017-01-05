/**
 * Handle HTTP startup and shutdown.
 * Parse request and s
 */
'use strict';

var http = require('http');
const debugF = require('debug');

const bind = function(fn, me) { return function() { return fn.apply(me, arguments); }; };


/**
 * Constructor.
 *   Prepare data for deploy.
 */
function WebServer(data) {
  // Use a closure to preserve `this`
  var self = this;
  self.data = data;

  this.RequestHandler = bind(this.RequestHandler, this);
  this.callbackExecutor = bind(this.callbackExecutor, this);

  self.server = http.createServer(self.RequestHandler);

  // Use random port if port settings is not provided.
  if(!self.data.port) {
    self.data.port = 0;
  }

  // Use address if provided.
  if(self.data.hostname) {
    self.server.listen(self.data.port, self.data.hostname);
  } else {
    self.server.listen(self.data.port);
  }

  self.server.on('listening', function() {
    self.debug.log('Listen on :%s', self.server.address().port);
  });
}

// Processed by tokens data structure
WebServer.prototype.data = {};

WebServer.prototype.server = false;

/**
 * Process http request and collect POSt and PUT data.
 */
WebServer.prototype.RequestHandler = function(request, response) {
  var self = this;

  self.debug.log('%s: %s', request.method, request.url);
  var _buffer = '';
  var data = '';


  request.addListener('data', function(chunk) { _buffer += chunk; });
  request.addListener('end', function() {
    var requestDetails = {};
    requestDetails.url = request.url.substr(1);
    requestDetails.headers = request.headers;
    requestDetails._buffer = _buffer;
    requestDetails.method = request.method;

    if (_buffer != '') {
      self.debug.debug('Data: %s', _buffer);
      try {
        data = JSON.parse(_buffer);
      } catch (e) {
        if (self.data.callbacks["responseHandler"]) {
          return self.data.callbacks["responseHandler"](e, null, response, requestDetails);
        }
        response.writeHead(500, { 'content-type': 'application/json' });
        response.write(JSON.stringify({ error: e.message }, null, 2));
        response.end('\n');
        self.debug.debug('Error intersepted:\n %s', e.stack);
        return;
      }
    } else {
      data = {};
    }

    if (self.data.callbacks.validate) {
      self.data.callbacks.validate(request.method, _buffer, requestDetails, function(err) {
        if (!err) {
          self.RequestProcess(request.method, response, requestDetails, data);
        } else {
          if(!err.code) {
            err.code = 403;
          }
          if (self.data.callbacks["responseHandler"]) {
            return self.data.callbacks["responseHandler"](err, null, response, requestDetails);
          }
          response.writeHead(err.code, { 'content-type': 'application/json' });
          response.write(JSON.stringify({ message: err.message }, null, 2));
          response.end('\n');
          self.debug.debug('Validation error: %s', err.message);
          return;
        }
      })
    } else {
      self.RequestProcess(request.method, response, requestDetails, data);
    }
  });
};

/**
 * Process request and if implemented, call handlers.
 */
WebServer.prototype.RequestProcess = function(method, response, requestDetails, data) {
  var self = this;

  self.debug.debug('Parsed data: %s', JSON.stringify(data, null, 2));
  try {
    if (self.data.callbacks[method]) {
      self.data.callbacks[method](data, requestDetails, function(err, handlerResponse) {
        self.callbackExecutor(err, handlerResponse, response, requestDetails);
      });
    } else {
      throw new Error('Do not support.');
    }
  } catch (e) {
    self.debug.debug('Error intersepted:\n %s', e.stack);
    e.code = 500;

    if (self.data.callbacks["responseHandler"]) {
      return self.data.callbacks["responseHandler"](e, null, response, requestDetails);
    }
    response.writeHead(e.code, { 'content-type': 'application/json' });
    response.write(JSON.stringify({ error: e.message }, null, 2));
    response.end('\n');
  }
}

/**
 * Output answer from handlers.
 */
WebServer.prototype.callbackExecutor = function(err, handlerResponse, response, requestDetails) {
  var self = this;

  if (self.data.callbacks["responseHandler"]) {
    return self.data.callbacks["responseHandler"](err, handlerResponse, response, requestDetails);
  }

  if (err) {
    self.debug.debug('Handler responce error:\n %s', JSON.stringify(err , null, 2));
    response.writeHead(503, { 'content-type': 'application/json' });
    response.write(JSON.stringify({message: err.message }, null, 2));
    response.end('\n');
  }else {
    self.debug.debug('Handler responce:\n %s', JSON.stringify(handlerResponse , null, 2));
    response.writeHead(handlerResponse.code, { 'content-type': 'application/json' });
    response.write(JSON.stringify(handlerResponse.answer , null, 2));
    response.end('\n');
  }
}

/**
 * Process server stop request.
 */
WebServer.prototype.stop = function() {
  var self = this;
  self.server.close(function() {
      self.debug.log('Worker stopped');
      process.exit();
    });
};

/**
 * Define debug methods.
 */
WebServer.prototype.debug = {
  log: debugF('http:log'),
  request: debugF('http:request'),
  debug: debugF('http:debug')
};

module.exports = WebServer;
