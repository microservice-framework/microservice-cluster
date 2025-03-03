/**
 * Handle HTTP startup and shutdown.
 * Parse request and send answer.
 */
'use strict';

import http from 'node:http';
import debug from 'debug';

/**
 * Constructor.
 *   Prepare data for deploy.
 */
function WebServer(data) {
  // Use a closure to preserve `this`
  this.data = data;
  this.server = http.createServer((request, response) => {
    this.RequestHandler(request, response);
  });

  // Use random port if port settings is not provided.
  let port = parseInt(process.env.PORT);
  if (!port) {
    port = 2001;
  }

  // Use address if provided.
  if (this.data.hostname) {
    this.server.listen(port, this.data.hostname);
  } else {
    this.server.listen(port);
  }

  this.server.on('listening', () => {
    this.debug.log('Listen on :%s', this.server.address().port);
  });
  this.server.on('clientError', (err, socket) => {
    socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  });
}

/**
 * Process http request and collect POSt and PUT data.
 */
WebServer.prototype.RequestHandler = function (request, response) {
  try {
    request.url = decodeURI(request.url);
  } catch (e) {
    this.debug.log('decodeURIfailed: %s: %s', request.url);
  }
  this.debug.log('Request: %s: %s', request.method, request.url);
  let _buffer = '';

  request.addListener('data', (chunk) => {
    _buffer += chunk;
  });
  request.addListener('end', () => {
    let requestDetails = {};
    requestDetails.url = request.url.substr(1);
    requestDetails.headers = request.headers;
    requestDetails._buffer = _buffer;
    requestDetails.method = request.method;
    requestDetails.remoteAddress = request.connection.remoteAddress;
    let decodedData = false;

    if (_buffer != '') {
      this.debug.debug('Data: %s', _buffer);

      try {
        decodedData = this.decodeData(request.headers['content-type'], _buffer);
      } catch (e) {
        if (this.data.responseHandler) {
          return this.data.responseHandler(e, null, response, requestDetails);
        }
        response.writeHead(503, () => {
          return this.validateHeaders({});
        });
        response.write(JSON.stringify({ error: e.message }, null, 2));
        response.end('\n');
        this.debug.debug('Error catched:\n %s', e.stack);
        return;
      }
    } else {
      decodedData = requestDetails.url;
    }
    if (this.data.loader) {
      this.data.loader(requestDetails).then((err) => {
        if (err) {
          if (!err.code) {
            err.code = 403;
          }
          if (this.data.responseHandler) {
            return this.data.responseHandler(err, null, response, requestDetails);
          }
          response.writeHead(err.code, () => {
            return this.validateHeaders({});
          });
          response.write(JSON.stringify({ message: err.message }, null, 2));
          response.end('\n');
          this.debug.debug('Loading error: %s', err.message);
          return;
        }
        this.RequestValidate(request, response, _buffer, requestDetails, decodedData).then((isValidated) => {
          if(isValidated) {
            this.RequestProcess(request.method, response, requestDetails, decodedData);
          }
        });
      })
      return;
    }
    this.RequestValidate(request, response, _buffer, requestDetails, decodedData).then((isValidated) => {
      if(isValidated) {
        this.RequestProcess(request.method, response, requestDetails, decodedData);
      }
    });
  });
};

/**
 * Encode answer property if nesessary.
 */
WebServer.prototype.encodeHandlerResponseAnswer = function (handlerResponse) {
  if (!handlerResponse.headers) {
    handlerResponse.headers = {};
  }

  if (!handlerResponse.headers['content-type']) {
    if (typeof handlerResponse.answer == 'string') {
      handlerResponse.headers['content-type'] = 'text/plain';
    } else {
      handlerResponse.headers['content-type'] = 'application/json';
    }
  }

  switch (handlerResponse.headers['content-type']) {
    case 'application/json': {
      handlerResponse.answer = JSON.stringify(handlerResponse.answer, null, 2);
      break;
    }
  }
};

/**
 * Process request and if implemented, call handlers.
 */
WebServer.prototype.RequestValidate = async function (request, response, _buffer, requestDetails, data) {
  if (this.data.validate) {
    let isAllowed = await this.data.validate(request.method, _buffer, requestDetails);
    if (isAllowed === true) {
      return true
    }
    // if custom handler exists
    if (this.data.responseHandler) {
      return this.data.responseHandler(isAllowed, null, response, requestDetails);
    }

    response.writeHead(403, () => {
      return this.validateHeaders({});
    });
    response.write(JSON.stringify({ message: isAllowed.message }, null, 2));
    response.end('\n');
    this.debug.debug('Validation error: %s', isAllowed.message);
    return false
  }
  return true
};

/**
 * Process request and if implemented, call handlers.
 */
WebServer.prototype.RequestProcess = function (method, response, requestDetails, data) {
  this.debug.debug('Parsed data: %O', data);
  try {
    if (this.data.methods[method]) {
      if (method == 'OPTIONS') {
        return this.data.methods[method](data, requestDetails, this.data.methods).then((handlerResponse) => {
          this.callbackExecutor(handlerResponse, response, requestDetails);
        }).catch((e) => {
          this.debug.debug('Error intersepted:\n %s', e.stack);
          e.code = 500;

          if (this.data.responseHandler) {
            return this.data.responseHandler(e, null, response, requestDetails);
          }
          response.writeHead(e.code, () => {
            return this.validateHeaders({});
          });
          response.write(JSON.stringify({ error: e.message }, null, 2));
          response.end('\n');
        })
      }
      if (method == 'PUT') {
        return this.data.methods[method](requestDetails.url, data, requestDetails).then((handlerResponse) => {
          this.callbackExecutor(handlerResponse, response, requestDetails);
        })
      }
      // no body elements for GET and DELETE
      if (['GET', 'DELETE'].includes(method)) {
        data = requestDetails.url;
      }

      // POST, SEARCH, PATCH etc
      return this.data.methods[method]( data, requestDetails).then((handlerResponse) => {
        this.callbackExecutor(handlerResponse, response, requestDetails);
      }).catch((e) => {
        this.debug.debug('Error intersepted:\n %s', e.stack);
        e.code = 500;
    
        if (this.data.responseHandler) {
          return this.data.responseHandler(e, null, response, requestDetails);
        }
        response.writeHead(e.code, () => {
          return this.validateHeaders({});
        });
        response.write(JSON.stringify({ error: e.message }, null, 2));
        response.end('\n');
      })
    } else {
      throw new Error(method + ' is not supported.');
    }
  } catch (e) {
    this.debug.debug('Error intersepted:\n %s', e.stack);
    e.code = 500;

    if (this.data.responseHandler) {
      return this.data.responseHandler(e, null, response, requestDetails);
    }
    response.writeHead(e.code, () => {
      return this.validateHeaders({});
    });
    response.write(JSON.stringify({ error: e.message }, null, 2));
    response.end('\n');
  }
};

/**
 * Output answer from handlers.
 */
WebServer.prototype.callbackExecutor = function (handlerResponse, response, requestDetails) {
  if (!response.connection) {
    this.debug.log('Writing after socket is closed handlerResponse: %O', handlerResponse);
    this.debug.log('Writing after socket is closed requestDetails: %O', requestDetails);
    return;
  }

  if (this.data.responseHandler) {
    return this.data.responseHandler(handlerResponse, response, requestDetails);
  }

  if (handlerResponse.error) {
    if (!handlerResponse.code) {
      handlerResponse.code = 503;
    }
    if(!handlerResponse.answer) {
      if(handlerResponse.error.message) {
        handlerResponse.answer = {message: handlerResponse.error.message}
      } else {
        handlerResponse.answer = {message: handlerResponse.error}
      }
    }
  }

  this.encodeHandlerResponseAnswer(handlerResponse);
  response.writeHead(handlerResponse.code, this.validateHeaders(handlerResponse.headers));
  response.write(handlerResponse.answer);
  response.end('\n');
};

/**
 * decode buffer to specidied by content-type format.
 */
WebServer.prototype.decodeData = function (contentType, buffer) {
  let data = false;
  switch (contentType) {
    case undefined: // version 1.x compatibility. If no content-type provided, assume json.
    case 'application/json': {
      data = JSON.parse(buffer);
      break;
    }
    // Todo support more decoders here?
    default: {
      data = buffer;
    }
  }
  return data;
};

/**
 * Encode answer property if nesessary.
 */
WebServer.prototype.validateHeaders = function (headers) {
  if (!headers) {
    headers = {};
  }
  for (let i in headers) {
    if (headers[i] == undefined) {
      delete headers[i];
    }
  }
  if (!headers['content-type']) {
    headers['content-type'] = 'application/json';
  }
  return headers;
};

/**
 * Process server stop request.
 */
WebServer.prototype.stop = function (callback) {
  this.server.close(() => {
    this.debug.log('Worker stopped');
    callback();
  });
};

/**
 * Define debug methods.
 */
WebServer.prototype.debug = {
  log: debug('http:log'),
  request: debug('http:request'),
  debug: debug('http:debug'),
};

export default WebServer;
