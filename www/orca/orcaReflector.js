/*jslint browser: true, unparam: true, sloppy: true */
/*global SessionError, CallError */

(function () {
    var orcaReflector, previousCall = null, SessionStatus, CallStatus;

    SessionStatus = {};
    SessionStatus.CONNECTED = 'connected';
    SessionStatus.CONNECTING = 'connecting';
    SessionStatus.DISCONNECTED = 'disconnected';
    SessionStatus.INCOMINGCALL = 'incomingCall';

    CallStatus = {};
    CallStatus.CONNECTING = 'connecting';
    CallStatus.HOLD = 'hold';
    CallStatus.UNHOLD = 'unhold';
    CallStatus.REJECTED = 'rejected';
    CallStatus.CONNECTED = 'connected';
    CallStatus.DISCONNECTED = 'disconnected';
    CallStatus.ADDSTREAM = 'stream:add';
	CallStatus.SDP = 'stream:sdp';
	CallStatus.ICE = 'stream:ice';
	
	Protocol = {};
	Protocol.REGISTER = 'REGISTER';
	Protocol.REGISTER_OK = 'REGISTER/200/0K';
	Protocol.REGISTER_ERROR = 'REGISTER/4';
	Protocol.CALL = 'INVITE';
	Protocol.CALL_OK = 'INVITE/200/OK';
	Protocol.CALL_CANDIDATE = 'iceCandidate';
	Protocol.CALL_REJECTED = 'INVITE/486/Busy Here';
	Protocol.CALL_ERROR = 'INVITE/4';
	Protocol.CALL_TERMINATE = 'BYE';

    function Call(to, mediaTypes, session, callback, isIncoming) {
        this.to = to;
        this.mediaTypes = mediaTypes;
        this.session = session;
        this.callback = callback;
        this.isIncoming = isIncoming;
        this.parallel = null;
        this.remoteStreamsList = [];
        this.localStreamsList = [];		
		this.peerConnection = null;
		this.messageQueue = [];
		var signalingReady = false;

        if (isIncoming) {
            this.status = CallStatus.CONNECTING;
            this.inStatus = CallStatus.CONNECTING;
        } else {
            this.status = undefined; // pre connect()
            this.inStatus = undefined;
        }
        if (previousCall) {
            previousCall = this;
        }

        this.triggerEvent = function (status, data) {
            var eventInfo = {}, i;
            switch (status) {
				case CallStatus.ADDSTREAM:
					eventInfo.stream = data;
					this.remoteStreamsList.push(data);
					break;
				case CallStatus.CONNECTED:
				case CallStatus.CONNECTING:
					this.status = status;
					this.inStatus = status;
					break;
				case CallStatus.DISCONNECTED:
				case CallStatus.REJECTED:
					this.status = status;
					this.inStatus = status;                
                    this.session.removeCall(this);	
					break;
				case CallStatus.SDP:
					this.peerConnection.setRemoteDescription(new RTCSessionDescription(data));	
					signalingReady = true;		
					if (!this.isIncoming)                          										
						this.callback.triggerEvent(CallStatus.CONNECTED);
					break;
				case CallStatus.ICE:
					if (data) {
						if (signalingReady)
							this.peerConnection.addIceCandidate(new RTCIceCandidate(data));
						else this.messageQueue.push(data);						
					}
				break;
                
            }
            this.emitter.emit(status, eventInfo, this.callback);
        };

        this.remoteIdentities = function () {
            var result = [{id: this.to}];
            return result;
        };

        this.addStream = function (stream) {
            this.localStreamsList.push(stream);
        };

        this.connect = function () {
            
            if (this.isIncoming) {                         
                this.acceptWebRTCCall();				       
                this.callback.triggerEvent(CallStatus.CONNECTED);
            } else {

				this.session.call = this.callback;
				this.sendWebRTCCall();
				this.callback.triggerEvent(CallStatus.CONNECTING);				               
            }
        };
		
		this.createWebRTCCall = function () {
		
			this.peerConnection = new RTCPeerConnection(this.session.sessionConfig.hostilityhelper);

			var self = this;			
			
			this.peerConnection.onaddstream = function(event) {
				var s = self.callback.addStream(event.stream);
				self.callback.triggerEvent(CallStatus.ADDSTREAM, s);
			};				

			this.peerConnection.onicecandidate = function(event) {				
				self.session.wsconn.send(Protocol.CALL_CANDIDATE, to, 'candidate', event.candidate);				
			};				

		};
		
		this.sendWebRTCCall = function() {
		
			var self = this;
			var stream = this.callback.streams('local')[0].stream();
			this.peerConnection.addStream(stream);
			this.peerConnection.createOffer(function(desc) {
				self.peerConnection.setLocalDescription(desc, function() {					
					self.session.wsconn.send(Protocol.CALL, to, 'sdp', desc)});
			}, error);
		
		};
		
		this.acceptWebRTCCall = function() {
		
			var self = this;
			var stream = this.callback.streams('local')[0].stream();
			this.peerConnection.addStream(stream);						
			this.peerConnection.createAnswer(function(desc) {
				self.peerConnection.setLocalDescription(desc, function() {					
					self.session.wsconn.send(Protocol.CALL_OK, to, 'sdp', desc)});
				}, error);
					
			while (this.messageQueue.length > 0)
				this.triggerEvent(CallStatus.ICE, this.messageQueue.shift());						

		};
		

        this.disconnect = function () {			
			this.session.wsconn.send(Protocol.CALL_TERMINATE, to);
			if (this.peerConnection.signalingState != "closed")
				this.peerConnection.close();
            this.callback.triggerEvent(CallStatus.DISCONNECTED);
        };

        this.reject = function () {
            if (this.isIncoming) {
				this.session.wsconn.send(Protocol.CALL_REJECTED, to);
                this.session.removeCall(this);                
            }
        };

        this.remoteStreams = function () {
            return this.remoteStreamsList;
        };

        this.localStreams = function () {
            return this.localStreamsList;
        };

        this.getStatus = function () {
            return this.status;
        };
		
		this.createWebRTCCall();

    }

    function Session(userId, token, config, callback) {
        this.userId = userId;
		this.sessionConfig = config;
        this.callback = callback;
        this.status = SessionStatus.DISCONNECTED;
        this.inStatus = SessionStatus.DISCONNECTED;
        this.call = false;
		this.wsconn = new WSConnection(this);        

        this.triggerEvent = function (status, call) {
            var eventInfo = {}, i;
            if (call) {
                eventInfo.call = call;
                this.call = call;
            } else {
                this.status = status;
                this.inStatus = status;
            }
            this.emitter.emit(status, eventInfo, this.callback);
        };

        this.removeCall = function (call) {
            var i;
            if (this.call.callback !== 'undefined') {
                this.call = call.callback;
            }
            this.call = false;
        };

        this.connect = function () {
            if (this.inStatus === SessionStatus.DISCONNECTED) {                
				this.triggerEvent(SessionStatus.CONNECTING);                
				this.wsconn.open();                                                    
				
            }
        };

        this.createCall = function (to, mediatypes, session, callback, isIncoming) {
            return new Call(to, mediatypes, session, callback, isIncoming);
        };

        this.disconnect = function () {
            
            if (this.call) {
                this.call.disconnect();
				this.removeCall(this.call);
            }
			this.wsconn.close();
            this.triggerEvent(SessionStatus.DISCONNECTED);            
			
        };

        this.getStatus = function () {
            return this.status;
        };

    }
	
	// A Web Socket connection class to discuss with the reflector
	function WSConnection(session) {
	
		this.session = session;
		var socket;
		var timerID;
		
		this.open = function () {
		
			this.socket = new WebSocket(this.session.sessionConfig.uri);	
			var $this = this;			
			this.socket.onopen = function () {		
				$this._onwsopen();
			};
			this.socket.onclose = function (event) {		
				$this._onwsclose(event);
			};
			this.socket.onerror = function (error) {		
				$this._onwserror(error);
			};
			this.socket.onmessage = function (msg) {		
				$this._onmessage(msg);
			};
		};
		
		this.keepalive = function() {
		
			this.send(Protocol.REGISTER, this.session.userId);
		}
		
		this.send = function (method, uri, param, value) {
			
			var msg = {
				method: method,
				from: this.session.userId,
				to : uri
			};
			if (param != undefined)
				msg[param] = value;
			this.socket.send(JSON.stringify(msg));	
			console.log("==> " + JSON.stringify(msg));
		};
		
		
		this.close = function () {
			
			clearInterval(this.timerID);
			this.socket.onclose = null;
			this.socket.close();
		};
		

		this._onwsopen = function () {
			
			this.send(Protocol.REGISTER, this.session.userId);
			var self = this;
			// we send REGISTER periodically to avoid some proxies to close the websocket for inactivity
			this.timerID = setInterval(function () {self.keepalive();}, 120000); 
			this.session.triggerEvent(SessionStatus.CONNECTED);
		};
		

		this._onmessage = function (msg) {
		
			console.log("<== " + msg.data);
			var json = JSON.parse(msg.data);
			if (json.method == Protocol.CALL) {			
				this.session.callback.triggerEvent(SessionStatus.INCOMINGCALL, json.from);
				this.session.call.triggerEvent(CallStatus.SDP, json.sdp);
			}
			else if (json.method == Protocol.CALL_OK)
				this.session.call.triggerEvent(CallStatus.SDP, json.sdp);			
			else if (json.method == Protocol.CALL_CANDIDATE) 
				this.session.call.triggerEvent(CallStatus.ICE, json.candidate);
			else if (json.method == Protocol.CALL_REJECTED)
				this.session.call.triggerEvent(CallStatus.REJECTED);
			else if (json.method == Protocol.CALL_TERMINATE) 			
				this.session.call.triggerEvent(CallStatus.DISCONNECTED);
			else if (json.method.indexOf(Protocol.CALL_ERROR) == 0) {
				alert("Call error: " + json.method);
				this.session.call.disconnect();
			}
			else if (json.method.indexOf(Protocol.REGISTER_ERROR) == 0) {
				alert("Session error: " + json.method);
				this.session.disconnect();
			}
		};
		
		this._onwserror = function (error) {
		
		};
		
		
		this._onwsclose = function (event) {		
			alert("Server connection closed!");
			this.session.disconnect();
			clearInterval(this.timerID);
		}
	}
	
	function error(err) { console.log(err); }

    orcaReflector = {

        createSession: function (userid, token, sessionConfig, callback) {
            return new Session(userid, token, sessionConfig, callback);
        }

    };

    this.orcaReflector = orcaReflector;

}());
