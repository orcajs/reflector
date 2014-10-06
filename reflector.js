var domain = require("domain");
var winston = require("winston");
var connect = require("connect");
var serveStatic = require("serve-static");
var serveIndex = require("serve-index");
var WebSocketServer = require('ws').Server;
var http = require("http");
var config = require("./config.js");


// Constants
////////////

var STATIC_DIR = "www";


// Logger configuration
///////////////////////

var logger = winston;
logger.clear();
logger.add(winston.transports.Console, {level: config.log.level, colorize: 'true'});
logger.setLevels(winston.config.npm.levels); // silly, debug, verbose, info, warn, error


// Setting-up the http server
/////////////////////////////

var app = connect();
app.use(serveStatic(STATIC_DIR));
app.use(serveIndex(STATIC_DIR));

var httpServer = http.createServer(app);
httpServer.on("listening", function() {
	logger.info("Orca reflector signalization server started on port %s", config.server.port);
});


// Run the http server and handle errors
////////////////////////////////////////

var errorDomain = domain.create();
errorDomain.on('error', function(err) {
	if(err.code === "EADDRINUSE") {
		logger.error("Port %s is already in use, stopping.", config.server.port);
	}
	else {
		logger.error(err);
	}
});
errorDomain.run(function() {
	httpServer.listen(config.server.port);
});


// Setting-up the reflector on top of WebSocket
///////////////////////////////////////////////

var wsRegistrar = new WebSocketServer({ server: httpServer });
wsRegistrar.on('connection', function(conn) {
	logger.verbose("New client connected from %s:%s", conn._socket.remoteAddress, conn._socket.remotePort);
	conn.isWho = null;
	conn.on('message', function(message) {
		logger.silly("Message received from %s:%s: %s", conn._socket.remoteAddress, conn._socket.remotePort, message);
		messageHandler(message, conn);
	});
	conn.on('close', function() {
		logger.verbose("Connection closed from %s:%s.", conn._socket.remoteAddress, conn._socket.remotePort);
		closeHandler(conn);
	});
});


// WebSocket / signal
/////////////////////

var registrar = Object.create(null);

function messageHandler(message, conn) {
	try {
		message = JSON.parse(message);
	}
	catch(e) {
		logger.warn("JSON parsing error: " + e);
		sendMessage("400/json", conn);
		return;
	}
	if (! ("method" in message) ) {
		logger.warn("Bad message received: " + message);
		sendMessage("400/no-method", conn);
		return;
	}
	switch(message.method) {
		case "REGISTER":
			if (conn.isWho !== null) {
				sendMessage('REGISTER/200/already-registered', conn);
				return;
			}
			if(! ("from" in message)) {
				sendMessage("REGISTER/400/no-from", conn);
				return;
			}
			if (message.from.length == 0) {
				sendMessage("REGISTER/400/empty-from", conn);
				return;
			}
			if (message.from in registrar) {
			 	//sendMessage('REGISTER/400/duplicate-id', conn);
				//return;

				//close old client websocket
				var oldConnection = registrar[message.from];
				registrar[message.from] = conn;
			 	oldConnection.close();
			}
			registrar[message.from] = conn;
			conn.isWho = message.from;
			logger.verbose("%s:%s registered as %s.", conn._socket.remoteAddress, conn._socket.remotePort, conn.isWho);
			sendMessage('REGISTER/200/OK', conn);
			break;
		
		default:
			if (conn.isWho === null) {
				sendMessage(message.method+'/400/not-registered', conn);
				return;
			}
			if ( ('to' in message) && !('from' in message)) {
				sendMessage(message.method+'/400/no-from', conn);
				return;
			}
			if ( ('to' in message) && (message.from != conn.isWho)) {
				sendMessage(message.method+'/400/bad-from', conn);
				return;
			}
			if (message.to === conn.isWho) {
				sendMessage(message.method+'/400/oneself-forbidden', conn);
				return;
			}
			if (message.to in registrar) {
				registrar[message.to].send(JSON.stringify(message), sendCallback);
			}
			else {
				sendMessage(message.method+'/400/peer-unavailable', conn);
			}
	}

}

function closeHandler(conn) {
	if ((conn.isWho !== null) && (conn === registrar[conn.isWho])) {
		delete registrar[conn.isWho];
	}
}

function sendMessage(code, conn) {
	var msg = {
		method: code,
	};
	conn.send(JSON.stringify(msg), sendCallback);
}

// Errors (both immediate and async write errors) can be detected in an optional callback.
// The callback is also the only way of being notified that data has actually been sent.
var sendCallback = function(error) {
    // if error is null, the send has been completed,
    // otherwise the error object will indicate what failed.
    if (error) {
         logger.warn('[ ] sending error: '+error);
         return;
    }
    logger.verbose('[ ] sending success');
};
