/**
 * Handle HTTP startup and shutdown.
 * Parse request and send answer.
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
  if (!self.data.port) {
    self.data.port = 0;
  }

  // Use address if provided.
  if (self.data.hostname) {
    self.server.listen(self.data.port, self.data.hostname);
  } else {
    self.server.listen(self.data.port);
  }

  self.server.on('listening', function() {
    self.debug.log('Listen on :%s', self.server.address().port);
  });
  self.server.on('clientError', function(err, socket) {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
  process.on('message', function(message) {
    self.processIPMMessage(message);
  });
}

// Processed by tokens data structure
WebServer.prototype.data = {};

WebServer.prototype.server = false;

/**
 * Process http request and collect POSt and PUT data.
 */
WebServer.prototype.processIPMMessage = function(message) {
  var self = this;
  self.debug.debug('IPM Message received: %s', message.toString());
  try {
    message = JSON.parse(message);
  } catch (e) {
    return self.debug.debug('JSON parse failed: %s', message.toString());
  }
  let method = 'IPM'
  try {
    if (self.data.callbacks[method]) {
      self.data.callbacks[method](message);
    } else {
      throw new Error(method + ' is not supported.');
    }
  } catch (e) {
    self.debug.debug('Error intersepted:\n %s', e.stack);
  }
}

/**
 * Process http request and collect POSt and PUT data.
 */
WebServer.prototype.RequestHandler = function(request, response) {
  var self = this;
  try {
    request.url = decodeURI(request.url);
  } catch (e) {
    self.debug.log('decodeURIfailed: %s: %s', request.url);
  }
  self.debug.log('Request: %s: %s', request.method, request.url);
  var _buffer = '';
  var data = '';

  let getRemoteAddress = function() {
    let ipAddress;
    // The request may be forwarded from local web server.
    let forwardedIpsStr = request.headers['x-forwarded-for']; 
    if (forwardedIpsStr) {
      // 'x-forwarded-for' header may return multiple IP addresses in
      // the format: "client IP, proxy 1 IP, proxy 2 IP" so take the
      // the first one
      let forwardedIps = forwardedIpsStr.split(',');
      ipAddress = forwardedIps[0];
    }
    if (!ipAddress) {
      ipAddress = request.connection.remoteAddress;
    }
    return ipAddress;
  }


  request.addListener('data', function(chunk) { _buffer += chunk; });
  request.addListener('end', function() {
    var requestDetails = {};
    requestDetails.url = request.url.substr(1);
    requestDetails.headers = request.headers;
    requestDetails._buffer = _buffer;
    requestDetails.method = request.method;
    requestDetails.remoteAddress = getRemoteAddress()

    if (_buffer != '') {
      self.debug.debug('Data: %s', _buffer);
      if(!self.data.binary) {
        try {
          data = JSON.parse(_buffer);
        } catch (e) {
          if (self.data.callbacks['responseHandler']) {
            return self.data.callbacks['responseHandler'](e, null, response, requestDetails);
          }
          response.writeHead(503, { 'content-type': 'application/json' });
          response.write(JSON.stringify({ error: e.message }, null, 2));
          response.end('\n');
          self.debug.debug('Error catched:\n %s', e.stack);
          return;
        }
      } else {
        data = _buffer
      }
    } else {
      data = {};
    }
    if (self.data.callbacks.loader) {
      self.data.callbacks.loader(request.method, _buffer, requestDetails, function(err) {
        if (err) {
          if (!err.code) {
            err.code = 403;
          }
          if (self.data.callbacks['responseHandler']) {
            return self.data.callbacks['responseHandler'](err, null, response, requestDetails);
          }
          response.writeHead(err.code, { 'content-type': 'application/json' });
          response.write(JSON.stringify({ message: err.message }, null, 2));
          response.end('\n');
          self.debug.debug('Validation error: %s', err.message);
          return;
        }
        return self.RequestValidate(request, response, _buffer, requestDetails, data);
      });
      return;
    }
    return self.RequestValidate(request, response, _buffer, requestDetails, data);
  });
};

/**
 * Process request and if implemented, call handlers.
 */
WebServer.prototype.RequestValidate = function(request, response, _buffer, requestDetails, data) {
  var self = this;
  if (self.data.callbacks.validate) {
    self.data.callbacks.validate(request.method, _buffer, requestDetails, function(err) {
      if (err) {
        if (!err.code) {
          err.code = 403;
        }
        if (self.data.callbacks['responseHandler']) {
          return self.data.callbacks['responseHandler'](err, null, response, requestDetails);
        }
        response.writeHead(err.code, { 'content-type': 'application/json' });
        response.write(JSON.stringify({ message: err.message }, null, 2));
        response.end('\n');
        self.debug.debug('Validation error: %s', err.message);
        return;
      }
      return self.RequestProcess(request.method, response, requestDetails, data);
    });
    return;
  }
  return self.RequestProcess(request.method, response, requestDetails, data);
}

/**
 * Process request and if implemented, call handlers.
 */
WebServer.prototype.RequestProcess = function(method, response, requestDetails, data) {
  var self = this;

  self.debug.debug('Parsed data: %O', data);
  try {
    if (self.data.callbacks[method]) {
      if (method == 'OPTIONS') {
        return self.data.callbacks[method](data, requestDetails, self.data.callbacks,
          function(err, handlerResponse) {
            self.callbackExecutor(err, handlerResponse, response, requestDetails);
          });
      }
      self.data.callbacks[method](data, requestDetails, function(err, handlerResponse) {
        self.callbackExecutor(err, handlerResponse, response, requestDetails);
      });
    } else {
      throw new Error(method + ' is not supported.');
    }
  } catch (e) {
    self.debug.debug('Error intersepted:\n %s', e.stack);
    e.code = 500;

    if (self.data.callbacks['responseHandler']) {
      return self.data.callbacks['responseHandler'](e, null, response, requestDetails);
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

  if (self.data.callbacks['responseHandler']) {
    return self.data.callbacks['responseHandler'](err, handlerResponse, response, requestDetails);
  }

  if (err) {
    self.debug.debug('Handler responce error:\n %O', err);
    response.writeHead(503, { 'content-type': 'application/json' });
    response.write(JSON.stringify({message: err.message }, null, 2));
    response.end('\n');
  } else {
    self.debug.debug('Handler responce:\n %O', handlerResponse);
    if (handlerResponse.headers) {
      if (!handlerResponse.headers['content-type']) {
        handlerResponse.headers['content-type'] = 'application/json';
      }
    } else {
      handlerResponse.headers = { 'content-type': 'application/json' };
    }
    response.writeHead(handlerResponse.code, handlerResponse.headers);
    if (typeof handlerResponse.answer == 'string') {
      response.write(handlerResponse.answer);
    } else {
      response.write(JSON.stringify(handlerResponse.answer, null, 2));
    }
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
